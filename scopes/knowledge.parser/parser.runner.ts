import { newTraceId } from "@core/platform/logger.js"
import { handleParseAll } from "./index.js"
await handleParseAll(newTraceId())
