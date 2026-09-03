export type Doc = { slug: string; title: string; sections: any[] }

export async function loadDocument(slug: string): Promise<Doc> {
  const bucket = process.env.TIGRIS_BUCKET
  const endpoint = process.env.TIGRIS_ENDPOINT
  if (bucket && endpoint) {
    const url = `${endpoint.replace(/\/$/, "")}/${bucket}/processed/${slug}.json`
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`Tigris miss ${slug} ${res.status}`)
    return res.json()
  }
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  const p = path.join(process.cwd(), "data", "processed", `${slug}.json`)
  return JSON.parse(await fs.readFile(p, "utf-8"))
}

export async function listSlugs(): Promise<string[]> {
  const bucket = process.env.TIGRIS_BUCKET
  if (bucket) {
    // In prod, list via Mongo manifest is cheaper — fallback to empty for ISR
    return []
  }
  return []
}
