import * as k8s from '@kubernetes/client-node';

export const DEFAULT_TRIVY_VERSION = 'v0.76.1';

const DEFAULT_ALLOWED_REGISTRIES = [
  'docker.io',
  'index.docker.io',
  'registry-1.docker.io',
  'ghcr.io',
  'quay.io',
  'registry.k8s.io',
  'gcr.io',
  'public.ecr.aws',
  'mcr.microsoft.com',
  '.pkg.dev',
];

export function registryForImage(image) {
  const firstPathSegment = image.split('/')[0].toLowerCase();
  return image.includes('/') &&
    (firstPathSegment.includes('.') || firstPathSegment.includes(':') || firstPathSegment === 'localhost')
    ? firstPathSegment
    : 'docker.io';
}

export function isAllowedImageRegistry(image) {
  const registry = registryForImage(image);
  const configured = (process.env.TRIVY_ALLOWED_REGISTRIES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowlist = [...DEFAULT_ALLOWED_REGISTRIES, ...configured];
  return allowlist.some((allowed) =>
    allowed.startsWith('.')
      ? registry.endsWith(allowed)
      : registry === allowed,
  );
}

export async function listClusterImages() {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  const core = config.makeApiClient(k8s.CoreV1Api);
  const response = await core.listPodForAllNamespaces();
  const imageUses = new Map();

  for (const pod of response.items || []) {
    const containers = [
      ...(pod.spec?.initContainers || []),
      ...(pod.spec?.containers || []),
      ...(pod.spec?.ephemeralContainers || []),
    ];
    for (const container of containers) {
      if (!container.image) continue;
      const uses = imageUses.get(container.image) || [];
      uses.push({
        namespace: pod.metadata?.namespace || 'default',
        pod: pod.metadata?.name || 'unknown',
        container: container.name || 'unknown',
      });
      imageUses.set(container.image, uses);
    }
  }

  return [...imageUses.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([image, uses]) => ({
      image,
      uses,
      count: uses.length,
      scanAllowed: isAllowedImageRegistry(image),
      registry: registryForImage(image),
    }));
}

function canonicalRegistry(registry) {
  return ['index.docker.io', 'registry-1.docker.io'].includes(registry.toLowerCase())
    ? 'docker.io'
    : registry.toLowerCase();
}

function parseImageReference(reference) {
  const [name, digest] = reference.split('@', 2);
  const firstPathSegment = name.split('/')[0];
  const explicitRegistry = name.includes('/') &&
    (firstPathSegment.includes('.') ||
      firstPathSegment.includes(':') ||
      firstPathSegment === 'localhost');
  const registry = canonicalRegistry(explicitRegistry ? firstPathSegment : 'docker.io');
  let repository = explicitRegistry ? name.slice(firstPathSegment.length + 1) : name;
  const lastSlash = repository.lastIndexOf('/');
  const lastColon = repository.lastIndexOf(':');
  const tag = lastColon > lastSlash ? repository.slice(lastColon + 1) : '';
  if (tag) repository = repository.slice(0, lastColon);
  if (registry === 'docker.io' && !repository.includes('/')) {
    repository = `library/${repository}`;
  }
  return { registry, repository, tag: tag || (digest ? '' : 'latest'), digest: digest || '' };
}

function reportImageReference(report) {
  const artifact = report.report?.artifact || {};
  if (!artifact.repository) return '';
  const firstPathSegment = artifact.repository.split('/')[0];
  const repositoryHasRegistry = firstPathSegment.includes('.') ||
    firstPathSegment.includes(':') ||
    firstPathSegment === 'localhost';
  const registry = report.report?.registry?.server || 'docker.io';
  const repository = repositoryHasRegistry
    ? artifact.repository
    : `${registry}/${artifact.repository}`;
  return `${repository}${artifact.tag ? `:${artifact.tag}` : ''}` +
    `${artifact.digest ? `@${artifact.digest}` : ''}`;
}

export function reportMatchesImage(image, report) {
  const reportReference = reportImageReference(report);
  if (!reportReference) return false;
  const requested = parseImageReference(image);
  const scanned = parseImageReference(reportReference);
  if (requested.digest) return requested.digest === scanned.digest;
  return requested.registry === scanned.registry &&
    requested.repository === scanned.repository &&
    requested.tag === scanned.tag;
}

export function aggregateVulnerabilityReports(image, reports) {
  const matchingReports = reports.filter((report) => reportMatchesImage(image, report));
  if (!matchingReports.length) return null;

  const findings = new Map();
  for (const report of matchingReports) {
    for (const vulnerability of report.report?.vulnerabilities || []) {
      const finding = {
        target: vulnerability.target || vulnerability.resource || '—',
        id: vulnerability.vulnerabilityID || '—',
        package: vulnerability.resource || '—',
        installedVersion: vulnerability.installedVersion || '—',
        fixedVersion: vulnerability.fixedVersion || '—',
        severity: (vulnerability.severity || 'UNKNOWN').toUpperCase(),
        title: vulnerability.title || vulnerability.description || '—',
        url: vulnerability.primaryLink || vulnerability.links?.[0] || '',
      };
      findings.set(
        JSON.stringify([
          finding.id,
          finding.package,
          finding.installedVersion,
          finding.fixedVersion,
          finding.target,
          finding.severity,
        ]),
        finding,
      );
    }
  }

  const vulnerabilities = [...findings.values()];
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const vulnerability of vulnerabilities) {
    counts[vulnerability.severity] = (counts[vulnerability.severity] || 0) + 1;
  }

  const scannedAt = matchingReports
    .map((report) => report.report?.updateTimestamp || report.metadata?.creationTimestamp || '')
    .filter(Boolean)
    .sort()
    .at(-1) || '';
  const artifact = matchingReports.find((report) => report.report?.artifact?.digest)
    ?.report?.artifact;

  return {
    image,
    scannedAt,
    digest: artifact?.digest || '',
    reportCount: matchingReports.length,
    counts,
    vulnerabilities,
  };
}

export async function listClusterVulnerabilityReports() {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  const customObjects = config.makeApiClient(k8s.CustomObjectsApi);
  const response = await customObjects.listClusterCustomObject(
    {
      group: 'aquasecurity.github.io',
      version: 'v1alpha1',
      plural: 'vulnerabilityreports',
    },
  );
  return response.items || [];
}

export async function listClusterSbomReports() {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  const customObjects = config.makeApiClient(k8s.CustomObjectsApi);
  const response = await customObjects.listClusterCustomObject(
    {
      group: 'aquasecurity.github.io',
      version: 'v1alpha1',
      plural: 'sbomreports',
    },
  );
  return response.items || [];
}
