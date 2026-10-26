const apiBase = process.env.RISE_API_URL ?? "http://127.0.0.1:8001";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const response = await fetch(`${apiBase}/api/assist/transcribe`, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json({ detail: "Voice transcription service is unavailable." }, { status: 503 });
  }
}