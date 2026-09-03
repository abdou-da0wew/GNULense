# GNULense — Colab Fleet (5 Shards)

> 5 notebooks, same template, sharded by hash, each logs stop so no overlap. Fast internet, 100GB disk, long runs.

## Fleet Overview

- **5 notebooks:** `colab/GNULense_Shard_1.ipynb` ... `Shard_5.ipynb` + `shard_template.ipynb` (master)
- **Sharding:** `shard = hash(normalizedUrl) % TOTAL` where `TOTAL=5`, `SHARD_ID=0..4`. No central queue. Each shard crawls only its slice of gnu.org.
- **Coordination:** Mongo `shard_checkpoints` + Tigris `manifest-shard-{id}.json`. Unique index `crawl_manifest.url` prevents double fetch even if hash collision.
- **Stop-log:** Each notebook writes checkpoint on **every 50 pages AND on stop** (interrupt, complete, error, timeout) via `try/finally` + `atexit` + `signal`. Next run (any shard) reads all checkpoints and skips done urls.

## How Not to Overlap

1. Before crawl, each shard does:
```python
# pseudo
done = set(mongo.crawl_manifest.distinct("url"))
checkpoints = mongo.shard_checkpoints.find().sort(stoppedAt=-1)
last_heads = {c.shardId: c.nextHead for c in checkpoints}
# enqueue seeds = gnu.org + sitemap urls, filter hash%TOTAL==SHARD_ID and not in done
```
2. During crawl, every 50 pages:
```python
mongo.shard_checkpoints.updateOne(
  {"shardId": SHARD_ID},
  {"$set": {"lastUrl": url, "nextHead": queue[0], "doneCount": len(done), "stoppedAt": now(), "reason": "checkpoint"}},
  upsert=True
)
tigris.put(f"manifest/manifest-shard-{SHARD_ID}.json", json.dumps(manifest))
```
3. On stop (finally):
```python
mongo.shard_checkpoints.insertOne({
  shardId: SHARD_ID,
  lastUrl, nextHead, doneCount, stoppedAt: now(), reason: "interrupt|complete|error", queueRemaining: len(queue)
})
```
4. Any other shard that starts later reads `shard_checkpoints` and `crawl_manifest` — done urls are never re-enqueued.

## Notebook Layout (all 5 identical except SHARD_ID cell)

**Cell 0 — Params (edit SHARD_ID only)**
```python
SHARD_ID = 0  # 0..4 — change per notebook
SHARD_TOTAL = 5
TIGRIS_BUCKET = "gnulense-store"
MONGODB_URI = "mongodb+srv://..."  # from .env or Colab Secrets
GITHUB_TOKEN = "..."  # Colab Secrets
```

**Cell 1 — Install (100GB disk, fast net)**
```bash
!curl -fsSL https://bun.sh/install | bash
!export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun --version
!pip install pymongo boto3 requests -q
```

**Cell 2 — Clone GNULense + env**
```bash
!git clone https://github.com/abdou-da0wew/GNULense.git
%cd GNULense
!cp .env.example .env
# set CRAWL_SHARD_ID/TOTAL in .env via sed or Colab Secrets
```

**Cell 3 — Run shard (long, can run hours)**
```bash
!export CRAWL_SHARD_ID=$SHARD_ID && export CRAWL_SHARD_TOTAL=$SHARD_TOTAL && bun run crawl:shard 2>&1 | tee /tmp/crawl.log
```
- Logs structured JSON per fetch: `{traceId, shardId, url, status, contentType, sha256, durationMs, storageKey/cdnUrl}`
- Media <=5MB -> GitHub CDN, HTML -> Tigris, >5MB -> metadata only
- Respects robots.txt (cached 24h), 2s ±500ms, 429 backoff

**Cell 4 — Stop-log + resume hint (runs even on interrupt)**
```python
import atexit, signal
def log_stop(reason):
  # write to mongo + tigris as above
  print(f"Shard {SHARD_ID} stopped: {reason}, lastUrl={lastUrl}, done={doneCount}")

atexit.register(lambda: log_stop("atexit"))
signal.signal(signal.SIGTERM, lambda *_: log_stop("SIGTERM"))
# also in notebook's finally block
```

**Cell 5 — Verify (no overlap check)**
```bash
!bun run validate:shards -- --shard=$SHARD_ID
# checks: manifest url unique, tigris usage <8GB, checkpoints present
```

## How to Run the Fleet

1. Open 5 Colab tabs, each open `GNULense_Shard_N.ipynb` (N=1..5, maps to SHARD_ID 0..4).
2. In each, set `MONGODB_URI`, `TIGRIS_*`, `GITHUB_TOKEN` via Colab Secrets (left panel → Secrets).
3. Run all cells. They run in parallel, different IPs, fast net, 100GB disk each (so Tigris sync is buffered locally first).
4. If any disconnects, its `shard_checkpoints` row has `stoppedAt` and `nextHead`. Re-run that notebook — it resumes, or another shard will skip its done urls on next start.
5. Monitor: `mongo.shard_checkpoints.find().sort({stoppedAt:-1})` shows 5 rows, each with progress.

## Fleet Ops (0$)

- No GitHub repo per shard needed — single repo `GNULense` with 5 notebooks. But you *can* fork to 5 repos if you want separate GitHub CDN quota — not needed.
- All 5 share `GNULense-media` repo for media CDN, dedup by sha256 so parallel pushes don't duplicate.
- Long runs: Colab can stay alive ~12h+ with `colab-keepalive` via JS heartbeat. Checkpoint every 50 pages means even 12h kill loses at most 50 pages.

## Resume Test

```sh
# local check that shards don't overlap
bun run validate:shards
# expected: 5 manifests, 0 duplicate urls, tigris usage X GB
rg -c "shardId" colab/*.ipynb  # should be 5 distinct
```
