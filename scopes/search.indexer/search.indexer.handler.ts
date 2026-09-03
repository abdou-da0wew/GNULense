import { IndexManager } from "./search.indexer.manager.js"

export async function handleBuildIndex(traceId: string): Promise<void> {
  const m = new IndexManager(traceId)
  await m.build()
}
