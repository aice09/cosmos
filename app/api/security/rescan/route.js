import * as k8s from '@kubernetes/client-node';
import {
  listClusterImages,
  listClusterVulnerabilityReports,
  reportMatchesImage,
} from '../image-inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 4096;

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  if (!request.body) throw new Error('A rescan request is required.');

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
    throw new Error('The rescan request must contain valid JSON.');
  }
}

function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'Rescan requests must come from this dashboard origin.' }, { status: 403 });
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const { image } = body || {};
  if (
    typeof image !== 'string' ||
    image.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(image)
  ) {
    return Response.json({ error: 'Select a valid image reference from the cluster inventory.' }, { status: 400 });
  }

  try {
    const images = await listClusterImages();
    if (!images.some((entry) => entry.image === image)) {
      return Response.json(
        { error: 'The image is no longer referenced by a cluster Pod. Refresh the image inventory and try again.' },
        { status: 409 },
      );
    }

    const reports = await listClusterVulnerabilityReports();
    const matchingReports = reports.filter((report) => reportMatchesImage(image, report));
    if (!matchingReports.length) {
      return Response.json(
        { error: 'No completed report exists for this image yet. Trivy Operator scans active workloads automatically.' },
        { status: 409 },
      );
    }

    const config = new k8s.KubeConfig();
    config.loadFromDefault();
    const customObjects = config.makeApiClient(k8s.CustomObjectsApi);
    let deletedReports = 0;
    for (const report of matchingReports) {
      const namespace = report.metadata?.namespace;
      const name = report.metadata?.name;
      if (!namespace || !name) continue;
      try {
        await customObjects.deleteNamespacedCustomObject(
          {
            group: 'aquasecurity.github.io',
            version: 'v1alpha1',
            namespace,
            plural: 'vulnerabilityreports',
            name,
          },
        );
        deletedReports += 1;
      } catch (error) {
        if (error.statusCode !== 404 && error.response?.statusCode !== 404) throw error;
      }
    }

    if (!deletedReports) {
      return Response.json(
        { error: 'The cached report was already removed. Refresh the image inventory to check scan progress.' },
        { status: 409 },
      );
    }

    return Response.json({ image, deletedReports, status: 'rescan-requested' }, { status: 202 });
  } catch (error) {
    console.error('Unable to request a Trivy Operator rescan:', error);
    return Response.json(
      { error: 'Unable to request a rescan. Check Trivy Operator availability and dashboard report-delete RBAC.' },
      { status: 503 },
    );
  }
}
