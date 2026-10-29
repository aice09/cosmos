import InventoryPage from '../../components/InventoryPage';

export const metadata = {
  title: 'Cluster Health | Cosmos Kubernetes Dashboard',
};

export default function Monitoring() {
  return (
    <InventoryPage
      section="monitoring"
      title="Cluster Health"
      description="Monitor API-server, etcd, kube-proxy, and kubelet health signals."
      active="monitoring"
    />
  );
}
