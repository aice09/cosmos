import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'IAM | Cosmos Kubernetes Dashboard' };

export default function IamPage() {
  return (
    <InventoryPage
      section="iam"
      active="iam"
      title="IAM"
      description="Inspect service accounts, roles, and the bindings that grant Kubernetes permissions."
    />
  );
}
