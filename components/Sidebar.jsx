'use client';

import Link from 'next/link';

export default function Sidebar({ active }) {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="Cosmos dashboard home">
        <span className="brand-mark"><i className="fa-solid fa-cubes" aria-hidden="true" /></span>
        <span>cosmos<span className="brand-period">.</span></span>
      </Link>
      <div className="sidebar-section-label">OVERVIEW</div>
      <Link className={`sidebar-link ${active === 'dashboard' ? 'active' : ''}`} href="/">
        <i className="fa-solid fa-chart-pie" aria-hidden="true" />
        Dashboard
      </Link>
      <Link className={`sidebar-link ${active === 'nodes' ? 'active' : ''}`} href="/nodes">
        <i className="fa-solid fa-server" aria-hidden="true" />
        Nodes
      </Link>
      <Link className={`sidebar-link ${active === 'storage' ? 'active' : ''}`} href="/storage">
        <i className="fa-solid fa-hard-drive" aria-hidden="true" />
        Storage
      </Link>
      <Link className={`sidebar-link ${active === 'workloads' ? 'active' : ''}`} href="/workloads">
        <i className="fa-solid fa-cubes-stacked" aria-hidden="true" />
        Workloads
      </Link>
      <Link className={`sidebar-link ${active === 'pods' ? 'active' : ''}`} href="/pods">
        <i className="fa-solid fa-cube" aria-hidden="true" />
        Pods
      </Link>
      <Link className={`sidebar-link ${active === 'namespaces' ? 'active' : ''}`} href="/namespaces">
        <i className="fa-solid fa-layer-group" aria-hidden="true" />
        Namespaces
      </Link>
      <Link className={`sidebar-link ${active === 'pod-generator' ? 'active' : ''}`} href="/pod-generator">
        <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
        Pod generator
      </Link>
      <div className="sidebar-section-label sidebar-section-platform">MONITORING</div>
      <Link className={`sidebar-link ${active === 'certificates' ? 'active' : ''}`} href="/certificates">
        <i className="fa-solid fa-certificate" aria-hidden="true" />
        Certificates
      </Link>
      <Link className={`sidebar-link ${active === 'monitoring' ? 'active' : ''}`} href="/monitoring">
        <i className="fa-solid fa-heart-pulse" aria-hidden="true" />
        Cluster health
      </Link>
      <Link className={`sidebar-link ${active === 'security' ? 'active' : ''}`} href="/security">
        <i className="fa-solid fa-shield-halved" aria-hidden="true" />
        Security
      </Link>
      <div className="sidebar-section-label sidebar-section-platform">PLATFORM</div>
      <Link className={`sidebar-link ${active === 'iam' ? 'active' : ''}`} href="/iam">
        <i className="fa-solid fa-user-shield" aria-hidden="true" />
        IAM
      </Link>
      <Link className={`sidebar-link ${active === 'networking' ? 'active' : ''}`} href="/networking">
        <i className="fa-solid fa-network-wired" aria-hidden="true" />
        Networking
      </Link>
      <Link className={`sidebar-link ${active === 'resources' ? 'active' : ''}`} href="/resources">
        <i className="fa-solid fa-gauge-high" aria-hidden="true" />
        Resource management
      </Link>
      <Link className={`sidebar-link ${active === 'configuration' ? 'active' : ''}`} href="/configuration">
        <i className="fa-solid fa-sliders" aria-hidden="true" />
        Configuration
      </Link>
      <div className="sidebar-footer">
        <span className="connection-indicator" />
        <span>Cluster overview</span>
      </div>
    </aside>
  );
}
