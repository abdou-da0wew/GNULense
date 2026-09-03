import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { getConfig } from "../config/index.js"

function getClient(): S3Client {
  const c = getConfig().tigris
  if (!c.enabled || !c.endpoint || !c.bucket || !c.accessKey || !c.secretKey) {
    throw new Error("Tigris not configured")
  }
  return new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey },
    forcePathStyle: false,
  })
}

function bucketRaw(): string {
  const b = getConfig().tigris.bucketRaw ?? getConfig().tigris.bucket
  if (!b) throw new Error("TIGRIS_BUCKET_RAW not set")
  return b
}
function bucketProcessed(): string {
  const b = getConfig().tigris.bucketProcessed
  if (!b) return bucketRaw()
  return b
}
function bucketForKey(key: string): string {
  if (key.startsWith("processed/") || key.startsWith("search/") || key.startsWith("manifest/")) return bucketProcessed()
  return bucketRaw()
}

// DUPER FAST: async put queue — never blocks crawl, retry in background
type PutJob = { bucket: string; key: string; body: Buffer; contentType: string; tries: number }
const putQueue: PutJob[] = []
let putWorkerRunning = false
let putStats = { queued: 0, done: 0, failed: 0 }

async function putWorker() {
  if (putWorkerRunning) return
  putWorkerRunning = true
  const client = getClient()
  while (putQueue.length > 0) {
    const job = putQueue.shift()!
    try {
      await client.send(new PutObjectCommand({ Bucket: job.bucket, Key: job.key, Body: job.body, ContentType: job.contentType }))
      putStats.done++
    } catch (e) {
      job.tries++
      if (job.tries < 3) {
        putQueue.push(job)
        await new Promise(r => setTimeout(r, 1000 * job.tries))
      } else {
        putStats.failed++
        console.error(JSON.stringify({ level: "error", msg: "tigris.put_failed", key: job.key, error: String(e).slice(0,200) }))
      }
    }
  }
  putWorkerRunning = false
}

export async function tigrisPut(key: string, body: Uint8Array | string, contentType = "application/octet-stream"): Promise<void> {
  const client = getClient()
  const bucket = bucketForKey(key)
  const buf = typeof body === "string" ? Buffer.from(body, "utf-8") : Buffer.from(body)
  // fast path: try immediate put with 5s timeout, else queue
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: contentType }), { abortSignal: controller.signal } as any)
    clearTimeout(timer)
    putStats.done++
    return
  } catch {
    clearTimeout(timer)
    // fallback to async queue — crawl continues immediately
    putQueue.push({ bucket, key, body: buf, contentType, tries: 0 })
    putStats.queued++
    void putWorker()
    return
  }
}

export function tigrisPutStats() { return { ...putStats, pending: putQueue.length } }

export async function tigrisFlush(): Promise<void> {
  while (putQueue.length > 0 || putWorkerRunning) {
    await new Promise(r => setTimeout(r, 500))
  }
}

export async function tigrisGet(key: string): Promise<Uint8Array> {
  const client = getClient()
  const res = await client.send(new GetObjectCommand({ Bucket: bucketForKey(key), Key: key }))
  const bytes = await res.Body?.transformToByteArray()
  if (!bytes) throw new Error(`Tigris get empty for ${key}`)
  return bytes
}
export async function tigrisExists(key: string): Promise<boolean> {
  const client = getClient()
  try { await client.send(new HeadObjectCommand({ Bucket: bucketForKey(key), Key: key })); return true } catch { return false }
}
export async function tigrisUsageBytes(): Promise<number> {
  const client = getClient()
  let total = 0
  for (const b of [bucketRaw(), bucketProcessed()]) {
    let token: string | undefined
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket: b, ContinuationToken: token }))
      for (const obj of res.Contents ?? []) total += obj.Size ?? 0
      token = res.NextContinuationToken
    } while (token)
  }
  return total
}
export function tigrisKeyForHash(sha256: string): string { return `raw/${sha256.slice(0, 2)}/${sha256}` }
export function tigrisMetaKeyForHash(sha256: string): string { return `raw/${sha256.slice(0, 2)}/${sha256}.meta.json` }
