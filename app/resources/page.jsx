import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'Resource management | Cosmos Kubernetes Dashboard' };

export default function ResourcesPage() {
  return (
    <InventoryPage
      section="resources"
      active="resources"
      title="Resource management"
      description="Inspect namespace quotas, resource limit ranges, and custom resource APIs."
    />
  );
}
