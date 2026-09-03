export const runtime = "edge"

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
    headers: { "content-type": "application/json" },
  })
}
