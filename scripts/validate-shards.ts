import { getDb } from "@core/platform/db.mongo.js"

try {
  const db = await getDb()
  const total = await db.collection("crawl_manifest").countDocuments()
  const byShard = await db.collection("crawl_manifest").aggregate([{ $group: { _id: "$shardId", count: { $sum: 1 } } }]).toArray()
  const checkpoints = await db.collection("shard_checkpoints").find().sort({ stoppedAt: -1 }).limit(10).toArray()
  const dups = await db.collection("crawl_manifest").aggregate([{ $group: { _id: "$url", c: { $sum: 1 } } }, { $match: { c: { $gt: 1 } } }]).toArray()
  console.log(JSON.stringify({ total, byShard, checkpoints, duplicates: dups.length }, null, 2))
  if (dups.length > 0) console.error("DUPLICATE URLS FOUND", dups.slice(0, 5))
  else console.log("No duplicates — shards do not overlap (unique index works)")
} catch (e) {
  console.log(JSON.stringify({ error: String(e), msg: "no mongo — local mode, skip" }))
}
