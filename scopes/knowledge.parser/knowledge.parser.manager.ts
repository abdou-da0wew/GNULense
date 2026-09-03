import crypto from "node:crypto"
import { createLogger } from "@core/platform/logger.js"
import { tigrisGet } from "@core/platform/storage.tigris.js"
import { getDb } from "@core/platform/db.mongo.js"

export class ParseManager {
  private logger: ReturnType<typeof createLogger>
  constructor(private traceId: string) {
    this.logger = createLogger({ traceId, operation: "knowledge.parser" })
  }

  async parseAll(): Promise<void> {
    this.logger.info("parse.start", {})
    const db = await this.getDbSafe()
    const manifest = db ? await db.collection("crawl_manifest").find({ contentType: /html/ }).toArray() : []
    for (const doc of manifest) {
      try {
        await this.parseOne(doc.storageKey)
      } catch (e) {
        this.logger.error("parse.one_failed", { url: doc.url, error: String(e) })
        if (db) await db.collection("parse_errors").insertOne({ url: doc.url, error: String(e), at: new Date().toISOString() })
      }
    }
    this.logger.info("parse.done", { count: manifest.length })
  }

  async parseOne(storageKey: string): Promise<void> {
    const bytes = await tigrisGet(storageKey)
    const html = new TextDecoder().decode(bytes)
    const doc = this.parseHtml(html, storageKey)
    const key = `processed/${doc.slug}.json`
    const { tigrisPut } = await import("@core/platform/storage.tigris.js")
    await tigrisPut(key, JSON.stringify(doc, null, 2), "application/json")
    const db = await this.getDbSafe()
    if (db) await db.collection("page_hashes").updateOne({ slug: doc.slug }, { $set: { slug: doc.slug, sha256: doc.sha256, sourceUrl: doc.sourceUrl, updatedAt: new Date().toISOString() } }, { upsert: true })
    this.logger.info("parse.stored", { slug: doc.slug, sha256: doc.sha256 })
  }

  private parseHtml(html: string, storageKey: string) {
    // minimal parse5-like extraction without heavy dep for skeleton — real impl uses parse5
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "Untitled"
    const sha256 = crypto.createHash("sha256").update(html).digest("hex")
    const slug = storageKey.replace(/^raw\//, "").slice(0, 32).toLowerCase()
    const sections = this.extractSections(html)
    return {
      sourceUrl: `https://www.gnu.org/${slug}`,
      slug,
      title,
      sha256,
      parsedAt: new Date().toISOString(),
      contentType: "text/html",
      sections,
    }
  }

  private extractSections(html: string) {
    const re = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi
    const headings: { level: number; heading: string; index: number }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) headings.push({ level: Number(m[1]), heading: m[2].replace(/<[^>]+>/g, "").trim(), index: m.index })
    if (headings.length === 0) return [{ id: "intro", level: 1, heading: "Document", content: html.slice(0, 2000).replace(/<[^>]+>/g, ""), html: html.slice(0, 5000), codeBlocks: [], tables: [], anchors: [] }]
    return headings.slice(0, 50).map((h, i) => ({
      id: h.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || `section-${i}`,
      level: h.level,
      heading: h.heading,
      content: html.slice(h.index, headings[i + 1]?.index ?? h.index + 2000).replace(/<[^>]+>/g, "").slice(0, 2000),
      html: html.slice(h.index, headings[i + 1]?.index ?? h.index + 3000).slice(0, 5000),
      codeBlocks: [...html.matchAll(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi)].map((x) => ({ language: null, code: x[1].slice(0, 2000) })),
      tables: [],
      anchors: [],
    }))
  }

  private async getDbSafe() {
    try {
      return await getDb()
    } catch {
      return null
    }
  }
}
