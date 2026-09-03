# GNULense — Data Model

## JSON Schemas

### `schemas/document.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GNULenseDocument",
  "type": "object",
  "required": ["sourceUrl", "slug", "title", "sha256", "parsedAt", "contentType", "sections"],
  "properties": {
    "sourceUrl": { "type": "string", "format": "uri" },
    "slug": { "type": "string", "pattern": "^[a-z0-9-/]+$" },
    "title": { "type": "string" },
    "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "parsedAt": { "type": "string", "format": "date-time" },
    "contentType": { "type": "string" },
    "description": { "type": "string" },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "level", "heading", "content", "html"],
        "properties": {
          "id": { "type": "string" },
          "level": { "type": "integer", "minimum": 1, "maximum": 6 },
          "heading": { "type": "string" },
          "content": { "type": "string" },
          "html": { "type": "string" },
          "codeBlocks": {
            "type": "array",
            "items": { "type": "object", "properties": { "language": { "type": ["string", "null"] }, "code": { "type": "string" } } }
          },
          "tables": {
            "type": "array",
            "items": { "type": "object", "properties": { "headers": { "type": "array", "items": { "type": "string" } }, "rows": { "type": "array", "items": { "type": "array", "items": { "type": "string" } } } } }
          },
          "anchors": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "assets": { "type": "array", "items": { "type": "string" } },
    "links": { "type": "array", "items": { "type": "string" } }
  }
}
```

### `schemas/crawl-manifest.schema.json`

```json
{
  "title": "CrawlManifestEntry",
  "type": "object",
  "required": ["url", "sha256", "contentType", "statusCode", "fetchedAt", "shardId"],
  "properties": {
    "url": { "type": "string", "format": "uri" },
    "sha256": { "type": "string" },
    "contentType": { "type": "string" },
    "statusCode": { "type": "integer" },
    "fetchedAt": { "type": "string", "format": "date-time" },
    "storageKey": { "type": "string" },
    "cdnUrl": { "type": "string", "format": "uri" },
    "shardId": { "type": "integer", "minimum": 0, "maximum": 4 },
    "externalAsset": { "type": "boolean" }
  }
}
```

## Mongo Collections

```ts
// crawl_manifest — unique url
{ url: string, sha256: string, contentType: string, statusCode: 200, fetchedAt: ISO, storageKey?: string, cdnUrl?: string, shardId: 0..4, externalAsset?: boolean }

// page_hashes — unique slug
{ slug: string, sha256: string, sourceUrl: string, updatedAt: ISO }

// shard_checkpoints — shardId + stoppedAt
{ shardId: 0..4, lastUrl: string, nextHead: string|null, doneCount: number, stoppedAt: ISO, reason: "checkpoint"|"interrupt"|"complete"|"error", queueRemaining: number }

// robots_cache — host
{ host: "www.gnu.org", rules: string, fetchedAt: ISO, expiresAt: ISO }

// diffs
{ date: "2025-09-03", added: string[], removed: string[], modified: string[], tigrisBytes: number }

// build_reports
{ timestamp: ISO, crawled: number, parsed: number, indexed: number, tigrisBytes: number, errors: number }
```

## Tigris Keys (S3)

```
raw/ab/cd...64hex                -> bytes (HTML)
raw/ab/cd...64hex.meta.json      -> {url, sha256, contentType, fetchedAt, shardId, statusCode}
processed/software/bash/manual.json -> Document JSON
manifest/manifest-shard-{0..4}.json
manifest/site-structure.json      -> [{slug, title, sectionCount, sha256}]
manifest/manifest.json            -> merged all shards
search/search-index-{0..n}.json   -> Flexsearch chunk, <5MB each
search/search-index-meta.json     -> {count, chunks, builtAt, hash}
checkpoints/shard-{id}.json       -> last checkpoint mirror
```

## GitHub CDN Keys

```
media/ab/cd...64hex.png  -> raw.githubusercontent + jsDelivr
media/ab/cd...64hex.pdf
```

CDN url stored in `crawl_manifest.cdnUrl` and rewritten in `processed/*.json` html.

## Data Loader (apps/web)

```ts
// apps/web/lib/data-loader.ts
export async function loadDocument(slug: string): Promise<Document> {
  if (process.env.TIGRIS_BUCKET) {
    // prod: fetch from Tigris presigned or public read
    return fetch(`https://${TIGRIS_BUCKET}.fly.storage.tigris.dev/processed/${slug}.json`).then(r=>r.json());
  }
  // dev: local fs
  return JSON.parse(await fs.readFile(`data/processed/${slug}.json`, "utf8"));
}
```
