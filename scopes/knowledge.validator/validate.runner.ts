import { newTraceId } from "@core/platform/logger.js"
import { handleValidateAll } from "./index.js"
await handleValidateAll(newTraceId())
