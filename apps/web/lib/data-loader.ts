export type DocSection = {
  id: string
  level: number
  heading: string
  content: string
  html: string
  codeBlocks: { language: string | null; code: string }[]
  media?: string[]
  tables?: { headers: string[]; rows: string[][] }[]
  anchors?: string[]
}
export type Doc = {
  sourceUrl: string
  slug: string
  title: string
  sha256: string
  parsedAt: string
  contentType: string
  sections: DocSection[]
  wordCount?: number
  mediaCount?: number
}

const TIGRIS_ENDPOINT = process.env.TIGRIS_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3 ?? "https://t3.storage.dev"
const BUCKET_RAW = process.env.TIGRIS_BUCKET_RAW ?? "gnu-lens-raw"
const BUCKET_PROCESSED = process.env.TIGRIS_BUCKET_PROCESSED ?? "gnu-lens-processed"

export async function loadDocument(slug: string): Promise<Doc> {
  const normalized = slug.replace(/^\/+|\/+$/g, "")
  // Edge will proxy via /api/media?key=processed/... but direct Tigris is faster for build
  const urls = [
    `${TIGRIS_ENDPOINT}/${BUCKET_PROCESSED}/processed/${normalized}.json`,
    `${TIGRIS_ENDPOINT}/${BUCKET_RAW}/processed/${normalized}.json`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } } as any)
      if (res.ok) return (await res.json()) as Doc
    } catch {}
  }
  // Fallback local (dev)
  try {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const p = path.join(process.cwd(), "apps/web", "data", "processed", `${normalized}.json`)
    return JSON.parse(await fs.readFile(p, "utf-8"))
  } catch {}
  throw new Error(`Doc not found: ${slug}`)
}

export async function listSlugs(): Promise<string[]> {
  // Super fast: fetch slugs.json (7492) via Tigris Edge, not via Mongo at build
  try {
    const res = await fetch(`${TIGRIS_ENDPOINT}/${BUCKET_PROCESSED}/manifest/slugs.json`, { next: { revalidate: 3600 } } as any)
    if (res.ok) {
      const slugs = (await res.json()) as string[]
      if (Array.isArray(slugs) && slugs.length > 0) return slugs
    }
  } catch {}
  try {
    const res = await fetch(`${TIGRIS_ENDPOINT}/${BUCKET_RAW}/manifest/slugs.json`, { next: { revalidate: 3600 } } as any)
    if (res.ok) {
      const slugs = (await res.json()) as string[]
      if (slugs.length > 0) return slugs
    }
  } catch {}
  return []
}

export async function listSlugsWithMeta(): Promise<{ slug: string; title: string }[]> {
  try {
    const res = await fetch(`${TIGRIS_ENDPOINT}/${BUCKET_PROCESSED}/manifest/full-index.json`, { next: { revalidate: 3600 } } as any)
    if (res.ok) {
      const index = (await res.json()) as any[]
      return index.slice(0, 7492).map((m: any) => ({ slug: m.slug, title: m.slug.split("/").pop() || m.slug }))
    }
  } catch {}
  const slugs = await listSlugs()
  return slugs.map((s) => ({ slug: s, title: s.split("/").pop() || s }))
}
