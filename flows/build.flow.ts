import { createLogger, newTraceId } from "@core/platform/logger.js"
import { handleBuildIndex } from "@scopes/search.indexer/index.js"

export async function buildFlow(): Promise<void> {
  const traceId = newTraceId()
  const logger = createLogger({ traceId, operation: "flow.build" })
  logger.info("flow.start", {})
  await handleBuildIndex(traceId)
  logger.info("flow.done", {})
}
