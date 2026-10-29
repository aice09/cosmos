import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'Pods | Cosmos Kubernetes Dashboard' };

export default function PodsPage() {
  return (
    <InventoryPage
      section="pods"
      active="pods"
      title="Pods"
      description="Browse pod health, container images, restarts, and node placement across namespaces."
    />
  );
}
