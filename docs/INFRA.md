# GNULense — 0$ Infrastructure

> No paid services. All free tiers, storage split to respect 10GB Tigris.

## Services (all free)

| Need | Service | Free Tier | Env | Cost |
|------|---------|-----------|-----|------|
| HTML/JSON store | Tigris S3 | 10GB, 1M req | `TIGRIS_*` | $0 |
| Media store | GitHub repo `GNULense-media` | ~100GB per repo (soft), CDN via raw/jsDelivr | `GITHUB_TOKEN` | $0 |
| DB (manifest, checkpoints) | MongoDB Atlas M0 | 512MB, shared | `MONGODB_URI` | $0 |
| Hosting + Edge backend | Vercel Hobby | 100GB bw, Edge Functions | `VERCEL_*` | $0 |
| Optional tiny backend | Railway free trial or Render free | 500h/mo | `RAILWAY_BACKEND_URL` | $0 (optional) |
| Crawler fleet | Google Colab | 100GB disk, fast net, ~12h per session | colab notebooks | $0 |

Total: **0$** — Vercel Edge is the backend. Railway is a door, not a requirement.

## Tigris Wiring (HTML/JSON only)

- Endpoint `https://fly.storage.tigris.dev`, region `auto`, bucket `gnulense-store` (or two buckets `gnulense-raw` + `gnulense-processed` if you prefer split).
- SDK: `@aws-sdk/client-s3` with `endpoint`, `forcePathStyle: false`.
- Keys: `raw/{sha256[0:2]}/{sha256}` + `.meta.json`, `processed/{slug}.json`, `search/*`, `manifest/*`.
- No media to Tigris — media goes to GitHub. This keeps usage ~2-4GB for full gnu.org HTML.
- Guard: `core/platform/storage.tigris.ts` exposes `getUsage()` via `ListObjectsV2` sum, cached in Mongo `build_reports`. Crawler checks before `put` if `usage > 8GB` warn, `>9.5GB` block.

## GitHub CDN Wiring (media only)

- Repo: `abdou-da0wew/GNULense-media` (private or public, public for jsDelivr).
- Connector: `scopes/media.github/github.connector.ts` does `PUT /repos/{owner}/{repo}/contents/media/{sha256[0:2]}/{sha256}.{ext}` with `content: base64(bytes)`, `message: "media: {originalUrl} {sha256}"`, `sha` for updates (fetch existing first).
- Dedup: `sha256` of bytes is key, check via Mongo `crawl_manifest` or GitHub `GET contents` 404 -> not exists.
- CDN urls returned:
  - `https://raw.githubusercontent.com/abdou-da0wew/GNULense-media/main/media/ab/cd...png`
  - `https://cdn.jsdelivr.net/gh/abdou-da0wew/GNULense-media@<commit-sha>/media/ab/cd...png` (faster, cached)
- Parser rewrites `<img src>` to CDN url, stores `cdnUrl` in manifest.

## Mongo Wiring (checkpoints + manifest)

- Atlas M0: collections `crawl_manifest` (unique index `url`), `page_hashes` (unique `slug`), `shard_checkpoints` (index `shardId, stoppedAt`), `robots_cache`, `diffs`, `build_reports`.
- Connection: `core/platform/db.mongo.ts` lazy singleton, `connect()` with `maxPoolSize 5` for Colab, retry 3x.
- Shard coordination: before crawl, each shard does `find().sort({stoppedAt:-1}).limit(1)` per shard to get `lastUrl` and `doneSet`. Enqueues only unseen.
- Stop-log: each notebook's `atexit` writes `{shardId, lastUrl, nextHead, doneCount, stoppedAt: ISO, reason: "interrupt"|"complete"|"error", queueRemaining}` to `shard_checkpoints`. No overlap because `crawl_manifest.url` unique prevents double insert.

## Vercel Wiring (Edge is the backend)

- `apps/web` is Next.js 14 App Router, `runtime = "edge"` for `app/api/*`.
- Routes:
  - `POST /api/revalidate` — checks `headers.get("x-revalidate-secret") === process.env.VERCEL_REVALIDATE_SECRET`, body `{slugs: string[]}`, calls `revalidatePath(`/docs/${slug}`)` per slug. No Blob, no DB write heavy.
  - `GET /api/health` — returns `{status:"ok", tigrisBytes, mongoCount, lastCheckpoint}` fetched via Tigris `HEAD` + Mongo count (edge can call Mongo via Data API or direct if env set).
  - `GET /api/search?q=` — optional fallback; primary search is client-side loading `search-index-*.json` from Tigris/GitHub. Edge search just proxies to Tigris if client offline.
  - `POST /api/cron` — optional, lightweight. If `RAILWAY_BACKEND_URL` set, just `fetch(Railway + "/cron")` and return. If not set, returns `503 cron disabled, run colab`.
- `vercel.json`:
```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": { "apps/web/app/api/**/*.ts": { "runtime": "edge" } }
}
```
- Build: `apps/web/lib/data-loader.ts` fetches from Tigris via presigned `getObject` (or public bucket read). Local dev falls back to `data/`. `generateStaticParams` reads Mongo or `manifest/site-structure.json` from Tigris.

## Railway Door (optional)

- `scripts/cron/schedule.ts` — if `RAILWAY_BACKEND_URL` empty, it no-ops and logs `railway disabled, using edge only`. If set, it runs `node-cron` at 02:00 UTC: incremental diff (compare Tigris `page_hashes` vs live HEAD hash), writes `diffs/{date}.json` to Tigris+Mongo, then `POST /api/revalidate` to Vercel with secret.
- Railway service is tiny: `bun run cron` only, no web server except health check. Zero cost if not used.
- To enable: deploy `strappers/strapper.ts` with `npm start` on Railway, set envs, done. To disable: leave `RAILWAY_BACKEND_URL` empty — Vercel Edge alone handles revalidation via deploy hook or manual Colab trigger.

## Local Dev vs Prod

- Local: `data/raw`, `data/processed` on disk, no Tigris/Mongo needed. `core/config` returns `isLocal: !TIGRIS_BUCKET`.
- Prod: `data/` ignored, all reads via `storage.tigris` / `storage.github` + Mongo. `scripts/sync-from-tigris.ts` can pull Tigris to local for debugging: `bun run sync -- --limit=100`.

## Env Setup

```sh
cp .env.example .env
# fill TIGRIS_*, MONGODB_URI, GITHUB_TOKEN, VERCEL_REVALIDATE_SECRET
bun run typecheck
bun run dev # apps/web at localhost:3000
```
