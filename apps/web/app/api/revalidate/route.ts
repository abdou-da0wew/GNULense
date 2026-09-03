export const runtime = "edge"

export async function POST(req: Request): Promise<Response> {
  const secret = req.headers.get("x-revalidate-secret")
  if (secret !== process.env.VERCEL_REVALIDATE_SECRET) {
    return new Response(JSON.stringify({ error: "INVALID_SECRET" }), { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { slug?: string; slugs?: string[] }
  const slugs = body.slugs ?? (body.slug ? [body.slug] : [])
  if (slugs.length === 0) return new Response(JSON.stringify({ error: "NO_SLUGS" }), { status: 400 })

  const { revalidatePath } = await import("next/cache")
  for (const slug of slugs.slice(0, 500)) {
    try {
      revalidatePath(`/docs/${slug}`)
    } catch {}
  }
  return new Response(JSON.stringify({ ok: true, revalidated: slugs.length }), { headers: { "content-type": "application/json" } })
}
