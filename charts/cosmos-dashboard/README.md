# Cosmos Kubernetes Dashboard Helm chart

This chart installs the Cosmos Kubernetes Dashboard and its ServiceAccount, cluster-wide read permissions, Deployment, and Service.

## Install

The chart is published as an OCI artifact:

```sh
helm install cosmos-dashboard \
  oci://ghcr.io/aice09/cosmos-dashboard \
  --version 1.0.2 \
  --namespace cosmos-dashboard \
  --create-namespace
```

By default the Service is `ClusterIP`. Use port-forwarding to access it locally:

```sh
kubectl port-forward -n cosmos-dashboard service/cosmos-dashboard 3000:3000
```

Then open `http://localhost:3000`. To use another exposure method, configure `service.type`, `service.nodePort`, or `ingress.*` in a values file. The dashboard has no built-in user authentication; protect external access with an authenticated ingress or another trusted access layer.

## Cluster permissions and credentials

The chart creates a Kubernetes ServiceAccount and binds it to a ClusterRole. The Pod uses the automatically projected, rotating in-cluster ServiceAccount token and cluster CA; no kubeconfig or long-lived token Secret is required.

The dashboard needs cluster-wide read access for its inventory pages and delete access to Trivy VulnerabilityReports for the explicit rescan action. Secret `get`/`list` permission is enabled by default for certificate and configuration metadata views. Secret values are not rendered by the app, but read access remains sensitive. Disable it if those views are not required:

```sh
helm upgrade --install cosmos-dashboard \
  oci://ghcr.io/aice09/cosmos-dashboard \
  --version 1.0.2 \
  --namespace cosmos-dashboard \
  --create-namespace \
  --set rbac.allowSecretRead=false
```

The cluster must have the Trivy Operator CRDs installed to use vulnerability reports and SBOMs. Private image registries must be configured separately for Trivy Operator.

## Artifact Hub

The OCI chart repository is `oci://ghcr.io/aice09/cosmos-dashboard`. The chart package is publicly readable. The application image must also be public for users to install the chart without registry credentials. In GitHub, open the `cosmos` image package's **Package settings** and set visibility to **Public**:

- `cosmos` (the dashboard container image)

Alternatively, keep the application image private and configure `image.pullSecrets` with a Kubernetes Secret that can pull it.

After the chart package is public, sign in to Artifact Hub and add `oci://ghcr.io/aice09/cosmos-dashboard` from the publisher control panel. Artifact Hub account/repository registration is an owner action and cannot be completed by the chart's GitHub Actions workflow.

## Configuration

See [`values.yaml`](values.yaml) for image, service, ingress, security context, resource, RBAC, and Trivy settings.
