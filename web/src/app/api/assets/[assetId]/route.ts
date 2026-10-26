const apiBase = process.env.RISE_API_URL ?? "http://127.0.0.1:8001";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  try {
    const response = await fetch(`${apiBase}/api/assets/${encodeURIComponent(assetId)}`, {
      cache: "no-store",
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json({ detail: "Rise API is unavailable" }, { status: 503 });
  }
}