import { createLogger } from "@core/platform/logger.js"
import { getDb } from "@core/platform/db.mongo.js"
import { tigrisPut } from "@core/platform/storage.tigris.js"

export class IndexManager {
  private logger: ReturnType<typeof createLogger>
  constructor(private traceId: string) {
    this.logger = createLogger({ traceId, operation: "search.indexer" })
  }

  async build(): Promise<void> {
    this.logger.info("index.build_start", {})
    const db = await this.getDbSafe()
    const docs = db ? await db.collection("page_hashes").find().limit(10000).toArray() : []
    const index = docs.map((d: any) => ({ slug: d.slug, title: d.slug, hash: d.sha256, url: d.sourceUrl }))
    const chunk = JSON.stringify(index)
    await tigrisPut("search/search-index-0.json", chunk, "application/json")
    await tigrisPut("search/search-index-meta.json", JSON.stringify({ count: index.length, chunks: 1, builtAt: new Date().toISOString(), hash: "na" }, null, 2), "application/json")
    this.logger.info("index.build_done", { count: index.length })
  }

  private async getDbSafe() {
    try {
      return await getDb()
    } catch {
      return null
    }
  }
}
