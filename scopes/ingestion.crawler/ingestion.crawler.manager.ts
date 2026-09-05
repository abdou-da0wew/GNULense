import crypto from "node:crypto"
import { getConfig, assertShardConfig } from "@core/config/index.js"
import { createLogger } from "@core/platform/logger.js"
import { getDb } from "@core/platform/db.mongo.js"
import { tigrisPut, tigrisKeyForHash, tigrisMetaKeyForHash, tigrisUsageBytes } from "@core/platform/storage.tigris.js"
import { githubPutMedia, githubMediaPathForHash } from "@core/platform/storage.github.js"
import { discordLogShard, discordLogMain, auditLog } from "@core/platform/discord.js"
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
    const seeds = process.env.SEED_URL ? [process.env.SEED_URL] : ["https://www.gnu.org/", "https://www.gnu.org/software/software.html", "https://www.gnu.org/philosophy/philosophy.html"]
    const seedSet = new Set(seeds.map(s => this.normalize(s)))
    const db = await this.getDbSafe()
    let done: Set<string>
    if (db) {
      try { done = new Set((await db.collection("crawl_manifest").distinct("url")) as string[]) } catch { done = new Set<string>() }
      if (done.size === 0) {
        // fallback to Tigris manifest if Mongo empty/down — prevents recrawl from scratch
        try {
          const { tigrisGet } = await import("@core/platform/storage.tigris.js")
          const manifestBytes = await tigrisGet("manifest/manifest.json")
          const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
          done = new Set((manifest as any[]).map((e: any) => e.url))
          this.logger.info("crawl.resume_from_tigris", { done: done.size })
        } catch {}
      }
    } else {
      done = new Set<string>()
      try {
        const { tigrisGet } = await import("@core/platform/storage.tigris.js")
        const manifestBytes = await tigrisGet("manifest/manifest.json")
        const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
        done = new Set((manifest as any[]).map((e: any) => e.url))
        this.logger.info("crawl.resume_from_tigris", { done: done.size })
      } catch {}
    }
    const checkpoints = db ? await db.collection("shard_checkpoints").find().sort({ stoppedAt: -1 }).toArray() : []
    this.logger.info("crawl.start", { shardId: this.shardId, shardTotal: this.shardTotal, seeds, done: done.size, checkpoints: checkpoints.length })

    for (const s of seeds) if (!done.has(s)) this.queue.push(s) // seeds always enqueued, sharding via shouldHandle on discovered links only

    let count = 0
    let lastUrl = ""
    const onStop = async (reason: string) => {
      // save manifest to Tigris for resume without Mongo - full done set every 20
      try {
        const { tigrisPut, tigrisGet } = await import("@core/platform/storage.tigris.js")
        const allDone = [...done, ...this.seen]
        await tigrisPut(`manifest/manifest-shard-${this.shardId}.json`, JSON.stringify(allDone.slice(-500)), "application/json")
        try {
          const existing = JSON.parse(new TextDecoder().decode(await tigrisGet("manifest/manifest.json")))
          const merged = [...new Set([...existing, ...allDone])]
          await tigrisPut("manifest/manifest.json", JSON.stringify(merged), "application/json")
        } catch {
          await tigrisPut("manifest/manifest.json", JSON.stringify(allDone), "application/json")
        }
      } catch {}
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

    const concurrency = (CRAWLER_CONFIG as any).concurrency ?? 8
    this.logger.info("crawl.fast_start", { concurrency, rateMs: CRAWLER_CONFIG.rateLimitMs, shardId: this.shardId })

    let active = 0
    const worker = async (wid: number) => {
      while (true) {
        const url = this.queue.shift()
        if (!url) {
          if (active === 0 && this.queue.length === 0) break
          await new Promise(r => setTimeout(r, 50))
          continue
        }
        const isSeed = seedSet.has(this.normalize(url))
        if (!isSeed && !this.shouldHandle(url)) {
          this.seen.add(url)
          continue
        }
        if (this.seen.has(url) || done.has(url)) continue
        this.seen.add(url)
        lastUrl = url
        if (process.env.CRAWL_LIMIT && count >= Number(process.env.CRAWL_LIMIT)) break
        active++
        const start = Date.now()
        try {
          await this.fetchAndStore(url)
          count++
          if (count % 10 === 0) discordLogShard({ shardId: this.shardId, level: "info", title: "Crawled", description: `Stored \`${lastUrl.slice(0,60)}\``, fields: [{ name: "sha", value: lastUrl.slice(0,8), inline: true }, { name: "queue", value: String(this.queue.length), inline: true }, { name: "done", value: String(count), inline: true }], traceId: this.traceId })
          if (count % CRAWLER_CONFIG.checkpointEvery === 0) await onStop("checkpoint")
          this.logger.info("crawl.worker_tick", { wid, url: url.slice(0,60), ms: Date.now()-start, queued: this.queue.length, done: count })
        } catch (e) {
          this.logger.warn("crawl.worker_error", { wid, url: url.slice(0,60), error: String(e).slice(0,200) })
        } finally {
          active--
        }
        await this.sleepWithJitter()
        if (process.env.CRAWL_LIMIT && count >= Number(process.env.CRAWL_LIMIT)) break
      }
    }

    try {
      await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)))
      await onStop("complete")
      this.logger.info("crawl.complete", { doneCount: count, concurrency })
      discordLogMain({ level: "success", title: "Crawl done", description: `Shard ${this.shardId} finished`, fields: [{ name: "done", value: String(count), inline: true }, { name: "concurrency", value: String(concurrency), inline: true }], traceId: this.traceId, mention: true }); auditLog("crawl.done", { shardId: this.shardId, done: count }, this.traceId)
    } catch (e) {
      this.logger.error("crawl.error", { error: String(e) })
      discordLogMain({ level: "error", title: "Crawl error", description: String(e).slice(0,300), fields: [{ name: "shard", value: String(this.shardId), inline: true }], traceId: this.traceId, mention: true }); auditLog("crawl.error", { shardId: this.shardId, error: String(e).slice(0,100) }, this.traceId)
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
      const path = `media/${sha256.slice(0,2)}/${sha256}${ext}` // for Tigris, keep github path as fallback
      const mediaKey = `media/${sha256.slice(0,2)}/${sha256}${ext}`
      await tigrisPut(mediaKey, bytes, contentType)
      const cdnUrl = `/api/media?key=${mediaKey}`
      // also keep github as backup if needed: await githubPutMedia(path, bytes, `media: ${url} ${sha256.slice(0, 8)}`).catch(()=>{})
      
      await this.saveManifest(url, sha256, contentType, status, undefined, cdnUrl, false)
      this.logger.info("crawl.media_github", { url, sha256, cdnUrl, durationMs: Date.now() - start })
      return
    }

    const usage = await this.tigrisUsageSafe()
    if (status === 429) { discordLogMain({ level: "warn", title: "Rate limited", description: `429 on \`${url.slice(0,60)}\` shard ${this.shardId}`, fields: [{ name: "url", value: url.slice(0,80), inline: false }], traceId: this.traceId, mention: true }); auditLog("crawl.rate_limited", { url, shardId: this.shardId }, this.traceId) }
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
      const htmlStr = bytes.toString("utf-8")
      const links = this.connector.extractLinks(htmlStr, url)
      for (const l of links) {
        const n = this.normalize(l)
        if (!this.seen.has(n) && this.shouldHandle(n)) this.queue.push(n)
      }
      // also queue media for Tigris media/ store (no hash sharding, all shards fetch media they see)
      const media = this.connector.extractMedia(htmlStr, url)
      for (const m of media) {
        const n = this.normalize(m)
        if (!this.seen.has(n)) this.queue.push(n)
      }
    }

    this.logger.info("crawl.stored_tigris", { url, sha256, key, links: this.queue.length, durationMs: Date.now() - start })
    // removed discord log from fetchAndStore (count not in scope)
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
