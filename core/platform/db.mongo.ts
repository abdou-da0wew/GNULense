import { MongoClient, type Db } from "mongodb"
import { getConfig } from "../config/index.js"

let client: MongoClient | null = null
let db: Db | null = null

export async function getDb(): Promise<Db> {
  const cfg = getConfig().mongo
  if (!cfg.enabled || !cfg.uri) throw new Error("MONGODB_URI not set")
  if (db) return db
  client = new MongoClient(cfg.uri, { maxPoolSize: 5, retryWrites: true })
  await client.connect()
  db = client.db(cfg.db)
  await ensureIndexes(db)
  return db
}

async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("crawl_manifest").createIndex({ url: 1 }, { unique: true }).catch(() => {})
  await db.collection("page_hashes").createIndex({ slug: 1 }, { unique: true }).catch(() => {})
  await db.collection("shard_checkpoints").createIndex({ shardId: 1, stoppedAt: -1 }).catch(() => {})
  await db.collection("robots_cache").createIndex({ host: 1 }, { unique: true }).catch(() => {})
}

export async function closeDb(): Promise<void> {
  if (client) await client.close()
  client = null
  db = null
}

export type CrawlManifestDoc = {
  url: string
  sha256: string
  contentType: string
  statusCode: number
  fetchedAt: string
  storageKey?: string
  cdnUrl?: string
  shardId: number
  externalAsset?: boolean
}

export type ShardCheckpointDoc = {
  shardId: number
  lastUrl: string
  nextHead: string | null
  doneCount: number
  stoppedAt: string
  reason: "checkpoint" | "interrupt" | "complete" | "error"
  queueRemaining: number
}
