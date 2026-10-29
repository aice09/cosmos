import VulnerabilitiesPage from '../../../components/VulnerabilitiesPage';

export const metadata = {
  title: 'Vulnerability findings | Cosmos Kubernetes Dashboard',
};

export default async function Page({ searchParams }) {
  const params = await searchParams;
  const initialImage = typeof params?.image === 'string' ? params.image : '';
  return <VulnerabilitiesPage initialImage={initialImage} />;
}
