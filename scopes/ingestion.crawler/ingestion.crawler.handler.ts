import { CrawlManager } from "./ingestion.crawler.manager.js"

export async function handleCrawlShard(opts: { shardId: number; shardTotal: number; traceId: string }): Promise<void> {
  const mgr = new CrawlManager(opts)
  await mgr.run()
}

export async function handleCrawlSingle(url: string, traceId: string): Promise<void> {
  const mgr = new CrawlManager({ shardId: 0, shardTotal: 1, traceId })
  await mgr.fetchAndStore(url)
}
