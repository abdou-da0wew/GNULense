export const runtime = "edge"

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  if (!q) return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } })
  // Edge search is fallback — primary is client-side loading search-index-*.json from Tigris.
  // Here we just echo, real impl fetches search-index-0.json from Tigris and filters.
  const bucket = process.env.TIGRIS_BUCKET
  const endpoint = process.env.TIGRIS_ENDPOINT
  if (bucket && endpoint) {
    try {
      const idxUrl = `${endpoint.replace(/\/$/, "")}/${bucket}/search/search-index-0.json`
      const res = await fetch(idxUrl)
      const idx = (await res.json()) as any[]
      const results = idx.filter((d) => JSON.stringify(d).toLowerCase().includes(q.toLowerCase())).slice(0, 20)
      return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } })
    } catch {}
  }
  return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } })
}
