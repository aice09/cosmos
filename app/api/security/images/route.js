import {
  aggregateVulnerabilityReports,
  DEFAULT_TRIVY_VERSION,
  listClusterImages,
  listClusterSbomReports,
  listClusterVulnerabilityReports,
  reportMatchesImage,
} from '../image-inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function GET() {
  try {
    const [images, vulnerabilityReports, sbomReports] = await Promise.all([
      listClusterImages(),
      listClusterVulnerabilityReports(),
      listClusterSbomReports(),
    ]);
    const scannerVersion = vulnerabilityReports.find((report) => report.report?.scanner?.version)
      ?.report?.scanner?.version ||
      sbomReports.find((report) => report.report?.scanner?.version)?.report?.scanner?.version;
    return Response.json({
      images: images.map((entry) => ({
        ...entry,
        scanReport: aggregateVulnerabilityReports(entry.image, vulnerabilityReports),
        sbomAvailable: sbomReports.some((report) => reportMatchesImage(entry.image, report)),
      })),
      trivyVersion: scannerVersion || process.env.TRIVY_SCAN_VERSION || DEFAULT_TRIVY_VERSION,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Unable to load cluster image inventory:', error);
    return Response.json(
      { error: 'Unable to load cluster images and Trivy reports. Check Kubernetes connectivity, report CRDs, and dashboard RBAC.' },
      { status: 503 },
    );
  }
}
