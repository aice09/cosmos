# Cosmos Kubernetes Dashboard

A cluster dashboard built with Next.js, Bootstrap, Font Awesome, DataTables, and the Kubernetes Node.js client. The dashboard summarizes node health, allocatable CPU and memory, pod status, deployments, namespaces, and recent pods. Dedicated pages browse pods, namespaces, deployments, StatefulSets, DaemonSets, Jobs, CronJobs, ReplicaSets, autoscalers, and disruption budgets. The local-only Pod Generator previews and downloads Kubernetes YAML; it does not apply resources to the cluster. The Nodes page shows detailed system information, resources, addresses, labels, taints, and conditions. The Storage page shows persistent volumes, claims, storage classes, capacity, and claim-to-pod usage. IAM, Networking, Resource Management, and Configuration pages provide read-only inventories of Kubernetes identities, policies, traffic resources, quotas, custom resource definitions, ConfigMaps, and Secret metadata. Secret and configuration values are never displayed. Certificates monitors `kubernetes.io/tls` Secrets and cert-manager Certificate resources, reporting expiry without returning certificate bytes or private keys. Cluster Health tracks API-server pods/API reachability, etcd ComponentStatus when available, kube-proxy DaemonSets/pods, and kubelet readiness from Node conditions. Security inventories current Pod images and reads cached vulnerability and CycloneDX SBOM reports from Trivy Operator. Vulnerability rescans are explicit; SPDX exports use the npm-installed Trivy runner. Inventory views refresh automatically every 30 seconds.

## Run locally

Requirements: Node.js 26.13.0+ and npm.

```sh
npm ci
npm run dev
```

The API uses `KUBECONFIG` when set, or `~/.kube/config` for the user running the app. That user needs read access to nodes, namespaces, pods, workloads, storage resources, service accounts, RBAC, network policies, ingress, services, endpoints, quotas, limit ranges, ConfigMaps, Secrets, component statuses, cert-manager Certificates (when installed), and custom resource definitions across the cluster. To select the config explicitly, run `KUBECONFIG="$HOME/.kube/config" npm run dev`.

Install Trivy Operator from the sibling `/home/ops/trivy` directory using its [README](../trivy/README.md). Vulnerability scans and CycloneDX SBOMs are produced and cached by the Operator; the Security page's **Rescan image** action deletes matching VulnerabilityReport resources to request a new Operator scan. The dashboard ServiceAccount requires list access to VulnerabilityReport and SbomReport resources and delete access to VulnerabilityReports, as included in `k8s/rbac.yaml`. Keep the dashboard behind trusted network access or authenticated ingress because its cluster APIs are unauthenticated.

The SPDX JSON and SPDX tag-value exports use the npm dependency `@b2bc-devkit/trivy-scan`. It downloads the official Trivy binary on first use and verifies its SHA-256 checksum. The dashboard pins Trivy v0.76.1 by default; `TRIVY_SCAN_VERSION` and `TRIVY_SCAN_CACHE_DIR` can change the version or binary cache location. Only images referenced by current Pods are accepted. Default export registry allowlist: Docker Hub, GitHub Container Registry, Quay, Kubernetes, Google, Amazon ECR Public, Microsoft, and Google Artifact Registry (`.pkg.dev`). Add trusted registries with a comma-separated `TRIVY_ALLOWED_REGISTRIES` value. SPDX export is limited to one concurrent request per app process, eight minutes, and 20 MB of output. Private registry credentials are not read by the dashboard; configure access for Trivy Operator separately when needed.

## Build and run with Docker

```sh
npm ci
npm run build
docker build -t cosmos-dashboard .
```

The image uses Next.js standalone output and listens on port 3000. To run it with a local kubeconfig, mount that file read-only; its Kubernetes API endpoint must also be reachable from inside the container:

```sh
docker run --rm -p 3000:3000 \
  -e KUBECONFIG=/kube/config \
  -v "$HOME/.kube:/kube:ro" \
  cosmos-dashboard
```

  ### Deploy with containerd

  The included manifests run the image from the `k8s.io` containerd namespace on `homepc05`, then expose it on NodePort 30080. Build with Podman and import the image into containerd on that node:

  ```sh
  sudo podman build --format docker --tag cosmos-dashboard:latest .
  sudo podman save --format docker-archive \
    --output /tmp/cosmos-dashboard-image.tar localhost/cosmos-dashboard:latest
  sudo nerdctl --namespace k8s.io load --input /tmp/cosmos-dashboard-image.tar
  sudo rm /tmp/cosmos-dashboard-image.tar
  kubectl apply -f k8s/dashboard.yaml
  kubectl apply -f k8s/rbac.yaml
  kubectl rollout status deployment/cosmos-dashboard -n cosmos-dashboard
  ```

  Open `http://<node-address>:30080`. The local image is pinned to `homepc05` because containerd image stores are node-local; to run on other nodes or use multiple replicas, push the image to a registry reachable by the cluster, update the Deployment image and pull policy, and remove its node selector. Keep this dashboard endpoint on a trusted network or put it behind an authenticated HTTPS ingress; the NodePort manifest does not provide user authentication.

  The Deployment uses the `cosmos-dashboard` Kubernetes ServiceAccount. Kubernetes automatically projects a short-lived, rotating ServiceAccount token and cluster CA into the Pod; the Kubernetes client reads those in-cluster credentials. Do not copy an administrator kubeconfig or create a long-lived token Secret for the app. `k8s/rbac.yaml` binds this identity to the dashboard's cluster-read permissions plus delete permission for VulnerabilityReports (used only by the explicit rescan action). The current read-only Configuration and certificate views also require Secret `get`/`list` permission; although secret values are not displayed, that permission is sensitive and should only be granted when those views are needed. The Pod Generator only produces a local YAML preview and download; it does not require cluster write permissions.

  ## Helm chart and Artifact Hub

  The installable chart is in [`charts/cosmos-dashboard`](charts/cosmos-dashboard). After the chart publication workflow has published it to GHCR, install it with:

  ```sh
  helm install cosmos-dashboard \
    oci://ghcr.io/aice09/charts/cosmos-dashboard \
    --version 1.0.1 \
    --namespace cosmos-dashboard \
    --create-namespace
  ```

  The chart defaults to a ClusterIP Service. Use `kubectl port-forward` for local access or configure an authenticated Ingress before exposing it. It creates its own ServiceAccount and ClusterRoleBinding; no kubeconfig needs to be placed in the Pod. Secret read access is enabled by default for the Configuration and certificate views and can be disabled with `--set rbac.allowSecretRead=false`.

  The `Publish Helm chart` GitHub Actions workflow publishes chart changes to the OCI repository `ghcr.io/aice09/cosmos-dashboard`. To list it on Artifact Hub, the repository owner must add `oci://ghcr.io/aice09/cosmos-dashboard` from an Artifact Hub account and ensure the GHCR chart package and application image package visibility are public. Artifact Hub account registration is a one-time publisher action.

The certificate view can only monitor certificates exposed through Kubernetes TLS Secrets or cert-manager resources. Host-managed PKI files such as kubeadm certificates are not available through the Kubernetes API. Component health is based on API-visible status and is not a replacement for metrics, logs, or host monitoring; Kubernetes ComponentStatus is deprecated and may not be available on every cluster.

The dashboard API exposes cluster inventory to anyone who can reach the app. Keep it behind trusted network access or an authenticated ingress; RBAC limits Kubernetes permissions but does not authenticate dashboard visitors. Image scans cause the dashboard host to fetch image metadata/layers from configured registries; restrict network egress and allowed registries appropriately.
