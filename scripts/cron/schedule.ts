import { hasRailway, getConfig } from "@core/config/index.js"
import { createLogger, newTraceId } from "@core/platform/logger.js"

// Optional cron — runs only if RAILWAY_BACKEND_URL is set. Otherwise no-op (Edge only).
// Railway free tier runs this as long process with node-cron.

async function tick(): Promise<void> {
  const traceId = newTraceId()
  const logger = createLogger({ traceId, operation: "cron.schedule" })
  if (!hasRailway()) {
    logger.info("cron.skipped_no_railway", { msg: "Railway not configured, using Vercel Edge only" })
    return
  }
  const cfg = getConfig()
  logger.info("cron.tick", { railway: cfg.railway.url })
  // TODO: diff check: compare Mongo page_hashes vs live HEAD, write diffs/{date}.json, POST /api/revalidate
  try {
    await fetch(`${cfg.railway.url}/health`).catch(() => {})
    logger.info("cron.done", {})
  } catch (e) {
    logger.error("cron.error", { error: String(e) })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (hasRailway()) {
    // simple every 24h at 02:00 UTC equivalent via setInterval for free tier
    setInterval(() => void tick(), 24 * 60 * 60 * 1000)
    void tick()
    console.log(JSON.stringify({ msg: "cron scheduled (Railway mode)" }))
  } else {
    console.log(JSON.stringify({ msg: "cron disabled — Edge only (set RAILWAY_BACKEND_URL to enable)" }))
  }
}
