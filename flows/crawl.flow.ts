import { createLogger, newTraceId } from "@core/platform/logger.js"
import { handleCrawlShard } from "@scopes/ingestion.crawler/index.js"
import { getConfig } from "@core/config/index.js"

// Flow <80 lines
export async function crawlFlow(): Promise<void> {
  const cfg = getConfig().crawler
  const traceId = newTraceId()
  const logger = createLogger({ traceId, shardId: cfg.shardId, operation: "flow.crawl" })
  logger.info("flow.start", { shardId: cfg.shardId, total: cfg.shardTotal })
  await handleCrawlShard({ shardId: cfg.shardId, shardTotal: cfg.shardTotal, traceId })
  logger.info("flow.done", {})
}
