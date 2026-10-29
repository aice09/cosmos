'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';

function SummaryCard({ item }) {
  return (
    <article className="inventory-summary-card">
      <span className={`storage-overview-icon ${item.tone}`}>
        <i className={`fa-solid ${item.icon}`} aria-hidden="true" />
      </span>
      <div>
        <small>{item.label}</small>
        <strong>{item.value}</strong>
        <span>{item.detail}</span>
      </div>
    </article>
  );
}

function InventoryTable({ group, rows }) {
  return (
    <div className="table-responsive">
      <table className="table align-middle inventory-table">
        <thead>
          <tr>{group.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.namespace || ''}/${row.name}/${index}`}>
              {group.columns.map((column, columnIndex) => (
                <td
                  className={columnIndex === 0 ? 'inventory-name-cell' : ''}
                  key={column.key}
                  title={String(row[column.key] ?? '')}
                >
                  {row[column.key] || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InventoryPage({ section, title, description, active }) {
  const [data, setData] = useState(null);
  const [activeGroup, setActiveGroup] = useState('');
  const [search, setSearch] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/inventory/${section}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Unable to load ${title.toLowerCase()} data.`);
      setData(result);
      setActiveGroup((current) =>
        result.groups.some((group) => group.id === current) ? current : result.groups[0]?.id || '',
      );
      setError('');
    } catch (loadError) {
      setError(loadError.message || `Unable to load ${title.toLowerCase()} data.`);
    } finally {
      setLoading(false);
    }
  }, [section, title]);

  useEffect(() => {
    loadInventory();
    const timer = window.setInterval(loadInventory, 30_000);
    return () => window.clearInterval(timer);
  }, [loadInventory]);

  const selectedGroup = data?.groups.find((group) => group.id === activeGroup);
  const filteredRows = useMemo(() => {
    if (!selectedGroup) return [];
    const needle = search.trim().toLowerCase();
    return selectedGroup.rows.filter((row) => (
      (!selectedNamespace || row.namespace === selectedNamespace) &&
      (!needle || JSON.stringify(row).toLowerCase().includes(needle))
    ));
  }, [search, selectedGroup, selectedNamespace]);

  return (
    <div className="dashboard-shell">
      <Sidebar active={active} />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb-label">
            <Link href="/" className="breadcrumb-link">Clusters</Link>
            <span>/</span>
            {title}
          </div>
          <div className="topbar-actions">
            <span className={`connection-label ${error ? 'disconnected' : ''}`}>
              <span className="status-dot" />
              {error ? 'Connection issue' : data ? 'Live cluster' : 'Connecting'}
            </span>
            <button
              type="button"
              className="btn refresh-button"
              onClick={loadInventory}
              disabled={loading}
              aria-label={`Refresh ${title.toLowerCase()} data`}
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
              <h1>{title}</h1>
              <p className="heading-subtitle">{description}</p>
            </div>
            {data?.updatedAt && (
              <span className="updated-label">Last updated {new Date(data.updatedAt).toLocaleTimeString()}</span>
            )}
          </section>

          {error && (
            <div className="alert alert-danger connection-error" role="alert">
              <i className="fa-solid fa-triangle-exclamation me-2" aria-hidden="true" />
              {error}
              <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={loadInventory}>
                Try again
              </button>
            </div>
          )}

          {loading && !data ? (
            <div className="loading-panel">
              <span className="spinner-border spinner-border-sm me-2" role="status" />
              Loading {title.toLowerCase()} resources...
            </div>
          ) : data ? (
            <>
              <section className="inventory-summary-grid" aria-label={`${title} summary`}>
                {data.summary.map((item) => <SummaryCard key={item.label} item={item} />)}
              </section>
              <section className="content-card inventory-card">
                <div className="inventory-card-heading">
                  <div>
                    <h2>{title} inventory</h2>
                    <p>Read-only view of resources across your Kubernetes cluster.</p>
                  </div>
                  <div className="inventory-filter-actions">
                    {data.filters?.namespaces && (
                      <select
                        className="inventory-namespace-select"
                        value={selectedNamespace}
                        onChange={(event) => setSelectedNamespace(event.target.value)}
                        aria-label="Filter by namespace"
                      >
                        <option value="">All namespaces</option>
                        {data.filters.namespaces.map((namespace) => (
                          <option value={namespace} key={namespace}>{namespace}</option>
                        ))}
                      </select>
                    )}
                    <label className="inventory-search">
                      <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={`Search ${selectedGroup?.label.toLowerCase() || 'resources'}...`}
                        aria-label={`Search ${selectedGroup?.label || 'resources'}`}
                      />
                    </label>
                  </div>
                </div>
                <div className="inventory-tabs" role="tablist" aria-label={`${title} resource types`}>
                  {data.groups.map((group) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeGroup === group.id}
                      className={`inventory-tab ${activeGroup === group.id ? 'active' : ''}`}
                      key={group.id}
                      onClick={() => { setActiveGroup(group.id); setSearch(''); }}
                    >
                      {group.label}<span>{group.rows.length}</span>
                    </button>
                  ))}
                </div>
                {filteredRows.length ? (
                  <InventoryTable group={selectedGroup} rows={filteredRows} />
                ) : (
                  <div className="storage-empty">
                    <i className="fa-solid fa-box-open" aria-hidden="true" />
                    <strong>{search ? 'No matching resources' : `No ${selectedGroup?.label.toLowerCase() || 'resources'} found`}</strong>
                    <span>{search ? 'Try a different search term.' : 'Resources will appear here when they are created.'}</span>
                  </div>
                )}
                <div className="storage-table-footer">
                  Showing {filteredRows.length} of {selectedGroup?.rows.length || 0} {selectedGroup?.label.toLowerCase() || 'resources'}
                </div>
              </section>
              {data.notice && (
                <p className="inventory-notice">
                  <i className="fa-solid fa-circle-info" aria-hidden="true" />
                  {data.notice}
                </p>
              )}
            </>
          ) : !loading ? (
            <div className="empty-dashboard">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
              <h2>{title} information unavailable</h2>
              <p>Verify the dashboard can reach Kubernetes and has the read-only RBAC permissions for this inventory.</p>
              <button type="button" className="btn primary-button" onClick={loadInventory}>Retry connection</button>
            </div>
          ) : null}
          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
