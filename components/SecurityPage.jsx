'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';

const SBOM_FORMATS = [
  { value: 'cyclonedx', label: 'CycloneDX JSON', extension: 'cdx.json' },
  { value: 'spdx-json', label: 'SPDX JSON', extension: 'spdx.json' },
  { value: 'spdx', label: 'SPDX tag-value', extension: 'spdx' },
];

function SummaryCard({ label, value, detail, icon, tone }) {
  return (
    <article className="inventory-summary-card">
      <span className={`storage-overview-icon ${tone}`}>
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SecurityPage() {
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState('');
  const [sbomFormat, setSbomFormat] = useState(SBOM_FORMATS[0].value);
  const [report, setReport] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [trivyVersion, setTrivyVersion] = useState('v0.76.1');

  const loadImages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/security/images', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load the cluster image inventory.');
      const nextImages = result.images || [];
      setImages(nextImages);
      setTrivyVersion(result.trivyVersion || 'v0.76.1');
      setUpdatedAt(result.updatedAt || '');
      setSelectedImage((current) =>
        nextImages.some((entry) => entry.image === current)
          ? current
          : nextImages[0]?.image || '',
      );
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Unable to load the cluster image inventory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (busy === 'rescan') return;
    setReport(images.find((entry) => entry.image === selectedImage)?.scanReport || null);
  }, [busy, images, selectedImage]);

  useEffect(() => {
    loadImages();
    const timer = window.setInterval(loadImages, 30_000);
    return () => window.clearInterval(timer);
  }, [loadImages]);

  const filteredImages = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return images.filter((entry) => (
      !needle || `${entry.image} ${entry.registry} ${entry.uses.map((use) =>
        `${use.namespace}/${use.pod}/${use.container}`,
      ).join(' ')}`.toLowerCase().includes(needle)
    ));
  }, [images, search]);

  async function rescanImage(image) {
    setSelectedImage(image);
    setBusy('rescan');
    setReport(null);
    setError('');
    setStatusMessage('');
    try {
      const response = await fetch('/api/security/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Trivy Operator could not request a rescan.');
      setStatusMessage(
        `Rescan requested for ${result.deletedReports} workload report(s). New results will appear after Trivy Operator finishes.`,
      );
      await loadImages();
    } catch (rescanError) {
      setError(rescanError.message || 'Trivy Operator could not request a rescan.');
    } finally {
      setBusy('');
    }
  }

  async function exportSbom() {
    if (!selectedImage) return;
    setBusy('sbom');
    setError('');
    try {
      const response = sbomFormat === 'cyclonedx'
        ? await fetch(`/api/security/sbom?image=${encodeURIComponent(selectedImage)}`, { cache: 'no-store' })
        : await fetch('/api/security/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: selectedImage, action: 'sbom', format: sbomFormat }),
        });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Unable to generate the SBOM.');
      }
      const format = SBOM_FORMATS.find((item) => item.value === sbomFormat);
      const safeName = selectedImage.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
      downloadBlob(await response.blob(), `${safeName}.${format.extension}`);
    } catch (exportError) {
      setError(exportError.message || 'Unable to generate the SBOM.');
    } finally {
      setBusy('');
    }
  }

  const selectedEntry = images.find((entry) => entry.image === selectedImage);
  const canExportSbom = sbomFormat === 'cyclonedx'
    ? selectedEntry?.sbomAvailable
    : selectedEntry?.scanAllowed;
  const totalVulnerabilities = report
    ? Object.values(report.counts).reduce((total, count) => total + count, 0)
    : 0;

  return (
    <div className="dashboard-shell">
      <Sidebar active="security" />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb-label">
            <Link href="/" className="breadcrumb-link">Clusters</Link>
            <span>/</span>
            Security
          </div>
          <div className="topbar-actions">
            <span className={`connection-label ${error && !images.length ? 'disconnected' : ''}`}>
              <span className="status-dot" />
              {error && !images.length ? 'Connection issue' : 'Trivy Operator'}
            </span>
            <button
              type="button"
              className="btn refresh-button"
              onClick={loadImages}
              disabled={loading}
              aria-label="Refresh cluster image inventory"
            >
              <i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`} aria-hidden="true" />
              <span className="d-none d-sm-inline ms-2">Refresh</span>
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">SECURITY</p>
              <h1>Image security</h1>
              <p className="heading-subtitle">
                Review cached Trivy Operator findings for images in cluster Pods and export software bills of materials.
              </p>
            </div>
            {updatedAt && (
              <span className="updated-label">Inventory updated {new Date(updatedAt).toLocaleTimeString()}</span>
            )}
          </section>

          <div className="alert security-notice" role="note">
            <i className="fa-solid fa-shield-halved" aria-hidden="true" />
            <span>
            Vulnerability reports and CycloneDX SBOMs come from Trivy Operator using Trivy {trivyVersion}.
              Only images referenced by current cluster Pods are listed. Reports stay cached until the workload
              changes or you explicitly request a rescan; the database refresh runs nightly.
            </span>
          </div>

          {error && (
            <div className="alert alert-danger connection-error" role="alert">
              <i className="fa-solid fa-triangle-exclamation me-2" aria-hidden="true" />
              {error}
              <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={loadImages}>
                Retry
              </button>
            </div>
          )}

          {statusMessage && (
            <div className="alert alert-success connection-error" role="status">
              <i className="fa-solid fa-circle-check me-2" aria-hidden="true" />
              {statusMessage}
            </div>
          )}

          <section className="inventory-summary-grid" aria-label="Image security summary">
            <SummaryCard
              label="Images in use"
              value={images.length}
              detail="Unique images referenced by Pods"
              icon="fa-cubes-stacked"
              tone="blue"
            />
            <SummaryCard
              label="Image uses"
              value={images.reduce((sum, entry) => sum + entry.count, 0)}
              detail="Containers across namespaces"
              icon="fa-boxes-stacked"
              tone="green"
            />
            <SummaryCard
              label="Critical findings"
              value={report?.counts.CRITICAL || 0}
              detail={report ? 'Cached Operator reports' : 'Select an image with a completed report'}
              icon="fa-triangle-exclamation"
              tone="orange"
            />
            <SummaryCard
              label="Total findings"
              value={report ? totalVulnerabilities : '—'}
              detail={report ? report.image : 'No completed report selected'}
              icon="fa-bug"
              tone="violet"
            />
          </section>

          <section className="content-card security-actions-card">
            <div className="inventory-card-heading">
              <div>
                <h2>Cached image reports and SBOM exports</h2>
                <p>Operator scans current workloads automatically. Request another scan only when needed.</p>
              </div>
              {busy && (
                <span className="security-running" role="status">
                  <span className="spinner-border spinner-border-sm" />
                  {busy === 'rescan' ? 'Requesting rescan…' : 'Generating SBOM…'}
                </span>
              )}
            </div>
            <div className="security-controls">
              <label className="security-field">
                <span>Cluster image</span>
                <select
                  value={selectedImage}
                  onChange={(event) => {
                    setSelectedImage(event.target.value);
                    setError('');
                    setStatusMessage('');
                  }}
                  disabled={!images.length || Boolean(busy)}
                >
                  {images.length ? images.map((entry) => (
                    <option value={entry.image} key={entry.image}>
                      {entry.image} ({entry.count} use{entry.count === 1 ? '' : 's'})
                    </option>
                  )) : <option value="">No Pod images found</option>}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary security-primary-action"
                onClick={() => rescanImage(selectedImage)}
                disabled={!selectedEntry?.scanReport || Boolean(busy)}
              >
                <i className="fa-solid fa-rotate me-2" aria-hidden="true" />
                Rescan image
              </button>
              <label className="security-field security-format-field">
                <span>SBOM format</span>
                <select
                  value={sbomFormat}
                  onChange={(event) => setSbomFormat(event.target.value)}
                  disabled={Boolean(busy)}
                >
                  {SBOM_FORMATS.map((format) => (
                    <option value={format.value} key={format.value}>{format.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={exportSbom}
                disabled={!canExportSbom || Boolean(busy)}
              >
                <i className="fa-solid fa-download me-2" aria-hidden="true" />
                Export SBOM
              </button>
            </div>
            {selectedEntry && !selectedEntry.scanReport && (
              <p className="security-registry-warning" role="status">
                Trivy Operator has not produced a report for this image yet. The Operator scans active workloads automatically.
              </p>
            )}
            {selectedEntry && sbomFormat === 'cyclonedx' && !selectedEntry.sbomAvailable && (
              <p className="security-registry-warning" role="status">
                The cached CycloneDX SBOM is not available until the Operator finishes scanning this workload.
              </p>
            )}
            {selectedEntry && sbomFormat !== 'cyclonedx' && !selectedEntry.scanAllowed && (
              <p className="security-registry-warning" role="status">
                <i className="fa-solid fa-lock" aria-hidden="true" />
                Registry <code>{selectedEntry.registry}</code> is not in the SPDX export allowlist. Add it to
                <code> TRIVY_ALLOWED_REGISTRIES</code> to enable SPDX exports.
              </p>
            )}
          </section>

          <section className="content-card security-image-card">
            <div className="inventory-card-heading">
              <div>
                <h2>Images in cluster Pods</h2>
                <p>Inventory includes regular, init, and ephemeral containers.</p>
              </div>
              <label className="inventory-search">
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search images or Pods..."
                  aria-label="Search cluster images"
                />
              </label>
            </div>
            {loading && !images.length ? (
              <div className="loading-panel">
                <span className="spinner-border spinner-border-sm me-2" role="status" />
                Loading image inventory...
              </div>
            ) : filteredImages.length ? (
              <div className="table-responsive">
                <table className="table align-middle security-image-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Registry</th>
                      <th>Pod uses</th>
                      <th>Vulnerability report</th>
                      <th>SPDX export</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredImages.map((entry) => (
                      <tr key={entry.image}>
                        <td className="security-image-name" title={entry.image}>{entry.image}</td>
                        <td><code>{entry.registry}</code></td>
                        <td>
                          <span className="security-use-count">{entry.count}</span>
                          <span className="security-use-details">
                            {' '}{entry.uses.slice(0, 2).map((use) => `${use.namespace}/${use.pod}`).join(', ')}
                            {entry.uses.length > 2 ? ` +${entry.uses.length - 2} more` : ''}
                          </span>
                        </td>
                        <td>
                          <span className={`security-access ${entry.scanReport ? 'allowed' : 'blocked'}`}>
                            <i className={`fa-solid ${entry.scanReport ? 'fa-circle-check' : 'fa-clock'}`} aria-hidden="true" />
                            {entry.scanReport ? 'Cached' : 'Pending'}
                          </span>
                        </td>
                        <td>
                          <span className={`security-access ${entry.scanAllowed ? 'allowed' : 'blocked'}`}>
                            <i className={`fa-solid ${entry.scanAllowed ? 'fa-circle-check' : 'fa-lock'}`} aria-hidden="true" />
                            {entry.scanAllowed ? 'Allowed' : 'Not allowlisted'}
                          </span>
                        </td>
                        <td>
                          <div className="security-image-actions">
                            {entry.scanReport ? (
                              <Link
                                className="btn btn-sm btn-outline-secondary"
                                href={`/security/vulnerabilities?image=${encodeURIComponent(entry.image)}`}
                                aria-label={`View vulnerabilities for ${entry.image}`}
                              >
                                <i className="fa-solid fa-bug me-1" aria-hidden="true" />
                                View vulnerabilities
                              </Link>
                            ) : (
                              <button type="button" className="btn btn-sm btn-outline-secondary" disabled>
                                <i className="fa-solid fa-bug me-1" aria-hidden="true" />
                                View vulnerabilities
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => rescanImage(entry.image)}
                              disabled={!entry.scanReport || Boolean(busy)}
                              aria-label={`Rescan ${entry.image}`}
                            >
                              Rescan
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="storage-empty">
                <i className="fa-solid fa-box-open" aria-hidden="true" />
                <strong>{search ? 'No matching images' : 'No Pod images found'}</strong>
                <span>{search ? 'Try another search.' : 'Images appear here when Pods reference them.'}</span>
              </div>
            )}
            {images.length > 0 && (
              <div className="storage-table-footer">
                Showing {filteredImages.length} of {images.length} unique images
              </div>
            )}
          </section>

          <p className="inventory-notice">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            Vulnerability and CycloneDX reports are stored by Trivy Operator in Kubernetes. Rescan deletes matching
            VulnerabilityReport resources so the Operator recreates them; the dashboard does not run vulnerability
            scans directly. SPDX exports use the npm-installed Trivy runner and the registry allowlist.
            Security scanning is not a substitute for image signing, runtime monitoring, or a full vulnerability-management program.
          </p>
          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
