import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'Networking | Cosmos Kubernetes Dashboard' };

export default function NetworkingPage() {
  return (
    <InventoryPage
      section="networking"
      active="networking"
      title="Networking"
      description="Review services, endpoints, ingress routes, and network policies."
    />
  );
}
