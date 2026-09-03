# GNULense — SMO Architecture

## 1. Boundaries (SMO)

- **Scopes** never import from another scope. Public API only via `scopes/<domain>.<capability>/index.ts`.
- **Mergers** coordinate scopes, stateless, <150 lines, no business logic. They call managers/connectors.
- **Flows** orchestrate mergers, <80 lines, linear.
- **Strappers** wire only, called in `main()`, never in request handler.
- **Connectors** do I/O (fetch, S3 put, GitHub push, Mongo write). **Managers** hold business rules.

```
core/config           -> env loader, hasTigris(), hasMongo(), hasGithub(), hasRailway()
core/platform/logger  -> createLogger({traceId, shardId, operation}) JSON structured
core/platform/db.mongo -> MongoClient singleton, collections
core/platform/storage.tigris -> S3Client (Tigris endpoint), put/get/exists, key scheme
core/platform/storage.github -> GitHub Contents API, putMedia -> cdnUrl
scopes/ingestion.crawler -> CrawlManager + HttpConnector + Queue + Robots + Checkpoint
scopes/knowledge.parser  -> ParseManager + TigrisReader + NoiseStripper + SectionExtractor
scopes/knowledge.validator -> ValidationManager + SchemaChecker + LinkChecker
scopes/search.indexer    -> IndexManager + Tigris chunk writer
scopes/media.github      -> MediaManager + GithubConnector (CDN)
mergers/crawl-to-parse   -> (crawlManifest) => parseFlow.forChanged()
mergers/knowledge-to-site-> (changedSlugs) => revalidate or deployHook
flows/crawl.flow         -> incremental crawl entry
flows/parse.flow         -> batch parse entry
flows/build.flow         -> site-structure + search index build
strappers/strapper.ts    -> bootstrap(): load config, logger, mongo, tigris, register flows
apps/web                 -> Next.js, consumes Tigris processed at build/ISR, never crawls
```

## 2. Data Flow

```
Seed URLs (gnu.org + *.gnu.org)
  -> Queue (hash shard % TOTAL) per colab
  -> Robots check (mongo cache 24h)
  -> Fetcher (2s ±500ms, UA, stream)
  -> Content-Type gate
     -> text/html -> Tigris raw/{shardPrefix}/{sha256} + meta.json
     -> media (image/video/pdf/tar) -> GitHub CDN via media.github (or externalAsset if >5MB)
  -> Manifest: mongo crawl_manifest + Tigris manifest-shard-{id}.json
  -> Checkpoint: mongo shard_checkpoints (every 50) + Tigris checkpoint
  -> Parser: Tigris raw -> parse5 -> strip -> sections -> Tigris processed/{slug}.json + site-structure.json
  -> Indexer: Tigris processed -> chunked search-index-*.json -> Tigris + apps/web/public
  -> Next.js: generateStaticParams from mongo/manifest, render /docs/[...slug] with TOC, search loads index chunks
  -> Validator: schema + coverage + links + duplicates + tigris-usage
  -> Watcher: nightly diff (sha256 compare) -> POST /api/revalidate (Edge) or Railway cron
```

## 3. Key Schemas

- `schemas/document.schema.json` — `sourceUrl, slug, title, sha256, parsedAt, contentType, sections[{id, level, heading, content, html, codeBlocks[{lang, code}], tables[{headers, rows}], anchors}]`
- `schemas/crawl-manifest.schema.json` — `url, sha256, contentType, statusCode, fetchedAt, storageKey, shardId, cdnUrl?`

Mongo collections:
- `crawl_manifest` (url unique, hash, storageKey/cdnUrl, shardId)
- `page_hashes` (slug, sha256, updatedAt)
- `shard_checkpoints` (shardId, lastUrl, nextHead, doneCount, stoppedAt, reason)
- `robots_cache` (host, rules, fetchedAt)
- `diffs` (date, added, removed, modified)
- `build_reports` (timestamp, crawled, parsed, indexed, tigrisBytes)

Tigris keys:
- `raw/{sha256[0:2]}/{sha256}` + `raw/{sha256[0:2]}/{sha256}.meta.json`
- `processed/{slug}.json`
- `manifest/manifest-shard-{id}.json`, `manifest/site-structure.json`
- `search/search-index-{n}.json`, `search/search-index-meta.json`
- `checkpoints/shard-{id}.json`

GitHub CDN (repo GNULense-media):
- `media/{sha256[0:2]}/{sha256}.{ext}` -> `https://raw.githubusercontent.com/abdou-da0wew/GNULense-media/main/media/...`
- `https://cdn.jsdelivr.net/gh/abdou-da0wew/GNULense-media@<sha>/media/...` for jsDelivr

## 4. Failure Modes

- Single fetch fail (429/5xx) -> backoff 2/4/8s, max 3, log to `crawl_errors`, continue. Never halt fleet.
- Parse fail -> write to `parse_errors` in mongo, skip doc, continue batch.
- Tigris 10GB near limit (>8GB warn, >9GB error) -> crawler refuses new bytes, logs `STORAGE_BUDGET_EXCEEDED`, only metadata.
- Colab disconnect -> `finally`/`atexit` writes checkpoint. Next shard resumes via `shard_checkpoints` query `max(stoppedAt)`.
- Vercel Edge has no filesystem — all data via fetch from Tigris/GitHub at request/build time.

## 5. Config Decision

`core/config/index.ts` is single source. No hardcoded domains, delays, caps. `getConfig()` validates env and exposes `isEdgeOnly()` vs `withRailway()` to keep Railway door optional.
