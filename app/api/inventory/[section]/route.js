import * as k8s from '@kubernetes/client-node';
import { X509Certificate } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function age(timestamp) {
  if (!timestamp) return '—';
  const hours = Math.floor((Date.now() - new Date(timestamp).getTime()) / 3_600_000);
  if (hours < 24) return `${Math.max(hours, 0)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function group(id, label, columns, rows) {
  return { id, label, columns, rows };
}

function resourceName(resource) {
  return resource.metadata?.name || 'unknown';
}

function namespace(resource) {
  return resource.metadata?.namespace || 'default';
}

function summarizeRules(rules = []) {
  if (!rules.length) return 'No rules';
  return rules.map((rule) => {
    const verbs = (rule.verbs || []).join(',') || '*';
    const resources = (rule.resources || rule.nonResourceURLs || []).join(',') || '*';
    const groups = (rule.apiGroups || []).join(',') || 'core';
    return `${verbs} → ${groups}/${resources}`;
  }).join(' · ');
}

function ruleCount(rules = []) {
  return `${rules.length} rule${rules.length === 1 ? '' : 's'}`;
}

function containerReadiness(pod) {
  const containers = pod.status?.containerStatuses || [];
  const expected = pod.spec?.containers?.length || 0;
  const ready = containers.filter((container) => container.ready).length;
  return `${ready}/${expected}`;
}

function podRestarts(pod) {
  return String((pod.status?.containerStatuses || []).reduce(
    (total, container) => total + (container.restartCount || 0),
    0,
  ));
}

function workloadSummary(item, kind) {
  const status = item.status || {};
  if (kind === 'Job') {
    return `${status.succeeded || 0} succeeded · ${status.failed || 0} failed`;
  }
  if (kind === 'CronJob') {
    return item.spec?.suspend ? 'Suspended' : item.spec?.schedule || '—';
  }
  if (kind === 'HorizontalPodAutoscaler') {
    return `${status.desiredReplicas ?? 0} desired · ${status.currentReplicas ?? 0} current`;
  }
  if (kind === 'PodDisruptionBudget') {
    return `${status.disruptionsAllowed ?? 0} disruptions allowed`;
  }
  const desired = status.replicas ?? item.spec?.replicas ?? 0;
  const ready = status.readyReplicas ?? status.numberReady ?? 0;
  return `${ready}/${desired} ready`;
}

function workloadRow(item, kind) {
  return {
    name: resourceName(item),
    namespace: namespace(item),
    kind,
    status: workloadSummary(item, kind),
    images: (item.spec?.template?.spec?.containers || [])
      .map((container) => container.image)
      .filter(Boolean)
      .join(', ') || '—',
    age: age(item.metadata?.creationTimestamp),
  };
}

function heartbeatAge(timestamp) {
  if (!timestamp) return 'unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  return age(timestamp);
}

function certificateExpiry(notAfter) {
  const expiry = Date.parse(notAfter || '');
  if (!Number.isFinite(expiry)) return { status: 'Unknown', daysRemaining: '—' };

  const days = Math.ceil((expiry - Date.now()) / 86_400_000);
  if (days < 0) return { status: 'Expired', daysRemaining: String(days) };
  if (days <= 30) return { status: 'Expiring soon', daysRemaining: String(days) };
  return { status: 'Valid', daysRemaining: String(days) };
}

function certificateRow({ name, namespace: resourceNamespace, source, certificate, status }) {
  const expiry = certificateExpiry(certificate?.validTo);
  return {
    name,
    namespace: resourceNamespace,
    source,
    status: status || expiry.status,
    notBefore: certificate?.validFrom || '—',
    notAfter: certificate?.validTo || '—',
    daysRemaining: expiry.daysRemaining,
    subject: certificate?.subject || '—',
    issuer: certificate?.issuer || '—',
  };
}

function secretCertificateRows(secrets) {
  return secrets.flatMap((secret) => {
    if (secret.type !== 'kubernetes.io/tls') return [];
    const name = resourceName(secret);
    const secretNamespace = namespace(secret);
    const encodedCertificate = secret.data?.['tls.crt'];
    const rows = [];

    for (const key of ['tls.crt', 'ca.crt']) {
      const encoded = secret.data?.[key];
      if (!encoded) continue;

      const pem = Buffer.from(encoded, 'base64').toString('utf8');
      const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
      if (!certificates.length) {
        rows.push({
          name,
          namespace: secretNamespace,
          source: `Secret ${key}`,
          status: 'Invalid certificate',
          notBefore: '—',
          notAfter: '—',
          daysRemaining: '—',
          subject: '—',
          issuer: '—',
        });
        continue;
      }

      certificates.forEach((certificatePem, index) => {
        try {
          const certificate = new X509Certificate(certificatePem);
          rows.push(certificateRow({
            name,
            namespace: secretNamespace,
            source: `Secret ${key}${certificates.length > 1 ? ` · chain ${index + 1}` : ''}`,
            certificate,
          }));
        } catch (error) {
          console.error(`Unable to parse certificate in ${secretNamespace}/${name} (${key}):`, error);
          rows.push({
            name,
            namespace: secretNamespace,
            source: `Secret ${key}${certificates.length > 1 ? ` · chain ${index + 1}` : ''}`,
            status: 'Invalid certificate',
            notBefore: '—',
            notAfter: '—',
            daysRemaining: '—',
            subject: '—',
            issuer: '—',
          });
        }
      });
    }

    if (!encodedCertificate) {
      rows.push({
        name,
        namespace: secretNamespace,
        source: 'TLS Secret',
        status: 'Missing certificate',
        notBefore: '—',
        notAfter: '—',
        daysRemaining: '—',
        subject: '—',
        issuer: '—',
      });
    }
    return rows;
  });
}

function certManagerCertificateRow(item) {
  const conditions = item.status?.conditions || [];
  const readyCondition = conditions.find((condition) => condition.type === 'Ready');
  const expiry = certificateExpiry(item.status?.notAfter);
  const status = expiry.status === 'Expired' || expiry.status === 'Expiring soon'
    ? expiry.status
    : readyCondition?.status === 'True'
      ? expiry.status
      : readyCondition?.status === 'False'
        ? 'Not ready'
        : expiry.status;

  return {
    name: resourceName(item),
    namespace: namespace(item),
    source: item.spec?.issuerRef
      ? `${item.spec.issuerRef.kind || 'Issuer'} ${item.spec.issuerRef.name || 'unknown'}`
      : 'cert-manager',
    status,
    notBefore: item.status?.notBefore || '—',
    notAfter: item.status?.notAfter || '—',
    daysRemaining: expiry.daysRemaining,
    subject: item.spec?.commonName || item.spec?.dnsNames?.join(', ') || '—',
    issuer: item.spec?.secretName || '—',
  };
}

function componentPodStatus(pod) {
  const containers = pod.status?.containerStatuses || [];
  const expected = pod.spec?.containers?.length || 0;
  const ready = containers.filter((container) => container.ready).length;
  const healthy = pod.status?.phase === 'Running' && expected > 0 && ready === expected;
  return {
    name: resourceName(pod),
    scope: pod.spec?.nodeName || namespace(pod),
    status: healthy ? 'Healthy' : pod.status?.phase === 'Running' ? 'Degraded' : 'Unhealthy',
    detail: `${ready}/${expected} containers ready · ${pod.status?.phase || 'Unknown'}`,
  };
}

function componentStatusRow(item) {
  const condition = item.conditions?.find((entry) => entry.type === 'Healthy');
  return {
    name: resourceName(item),
    scope: 'ComponentStatus API',
    status: condition?.status === 'True' ? 'Healthy' : condition?.status === 'False' ? 'Unhealthy' : 'Unknown',
    detail: condition?.message || condition?.status || 'No health condition reported',
  };
}

async function loadCertificates(config, core) {
  const [secretResponse, definitionResponse] = await Promise.all([
    core.listSecretForAllNamespaces(),
    config.makeApiClient(k8s.ApiextensionsV1Api).listCustomResourceDefinition(),
  ]);
  const tlsRows = secretCertificateRows(secretResponse.items || []);
  const certificateDefinition = (definitionResponse.items || []).find(
    (definition) => definition.spec?.group === 'cert-manager.io' &&
      definition.spec?.names?.plural === 'certificates',
  );
  let certManagerRows = [];
  let certManagerNotice = '';

  if (certificateDefinition) {
    const version = certificateDefinition.spec?.versions?.find((entry) => entry.served)?.name;
    if (version) {
      try {
        const response = await config.makeApiClient(k8s.CustomObjectsApi)
          .listCustomObjectForAllNamespaces({
            group: 'cert-manager.io',
            version,
            plural: 'certificates',
          });
        certManagerRows = (response.items || []).map(certManagerCertificateRow);
      } catch (error) {
        console.error('Unable to list cert-manager Certificates:', error);
        certManagerNotice = 'cert-manager Certificate resources could not be read. Check the dashboard RBAC permissions.';
      }
    }
  } else {
    certManagerNotice = 'The cert-manager Certificate API is not installed; TLS Secret certificates are still monitored.';
  }

  const allRows = [...tlsRows, ...certManagerRows];
  return {
    summary: [
      { label: 'Certificates', value: allRows.length, detail: 'TLS Secrets and cert-manager resources', icon: 'fa-certificate', tone: 'blue' },
      { label: 'Expiring soon', value: allRows.filter((item) => item.status === 'Expiring soon').length, detail: 'Within the next 30 days', icon: 'fa-clock', tone: 'orange' },
      { label: 'Expired', value: allRows.filter((item) => item.status === 'Expired').length, detail: 'Renew or replace these certificates', icon: 'fa-triangle-exclamation', tone: 'violet' },
      { label: 'TLS Secrets', value: new Set(tlsRows.map((item) => `${item.namespace}/${item.name}`)).size, detail: 'Certificate data only; keys are never returned', icon: 'fa-lock', tone: 'green' },
    ],
    groups: [
      group('tls-secrets', 'TLS Secret certificates', [
        { key: 'name', label: 'Secret' }, { key: 'namespace', label: 'Namespace' },
        { key: 'source', label: 'Certificate source' }, { key: 'status', label: 'Status' },
        { key: 'notAfter', label: 'Expires' }, { key: 'daysRemaining', label: 'Days left' },
        { key: 'subject', label: 'Subject' }, { key: 'issuer', label: 'Issuer' },
      ], tlsRows),
      group('cert-manager', 'cert-manager Certificates', [
        { key: 'name', label: 'Certificate' }, { key: 'namespace', label: 'Namespace' },
        { key: 'source', label: 'Issuer' }, { key: 'status', label: 'Status' },
        { key: 'notBefore', label: 'Valid from' }, { key: 'notAfter', label: 'Expires' },
        { key: 'daysRemaining', label: 'Days left' }, { key: 'subject', label: 'Subject / DNS names' },
        { key: 'issuer', label: 'Target Secret' },
      ], certManagerRows),
    ],
    notice: [
      'Certificate bytes and private keys are never returned to the browser. The view covers kubernetes.io/tls Secrets and cert-manager Certificate resources; host-managed certificates such as kubeadm PKI files are not visible through the Kubernetes API.',
      certManagerNotice,
    ].filter(Boolean).join(' '),
    updatedAt: new Date().toISOString(),
  };
}

async function loadMonitoring(config, core) {
  const apps = config.makeApiClient(k8s.AppsV1Api);
  const [podResponse, nodeResponse, daemonSetResponse, componentResponse] = await Promise.all([
    core.listPodForAllNamespaces(),
    core.listNode(),
    apps.listDaemonSetForAllNamespaces(),
    core.listComponentStatus().catch((error) => {
      console.error('Unable to read Kubernetes ComponentStatus:', error);
      return null;
    }),
  ]);
  const systemPods = (podResponse.items || []).filter((pod) => namespace(pod) === 'kube-system');
  const apiServerPods = systemPods.filter((pod) => resourceName(pod).startsWith('kube-apiserver'));
  const etcdPods = systemPods.filter((pod) => resourceName(pod).startsWith('etcd'));
  const proxyPods = systemPods.filter((pod) => resourceName(pod).startsWith('kube-proxy'));
  const daemonSets = (daemonSetResponse.items || []).filter((item) => resourceName(item) === 'kube-proxy');
  const componentStatuses = componentResponse?.items || [];
  const etcdStatuses = componentStatuses.filter((item) => resourceName(item).startsWith('etcd'));
  const otherStatuses = componentStatuses.filter((item) => !resourceName(item).startsWith('etcd'));
  const controlPlaneRows = apiServerPods.map(componentPodStatus);
  const nodeServiceRows = [];

  if (!apiServerPods.length) {
    controlPlaneRows.push({
      name: 'Kubernetes API',
      scope: 'API endpoint',
      status: 'Reachable',
      detail: 'Cluster API requests succeeded; API-server pod readiness is not exposed.',
    });
  }

  controlPlaneRows.push(...etcdStatuses.map(componentStatusRow), ...etcdPods.map(componentPodStatus));
  if (!etcdStatuses.length && !etcdPods.length) {
    controlPlaneRows.push({
      name: 'etcd',
      scope: 'Control plane',
      status: 'Unknown',
      detail: 'No etcd pod or ComponentStatus health is exposed; etcd may be managed externally.',
    });
  }
  controlPlaneRows.push(...otherStatuses.map(componentStatusRow));

  for (const node of nodeResponse.items || []) {
    const readyCondition = node.status?.conditions?.find((condition) => condition.type === 'Ready');
    const ready = readyCondition?.status === 'True';
    const heartbeat = readyCondition?.lastHeartbeatTime;
    nodeServiceRows.push({
      name: 'kubelet',
      scope: resourceName(node),
      status: ready ? 'Ready' : readyCondition?.status === 'False' ? 'NotReady' : 'Unknown',
      detail: `${node.status?.nodeInfo?.kubeletVersion || 'Version unavailable'} · ` +
        `heartbeat ${heartbeatAge(heartbeat)}${readyCondition?.reason ? ` · ${readyCondition.reason}` : ''}`,
    });
  }

  if (daemonSets.length) {
    for (const daemonSet of daemonSets) {
      const desired = daemonSet.status?.desiredNumberScheduled || 0;
      const ready = daemonSet.status?.numberReady || 0;
      nodeServiceRows.push({
        name: resourceName(daemonSet),
        scope: 'DaemonSet',
        status: desired > 0 && ready === desired ? 'Healthy' : 'Degraded',
        detail: `${ready}/${desired} pods ready · ${daemonSet.status?.numberMisscheduled || 0} misscheduled`,
      });
    }
  } else if (proxyPods.length) {
    nodeServiceRows.push(...proxyPods.map(componentPodStatus));
  } else {
    nodeServiceRows.push({
      name: 'kube-proxy',
      scope: 'Cluster',
      status: 'Unknown',
      detail: 'No kube-proxy DaemonSet or pods were found; this cluster may use another proxy implementation.',
    });
  }

  const allRows = [...controlPlaneRows, ...nodeServiceRows];
  const isHealthy = (status) => ['Healthy', 'Ready', 'Reachable'].includes(status);
  const isAttention = (status) => ['Unhealthy', 'Degraded', 'NotReady'].includes(status);

  return {
    summary: [
      { label: 'Health signals', value: allRows.length, detail: 'Reported by the Kubernetes API', icon: 'fa-heart-pulse', tone: 'blue' },
      { label: 'Healthy', value: allRows.filter((item) => isHealthy(item.status)).length, detail: 'Currently healthy or reachable', icon: 'fa-circle-check', tone: 'green' },
      { label: 'Needs attention', value: allRows.filter((item) => isAttention(item.status)).length, detail: 'Degraded or not ready', icon: 'fa-triangle-exclamation', tone: 'orange' },
      { label: 'Unknown', value: allRows.filter((item) => !isHealthy(item.status) && !isAttention(item.status)).length, detail: 'No usable health signal exposed', icon: 'fa-circle-question', tone: 'violet' },
    ],
    groups: [
      group('control-plane', 'Control plane', [
        { key: 'name', label: 'Component' }, { key: 'scope', label: 'Instance / source' },
        { key: 'status', label: 'Status' }, { key: 'detail', label: 'Health detail' },
      ], controlPlaneRows),
      group('node-services', 'Node services', [
        { key: 'name', label: 'Component' }, { key: 'scope', label: 'Node / scope' },
        { key: 'status', label: 'Status' }, { key: 'detail', label: 'Health detail' },
      ], nodeServiceRows),
    ],
    notice: 'Health is inferred from API-server pod readiness or successful API requests, deprecated ComponentStatus data for etcd when available, kube-proxy DaemonSet/pods, and each Node Ready condition for kubelet. This is not metrics or log monitoring; host-level and externally managed component health may be unavailable.',
    updatedAt: new Date().toISOString(),
  };
}

async function loadInventory(section) {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  const core = config.makeApiClient(k8s.CoreV1Api);

  if (section === 'certificates') return loadCertificates(config, core);
  if (section === 'monitoring') return loadMonitoring(config, core);

  if (section === 'pods') {
    const [podResponse, namespaceResponse] = await Promise.all([
      core.listPodForAllNamespaces(),
      core.listNamespace(),
    ]);
    const pods = podResponse.items || [];
    const phases = pods.reduce((counts, pod) => {
      const phase = pod.status?.phase || 'Unknown';
      counts[phase] = (counts[phase] || 0) + 1;
      return counts;
    }, {});
    return {
      summary: [
        { label: 'Pods', value: pods.length, detail: 'Across all namespaces', icon: 'fa-cubes-stacked', tone: 'blue' },
        { label: 'Running', value: phases.Running || 0, detail: 'Currently running', icon: 'fa-circle-play', tone: 'green' },
        { label: 'Pending', value: phases.Pending || 0, detail: 'Waiting to be scheduled', icon: 'fa-clock', tone: 'orange' },
        { label: 'Failed', value: (phases.Failed || 0) + (phases.Unknown || 0), detail: 'Failed or unknown status', icon: 'fa-triangle-exclamation', tone: 'violet' },
      ],
      groups: [
        group('all-pods', 'All pods', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'status', label: 'Status' }, { key: 'ready', label: 'Ready' },
          { key: 'restarts', label: 'Restarts' }, { key: 'node', label: 'Node' },
          { key: 'images', label: 'Container images' }, { key: 'age', label: 'Age' },
        ], pods.map((pod) => ({
          name: resourceName(pod),
          namespace: namespace(pod),
          status: pod.status?.phase || 'Unknown',
          ready: containerReadiness(pod),
          restarts: podRestarts(pod),
          node: pod.spec?.nodeName || 'Unscheduled',
          images: (pod.spec?.containers || []).map((container) => container.image).filter(Boolean).join(', ') || '—',
          age: age(pod.metadata?.creationTimestamp),
        }))),
      ],
      filters: {
        namespaces: (namespaceResponse.items || []).map((item) => resourceName(item)).sort(),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  if (section === 'namespaces') {
    const [namespaceResponse, podResponse] = await Promise.all([
      core.listNamespace(),
      core.listPodForAllNamespaces(),
    ]);
    const podsByNamespace = new Map();
    for (const pod of podResponse.items || []) {
      const name = namespace(pod);
      const counts = podsByNamespace.get(name) || { total: 0, running: 0, pending: 0, failed: 0 };
      counts.total += 1;
      const phase = (pod.status?.phase || 'Unknown').toLowerCase();
      if (phase === 'running') counts.running += 1;
      if (phase === 'pending') counts.pending += 1;
      if (phase === 'failed' || phase === 'unknown') counts.failed += 1;
      podsByNamespace.set(name, counts);
    }
    const namespaces = namespaceResponse.items || [];
    return {
      summary: [
        { label: 'Namespaces', value: namespaces.length, detail: 'Cluster namespaces', icon: 'fa-layer-group', tone: 'blue' },
        { label: 'Active', value: namespaces.filter((item) => item.status?.phase === 'Active').length, detail: 'Accepting workloads', icon: 'fa-circle-check', tone: 'green' },
        { label: 'Terminating', value: namespaces.filter((item) => item.status?.phase === 'Terminating').length, detail: 'Being removed', icon: 'fa-clock', tone: 'orange' },
        { label: 'Pods', value: (podResponse.items || []).length, detail: 'Scheduled and unscheduled', icon: 'fa-cubes-stacked', tone: 'violet' },
      ],
      groups: [
        group('all-namespaces', 'All namespaces', [
          { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' },
          { key: 'pods', label: 'Pods' }, { key: 'running', label: 'Running' },
          { key: 'pending', label: 'Pending' }, { key: 'failed', label: 'Failed / unknown' },
          { key: 'labels', label: 'Labels' }, { key: 'age', label: 'Age' },
        ], namespaces.map((item) => {
          const counts = podsByNamespace.get(resourceName(item)) || { total: 0, running: 0, pending: 0, failed: 0 };
          return {
            name: resourceName(item),
            status: item.status?.phase || 'Unknown',
            pods: String(counts.total),
            running: String(counts.running),
            pending: String(counts.pending),
            failed: String(counts.failed),
            labels: Object.entries(item.metadata?.labels || {}).map(([key, value]) => `${key}=${value}`).join(', ') || '—',
            age: age(item.metadata?.creationTimestamp),
          };
        })),
      ],
      updatedAt: new Date().toISOString(),
    };
  }

  if (section === 'workloads') {
    const apps = config.makeApiClient(k8s.AppsV1Api);
    const batch = config.makeApiClient(k8s.BatchV1Api);
    const autoscaling = config.makeApiClient(k8s.AutoscalingV2Api);
    const policy = config.makeApiClient(k8s.PolicyV1Api);
    const [
      deploymentResponse,
      statefulSetResponse,
      daemonSetResponse,
      replicaSetResponse,
      jobResponse,
      cronJobResponse,
      autoscalerResponse,
      budgetResponse,
    ] = await Promise.all([
      apps.listDeploymentForAllNamespaces(),
      apps.listStatefulSetForAllNamespaces(),
      apps.listDaemonSetForAllNamespaces(),
      apps.listReplicaSetForAllNamespaces(),
      batch.listJobForAllNamespaces(),
      batch.listCronJobForAllNamespaces(),
      autoscaling.listHorizontalPodAutoscalerForAllNamespaces(),
      policy.listPodDisruptionBudgetForAllNamespaces(),
    ]);
    const resources = [
      { id: 'deployments', label: 'Deployments', items: deploymentResponse.items || [], kind: 'Deployment' },
      { id: 'statefulsets', label: 'StatefulSets', items: statefulSetResponse.items || [], kind: 'StatefulSet' },
      { id: 'daemonsets', label: 'DaemonSets', items: daemonSetResponse.items || [], kind: 'DaemonSet' },
      { id: 'jobs', label: 'Jobs', items: jobResponse.items || [], kind: 'Job' },
      { id: 'cronjobs', label: 'CronJobs', items: cronJobResponse.items || [], kind: 'CronJob' },
      { id: 'replicasets', label: 'ReplicaSets', items: replicaSetResponse.items || [], kind: 'ReplicaSet' },
      { id: 'autoscalers', label: 'Horizontal Pod Autoscalers', items: autoscalerResponse.items || [], kind: 'HorizontalPodAutoscaler' },
      { id: 'disruption-budgets', label: 'Pod Disruption Budgets', items: budgetResponse.items || [], kind: 'PodDisruptionBudget' },
    ];
    const total = resources.reduce((sum, resource) => sum + resource.items.length, 0);
    return {
      summary: [
        { label: 'Workloads', value: total, detail: 'Managed resources across namespaces', icon: 'fa-cubes-stacked', tone: 'blue' },
        { label: 'Deployments', value: resources[0].items.length, detail: 'Rolling-out applications', icon: 'fa-rocket', tone: 'green' },
        { label: 'Jobs', value: resources[3].items.length + resources[4].items.length, detail: 'One-off and scheduled tasks', icon: 'fa-clock', tone: 'orange' },
        { label: 'Autoscalers', value: resources[6].items.length, detail: 'Horizontal pod autoscalers', icon: 'fa-up-down-left-right', tone: 'violet' },
      ],
      groups: resources.map((resource) => group(
        resource.id,
        resource.label,
        [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'status', label: 'Status / schedule' }, { key: 'images', label: 'Container images' },
          { key: 'age', label: 'Age' },
        ],
        resource.items.map((item) => workloadRow(item, resource.kind)),
      )),
      updatedAt: new Date().toISOString(),
    };
  }

  if (section === 'iam') {
    const rbac = config.makeApiClient(k8s.RbacAuthorizationV1Api);
    const [
      accountResponse,
      roleResponse,
      clusterRoleResponse,
      bindingResponse,
      clusterBindingResponse,
    ] = await Promise.all([
      core.listServiceAccountForAllNamespaces(),
      rbac.listRoleForAllNamespaces(),
      rbac.listClusterRole(),
      rbac.listRoleBindingForAllNamespaces(),
      rbac.listClusterRoleBinding(),
    ]);
    const accounts = accountResponse.items || [];
    const roles = roleResponse.items || [];
    const clusterRoles = clusterRoleResponse.items || [];
    const bindings = bindingResponse.items || [];
    const clusterBindings = clusterBindingResponse.items || [];

    return {
      summary: [
        { label: 'Service accounts', value: accounts.length, detail: 'Across all namespaces', icon: 'fa-user-shield', tone: 'blue' },
        { label: 'Roles', value: roles.length, detail: 'Namespace-scoped permissions', icon: 'fa-key', tone: 'violet' },
        { label: 'Cluster roles', value: clusterRoles.length, detail: 'Cluster-wide permission sets', icon: 'fa-shield-halved', tone: 'green' },
        { label: 'Bindings', value: bindings.length + clusterBindings.length, detail: `${bindings.length} role · ${clusterBindings.length} cluster role`, icon: 'fa-link', tone: 'orange' },
      ],
      groups: [
        group('service-accounts', 'Service accounts', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'automount', label: 'Token automount' }, { key: 'secrets', label: 'Referenced secrets' },
          { key: 'imagePullSecrets', label: 'Image pull secrets' }, { key: 'age', label: 'Age' },
        ], accounts.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          automount: item.automountServiceAccountToken === false ? 'Disabled' : 'Enabled (default)',
          secrets: (item.secrets || []).map((secret) => secret.name).join(', ') || '—',
          imagePullSecrets: (item.imagePullSecrets || []).map((secret) => secret.name).join(', ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('roles', 'Roles', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'permissions', label: 'Rules' }, { key: 'details', label: 'Permissions' },
          { key: 'age', label: 'Age' },
        ], roles.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          permissions: ruleCount(item.rules), details: summarizeRules(item.rules),
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('cluster-roles', 'Cluster roles', [
          { key: 'name', label: 'Name' }, { key: 'permissions', label: 'Rules' },
          { key: 'details', label: 'Permissions' }, { key: 'age', label: 'Age' },
        ], clusterRoles.map((item) => ({
          name: resourceName(item), permissions: ruleCount(item.rules),
          details: summarizeRules(item.rules), age: age(item.metadata?.creationTimestamp),
        }))),
        group('role-bindings', 'Role bindings', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'role', label: 'Role reference' }, { key: 'subjects', label: 'Subjects' },
          { key: 'age', label: 'Age' },
        ], bindings.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          role: `${item.roleRef?.kind || 'Role'}/${item.roleRef?.name || 'unknown'}`,
          subjects: (item.subjects || []).map((subject) =>
            `${subject.kind}:${subject.namespace ? `${subject.namespace}/` : ''}${subject.name}`,
          ).join(', ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('cluster-role-bindings', 'Cluster role bindings', [
          { key: 'name', label: 'Name' }, { key: 'role', label: 'Cluster role' },
          { key: 'subjects', label: 'Subjects' }, { key: 'age', label: 'Age' },
        ], clusterBindings.map((item) => ({
          name: resourceName(item), role: item.roleRef?.name || 'unknown',
          subjects: (item.subjects || []).map((subject) =>
            `${subject.kind}:${subject.namespace ? `${subject.namespace}/` : ''}${subject.name}`,
          ).join(', ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
      ],
      updatedAt: new Date().toISOString(),
    };
  }

  if (section === 'networking') {
    const networking = config.makeApiClient(k8s.NetworkingV1Api);
    const [serviceResponse, endpointResponse, ingressResponse, policyResponse] = await Promise.all([
      core.listServiceForAllNamespaces(),
      core.listEndpointsForAllNamespaces(),
      networking.listIngressForAllNamespaces(),
      networking.listNetworkPolicyForAllNamespaces(),
    ]);
    const services = serviceResponse.items || [];
    const endpoints = endpointResponse.items || [];
    const ingresses = ingressResponse.items || [];
    const policies = policyResponse.items || [];
    const endpointCounts = new Map(endpoints.map((item) => [
      `${namespace(item)}/${resourceName(item)}`,
      (item.subsets || []).reduce(
        (total, subset) => total + (subset.addresses || []).length + (subset.notReadyAddresses || []).length,
        0,
      ),
    ]));

    return {
      summary: [
        { label: 'Services', value: services.length, detail: 'Cluster and external services', icon: 'fa-network-wired', tone: 'blue' },
        { label: 'Ingresses', value: ingresses.length, detail: 'HTTP and HTTPS entry points', icon: 'fa-arrow-right-to-bracket', tone: 'violet' },
        { label: 'Network policies', value: policies.length, detail: 'Pod traffic policies', icon: 'fa-shield-halved', tone: 'green' },
        { label: 'Endpoint addresses', value: [...endpointCounts.values()].reduce((total, count) => total + count, 0), detail: 'Ready and not-ready addresses', icon: 'fa-diagram-project', tone: 'orange' },
      ],
      groups: [
        group('services', 'Services', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'type', label: 'Type' }, { key: 'clusterIp', label: 'Cluster IP' },
          { key: 'ports', label: 'Ports' }, { key: 'external', label: 'External IPs' },
          { key: 'age', label: 'Age' },
        ], services.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          type: item.spec?.type || 'ClusterIP', clusterIp: item.spec?.clusterIP || '—',
          ports: (item.spec?.ports || []).map((port) =>
            `${port.port}${port.protocol && port.protocol !== 'TCP' ? `/${port.protocol}` : ''}${port.targetPort ? ` → ${port.targetPort}` : ''}`,
          ).join(', ') || '—',
          external: (item.spec?.externalIPs || []).join(', ') || item.status?.loadBalancer?.ingress?.map((address) => address.ip || address.hostname).join(', ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('ingresses', 'Ingresses', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'class', label: 'Ingress class' }, { key: 'hosts', label: 'Hosts' },
          { key: 'addresses', label: 'Addresses' }, { key: 'age', label: 'Age' },
        ], ingresses.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          class: item.spec?.ingressClassName || '—',
          hosts: (item.spec?.rules || []).map((rule) => rule.host || '*').join(', ') || '*',
          addresses: (item.status?.loadBalancer?.ingress || []).map((entry) => entry.ip || entry.hostname).join(', ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('network-policies', 'Network policies', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'podSelector', label: 'Pod selector' }, { key: 'policyTypes', label: 'Policy types' },
          { key: 'rules', label: 'Ingress / egress rules' }, { key: 'age', label: 'Age' },
        ], policies.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          podSelector: Object.entries(item.spec?.podSelector?.matchLabels || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'All pods',
          policyTypes: (item.spec?.policyTypes || []).join(', ') || 'Ingress',
          rules: `${(item.spec?.ingress || []).length} / ${(item.spec?.egress || []).length}`,
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('endpoints', 'Endpoints', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'addresses', label: 'Addresses' }, { key: 'ports', label: 'Ports' },
          { key: 'age', label: 'Age' },
        ], endpoints.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          addresses: String(endpointCounts.get(`${namespace(item)}/${resourceName(item)}`) || 0),
          ports: [...new Set((item.subsets || []).flatMap((subset) => (subset.ports || []).map((port) => `${port.port}${port.protocol && port.protocol !== 'TCP' ? `/${port.protocol}` : ''}`)))].join(', ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
      ],
      updatedAt: new Date().toISOString(),
    };
  }

  if (section === 'resources') {
    const apiextensions = config.makeApiClient(k8s.ApiextensionsV1Api);
    const [quotaResponse, limitResponse, definitionResponse] = await Promise.all([
      core.listResourceQuotaForAllNamespaces(),
      core.listLimitRangeForAllNamespaces(),
      apiextensions.listCustomResourceDefinition(),
    ]);
    const quotas = quotaResponse.items || [];
    const limitRanges = limitResponse.items || [];
    const definitions = definitionResponse.items || [];

    return {
      summary: [
        { label: 'Resource quotas', value: quotas.length, detail: 'Namespace resource budgets', icon: 'fa-gauge-high', tone: 'blue' },
        { label: 'Limit ranges', value: limitRanges.length, detail: 'Per-resource constraints', icon: 'fa-sliders', tone: 'violet' },
        { label: 'Custom resource definitions', value: definitions.length, detail: 'Extended Kubernetes APIs', icon: 'fa-puzzle-piece', tone: 'green' },
        { label: 'Established APIs', value: definitions.filter((item) => item.status?.conditions?.some((condition) => condition.type === 'Established' && condition.status === 'True')).length, detail: 'Ready custom resource APIs', icon: 'fa-circle-check', tone: 'orange' },
      ],
      groups: [
        group('quotas', 'Resource quotas', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'resources', label: 'Usage / hard limits' }, { key: 'age', label: 'Age' },
        ], quotas.map((item) => {
          const used = item.status?.used || {};
          const hard = item.status?.hard || {};
          const resources = Object.keys(hard).map((key) => `${key}: ${used[key] || '0'} / ${hard[key]}`).join(' · ');
          return {
            name: resourceName(item), namespace: namespace(item),
            resources: resources || 'No resource limits reported',
            age: age(item.metadata?.creationTimestamp),
          };
        })),
        group('limit-ranges', 'Limit ranges', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'limits', label: 'Limits' }, { key: 'age', label: 'Age' },
        ], limitRanges.map((item) => ({
          name: resourceName(item), namespace: namespace(item),
          limits: (item.spec?.limits || []).map((limit) => {
            const values = ['min', 'max', 'default', 'defaultRequest', 'maxLimitRequestRatio']
              .filter((key) => limit[key] && Object.keys(limit[key]).length)
              .map((key) => `${key}: ${Object.entries(limit[key]).map(([resource, value]) => `${resource}=${value}`).join(', ')}`);
            return `${limit.type}: ${values.join(' · ') || 'No limits specified'}`;
          }).join(' | ') || '—',
          age: age(item.metadata?.creationTimestamp),
        }))),
        group('custom-resource-definitions', 'Custom resource definitions', [
          { key: 'name', label: 'Name' }, { key: 'group', label: 'API group' },
          { key: 'kind', label: 'Kind' }, { key: 'versions', label: 'Versions' },
          { key: 'scope', label: 'Scope' }, { key: 'established', label: 'Established' },
          { key: 'age', label: 'Age' },
        ], definitions.map((item) => ({
          name: resourceName(item), group: item.spec?.group || '—',
          kind: item.spec?.names?.kind || '—',
          versions: (item.spec?.versions || []).filter((version) => version.served).map((version) => version.name).join(', ') || '—',
          scope: item.spec?.scope || '—',
          established: item.status?.conditions?.find((condition) => condition.type === 'Established')?.status || 'Unknown',
          age: age(item.metadata?.creationTimestamp),
        }))),
      ],
      updatedAt: new Date().toISOString(),
    };
  }

  if (section === 'configuration') {
    const [configMapResponse, secretResponse] = await Promise.all([
      core.listConfigMapForAllNamespaces(),
      core.listSecretForAllNamespaces(),
    ]);
    const configMaps = configMapResponse.items || [];
    const secrets = secretResponse.items || [];

    return {
      summary: [
        { label: 'ConfigMaps', value: configMaps.length, detail: 'Configuration metadata', icon: 'fa-file-lines', tone: 'blue' },
        { label: 'Secrets', value: secrets.length, detail: 'Values are never displayed', icon: 'fa-lock', tone: 'violet' },
        { label: 'ConfigMap keys', value: configMaps.reduce((total, item) => total + Object.keys(item.data || {}).length + Object.keys(item.binaryData || {}).length, 0), detail: 'Key names only', icon: 'fa-list', tone: 'green' },
        { label: 'Secret keys', value: secrets.reduce((total, item) => total + Object.keys(item.data || {}).length, 0), detail: 'Secret values remain hidden', icon: 'fa-shield-halved', tone: 'orange' },
      ],
      groups: [
        group('config-maps', 'ConfigMaps', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'keys', label: 'Data keys' }, { key: 'keyCount', label: 'Key count' },
          { key: 'immutable', label: 'Immutable' }, { key: 'age', label: 'Age' },
        ], configMaps.map((item) => {
          const keys = [...Object.keys(item.data || {}), ...Object.keys(item.binaryData || {})];
          return {
            name: resourceName(item), namespace: namespace(item),
            keys: keys.join(', ') || 'No data keys',
            keyCount: String(keys.length),
            immutable: item.immutable ? 'Yes' : 'No',
            age: age(item.metadata?.creationTimestamp),
          };
        })),
        group('secrets', 'Secrets', [
          { key: 'name', label: 'Name' }, { key: 'namespace', label: 'Namespace' },
          { key: 'type', label: 'Type' }, { key: 'keys', label: 'Data keys' },
          { key: 'keyCount', label: 'Key count' }, { key: 'immutable', label: 'Immutable' },
          { key: 'age', label: 'Age' },
        ], secrets.map((item) => {
          const keys = Object.keys(item.data || {});
          return {
            name: resourceName(item), namespace: namespace(item),
            type: item.type || 'Opaque',
            keys: keys.join(', ') || 'No data keys',
            keyCount: String(keys.length),
            immutable: item.immutable ? 'Yes' : 'No',
            age: age(item.metadata?.creationTimestamp),
          };
        })),
      ],
      notice: 'Configuration values and Secret contents are intentionally hidden. Only resource metadata and key names are shown.',
      updatedAt: new Date().toISOString(),
    };
  }

  return null;
}

export async function GET(_request, context) {
  const { section } = await context.params;
  if (!['pods', 'namespaces', 'workloads', 'iam', 'networking', 'resources', 'configuration', 'certificates', 'monitoring'].includes(section)) {
    return Response.json({ error: 'Unknown inventory section.' }, { status: 404 });
  }

  try {
    const inventory = await loadInventory(section);
    return Response.json(inventory);
  } catch (error) {
    console.error(`Unable to load Kubernetes ${section} inventory:`, error);
    return Response.json(
      { error: `Unable to load ${section} inventory. Check Kubernetes connectivity and RBAC.` },
      { status: 503 },
    );
  }
}
