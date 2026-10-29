import {
  listClusterImages,
  listClusterSbomReports,
  reportMatchesImage,
} from '../image-inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const image = searchParams.get('image') || '';
  if (
    image.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(image)
  ) {
    return Response.json({ error: 'Select a valid image reference from the cluster inventory.' }, { status: 400 });
  }

  try {
    const images = await listClusterImages();
    if (!images.some((entry) => entry.image === image)) {
      return Response.json(
        { error: 'The image is no longer referenced by a cluster Pod. Refresh the image inventory and try again.' },
        { status: 409 },
      );
    }

    const reports = await listClusterSbomReports();
    const report = reports
      .filter((entry) => reportMatchesImage(image, entry))
      .sort((left, right) => (
        (left.report?.updateTimestamp || left.metadata?.creationTimestamp || '')
          .localeCompare(right.report?.updateTimestamp || right.metadata?.creationTimestamp || '')
      ))
      .at(-1);
    const bom = report?.report?.components;
    if (!bom) {
      return Response.json(
        { error: 'The Operator SBOM is not available yet. Wait for the workload scan to finish and refresh.' },
        { status: 404 },
      );
    }
    if (bom.bomFormat !== 'CycloneDX') {
      return Response.json({ error: 'The Operator returned an unsupported SBOM format.' }, { status: 502 });
    }

    const safeName = image.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
    return new Response(`${JSON.stringify(bom, null, 2)}\n`, {
      headers: {
        'Content-Type': 'application/vnd.cyclonedx+json',
        'Content-Disposition': `attachment; filename="${safeName}.cdx.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Unable to export the Operator SBOM:', error);
    return Response.json(
      { error: 'Unable to load the Operator SBOM. Check Kubernetes connectivity and SbomReport read RBAC.' },
      { status: 503 },
    );
  }
}
