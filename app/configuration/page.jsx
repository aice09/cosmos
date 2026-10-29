import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'Configuration | Cosmos Kubernetes Dashboard' };

export default function ConfigurationPage() {
  return (
    <InventoryPage
      section="configuration"
      active="configuration"
      title="Configuration"
      description="Review ConfigMap and Secret metadata without exposing stored values."
    />
  );
}
