'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function severityRank(severity = '') {
  const index = SEVERITY_ORDER.indexOf(severity.toUpperCase());
  return index < 0 ? SEVERITY_ORDER.length : index;
}

function cveInformationUrl(item) {
  if (item.url?.startsWith('https://')) return item.url;
  if (/^CVE-\d{4}-\d{4,}$/i.test(item.id)) {
    return `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(item.id)}`;
  }
  return '';
}

export default function VulnerabilitiesPage({ initialImage }) {
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(initialImage);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadImages() {
      try {
        const response = await fetch('/api/security/images', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load cached vulnerability reports.');
        if (!active) return;
        const nextImages = result.images || [];
        setImages(nextImages);
        setSelectedImage((current) =>
          nextImages.some((entry) => entry.image === current)
            ? current
            : nextImages.find((entry) => entry.scanReport)?.image || nextImages[0]?.image || '',
        );
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load cached vulnerability reports.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadImages();
    return () => {
      active = false;
    };
  }, []);

  const selectedEntry = images.find((entry) => entry.image === selectedImage);
  const report = selectedEntry?.scanReport;
  const totalFindings = report
    ? Object.values(report.counts).reduce((total, count) => total + count, 0)
    : 0;
  const findings = useMemo(() => {
    if (!report) return [];
    const needle = search.trim().toLowerCase();
    return [...report.vulnerabilities]
      .sort((left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        left.id.localeCompare(right.id),
      )
      .filter((item) =>
        !needle || `${item.id} ${item.package} ${item.target} ${item.title}`.toLowerCase().includes(needle),
      );
  }, [report, search]);

  return (
    <div className="dashboard-shell">
      <Sidebar active="security" />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb-label">
            <Link href="/" className="breadcrumb-link">Clusters</Link>
            <span>/</span>
            <Link href="/security" className="breadcrumb-link">Security</Link>
            <span>/</span>
            Vulnerabilities
          </div>
          <div className="topbar-actions">
            <Link href="/security" className="btn refresh-button">
              <i className="fa-solid fa-arrow-left me-2" aria-hidden="true" />
              Back to images
            </Link>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">SECURITY</p>
              <h1>Vulnerability findings</h1>
              <p className="heading-subtitle">
                Review every cached finding for the selected cluster image and open its CVE reference.
              </p>
            </div>
          </section>

          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          <section className="content-card security-actions-card">
            <div className="security-controls vulnerability-controls">
              <label className="security-field">
                <span>Cluster image</span>
                <select
                  value={selectedImage}
                  onChange={(event) => {
                    setSelectedImage(event.target.value);
                    setSearch('');
                  }}
                  disabled={loading || !images.length}
                >
                  {images.length ? images.map((entry) => (
                    <option key={entry.image} value={entry.image}>
                      {entry.image}{entry.scanReport ? '' : ' (report pending)'}
                    </option>
                  )) : <option value="">No Pod images found</option>}
                </select>
              </label>
              {report && (
                <div className="vulnerability-report-meta">
                  <span>{report.reportCount} workload report{report.reportCount === 1 ? '' : 's'}</span>
                  <span>{report.scannedAt ? `Scanned ${new Date(report.scannedAt).toLocaleString()}` : 'Scan time unavailable'}</span>
                  {report.digest && <code>{report.digest}</code>}
                </div>
              )}
            </div>
          </section>

          <section className="inventory-summary-grid vulnerability-summary" aria-label="Vulnerability counts">
            {SEVERITY_ORDER.map((severity) => (
              <article className="inventory-summary-card" key={severity}>
                <div>
                  <small>{severity}</small>
                  <strong>{report?.counts[severity] || 0}</strong>
                  <span>Cached findings</span>
                </div>
              </article>
            ))}
          </section>

          <section className="content-card security-findings-card" aria-label="Vulnerability findings table">
            <div className="inventory-card-heading">
              <div>
                <h2>{selectedImage || 'Cluster image'} vulnerabilities</h2>
                <p>{totalFindings} findings in the cached Operator report</p>
              </div>
              <label className="inventory-search">
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search CVE, package, target..."
                  aria-label="Search vulnerability findings"
                />
              </label>
            </div>

            {loading ? (
              <div className="loading-panel">
                <span className="spinner-border spinner-border-sm me-2" role="status" />
                Loading cached vulnerability reports...
              </div>
            ) : !report ? (
              <div className="storage-empty">
                <i className="fa-solid fa-clock" aria-hidden="true" />
                <strong>{selectedImage ? 'Vulnerability report is pending' : 'No cluster images found'}</strong>
                <span>
                  {selectedImage
                    ? 'Trivy Operator has not completed a report for this image yet.'
                    : 'Reports appear here when Pods reference images in the cluster.'}
                </span>
              </div>
            ) : findings.length ? (
              <div className="table-responsive">
                <table className="table align-middle security-findings-table">
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>CVE</th>
                      <th>Package</th>
                      <th>Installed</th>
                      <th>Fixed in</th>
                      <th>Target</th>
                      <th>CVE information</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((item, index) => {
                      const informationUrl = cveInformationUrl(item);
                      return (
                        <tr key={`${item.id}/${item.package}/${item.target}/${index}`}>
                          <td>
                            <span className={`severity-badge ${item.severity.toLowerCase()}`}>
                              {item.severity}
                            </span>
                          </td>
                          <td className="security-finding-id">{item.id}</td>
                          <td>{item.package}</td>
                          <td>{item.installedVersion}</td>
                          <td>{item.fixedVersion}</td>
                          <td>{item.target}</td>
                          <td>
                            {informationUrl ? (
                              <a
                                className="btn btn-sm btn-outline-primary"
                                href={informationUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`View CVE information for ${item.id}`}
                              >
                                <i className="fa-solid fa-arrow-up-right-from-square me-1" aria-hidden="true" />
                                View CVE
                              </a>
                            ) : <span className="text-muted">Unavailable</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="storage-empty">
                <i className={`fa-solid ${totalFindings ? 'fa-magnifying-glass' : 'fa-circle-check'}`} aria-hidden="true" />
                <strong>{totalFindings ? 'No matching findings' : 'No vulnerabilities found'}</strong>
                <span>
                  {totalFindings
                    ? 'Try another search.'
                    : 'Trivy Operator did not report package vulnerabilities in this image.'}
                </span>
              </div>
            )}
            {report && findings.length > 0 && (
              <div className="storage-table-footer">
                Showing {findings.length} of {totalFindings} vulnerabilities
              </div>
            )}
          </section>
          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
