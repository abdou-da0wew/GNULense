import { CRAWLER_CONFIG } from "./ingestion.crawler.constants.js"
import { getDb } from "@core/platform/db.mongo.js"

export type FetchResult = { bytes: Buffer; contentType: string; status: number }

export class CrawlConnector {
  constructor(private logger: { info: Function; warn: Function; error: Function }) {}

  async fetchWithRetry(url: string): Promise<FetchResult | null> {
    let lastErr: unknown
    for (let i = 0; i <= CRAWLER_CONFIG.maxRetries; i++) {
      try {
        if (i > 0) await this.sleep(CRAWLER_CONFIG.retryDelaysMs[Math.min(i - 1, 2)])
        const res = await this.fetchOnce(url)
        if (res.status === 429 || res.status >= 500) {
          this.logger.warn("fetch.retry_status", { url, status: res.status, attempt: i })
          lastErr = new Error(`status ${res.status}`)
          continue
        }
        if (res.status >= 400) {
          this.logger.warn("fetch.skip_error", { url, status: res.status })
          return null
        }
        return res
      } catch (e) {
        lastErr = e
        this.logger.warn("fetch.retry_error", { url, attempt: i, error: String(e) })
      }
    }
    this.logger.error("fetch.failed", { url, error: String(lastErr) })
    return null
  }

  private async fetchOnce(url: string): Promise<FetchResult> {
    await this.checkRobots(url)
    const res = await fetch(url, {
      headers: { "User-Agent": CRAWLER_CONFIG.userAgent, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get("content-type") ?? "application/octet-stream"
    return { bytes: buf, contentType: ct.split(";")[0].trim(), status: res.status }
  }

  private async checkRobots(url: string): Promise<void> {
    try {
      const u = new URL(url)
      const host = u.hostname
      const db = await getDb()
      const cached = await db.collection("robots_cache").findOne({ host })
      if (cached && new Date(cached.expiresAt) > new Date()) return
      const robotsUrl = `${u.protocol}//${host}/robots.txt`
      const res = await fetch(robotsUrl, { headers: { "User-Agent": CRAWLER_CONFIG.userAgent } })
      const text = res.ok ? await res.text() : ""
      await db.collection("robots_cache").updateOne(
        { host },
        { $set: { host, rules: text, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } },
        { upsert: true },
      )
    } catch {}
  }

  extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = []
    const re = /<a[^>]+href=["']([^"']+)["']/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      try {
        const href = m[1]
        if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue
        const abs = new URL(href, baseUrl).toString()
        const u = new URL(abs)
        if (!u.hostname.endsWith("gnu.org")) continue
        links.push(abs)
      } catch {}
    }
    return [...new Set(links)]
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
