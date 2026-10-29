import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'Namespaces | Cosmos Kubernetes Dashboard' };

export default function NamespacesPage() {
  return (
    <InventoryPage
      section="namespaces"
      active="namespaces"
      title="Namespaces"
      description="Review namespace lifecycle, pod health, and labels across the cluster."
    />
  );
}
