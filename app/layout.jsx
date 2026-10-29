import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import 'datatables.net-bs5/css/dataTables.bootstrap5.min.css';
import './globals.css';

export const metadata = {
  title: 'Cosmos | Kubernetes Dashboard',
  description: 'A real-time overview of your Kubernetes cluster.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
