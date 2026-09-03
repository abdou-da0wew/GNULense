# GNULense

> A structured lens over the entire `gnu.org` domain — not a redesign, a refocus.

GNULense is an infrastructure-first, 0$-budget knowledge ingestion engine that crawls **every page under https://www.gnu.org**, parses it into deterministic JSON, and rebuilds it as a modern, searchable, AI-ready static site on **Vercel**.

**Infrastructure:** `Vercel (Edge) + Tigris S3 (10GB) + MongoDB Atlas (M0) + GitHub CDN + Colab Fleet (5 shards)` — all free tier.

```
Colab Fleet (5 shards) -> Tigris (HTML/JSON) + GitHub CDN (media) + Mongo (manifest)
        ↓
   Railway (optional cron, tiny) or Vercel Cron -> diff -> selective revalidate
        ↓
   Vercel Edge Functions -> Next.js ISR -> gnu.triecbot.xyz
```

## Quick Start

```sh
bun install
cp .env.example .env # fill TIGRIS_* , MONGODB_URI , GITHUB_TOKEN
bun run dev          # local dev pulls from Tigris or data/
bun run crawl:shard -- --shard=0 --total=5  # single shard
bun run parse        # Tigris raw -> processed JSON
bun run build        # Next.js build from Tigris
```

## Structure (SMO)

```
core/config, core/platform   -> config + Tigris/Mongo/GitHub adapters + logger
scopes/ingestion.crawler     -> polite crawler, 5-shard aware
scopes/knowledge.parser      -> parse5 -> JSON
scopes/knowledge.validator   -> schema + link + duplicate checks
scopes/search.indexer        -> chunked Flexsearch index
scopes/media.github          -> media -> GitHub CDN
mergers/crawl-to-parse, knowledge-to-site -> cross-scope coordination only
flows/crawl.flow, parse.flow, build.flow  -> <80 lines orchestration
strappers/strapper.ts         -> wiring only, called in main
apps/web                     -> Next.js 14 App Router on Vercel
colab/                       -> 5 notebooks, each logs stop checkpoint to Mongo+Tigris
```

## 0$ Budget

| Piece | Service | Free Tier | Usage |
|-------|---------|-----------|-------|
| HTML/JSON store | Tigris S3 | 10GB | raw + processed, 5MB cap per asset |
| Media store | GitHub | unlimited (via repo) | images/videos -> GNULense-media repo -> raw.githubusercontent CDN |
| DB | MongoDB Atlas M0 | 512MB | manifests, hashes, shard checkpoints |
| Hosting + Edge | Vercel Hobby | 100GB bw | Next.js + Edge Functions (backend) |
| Optional backend | Railway | $5 free | tiny cron only, optional |
| Crawlers | Colab | 100GB disk, fast net | 5 parallel shards |

Run `smo map` to regenerate SMO-MAP.md.

## Docs

- `docs/PLAN.md` — phased execution plan
- `docs/ARCHITECTURE.md` — SMO boundaries + data flow
- `docs/INFRA.md` — 0$ infra wiring
- `docs/COLAB_FLEET.md` — 5-shard fleet + stop-log
- `docs/DATA_MODEL.md` — schemas + Mongo collections
