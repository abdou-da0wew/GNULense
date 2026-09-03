import crypto from "node:crypto"
import { getConfig, assertShardConfig } from "@core/config/index.js"
import { createLogger } from "@core/platform/logger.js"
import { getDb } from "@core/platform/db.mongo.js"
import { tigrisPut, tigrisKeyForHash, tigrisMetaKeyForHash, tigrisUsageBytes } from "@core/platform/storage.tigris.js"
import { githubPutMedia, githubMediaPathForHash } from "@core/platform/storage.github.js"
import { CRAWLER_CONFIG, MEDIA_CONTENT_TYPES, MEDIA_EXTENSIONS } from "./ingestion.crawler.constants.js"
import { CrawlConnector } from "./ingestion.crawler.connector.js"

export class CrawlManager {
  private traceId: string
  private shardId: number
  private shardTotal: number
  private connector: CrawlConnector
  private logger: ReturnType<typeof createLogger>
  private seen = new Set<string>()
  private queue: string[] = []

  constructor(opts: { shardId: number; shardTotal: number; traceId: string }) {
    this.shardId = opts.shardId
    this.shardTotal = opts.shardTotal
    this.traceId = opts.traceId
    assertShardConfig()
    this.logger = createLogger({ traceId: this.traceId, shardId: this.shardId, operation: "ingestion.crawler" })
    this.connector = new CrawlConnector(this.logger)
  }

  private shouldHandle(url: string): boolean {
    try {
      const u = new URL(url)
      if (!CRAWLER_CONFIG.allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return false
      const h = crypto.createHash("sha256").update(this.normalize(url)).digest("hex")
      const shard = parseInt(h.slice(0, 8), 16) % this.shardTotal
      return shard === this.shardId
    } catch {
      return false
    }
  }

  private normalize(url: string): string {
    const u = new URL(url)
    u.hash = ""
    return u.toString().replace(/\/$/, "")
  }

  async run(): Promise<void> {
    const seeds = ["https://www.gnu.org/"]
    const db = await this.getDbSafe()
    const done = db ? new Set((await db.collection("crawl_manifest").distinct("url")) as string[]) : new Set<string>()
    const checkpoints = db ? await db.collection("shard_checkpoints").find().sort({ stoppedAt: -1 }).toArray() : []
    this.logger.info("crawl.start", { shardId: this.shardId, shardTotal: this.shardTotal, done: done.size, checkpoints: checkpoints.length })

    for (const s of seeds) if (!done.has(s) && this.shouldHandle(s)) this.queue.push(s)

    let count = 0
    let lastUrl = ""
    const onStop = async (reason: string) => {
      if (db) {
        await db.collection("shard_checkpoints").insertOne({
          shardId: this.shardId,
          lastUrl,
          nextHead: this.queue[0] ?? null,
          doneCount: count,
          stoppedAt: new Date().toISOString(),
          reason,
          queueRemaining: this.queue.length,
        })
      }
    }

    process.on("SIGTERM", () => { void onStop("SIGTERM") })
    process.on("SIGINT", () => { void onStop("SIGINT") })

    try {
      while (this.queue.length > 0) {
        const url = this.queue.shift()!
        if (this.seen.has(url) || done.has(url)) continue
        this.seen.add(url)
        lastUrl = url
        await this.fetchAndStore(url)
        count++
        if (count % CRAWLER_CONFIG.checkpointEvery === 0) await onStop("checkpoint")
        await this.sleepWithJitter()
      }
      await onStop("complete")
      this.logger.info("crawl.complete", { doneCount: count })
    } catch (e) {
      this.logger.error("crawl.error", { error: String(e) })
      await onStop("error")
      throw e
    }
  }

  async fetchAndStore(url: string): Promise<void> {
    const start = Date.now()
    const res = await this.connector.fetchWithRetry(url)
    if (!res) return
    const bytes = res.bytes
    const contentType = res.contentType
    const status = res.status
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex")

    if (this.isMedia(url, contentType)) {
      if (bytes.length > CRAWLER_CONFIG.maxAssetBytes) {
        await this.saveManifest(url, sha256, contentType, status, undefined, undefined, true)
        this.logger.info("crawl.skip_large_media", { url, bytes: bytes.length, sha256 })
        return
      }
      const ext = this.extFrom(url, contentType)
      const path = githubMediaPathForHash(sha256, ext)
      const { cdnUrl } = await githubPutMedia(path, bytes, `media: ${url} ${sha256.slice(0, 8)}`)
      await this.saveManifest(url, sha256, contentType, status, undefined, cdnUrl, false)
      this.logger.info("crawl.media_github", { url, sha256, cdnUrl, durationMs: Date.now() - start })
      return
    }

    const usage = await this.tigrisUsageSafe()
    if (usage > 8 * 1024 * 1024 * 1024) {
      this.logger.warn("crawl.tigris_near_limit", { usage })
    }
    if (usage > 9.5 * 1024 * 1024 * 1024) {
      this.logger.error("crawl.tigris_full", { usage })
      throw new Error("Tigris 10GB limit reached")
    }

    const key = tigrisKeyForHash(sha256)
    const metaKey = tigrisMetaKeyForHash(sha256)
    await tigrisPut(key, bytes, contentType)
    await tigrisPut(metaKey, JSON.stringify({ url, sha256, contentType, fetchedAt: new Date().toISOString(), shardId: this.shardId, statusCode: status }, null, 2), "application/json")
    await this.saveManifest(url, sha256, contentType, status, key, undefined, false)

    if (contentType.includes("text/html")) {
      const links = this.connector.extractLinks(bytes.toString("utf-8"), url)
      for (const l of links) {
        const n = this.normalize(l)
        if (!this.seen.has(n) && this.shouldHandle(n)) this.queue.push(n)
      }
    }

    this.logger.info("crawl.stored_tigris", { url, sha256, key, links: this.queue.length, durationMs: Date.now() - start })
  }

  private isMedia(url: string, ct: string): boolean {
    if ([...MEDIA_CONTENT_TYPES].some((p) => ct.startsWith(p))) return true
    const ext = this.extFrom(url, ct).toLowerCase()
    return MEDIA_EXTENSIONS.has(ext)
  }

  private extFrom(url: string, ct: string): string {
    try {
      const u = new URL(url)
      const m = u.pathname.match(/\.[a-z0-9]+$/i)
      if (m) return m[0]
    } catch {}
    if (ct.includes("png")) return ".png"
    if (ct.includes("jpeg")) return ".jpg"
    if (ct.includes("pdf")) return ".pdf"
    return ".bin"
  }

  private async saveManifest(url: string, sha256: string, contentType: string, statusCode: number, storageKey?: string, cdnUrl?: string, externalAsset?: boolean): Promise<void> {
    const db = await this.getDbSafe()
    if (!db) return
    await db.collection("crawl_manifest").updateOne(
      { url },
      { $set: { url, sha256, contentType, statusCode, fetchedAt: new Date().toISOString(), storageKey, cdnUrl, shardId: this.shardId, externalAsset } },
      { upsert: true },
    )
    await db.collection("page_hashes").updateOne(
      { url },
      { $set: { slug: this.slugFromUrl(url), sha256, sourceUrl: url, updatedAt: new Date().toISOString() } },
      { upsert: true },
    )
  }

  private slugFromUrl(url: string): string {
    const u = new URL(url)
    return u.pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9/_-]/gi, "-").toLowerCase() || "index"
  }

  private async getDbSafe() {
    try {
      return await getDb()
    } catch {
      return null
    }
  }

  private async tigrisUsageSafe(): Promise<number> {
    try {
      return await tigrisUsageBytes()
    } catch {
      return 0
    }
  }

  private async sleepWithJitter(): Promise<void> {
    const ms = CRAWLER_CONFIG.rateLimitMs + (Math.random() * 2 - 1) * CRAWLER_CONFIG.jitterMs
    await new Promise((r) => setTimeout(r, ms))
  }
}
