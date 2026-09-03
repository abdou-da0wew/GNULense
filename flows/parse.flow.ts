import { createLogger, newTraceId } from "@core/platform/logger.js"
import { handleParseAll } from "@scopes/knowledge.parser/index.js"

export async function parseFlow(): Promise<void> {
  const traceId = newTraceId()
  const logger = createLogger({ traceId, operation: "flow.parse" })
  logger.info("flow.start", {})
  await handleParseAll(traceId)
  logger.info("flow.done", {})
}
