import * as k8s from '@kubernetes/client-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBytes(value = '0') {
  const units = {
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1000,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  const match = String(value).match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(Ei|Pi|Ti|Gi|Mi|Ki|[numkKMGTPE])?$/,
  );
  if (!match) return 0;
  return Number(match[1]) * (units[match[2]] || 1);
}

function formatAge(timestamp) {
  if (!timestamp) return '—';
  const hours = Math.floor((Date.now() - new Date(timestamp).getTime()) / 3_600_000);
  if (hours < 24) return `${Math.max(hours, 0)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function volumeSource(spec = {}) {
  if (spec.csi?.driver) return { type: 'CSI', detail: spec.csi.driver };
  const sourceNames = {
    awsElasticBlockStore: 'AWS EBS',
    azureDisk: 'Azure Disk',
    azureFile: 'Azure File',
    cephfs: 'CephFS',
    cinder: 'Cinder',
    fc: 'Fibre Channel',
    flexVolume: 'FlexVolume',
    gcePersistentDisk: 'GCE Persistent Disk',
    glusterfs: 'GlusterFS',
    hostPath: 'HostPath',
    iscsi: 'iSCSI',
    local: 'Local',
    nfs: 'NFS',
    portworxVolume: 'Portworx',
    quobyte: 'Quobyte',
    rbd: 'RBD',
    scaleIO: 'ScaleIO',
    storageos: 'StorageOS',
    vsphereVolume: 'vSphere',
  };
  const source = Object.keys(sourceNames).find((key) => spec[key]);
  if (!source) return { type: 'Unknown', detail: '—' };
  const details = spec[source];
  const detail = details.server
    ? `${details.server}${details.path ? `:${details.path}` : ''}`
    : details.path || details.volumeID || details.volumeId || '—';
  return { type: sourceNames[source], detail };
}

export async function GET() {
  try {
    const config = new k8s.KubeConfig();
    config.loadFromDefault();
    const core = config.makeApiClient(k8s.CoreV1Api);
    const storageApi = config.makeApiClient(k8s.StorageV1Api);

    const [volumesResponse, claimsResponse, classesResponse, podsResponse] =
      await Promise.all([
        core.listPersistentVolume(),
        core.listPersistentVolumeClaimForAllNamespaces(),
        storageApi.listStorageClass(),
        core.listPodForAllNamespaces(),
      ]);

    const volumes = volumesResponse.items || [];
    const claims = claimsResponse.items || [];
    const classes = classesResponse.items || [];
    const claimsByKey = new Map(
      claims.map((claim) => [
        `${claim.metadata?.namespace || 'default'}/${claim.metadata?.name || ''}`,
        claim,
      ]),
    );
    const podsByClaim = new Map();
    for (const pod of podsResponse.items || []) {
      const namespace = pod.metadata?.namespace || 'default';
      for (const volume of pod.spec?.volumes || []) {
        const claimName = volume.persistentVolumeClaim?.claimName;
        if (!claimName) continue;
        const key = `${namespace}/${claimName}`;
        const podName = pod.metadata?.name || 'unknown';
        const usedBy = podsByClaim.get(key) || [];
        if (!usedBy.includes(podName)) usedBy.push(podName);
        podsByClaim.set(key, usedBy);
      }
    }

    const totalCapacityBytes = volumes.reduce(
      (total, volume) => total + parseBytes(volume.spec?.capacity?.storage),
      0,
    );
    const boundVolumes = volumes.filter((volume) => volume.status?.phase === 'Bound').length;
    const boundClaims = claims.filter((claim) => claim.status?.phase === 'Bound').length;

    return Response.json({
      summary: {
        persistentVolumes: volumes.length,
        boundVolumes,
        availableVolumes: volumes.filter((volume) => volume.status?.phase === 'Available').length,
        releasedVolumes: volumes.filter((volume) => volume.status?.phase === 'Released').length,
        failedVolumes: volumes.filter((volume) => volume.status?.phase === 'Failed').length,
        claims: claims.length,
        boundClaims,
        pendingClaims: claims.filter((claim) => claim.status?.phase === 'Pending').length,
        lostClaims: claims.filter((claim) => claim.status?.phase === 'Lost').length,
        storageClasses: classes.length,
        defaultStorageClasses: classes.filter(
          (storageClass) =>
            storageClass.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
        ).length,
        totalCapacityBytes,
      },
      persistentVolumes: volumes.map((volume) => {
        const name = volume.metadata?.name || 'unknown';
        const claimNamespace = volume.spec?.claimRef?.namespace || '';
        const claimName = volume.spec?.claimRef?.name || '';
        const claim = claimsByKey.get(`${claimNamespace}/${claimName}`);
        const source = volumeSource(volume.spec);
        return {
          name,
          status: volume.status?.phase || 'Unknown',
          capacity: volume.spec?.capacity?.storage || '—',
          storageClass: volume.spec?.storageClassName || '—',
          accessModes: volume.spec?.accessModes || [],
          volumeMode: volume.spec?.volumeMode || 'Filesystem',
          reclaimPolicy: volume.spec?.persistentVolumeReclaimPolicy || 'Retain',
          claim: claimName ? { name: claimName, namespace: claimNamespace } : null,
          claimStatus: claim?.status?.phase || null,
          source,
          age: formatAge(volume.metadata?.creationTimestamp),
        };
      }),
      claims: claims.map((claim) => {
        const namespace = claim.metadata?.namespace || 'default';
        const name = claim.metadata?.name || 'unknown';
        return {
          name,
          namespace,
          status: claim.status?.phase || 'Pending',
          requested: claim.spec?.resources?.requests?.storage || '—',
          capacity: claim.status?.capacity?.storage || '—',
          storageClass: claim.spec?.storageClassName || '—',
          volume: claim.spec?.volumeName || '—',
          accessModes: claim.spec?.accessModes || [],
          volumeMode: claim.spec?.volumeMode || 'Filesystem',
          usedBy: podsByClaim.get(`${namespace}/${name}`) || [],
          age: formatAge(claim.metadata?.creationTimestamp),
        };
      }),
      storageClasses: classes.map((storageClass) => ({
        name: storageClass.metadata?.name || 'unknown',
        provisioner: storageClass.provisioner || '—',
        reclaimPolicy: storageClass.reclaimPolicy || 'Delete',
        volumeBindingMode: storageClass.volumeBindingMode || 'Immediate',
        allowVolumeExpansion: storageClass.allowVolumeExpansion || false,
        mountOptions: storageClass.mountOptions || [],
        isDefault:
          storageClass.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
      })),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Unable to load Kubernetes storage data:', error);
    return Response.json(
      { error: 'Unable to load storage data. Check Kubernetes connectivity and RBAC.' },
      { status: 503 },
    );
  }
}
