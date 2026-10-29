'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';

function ResourceValue({ label, value, icon }) {
  return (
    <div className="node-resource">
      <span className="node-resource-label">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function NodeCard({ node }) {
  const readyCondition = node.conditions.find((condition) => condition.type === 'Ready');

  return (
    <article className="content-card node-detail-card">
      <div className="node-detail-heading">
        <div className="node-identity">
          <span className="node-detail-icon">
            <i className="fa-solid fa-server" aria-hidden="true" />
          </span>
          <div>
            <h2>{node.name}</h2>
            <div className="node-role-list">
              {node.roles.map((role) => <span className="node-role-tag" key={role}>{role}</span>)}
            </div>
          </div>
        </div>
        <span className={`status-pill ${node.status === 'Ready' ? 'healthy' : 'unhealthy'}`}>
          <span className="status-dot" />
          {node.status}
        </span>
      </div>

      <div className="node-summary-strip">
        <span><i className="fa-solid fa-code-branch" aria-hidden="true" />{node.system.kubeletVersion}</span>
        <span><i className="fa-solid fa-clock" aria-hidden="true" />Age {node.age}</span>
        <span><i className="fa-solid fa-cubes-stacked" aria-hidden="true" />{node.podCounts.total || 0} assigned pods</span>
      </div>

      <div className="node-detail-grid">
        <section className="node-detail-section">
          <h3>Resources</h3>
          <div className="node-resource-list">
            <ResourceValue label="CPU" value={`${node.allocatable.cpu} / ${node.capacity.cpu}`} icon="fa-microchip" />
            <ResourceValue label="Memory" value={`${node.allocatable.memory} / ${node.capacity.memory}`} icon="fa-memory" />
            <ResourceValue label="Pods" value={`${node.podCounts.total || 0} / ${node.allocatable.pods}`} icon="fa-cubes-stacked" />
            <ResourceValue label="Ephemeral storage" value={node.allocatable.ephemeralStorage} icon="fa-hard-drive" />
          </div>
          <p className="node-resource-note">Allocatable / capacity, except ephemeral storage</p>
        </section>

        <section className="node-detail-section">
          <h3>System information</h3>
          <dl className="node-info-list">
            <div><dt>Operating system</dt><dd>{node.system.osImage}</dd></div>
            <div><dt>Kernel</dt><dd>{node.system.kernelVersion}</dd></div>
            <div><dt>Architecture</dt><dd>{node.system.architecture}</dd></div>
            <div><dt>Container runtime</dt><dd>{node.system.containerRuntime}</dd></div>
          </dl>
        </section>
      </div>

      <section className="node-detail-section node-address-section">
        <h3>Addresses</h3>
        <div className="node-address-list">
          {node.addresses.length ? node.addresses.map((entry) => (
            <div className="node-address" key={`${entry.type}-${entry.address}`}>
              <span>{entry.type}</span>
              <code>{entry.address}</code>
            </div>
          )) : <p className="node-muted">No addresses reported.</p>}
        </div>
      </section>

      <section className="node-detail-section node-conditions-section">
        <h3>Conditions</h3>
        <div className="node-condition-list">
          {node.conditions.map((condition) => {
            const healthy = condition.type === 'Ready'
              ? condition.status === 'True'
              : condition.status === 'False';
            return (
              <div className="node-condition" key={condition.type} title={condition.message}>
                <span className={`condition-indicator ${healthy ? 'healthy' : 'unhealthy'}`} />
                <span className="condition-name">{condition.type}</span>
                <span className={`condition-status ${healthy ? 'healthy' : 'unhealthy'}`}>
                  {condition.status === 'True' ? 'True' : condition.status}
                </span>
                <span className="condition-reason">{condition.reason || '—'}</span>
              </div>
            );
          })}
        </div>
        {readyCondition?.message && readyCondition.status !== 'True' && (
          <p className="node-condition-message">{readyCondition.message}</p>
        )}
      </section>

      {(node.taints.length > 0 || node.labels.length > 0) && (
        <details className="node-metadata">
          <summary>
            Node metadata
            <span>{node.labels.length} labels · {node.taints.length} taints</span>
          </summary>
          {node.taints.length > 0 && (
            <div className="node-metadata-group">
              <h3>Taints</h3>
              <div className="node-chip-list">
                {node.taints.map((taint) => (
                  <span className="node-metadata-chip" key={`${taint.key}-${taint.effect}`}>
                    {taint.key}{taint.value ? `=${taint.value}` : ''}:{taint.effect}
                  </span>
                ))}
              </div>
            </div>
          )}
          {node.labels.length > 0 && (
            <div className="node-metadata-group">
              <h3>Labels</h3>
              <div className="node-label-list">
                {node.labels.map(([key, value]) => (
                  <div className="node-label" key={key}>
                    <span>{key}</span>
                    <code>{value}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </details>
      )}
    </article>
  );
}

export default function NodesPage() {
  const [nodes, setNodes] = useState([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cluster', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load node information.');
      setNodes(result.nodes);
      setUpdatedAt(result.updatedAt);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Unable to load node information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNodes();
    const timer = window.setInterval(loadNodes, 30_000);
    return () => window.clearInterval(timer);
  }, [loadNodes]);

  const readyCount = nodes.filter((node) => node.status === 'Ready').length;

  return (
    <div className="dashboard-shell">
      <Sidebar active="nodes" />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb-label">
            <Link href="/" className="breadcrumb-link">Clusters</Link>
            <span>/</span>
            Nodes
          </div>
          <div className="topbar-actions">
            <span className={`connection-label ${error ? 'disconnected' : ''}`}>
              <span className="status-dot" />
              {error ? 'Connection issue' : nodes.length ? 'Live cluster' : 'Connecting'}
            </span>
            <button
              type="button"
              className="btn refresh-button"
              onClick={loadNodes}
              disabled={loading}
              aria-label="Refresh node information"
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
              <h1>Nodes</h1>
              <p className="heading-subtitle">Hardware, system details, addresses, and health conditions for every cluster node.</p>
            </div>
            {updatedAt && (
              <span className="updated-label">
                Last updated {new Date(updatedAt).toLocaleTimeString()}
              </span>
            )}
          </section>

          {error && (
            <div className="alert alert-danger connection-error" role="alert">
              <i className="fa-solid fa-triangle-exclamation me-2" aria-hidden="true" />
              {error}
              <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={loadNodes}>
                Try again
              </button>
            </div>
          )}

          {loading && !nodes.length ? (
            <div className="loading-panel">
              <span className="spinner-border spinner-border-sm me-2" role="status" />
              Loading node information...
            </div>
          ) : nodes.length ? (
            <>
              <section className="node-overview-strip" aria-label="Node health summary">
                <div className="node-overview-item">
                  <span className="node-overview-icon blue"><i className="fa-solid fa-server" aria-hidden="true" /></span>
                  <span><strong>{nodes.length}</strong><small>Total nodes</small></span>
                </div>
                <div className="node-overview-item">
                  <span className="node-overview-icon green"><i className="fa-solid fa-circle-check" aria-hidden="true" /></span>
                  <span><strong>{readyCount} / {nodes.length}</strong><small>Ready</small></span>
                </div>
                <div className="node-overview-item">
                  <span className="node-overview-icon violet"><i className="fa-solid fa-microchip" aria-hidden="true" /></span>
                  <span><strong>{nodes.reduce((total, node) => total + node.allocatableCpuCores, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><small>Allocatable CPU cores</small></span>
                </div>
                <div className="node-overview-item">
                  <span className="node-overview-icon orange"><i className="fa-solid fa-cubes-stacked" aria-hidden="true" /></span>
                  <span><strong>{nodes.reduce((total, node) => total + (node.podCounts.total || 0), 0)}</strong><small>Scheduled pods</small></span>
                </div>
              </section>
              <section className="node-detail-list" aria-label="Node details">
                {nodes.map((node) => <NodeCard key={node.name} node={node} />)}
              </section>
            </>
          ) : !loading ? (
            <div className="empty-dashboard">
              <i className="fa-solid fa-server" aria-hidden="true" />
              <h2>Node information unavailable</h2>
              <p>Verify the dashboard can reach the Kubernetes API and has permission to list nodes.</p>
              <button type="button" className="btn primary-button" onClick={loadNodes}>Retry connection</button>
            </div>
          ) : null}
          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
