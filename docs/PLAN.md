# GNULense — Execution Plan (Phased, SMO, 0$)

> Core Pipeline: `Crawl (Colab Fleet) -> Raw (Tigris+GitHub) -> Parse -> JSON (Tigris) -> Search Index -> Static ISR (Vercel Edge) -> Validate -> Deploy`

## Phase 0 — Foundation (Day 1, local, no cost)

- [x] `smo init . --lang ts --pm bun` done
- [ ] Implement `core/config/index.ts` (env loader, 0$ service toggles), `core/platform/logger.ts` (traceId), `core/platform/db.mongo.ts`, `core/platform/storage.tigris.ts`, `core/platform/storage.github.ts`
- [ ] Create `schemas/document.schema.json`, `schemas/crawl-manifest.schema.json`
- [ ] Create `scopes/*` skeletons with `manager/handler/connector/constants/index` and `public API` per SMO
- [ ] Create `apps/web` Next.js 14 App Router placeholder with `vercel.json` (crons disabled, edge routes)
- [ ] `bun run typecheck && bun run lint` passes

**Exit criteria:** `smo map` shows 5 scopes, 2 mergers, 3 flows. `bun run build` compiles with mocked adapters.

## Phase 1 — Sharded Crawler (Days 2-3, Colab Fleet)

- `scopes/ingestion.crawler`: `queue.ts` (hash-shard, no central queue), `robots.ts` (per-subdomain, mongo cache), `fetcher.ts` (stream, 2s ±500ms jitter, 429 backoff 2/4/8s, UA Mozilla), `storage.ts` (HTML->Tigris, media->GitHub CDN, sidecar meta), `manifest.ts` (mongo `crawl_manifest` + Tigris `manifest-shard-{id}.json`), `checkpoint.ts` (every 50 pages -> mongo `shard_checkpoints`).
- `scopes/media.github`: connector `putMedia(path, bytes) -> cdnUrl` via GitHub Contents API, dedup by sha256, served via raw.githubusercontent + jsDelivr.
- Filter: `isMedia()` by content-type/extension. If `content-length >5MB` -> store metadata only (`externalAsset: true`), no bytes. Keeps Tigris <10GB.
- Create `colab/GNULense_Shard_{1..5}.ipynb` + `colab/shard_template.ipynb` with SHARD_ID param, `finally` stop-log, and resume from Mongo+Tigris.

**Test:** Run shard 0 locally on 10 urls, verify Tigris keys `raw/ab/cd...`, mongo docs, GitHub media CDN url, checkpoint written.

**Colab execution:** Open 5 colabs, each sets `CRAWL_SHARD_ID=0..4`, `CRAWL_SHARD_TOTAL=5`, runs `bun run crawl:shard`. Fast internet + 100GB disk lets each run hours. If stopped, `shard_checkpoints` has `lastUrl, nextQueueHead, stoppedAt, reason`; next shard reads it and skips done.

## Phase 2 — Parser (Days 3-4)

- `scopes/knowledge.parser`: `html-parser.ts` (parse5), `noise-stripper.ts` (remove nav/header/footer/script/style/.menu/.breadcrumb), `section-extractor.ts` (split h1-h6 -> sections), `code-extractor.ts` (pre/code + language from class), `table-extractor.ts`, `link-normalizer.ts` (relative -> absolute -> /docs/slug, media -> GitHub CDN url), `schema-validator.ts` (ajv against `document.schema.json`).
- Input always Tigris `raw/*`, output Tigris `processed/{slug}.json` (atomic, deterministic). Errors -> `parse-errors.json` in Mongo, never abort.
- Also write `site-structure.json` to Tigris for sidebar.

**Test:** `bun run parse` on 20 raw samples, validate `schemas/document.schema.json`, check media links rewritten to GitHub CDN.

## Phase 3 — Search Index (Day 4)

- `scopes/search.indexer`: reads `processed/*.json` from Tigris, indexes `heading + content.slice(0,500) + slug + sectionId`, stop-words filter, chunked at 5MB per file `search-index-{n}.json` + `search-index-meta.json` (count, hash, timestamp) to Tigris. Also sync copy to `apps/web/public/` at build time for client offline search (Flexsearch/MiniSearch).
- Incremental: only re-index docs where `sha256` changed (compare Mongo `page_hashes`).

## Phase 4 — Frontend Lens (Days 5-7, Vercel)

- `apps/web`: Next.js 14 App Router, Tailwind, shiki (server), Inter/system-ui, monospace for code.
- Routes: `/` (top sections + counts from manifest), `/docs/[...slug]` (SectionRenderer + sticky TOC + CodeBlock), `/search` (client Flexsearch, loads `search-index-*.json` from CDN), `/about`, `/changelog`.
- `lib/data-loader.ts`: `if prod -> fetch from Tigris S3 (signed url)`, else local `data/`. `generateStaticParams` from Mongo `crawl_manifest` (or Tigris `manifest.json` at build).
- `app/api/revalidate/route.ts`, `health/route.ts`, `search/route.ts` — Edge runtime, no Blob, no DB heavy work. `revalidate` checks `x-revalidate-secret` and calls `revalidatePath`.
- Config `vercel.json`: no crons by default, edge region auto.
- Performance: FCP <1.5s, CLS 0, Lighthouse >90, paginate >50 sections, lazy sections.

## Phase 5 — Validation (Day 7)

- `scopes/knowledge.validator`: `schema-checker.ts`, `coverage-report.ts` (manifest vs processed), `link-checker.ts` (internal links resolve), `duplicate-detector.ts` (sha256 exact + Jaccard >0.95), `tigris-usage.ts` (warn 8GB).
- `scripts/validate-all.ts` runs all, exit 1 on fail.
- Tests: `tests/parser/*.test.ts` (10 fixtures from gnu.org), `tests/pages/*.snapshot.test.tsx`, benchmarks (parse <500ms/file, index <30s).

## Phase 6 — Watcher & Deploy (Day 8, optional backend door)

- `flows/crawl.flow`, `parse.flow`, `build.flow` (<80 lines each) orchestrating mergers.
- `scripts/cron/schedule.ts`: if `RAILWAY_BACKEND_URL` set -> run on Railway (node-cron 02:00 UTC incremental), else no-op. Alternative: Vercel Cron calls `POST /api/cron` (Edge) which just enqueues check, heavy work stays on Railway or next Colab run.
- `mergers/crawl-to-parse`, `knowledge-to-site`: selective revalidate. If diff count >500 -> trigger full `vercel --prod` via deploy hook.
- `apps/web/app/api/cron/route.ts` optional — lightweight, delegates to Railway if present.
- Deploy: `vercel --prod` with `TIGRIS_*`, `MONGODB_URI`, `GITHUB_TOKEN` env. Media served from GitHub CDN, never from Vercel.

**Done when:** 5 colabs finish full gnu.org crawl (HTML via Tigris, media via GitHub), `bun run parse && bun run validate-all` passes, `vercel --prod` serves `/docs/software/bash/manual` etc with TOC/Search, `POST /api/revalidate` works, Tigris usage <8GB.

## Execution Order (strict)

`0 Foundation -> 1 Crawler Fleet -> 2 Parser -> 3 Index -> 4 Frontend -> 5 Validate -> 6 Watcher/Deploy`

Do not start `4` before `2` has produced `processed/*.json` in Tigris. `5` gates `6`.
