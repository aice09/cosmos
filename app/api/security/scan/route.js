import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  DEFAULT_TRIVY_VERSION,
  isAllowedImageRegistry,
  listClusterImages,
} from '../image-inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const MAX_REQUEST_BYTES = 4096;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const SCAN_TIMEOUT_MS = 8 * 60 * 1000;
const SBOM_FORMATS = {
  cyclonedx: { extension: 'cdx.json', contentType: 'application/vnd.cyclonedx+json' },
  'spdx-json': { extension: 'spdx.json', contentType: 'application/spdx+json' },
  spdx: { extension: 'spdx', contentType: 'text/plain; charset=utf-8' },
};

const require = createRequire(path.join(process.cwd(), 'package.json'));
const trivyPackageDirectory = path.dirname(require.resolve('@b2bc-devkit/trivy-scan/package.json'));
const trivyRunnerPath = path.join(trivyPackageDirectory, 'dist/src/bin/trivy-scan.js');
let scanInProgress = false;

function validImageReference(image) {
  return typeof image === 'string' &&
    image.length <= 512 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(image);
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  if (!request.body) throw new Error('A scan request is required.');

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error('Request body is too large.');
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('The scan request must contain valid JSON.');
  }
}

function runTrivy(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [trivyRunnerPath, ...args],
      {
        detached: process.platform !== 'win32',
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    let killTimer;

    function stopProcess(signal) {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') console.error(`Unable to signal Trivy process group (${signal}):`, error);
        }
      } else {
        child.kill(signal);
      }
    }

    function terminateProcess() {
      stopProcess('SIGTERM');
      if (!killTimer) killTimer = setTimeout(() => stopProcess('SIGKILL'), 5000);
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcess();
    }, SCAN_TIMEOUT_MS);

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        terminateProcess();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      reject(error);
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      const output = Buffer.concat(stdout).toString('utf8');
      const diagnostics = Buffer.concat(stderr).toString('utf8').trim();

      if (timedOut) {
        reject(new Error('Trivy exceeded the 8-minute scan limit.'));
      } else if (outputExceeded) {
        reject(new Error('Trivy output exceeded the 20 MB report limit.'));
      } else if (code !== 0) {
        console.error('Trivy scan failed:', diagnostics.slice(-4000));
        reject(new Error(diagnostics.slice(-1000) || `Trivy exited with status ${code}.`));
      } else {
        resolve(output);
      }
    });
  });
}

async function requestEnvironment() {
  const dockerConfig = await mkdtemp(path.join(tmpdir(), 'cosmos-trivy-docker-'));
  return {
    dockerConfig,
    environment: {
      ...process.env,
      DOCKER_CONFIG: dockerConfig,
      TRIVY_SCAN_VERSION: process.env.TRIVY_SCAN_VERSION || DEFAULT_TRIVY_VERSION,
      TRIVY_SCAN_CACHE_DIR: process.env.TRIVY_SCAN_CACHE_DIR ||
        path.join(homedir(), '.cache', 'trivy-scan'),
    },
  };
}

export async function POST(request) {
  if (scanInProgress) {
    return Response.json(
      { error: 'A Trivy scan is already running. Try again when it completes.' },
      { status: 409 },
    );
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const { image, action, format } = body || {};
  if (!validImageReference(image)) {
    return Response.json({ error: 'Select a valid image reference from the cluster inventory.' }, { status: 400 });
  }
  if (action !== 'sbom') {
    return Response.json({ error: 'Use Trivy Operator reports for vulnerability scans; this endpoint only exports SPDX SBOMs.' }, { status: 400 });
  }
  if (action === 'sbom' && !Object.hasOwn(SBOM_FORMATS, format)) {
    return Response.json({ error: 'Choose CycloneDX JSON, SPDX JSON, or SPDX tag-value format.' }, { status: 400 });
  }
  if (!isAllowedImageRegistry(image)) {
    return Response.json(
      { error: 'This image registry is not allowed. Configure TRIVY_ALLOWED_REGISTRIES to permit it.' },
      { status: 403 },
    );
  }

  scanInProgress = true;
  let dockerConfig;
  try {
    const images = await listClusterImages();
    if (!images.some((entry) => entry.image === image)) {
      return Response.json(
        { error: 'The image is no longer referenced by a cluster Pod. Refresh the image inventory and try again.' },
        { status: 409 },
      );
    }

    const setup = await requestEnvironment();
    dockerConfig = setup.dockerConfig;
    const args = ['image', '--image-src', 'remote', '--scanners', 'vuln', '--format', format, '--quiet', '--no-progress', image];
    const output = await runTrivy(args, setup.environment);

    const details = SBOM_FORMATS[format];
    const safeName = image.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
    return new Response(output, {
      headers: {
        'Content-Type': details.contentType,
        'Content-Disposition': `attachment; filename="${safeName}.${details.extension}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return Response.json(
        { error: 'The npm Trivy runner is missing from this deployment. Rebuild the app with npm install.' },
        { status: 503 },
      );
    }
    console.error('Unable to complete Trivy image operation:', error);
    return Response.json(
      { error: error.message || 'Trivy could not scan this image. Check registry reachability and try again.' },
      { status: 502 },
    );
  } finally {
    scanInProgress = false;
    if (dockerConfig) {
      try {
        await rm(dockerConfig, { recursive: true, force: true });
      } catch (error) {
        console.error('Unable to remove temporary Docker config directory:', error);
      }
    }
  }
}
