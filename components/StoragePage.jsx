'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';

const storageTabs = [
  { id: 'volumes', label: 'Persistent volumes', icon: 'fa-database' },
  { id: 'claims', label: 'Claims', icon: 'fa-file-circle-check' },
  { id: 'classes', label: 'Storage classes', icon: 'fa-layer-group' },
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function statusTone(status) {
  if (['Bound', 'Available', 'Active', 'true'].includes(status)) return 'healthy';
  if (['Pending', 'Released'].includes(status)) return 'warning';
  return 'unhealthy';
}

function StatusBadge({ status }) {
  return (
    <span className={`status-pill ${statusTone(status)}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

function AccessModes({ modes }) {
  if (!modes.length) return <span className="storage-muted">—</span>;
  return (
    <div className="storage-chip-list">
      {modes.map((mode) => (
        <span className="storage-chip" key={mode}>{mode.replace('ReadWrite', 'RW').replace('ReadOnly', 'RO')}</span>
      ))}
    </div>
  );
}

function VolumeTable({ volumes }) {
  return (
    <div className="table-responsive">
      <table className="table align-middle storage-table">
        <thead>
          <tr>
            <th>Volume</th>
            <th>Status</th>
            <th>Capacity</th>
            <th>Storage class</th>
            <th>Claim</th>
            <th>Access modes</th>
            <th>Source</th>
            <th>Reclaim</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {volumes.map((volume) => (
            <tr key={volume.name}>
              <td className="storage-name">{volume.name}</td>
              <td><StatusBadge status={volume.status} /></td>
              <td className="storage-strong">{volume.capacity}</td>
              <td>{volume.storageClass}</td>
              <td>
                {volume.claim
                  ? <span>{volume.claim.namespace}/{volume.claim.name}</span>
                  : <span className="storage-muted">Unclaimed</span>}
              </td>
              <td><AccessModes modes={volume.accessModes} /></td>
              <td>
                <span className="storage-source">{volume.source.type}</span>
                {volume.source.detail !== '—' && (
                  <span className="storage-source-detail">{volume.source.detail}</span>
                )}
              </td>
              <td>{volume.reclaimPolicy}</td>
              <td className="storage-muted">{volume.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimTable({ claims }) {
  return (
    <div className="table-responsive">
      <table className="table align-middle storage-table">
        <thead>
          <tr>
            <th>Claim</th>
            <th>Namespace</th>
            <th>Status</th>
            <th>Requested</th>
            <th>Bound capacity</th>
            <th>Storage class</th>
            <th>Volume</th>
            <th>Access modes</th>
            <th>Used by</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={`${claim.namespace}/${claim.name}`}>
              <td className="storage-name">{claim.name}</td>
              <td><span className="namespace-tag">{claim.namespace}</span></td>
              <td><StatusBadge status={claim.status} /></td>
              <td className="storage-strong">{claim.requested}</td>
              <td>{claim.capacity}</td>
              <td>{claim.storageClass}</td>
              <td>{claim.volume}</td>
              <td><AccessModes modes={claim.accessModes} /></td>
              <td>
                {claim.usedBy.length
                  ? <span className="storage-usage" title={claim.usedBy.join(', ')}>{claim.usedBy.length} pod{claim.usedBy.length === 1 ? '' : 's'}</span>
                  : <span className="storage-muted">Not mounted</span>}
              </td>
              <td className="storage-muted">{claim.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassTable({ classes }) {
  return (
    <div className="table-responsive">
      <table className="table align-middle storage-table">
        <thead>
          <tr>
            <th>Storage class</th>
            <th>Provisioner</th>
            <th>Default</th>
            <th>Binding mode</th>
            <th>Reclaim policy</th>
            <th>Expansion</th>
            <th>Mount options</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((storageClass) => (
            <tr key={storageClass.name}>
              <td className="storage-name">{storageClass.name}</td>
              <td><code className="storage-provisioner">{storageClass.provisioner}</code></td>
              <td>
                {storageClass.isDefault
                  ? <span className="default-class-badge"><i className="fa-solid fa-star" aria-hidden="true" />Default</span>
                  : <span className="storage-muted">—</span>}
              </td>
              <td>{storageClass.volumeBindingMode}</td>
              <td>{storageClass.reclaimPolicy}</td>
              <td>
                <span className={`expansion-badge ${storageClass.allowVolumeExpansion ? 'enabled' : ''}`}>
                  {storageClass.allowVolumeExpansion ? 'Enabled' : 'Disabled'}
                </span>
              </td>
              <td>
                {storageClass.mountOptions.length
                  ? storageClass.mountOptions.join(', ')
                  : <span className="storage-muted">Default</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StoragePage() {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('volumes');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadStorage = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/storage', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load storage information.');
      setData(result);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Unable to load storage information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStorage();
    const timer = window.setInterval(loadStorage, 30_000);
    return () => window.clearInterval(timer);
  }, [loadStorage]);

  const activeItems = useMemo(() => {
    if (!data) return [];
    if (activeTab === 'claims') return data.claims;
    if (activeTab === 'classes') return data.storageClasses;
    return data.persistentVolumes;
  }, [activeTab, data]);
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return activeItems;
    return activeItems.filter((item) => JSON.stringify(item).toLowerCase().includes(needle));
  }, [activeItems, search]);

  const counts = data?.summary;
  const activeLabel = storageTabs.find((tab) => tab.id === activeTab)?.label || 'Storage';

  return (
    <div className="dashboard-shell">
      <Sidebar active="storage" />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb-label">
            <Link href="/" className="breadcrumb-link">Clusters</Link>
            <span>/</span>
            Storage
          </div>
          <div className="topbar-actions">
            <span className={`connection-label ${error ? 'disconnected' : ''}`}>
              <span className="status-dot" />
              {error ? 'Connection issue' : data ? 'Live cluster' : 'Connecting'}
            </span>
            <button
              type="button"
              className="btn refresh-button"
              onClick={loadStorage}
              disabled={loading}
              aria-label="Refresh storage information"
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
              <h1>Storage</h1>
              <p className="heading-subtitle">Persistent volumes, claims, and storage provisioning across your cluster.</p>
            </div>
            {data?.updatedAt && (
              <span className="updated-label">Last updated {new Date(data.updatedAt).toLocaleTimeString()}</span>
            )}
          </section>

          {error && (
            <div className="alert alert-danger connection-error" role="alert">
              <i className="fa-solid fa-triangle-exclamation me-2" aria-hidden="true" />
              {error}
              <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={loadStorage}>
                Try again
              </button>
            </div>
          )}

          {loading && !data ? (
            <div className="loading-panel">
              <span className="spinner-border spinner-border-sm me-2" role="status" />
              Loading Kubernetes storage resources...
            </div>
          ) : data ? (
            <>
              <section className="storage-overview-grid" aria-label="Storage summary">
                <article className="storage-overview-card">
                  <span className="storage-overview-icon blue"><i className="fa-solid fa-database" aria-hidden="true" /></span>
                  <div><small>Persistent volumes</small><strong>{counts.persistentVolumes}</strong><span>{counts.boundVolumes} bound · {counts.availableVolumes} available</span></div>
                </article>
                <article className="storage-overview-card">
                  <span className="storage-overview-icon violet"><i className="fa-solid fa-file-circle-check" aria-hidden="true" /></span>
                  <div><small>Volume claims</small><strong>{counts.claims}</strong><span>{counts.boundClaims} bound · {counts.pendingClaims} pending</span></div>
                </article>
                <article className="storage-overview-card">
                  <span className="storage-overview-icon green"><i className="fa-solid fa-hard-drive" aria-hidden="true" /></span>
                  <div><small>Provisioned capacity</small><strong>{formatBytes(counts.totalCapacityBytes)}</strong><span>Sum of persistent volume capacities</span></div>
                </article>
                <article className="storage-overview-card">
                  <span className="storage-overview-icon orange"><i className="fa-solid fa-layer-group" aria-hidden="true" /></span>
                  <div><small>Storage classes</small><strong>{counts.storageClasses}</strong><span>{counts.defaultStorageClasses} default</span></div>
                </article>
              </section>

              <section className="content-card storage-inventory-card">
                <div className="storage-inventory-heading">
                  <div>
                    <h2>Storage inventory</h2>
                    <p>Inspect persistent storage resources and their current bindings.</p>
                  </div>
                  <label className="storage-search">
                    <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={`Search ${activeLabel.toLowerCase()}...`}
                      aria-label={`Search ${activeLabel.toLowerCase()}`}
                    />
                  </label>
                </div>
                <div className="storage-tabs" role="tablist" aria-label="Storage resource type">
                  {storageTabs.map((tab) => {
                    const count = tab.id === 'volumes'
                      ? counts.persistentVolumes
                      : tab.id === 'claims'
                        ? counts.claims
                        : counts.storageClasses;
                    return (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        className={`storage-tab ${activeTab === tab.id ? 'active' : ''}`}
                        key={tab.id}
                        onClick={() => { setActiveTab(tab.id); setSearch(''); }}
                      >
                        <i className={`fa-solid ${tab.icon}`} aria-hidden="true" />
                        {tab.label}
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
                {filteredItems.length ? (
                  activeTab === 'volumes' ? (
                    <VolumeTable volumes={filteredItems} />
                  ) : activeTab === 'claims' ? (
                    <ClaimTable claims={filteredItems} />
                  ) : (
                    <ClassTable classes={filteredItems} />
                  )
                ) : (
                  <div className="storage-empty">
                    <i className="fa-solid fa-box-open" aria-hidden="true" />
                    <strong>{search ? 'No matching resources' : `No ${activeLabel.toLowerCase()} found`}</strong>
                    <span>{search ? 'Try a different search term.' : 'Storage resources will appear here when they are created.'}</span>
                  </div>
                )}
                <div className="storage-table-footer">
                  Showing {filteredItems.length} of {activeItems.length} {activeLabel.toLowerCase()}
                </div>
              </section>
            </>
          ) : !loading ? (
            <div className="empty-dashboard">
              <i className="fa-solid fa-hard-drive" aria-hidden="true" />
              <h2>Storage information unavailable</h2>
              <p>Verify the dashboard can reach the Kubernetes API and has permission to list persistent volumes, claims, and storage classes.</p>
              <button type="button" className="btn primary-button" onClick={loadStorage}>Retry connection</button>
            </div>
          ) : null}
          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
