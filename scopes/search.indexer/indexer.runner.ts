import { newTraceId } from "@core/platform/logger.js"
import { handleBuildIndex } from "./index.js"
await handleBuildIndex(newTraceId())
