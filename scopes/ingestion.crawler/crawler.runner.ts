import { getConfig } from "@core/config/index.js"
import { newTraceId } from "@core/platform/logger.js"
import { handleCrawlShard } from "./index.js"

const cfg = getConfig().crawler
const traceId = newTraceId()
console.log(JSON.stringify({ traceId, shardId: cfg.shardId, shardTotal: cfg.shardTotal, msg: "crawler.runner start" }))
await handleCrawlShard({ shardId: cfg.shardId, shardTotal: cfg.shardTotal, traceId })
