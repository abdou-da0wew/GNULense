# PROJECT_LESSONS — GNULense

## Architecture

- SMO scaffold via `smo init . --lang ts --pm bun`. Scopes never import each other, mergers <150 lines, flows <80 lines, connectors do I/O.
- Infrastructure-first: raw archive is immutable. Parser never fetches network, only Tigris/local.
- 0$ constraint drives storage split: Tigris 10GB for HTML/JSON, GitHub CDN for media. 5MB per-asset cap enforced in crawler.
- Backend is Vercel Edge only. Railway is optional door, not required. `core/config` exposes `hasRailway()` to switch.

## Decisions

- parse5 over cheerio for legacy gnu.org HTML (malformed tables, unclosed tags).
- Shard by `hash(url) % TOTAL == SHARD_ID` — no central queue, Mongo is dedup source. Each shard checkpoints every 50 pages to Mongo `shard_checkpoints` + Tigris `manifest-shard-{id}.json`.
- Media detection: content-type or extension in `isMedia()`. If media and <=5MB and image/pdf -> Tigris? No — per 0$ rule media goes to GitHub CDN always. HTML to Tigris. This keeps Tigris under 4GB.
- Tigris key: `raw/{sha256[0:2]}/{sha256}` + sidecar `{sha256}.meta.json`. Processed: `processed/{slug}.json`.
- Vercel ISR not full SSG: `revalidate` on-demand via `POST /api/revalidate` with secret. Only changed slugs revalidated.

## Quirks

- Colab notebooks share same template, param `SHARD_ID`. Each logs stop via `finally` + `atexit` to Mongo `shardId, lastUrl, nextQueueHead, stoppedAt, reason`. Next run any shard reads all checkpoints to skip done URLs.
- GitHub CDN media repo `GNULense-media` — push via `PUT /repos/{owner}/{repo}/contents/{path}` with base64. CDN url is `https://raw.githubusercontent.com/{repo}/{branch}/{path}` and `https://cdn.jsdelivr.net/gh/{repo}@{sha}/{path}`.
- Tigris 10GB guard: `tigris-usage.json` computed nightly, warn at 8GB, error at 9.5GB. Crawler refuses new >5MB assets when >9GB.
- `smo map` regenerates SMO-MAP.md — run after adding scope.

## Gotchas

- Do not use `find`, use `rg`. Verified by lessons.md.
- Do not buffer large tarballs in memory — stream to Tigris/GitHub.
- robots.txt must be fetched per subdomain before any crawl, cached 24h in Mongo `robots_cache`.
- All logs structured JSON with traceId, shardId, url, hash, durationMs.
