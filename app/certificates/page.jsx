import InventoryPage from '../../components/InventoryPage';

export const metadata = {
  title: 'Certificates | Cosmos Kubernetes Dashboard',
};

export default function Certificates() {
  return (
    <InventoryPage
      section="certificates"
      title="Certificates"
      description="Inspect TLS certificate expiry and cert-manager status without exposing certificate data."
      active="certificates"
    />
  );
}
