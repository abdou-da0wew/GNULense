import { createLogger, newTraceId } from "@core/platform/logger.js"
import { ParseManager } from "@scopes/knowledge.parser/knowledge.parser.manager.js"
import { getDb } from "@core/platform/db.mongo.js"

// Merger: crawl -> parse. No business logic, only coordination. <150 lines.
export async function crawlToParse(changedUrls?: string[]): Promise<void> {
  const traceId = newTraceId()
  const logger = createLogger({ traceId, operation: "merger.crawl-to-parse" })
  logger.info("merge.start", { changed: changedUrls?.length ?? "all" })

  const db = await getDb().catch(() => null)
  let keys: string[] = []
  if (changedUrls && changedUrls.length > 0 && db) {
    const docs = await db.collection("crawl_manifest").find({ url: { $in: changedUrls } }).toArray()
    keys = docs.map((d: any) => d.storageKey).filter(Boolean)
  }

  const mgr = new ParseManager(traceId)
  if (keys.length > 0) {
    for (const k of keys) await mgr.parseOne(k)
  } else {
    await mgr.parseAll()
  }

  logger.info("merge.done", { parsed: keys.length || "all" })
}
