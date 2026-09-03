import { getConfig, isLocalMode, hasRailway } from "@core/config/index.js"
import { createLogger, newTraceId } from "@core/platform/logger.js"

export function bootstrap(): void {
  const cfg = getConfig()
  const traceId = newTraceId()
  const logger = createLogger({ traceId, operation: "strapper.bootstrap" })
  logger.info("bootstrap", {
    env: cfg.env,
    tigris: cfg.tigris.enabled,
    mongo: cfg.mongo.enabled,
    github: cfg.github.enabled,
    railway: hasRailway(),
    localMode: isLocalMode(),
    shard: `${cfg.crawler.shardId}/${cfg.crawler.shardTotal}`,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) bootstrap()
