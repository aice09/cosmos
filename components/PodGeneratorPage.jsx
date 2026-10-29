'use client';

import { useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';

function quoteYaml(value) {
  return JSON.stringify(value);
}

function buildPodYaml(values) {
  const lines = [
    'apiVersion: v1',
    'kind: Pod',
    'metadata:',
    `  name: ${quoteYaml(values.name)}`,
    `  namespace: ${quoteYaml(values.namespace)}`,
    '  labels:',
    `    app: ${quoteYaml(values.name)}`,
    'spec:',
    `  restartPolicy: ${quoteYaml(values.restartPolicy)}`,
    '  containers:',
    `    - name: ${quoteYaml(values.containerName)}`,
    `      image: ${quoteYaml(values.image)}`,
    `      imagePullPolicy: ${quoteYaml(values.imagePullPolicy)}`,
  ];

  if (values.port) {
    lines.push(
      '      ports:',
      '        - name: http',
      `          containerPort: ${Number(values.port)}`,
      '          protocol: TCP',
    );
  }

  const requests = [];
  const limits = [];
  if (values.cpuRequest) requests.push(`          cpu: ${quoteYaml(values.cpuRequest)}`);
  if (values.memoryRequest) requests.push(`          memory: ${quoteYaml(values.memoryRequest)}`);
  if (values.cpuLimit) limits.push(`          cpu: ${quoteYaml(values.cpuLimit)}`);
  if (values.memoryLimit) limits.push(`          memory: ${quoteYaml(values.memoryLimit)}`);

  if (requests.length || limits.length) {
    lines.push('      resources:');
    if (requests.length) lines.push('        requests:', ...requests);
    if (limits.length) lines.push('        limits:', ...limits);
  }

  return `${lines.join('\n')}\n`;
}

export default function PodGeneratorPage() {
  const [yaml, setYaml] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  function generate(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    setYaml(buildPodYaml(values));
    setCopyMessage('');
  }

  async function copyYaml() {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopyMessage('YAML copied to clipboard.');
    } catch (error) {
      console.error('Unable to copy the generated Pod manifest:', error);
      setCopyMessage('Copy was blocked by the browser. Select and copy the YAML instead.');
    }
  }

  function downloadYaml() {
    const blob = new Blob([yaml], { type: 'application/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pod.yaml';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dashboard-shell">
      <Sidebar active="pod-generator" />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb-label">
            <Link href="/" className="breadcrumb-link">Clusters</Link>
            <span>/</span>
            <Link href="/pods" className="breadcrumb-link">Pods</Link>
            <span>/</span>
            Generator
          </div>
          <span className="read-only-label"><i className="fa-solid fa-eye" aria-hidden="true" /> YAML preview only</span>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">KUBERNETES</p>
              <h1>Pod Generator</h1>
              <p className="heading-subtitle">Configure a basic Pod and preview a manifest you can review and apply yourself.</p>
            </div>
          </section>

          <div className="alert alert-info pod-generator-notice" role="note">
            <i className="fa-solid fa-shield-halved" aria-hidden="true" />
            <span><strong>Read-only mode.</strong> This tool only generates a local YAML file. It never submits resources to your cluster.</span>
          </div>

          <div className="pod-generator-grid">
            <form className="content-card pod-generator-form" onSubmit={generate}>
              <div className="card-heading">
                <div>
                  <h2>Pod settings</h2>
                  <p>Required fields are marked with an asterisk.</p>
                </div>
                <span className="subtle-icon"><i className="fa-solid fa-sliders" aria-hidden="true" /></span>
              </div>

              <div className="generator-field-grid">
                <label className="generator-field">
                  <span>Pod name <b>*</b></span>
                  <input name="name" required maxLength={63} pattern="[a-z0-9]([a-z0-9]|-)*[a-z0-9]|[a-z0-9]" defaultValue="my-pod" />
                  <small>Lowercase DNS label, up to 63 characters.</small>
                </label>
                <label className="generator-field">
                  <span>Namespace <b>*</b></span>
                  <input name="namespace" required maxLength={63} pattern="[a-z0-9]([a-z0-9]|-)*[a-z0-9]|[a-z0-9]" defaultValue="default" />
                </label>
                <label className="generator-field field-span">
                  <span>Container image <b>*</b></span>
                  <input name="image" required defaultValue="nginx:stable" placeholder="registry.example.com/image:tag" />
                  <small>Use an image and tag available to the cluster.</small>
                </label>
                <label className="generator-field">
                  <span>Container name</span>
                  <input name="containerName" required maxLength={63} pattern="[a-z0-9]([a-z0-9]|-)*[a-z0-9]|[a-z0-9]" defaultValue="app" />
                </label>
                <label className="generator-field">
                  <span>Restart policy</span>
                  <select name="restartPolicy" defaultValue="Always">
                    <option>Always</option>
                    <option>OnFailure</option>
                    <option>Never</option>
                  </select>
                </label>
                <label className="generator-field">
                  <span>Container port</span>
                  <input name="port" type="number" min="1" max="65535" placeholder="Optional" />
                </label>
                <label className="generator-field">
                  <span>Image pull policy</span>
                  <select name="imagePullPolicy" defaultValue="IfNotPresent">
                    <option>IfNotPresent</option>
                    <option>Always</option>
                    <option>Never</option>
                  </select>
                </label>
              </div>

              <div className="generator-subsection">
                <div className="generator-subsection-heading">
                  <h3>CPU and memory</h3>
                  <span>Optional</span>
                </div>
                <div className="generator-field-grid">
                  <label className="generator-field">
                    <span>CPU request</span>
                    <input name="cpuRequest" placeholder="e.g. 100m" />
                  </label>
                  <label className="generator-field">
                    <span>Memory request</span>
                    <input name="memoryRequest" placeholder="e.g. 128Mi" />
                  </label>
                  <label className="generator-field">
                    <span>CPU limit</span>
                    <input name="cpuLimit" placeholder="e.g. 500m" />
                  </label>
                  <label className="generator-field">
                    <span>Memory limit</span>
                    <input name="memoryLimit" placeholder="e.g. 512Mi" />
                  </label>
                </div>
              </div>

              <div className="generator-actions">
                <button className="btn primary-button" type="submit">
                  <i className="fa-solid fa-wand-magic-sparkles me-2" aria-hidden="true" />
                  Generate YAML
                </button>
                <span>Generated locally in your browser</span>
              </div>
            </form>

            <section className="content-card pod-yaml-card">
              <div className="card-heading">
                <div>
                  <h2>Manifest preview</h2>
                  <p>Review the Pod manifest before using it.</p>
                </div>
                {yaml && <span className="yaml-kind-badge">v1 · Pod</span>}
              </div>
              {yaml ? (
                <>
                  <pre className="pod-yaml-preview"><code>{yaml}</code></pre>
                  <div className="yaml-actions">
                    <button className="btn refresh-button" type="button" onClick={copyYaml}>
                      <i className="fa-regular fa-copy me-2" aria-hidden="true" />Copy YAML
                    </button>
                    <button className="btn refresh-button" type="button" onClick={downloadYaml}>
                      <i className="fa-solid fa-download me-2" aria-hidden="true" />Download
                    </button>
                  </div>
                  {copyMessage && <p className="yaml-copy-message" role="status">{copyMessage}</p>}
                  <p className="yaml-apply-hint">To apply manually, review the file and run <code>kubectl apply -f pod.yaml</code>.</p>
                </>
              ) : (
                <div className="yaml-placeholder">
                  <i className="fa-solid fa-file-code" aria-hidden="true" />
                  <strong>Your manifest preview will appear here</strong>
                  <span>Fill in the Pod settings and select Generate YAML.</span>
                </div>
              )}
            </section>
          </div>

          <footer className="page-footer">Cosmos Kubernetes Dashboard <span>·</span> Read-only cluster insights</footer>
        </div>
      </main>
    </div>
  );
}
