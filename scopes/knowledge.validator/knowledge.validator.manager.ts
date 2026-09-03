import { createLogger } from "@core/platform/logger.js"
import { getDb } from "@core/platform/db.mongo.js"
import { tigrisUsageBytes } from "@core/platform/storage.tigris.js"

export class ValidationManager {
  private logger: ReturnType<typeof createLogger>
  constructor(private traceId: string) {
    this.logger = createLogger({ traceId, operation: "knowledge.validator" })
  }

  async validateAll(): Promise<{ ok: boolean; usageBytes: number; counts: Record<string, number> }> {
    const usage = await this.usageSafe()
    this.logger.info("validate.usage", { usageBytes: usage, usageGb: (usage / 1e9).toFixed(2) })
    if (usage > 8 * 1e9) this.logger.warn("validate.tigris_warn_8gb", { usage })
    if (usage > 9.5 * 1e9) this.logger.error("validate.tigris_over", { usage })

    const db = await this.getDbSafe()
    const counts: Record<string, number> = { usageBytes: usage }
    if (db) {
      counts.manifest = await db.collection("crawl_manifest").countDocuments()
      counts.hashes = await db.collection("page_hashes").countDocuments()
      counts.errors = await db.collection("parse_errors").countDocuments()
    }

    const ok = usage < 9.5 * 1e9
    this.logger.info("validate.done", { ok, counts })
    return { ok, usageBytes: usage, counts }
  }

  private async usageSafe(): Promise<number> {
    try {
      return await tigrisUsageBytes()
    } catch {
      return 0
    }
  }

  private async getDbSafe() {
    try {
      return await getDb()
    } catch {
      return null
    }
  }
}
