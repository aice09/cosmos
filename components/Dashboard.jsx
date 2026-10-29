'use client';

import { useCallback, useEffect, useState } from 'react';
import NodesTable from './NodesTable';
import Sidebar from './Sidebar';

function MetricCard({ label, value, detail, icon, tone }) {
  return (
    <div className="col-12 col-sm-6 col-xl-3">
      <article className="metric-card h-100">
        <div className={`metric-icon ${tone}`}>
          <i className={`fa-solid ${icon}`} aria-hidden="true" />
        </div>
        <p className="metric-label">{label}</p>
        <div className="metric-value">{value}</div>
        <p className="metric-detail">{detail}</p>
      </article>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="loading-panel">
      <span className="spinner-border spinner-border-sm me-2" role="status" />
      Connecting to your Kubernetes cluster...
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadCluster = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cluster', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load cluster data.');
      setData(result);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Unable to load cluster data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCluster();
    const timer = window.setInterval(loadCluster, 30_000);
    return () => window.clearInterval(timer);
  }, [loadCluster]);

  const readyNodes = data?.cluster.readyNodes || 0;
  const nodeHealth = data?.cluster.nodes
    ? `${readyNodes} of ${data.cluster.nodes} nodes ready`
    : 'Waiting for cluster data';
  const podCounts = data?.cluster.podCounts || {};
  const podHealth = [
    `${podCounts.Running || 0} running`,
    `${podCounts.Pending || 0} pending`,
    `${podCounts.Failed || 0} failed`,
  ].join(' · ');
  const totalPods = data?.cluster.pods || 0;
  const healthyPercent = totalPods
    ? Math.round(((podCounts.Running || 0) / totalPods) * 100)
    : 0;

  return (
    <div className="dashboard-shell">
      <Sidebar active="dashboard" />

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb-label">Clusters <span>/</span> Overview</div>
          <div className="topbar-actions">
            <span className={`connection-label ${error ? 'disconnected' : ''}`}>
              <span className="status-dot" />
              {error ? 'Connection issue' : data ? 'Live cluster' : 'Connecting'}
            </span>
            <button
              type="button"
              className="btn refresh-button"
              onClick={loadCluster}
              disabled={loading}
              aria-label="Refresh cluster data"
            >
              <i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`} aria-hidden="true" />
              <span className="d-none d-sm-inline ms-2">Refresh</span>
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">KUBERNETES</p>
              <h1>Cluster overview</h1>
              <p className="heading-subtitle">
                Monitor the health and capacity of your Kubernetes cluster.
              </p>
            </div>
            {data?.updatedAt && (
              <span className="updated-label">
                Last updated {new Date(data.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </section>

          {error && (
            <div className="alert alert-danger connection-error" role="alert">
              <i className="fa-solid fa-triangle-exclamation me-2" aria-hidden="true" />
              {error}
              <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={loadCluster}>
                Try again
              </button>
            </div>
          )}

          {loading && !data ? (
            <LoadingPanel />
          ) : data ? (
            <>
              <section className="row g-3 metric-grid" aria-label="Cluster summary">
                <MetricCard
                  label="Nodes"
                  value={data.cluster.nodes}
                  detail={nodeHealth}
                  icon="fa-server"
                  tone="blue"
                />
                <MetricCard
                  label="Namespaces"
                  value={data.cluster.namespaces}
                  detail="Active cluster namespaces"
                  icon="fa-layer-group"
                  tone="violet"
                />
                <MetricCard
                  label="Pods"
                  value={data.cluster.pods}
                  detail={podHealth}
                  icon="fa-cubes-stacked"
                  tone="green"
                />
                <MetricCard
                  label="Deployments"
                  value={data.cluster.deployments}
                  detail="Across all namespaces"
                  icon="fa-rocket"
                  tone="orange"
                />
              </section>

              <section className="row g-3 overview-grid">
                <div className="col-12 col-xl-7">
                  <article className="content-card h-100">
                    <div className="card-heading">
                      <div>
                        <h2>Cluster capacity</h2>
                        <p>Allocatable resources across all nodes</p>
                      </div>
                      <span className="subtle-icon"><i className="fa-solid fa-gauge-high" aria-hidden="true" /></span>
                    </div>
                    <div className="capacity-items">
                      <div className="capacity-item">
                        <div className="capacity-title">
                          <span><i className="fa-solid fa-microchip me-2" aria-hidden="true" />CPU</span>
                          <strong>{data.cluster.cpuCores.toLocaleString(undefined, { maximumFractionDigits: 2 })} cores</strong>
                        </div>
                        <span className="capacity-caption">Total allocatable compute</span>
                      </div>
                      <div className="capacity-item">
                        <div className="capacity-title">
                          <span><i className="fa-solid fa-memory me-2" aria-hidden="true" />Memory</span>
                          <strong>{data.cluster.memoryGiB.toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB</strong>
                        </div>
                        <span className="capacity-caption">Total allocatable memory</span>
                      </div>
                    </div>
                  </article>
                </div>
                <div className="col-12 col-xl-5">
                  <article className="content-card h-100 pod-health-card">
                    <div className="card-heading">
                      <div>
                        <h2>Pod health</h2>
                        <p>Current pod status across the cluster</p>
                      </div>
                      <span className="subtle-icon"><i className="fa-solid fa-heart-pulse" aria-hidden="true" /></span>
                    </div>
                    <div className="pod-health-summary">
                      <div className="health-score">{healthyPercent}<span>%</span></div>
                      <span className="health-description">of pods running</span>
                    </div>
                    <div className="health-bar" role="img" aria-label={`${healthyPercent}% of pods are running`}>
                      <span style={{ width: `${healthyPercent}%` }} />
                    </div>
                    <div className="pod-legend">
                      <span><i className="legend-dot running" />Running <strong>{podCounts.Running || 0}</strong></span>
                      <span><i className="legend-dot pending" />Pending <strong>{podCounts.Pending || 0}</strong></span>
                      <span><i className="legend-dot failed" />Failed <strong>{podCounts.Failed || 0}</strong></span>
                    </div>
                  </article>
                </div>
              </section>

              <section className="content-card table-card" id="nodes">
                <div className="card-heading">
                  <div>
                    <h2>Cluster nodes</h2>
                    <p>{readyNodes} of {data.cluster.nodes} nodes are healthy</p>
                  </div>
                  <span className="count-badge">{data.cluster.nodes} total</span>
                </div>
                <NodesTable key={data.updatedAt} nodes={data.nodes} />
              </section>

              <section className="row g-3 bottom-grid" id="workloads">
                <div className="col-12 col-xl-7">
                  <article className="content-card h-100">
                    <div className="card-heading">
                      <div>
                        <h2>Top namespaces</h2>
                        <p>Namespaces with the most pods</p>
                      </div>
                    </div>
                    {data.namespaces.length ? (
                      <div className="namespace-list">
                        {data.namespaces.map((namespace) => (
                          <div className="namespace-row" key={namespace.name}>
                            <span className="namespace-avatar">{namespace.name.slice(0, 1).toUpperCase()}</span>
                            <span className="namespace-name">{namespace.name}</span>
                            <span className="namespace-stat">{namespace.deployments} deployments</span>
                            <span className="namespace-pods">{namespace.pods} pods</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">No namespaces found.</p>
                    )}
                  </article>
                </div>
                <div className="col-12 col-xl-5">
                  <article className="content-card h-100">
                    <div className="card-heading">
                      <div>
                        <h2>Recently created pods</h2>
                        <p>Latest activity in your cluster</p>
                      </div>
                    </div>
                    {data.recentPods.length ? (
                      <div className="recent-pod-list">
                        {data.recentPods.slice(0, 5).map((pod) => (
                          <div className="recent-pod-row" key={`${pod.namespace}/${pod.name}`}>
                            <span className={`pod-status-mark ${pod.phase.toLowerCase()}`} />
                            <div className="recent-pod-info">
                              <span className="recent-pod-name">{pod.name}</span>
                              <span className="recent-pod-meta">{pod.namespace} · {pod.restarts} restarts</span>
                            </div>
                            <span className="recent-pod-age">{pod.age}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">No pods found.</p>
                    )}
                  </article>
                </div>
              </section>
            </>
          ) : (
            <div className="empty-dashboard">
              <i className="fa-solid fa-cloud-exclamation" aria-hidden="true" />
              <h2>Cluster data unavailable</h2>
              <p>Verify this app can reach the Kubernetes API and has the required read permissions.</p>
              <button type="button" className="btn primary-button" onClick={loadCluster}>Retry connection</button>
            </div>
          )}
          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
