import * as k8s from '@kubernetes/client-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseCpu(value = '0') {
  const quantity = String(value);
  if (quantity.endsWith('m')) return Number.parseFloat(quantity) / 1000;
  if (quantity.endsWith('u')) return Number.parseFloat(quantity) / 1_000_000;
  if (quantity.endsWith('n')) return Number.parseFloat(quantity) / 1_000_000_000;
  return Number.parseFloat(quantity) || 0;
}

function parseMemory(value = '0') {
  const quantity = String(value);
  const units = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  const match = quantity.match(/^([0-9.]+)(Ki|Mi|Gi|Ti|Pi|Ei|K|M|G|T|P|E)?$/);
  if (!match) return 0;
  return Number.parseFloat(match[1]) * (units[match[2]] || 1);
}

function formatAge(timestamp) {
  if (!timestamp) return '—';
  const hours = Math.floor((Date.now() - new Date(timestamp).getTime()) / 3_600_000);
  if (hours < 24) return `${Math.max(hours, 0)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function nodeReady(node) {
  return node.status?.conditions?.some(
    (condition) => condition.type === 'Ready' && condition.status === 'True',
  ) || false;
}

function nodeRoles(node) {
  const labels = node.metadata?.labels || {};
  const roles = Object.keys(labels)
    .filter((label) => label.startsWith('node-role.kubernetes.io/'))
    .map((label) => label.slice('node-role.kubernetes.io/'.length));
  return roles.length ? roles : ['worker'];
}

export async function GET() {
  try {
    const config = new k8s.KubeConfig();
    config.loadFromDefault();
    const core = config.makeApiClient(k8s.CoreV1Api);
    const apps = config.makeApiClient(k8s.AppsV1Api);

    const [nodesResponse, podsResponse, namespacesResponse, deploymentsResponse] =
      await Promise.all([
        core.listNode(),
        core.listPodForAllNamespaces(),
        core.listNamespace(),
        apps.listDeploymentForAllNamespaces(),
      ]);

    const nodes = nodesResponse.items || [];
    const pods = podsResponse.items || [];
    const namespaces = namespacesResponse.items || [];
    const deployments = deploymentsResponse.items || [];
    const podsByNode = new Map();
    const podCounts = pods.reduce((counts, pod) => {
      const phase = pod.status?.phase || 'Unknown';
      counts[phase] = (counts[phase] || 0) + 1;
      const nodeName = pod.spec?.nodeName;
      if (nodeName) {
        const nodeCounts = podsByNode.get(nodeName) || {};
        nodeCounts[phase] = (nodeCounts[phase] || 0) + 1;
        nodeCounts.total = (nodeCounts.total || 0) + 1;
        podsByNode.set(nodeName, nodeCounts);
      }
      return counts;
    }, {});
    const podsByNamespace = {};
    const deploymentsByNamespace = {};

    for (const pod of pods) {
      const namespace = pod.metadata?.namespace || 'default';
      podsByNamespace[namespace] = (podsByNamespace[namespace] || 0) + 1;
    }
    for (const deployment of deployments) {
      const namespace = deployment.metadata?.namespace || 'default';
      deploymentsByNamespace[namespace] = (deploymentsByNamespace[namespace] || 0) + 1;
    }

    const readyNodes = nodes.filter(nodeReady).length;
    const namespaceSummaries = namespaces
      .map((namespace) => {
        const name = namespace.metadata?.name || 'unknown';
        return {
          name,
          pods: podsByNamespace[name] || 0,
          deployments: deploymentsByNamespace[name] || 0,
        };
      })
      .sort((a, b) => b.pods - a.pods || a.name.localeCompare(b.name))
      .slice(0, 6);
    const recentPods = [...pods]
      .sort(
        (a, b) =>
          new Date(b.metadata?.creationTimestamp || 0) -
          new Date(a.metadata?.creationTimestamp || 0),
      )
      .slice(0, 8)
      .map((pod) => ({
        name: pod.metadata?.name || 'unknown',
        namespace: pod.metadata?.namespace || 'default',
        phase: pod.status?.phase || 'Unknown',
        restarts: (pod.status?.containerStatuses || []).reduce(
          (total, container) => total + (container.restartCount || 0),
          0,
        ),
        age: formatAge(pod.metadata?.creationTimestamp),
      }));

    return Response.json({
      cluster: {
        nodes: nodes.length,
        readyNodes,
        namespaces: namespaces.length,
        pods: pods.length,
        deployments: deployments.length,
        podCounts,
        cpuCores: nodes.reduce(
          (total, node) => total + parseCpu(node.status?.allocatable?.cpu),
          0,
        ),
        memoryGiB:
          nodes.reduce(
            (total, node) => total + parseMemory(node.status?.allocatable?.memory),
            0,
          ) /
          1024 ** 3,
      },
      nodes: nodes.map((node) => ({
        name: node.metadata?.name || 'unknown',
        status: nodeReady(node) ? 'Ready' : 'NotReady',
        roles: nodeRoles(node),
        version: node.status?.nodeInfo?.kubeletVersion || '—',
        cpu: node.status?.allocatable?.cpu || '—',
        memory: node.status?.allocatable?.memory || '—',
        pods: node.status?.allocatable?.pods || '—',
        allocatableCpuCores: parseCpu(node.status?.allocatable?.cpu),
        age: formatAge(node.metadata?.creationTimestamp),
        createdAt: node.metadata?.creationTimestamp || null,
        addresses: (node.status?.addresses || []).map(({ type, address }) => ({ type, address })),
        capacity: {
          cpu: node.status?.capacity?.cpu || '—',
          memory: node.status?.capacity?.memory || '—',
          pods: node.status?.capacity?.pods || '—',
          ephemeralStorage: node.status?.capacity?.['ephemeral-storage'] || '—',
        },
        allocatable: {
          cpu: node.status?.allocatable?.cpu || '—',
          memory: node.status?.allocatable?.memory || '—',
          pods: node.status?.allocatable?.pods || '—',
          ephemeralStorage: node.status?.allocatable?.['ephemeral-storage'] || '—',
        },
        system: {
          osImage: node.status?.nodeInfo?.osImage || '—',
          kernelVersion: node.status?.nodeInfo?.kernelVersion || '—',
          architecture: node.status?.nodeInfo?.architecture || '—',
          operatingSystem: node.status?.nodeInfo?.operatingSystem || '—',
          containerRuntime: node.status?.nodeInfo?.containerRuntimeVersion || '—',
          kubeletVersion: node.status?.nodeInfo?.kubeletVersion || '—',
        },
        conditions: (node.status?.conditions || []).map((condition) => ({
          type: condition.type,
          status: condition.status,
          reason: condition.reason || '',
          message: condition.message || '',
          lastTransitionTime: condition.lastTransitionTime || null,
        })),
        labels: Object.entries(node.metadata?.labels || {}).sort(([a], [b]) => a.localeCompare(b)),
        taints: (node.spec?.taints || []).map((taint) => ({
          key: taint.key,
          value: taint.value || '',
          effect: taint.effect,
        })),
        podCounts: podsByNode.get(node.metadata?.name) || { total: 0 },
      })),
      namespaces: namespaceSummaries,
      recentPods,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Unable to load Kubernetes cluster data:', error);
    return Response.json(
      { error: 'Unable to load cluster data. Check Kubernetes connectivity and RBAC.' },
      { status: 503 },
    );
  }
}
