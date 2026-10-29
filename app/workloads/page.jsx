import InventoryPage from '../../components/InventoryPage';

export const metadata = { title: 'Workloads | Cosmos Kubernetes Dashboard' };

export default function WorkloadsPage() {
  return (
    <InventoryPage
      section="workloads"
      active="workloads"
      title="Workloads"
      description="Browse controllers, scheduled jobs, autoscalers, and disruption budgets."
    />
  );
}
