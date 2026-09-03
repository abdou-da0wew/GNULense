import { createLogger, newTraceId } from "@core/platform/logger.js"
import { getConfig } from "@core/config/index.js"

// Merger: knowledge -> site. Triggers Vercel revalidate or deploy hook. <150 lines.
export async function knowledgeToSite(changedSlugs: string[]): Promise<void> {
  const traceId = newTraceId()
  const logger = createLogger({ traceId, operation: "merger.knowledge-to-site" })
  logger.info("merge.start", { slugs: changedSlugs.length })

  const cfg = getConfig()
  if (changedSlugs.length > 500 && cfg.vercel.deployHook) {
    logger.info("merge.full_deploy", { count: changedSlugs.length })
    await fetch(cfg.vercel.deployHook, { method: "POST" })
    return
  }

  const secret = cfg.vercel.revalidateSecret
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"
  for (const slug of changedSlugs.slice(0, 500)) {
    try {
      await fetch(`${base}/api/revalidate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": secret ?? "" },
        body: JSON.stringify({ slug }),
      })
    } catch (e) {
      logger.warn("merge.revalidate_failed", { slug, error: String(e) })
    }
  }

  logger.info("merge.done", {})
}
