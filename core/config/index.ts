export type AppConfig = {
  env: string
  port: number
  tigris: {
    endpoint: string | null
    region: string
    bucket: string | null
    accessKey: string | null
    secretKey: string | null
    enabled: boolean
  }
  mongo: {
    uri: string | null
    db: string
    enabled: boolean
  }
  github: {
    token: string | null
    mediaRepo: string
    mediaBranch: string
    enabled: boolean
  }
  vercel: {
    deployHook: string | null
    revalidateSecret: string | null
  }
  railway: {
    url: string | null
    enabled: boolean
  }
  crawler: {
    shardId: number
    shardTotal: number
    domain: string
    rateLimitMs: number
    jitterMs: number
    maxAssetBytes: number
  }
}

export function getConfig(): AppConfig {
  const tigrisBucket = process.env.TIGRIS_BUCKET ?? null
  const tigrisAccess = process.env.TIGRIS_ACCESS_KEY ?? null
  const tigrisSecret = process.env.TIGRIS_SECRET_KEY ?? null
  const tigrisEndpoint = process.env.TIGRIS_ENDPOINT ?? null
  const mongoUri = process.env.MONGODB_URI ?? null
  const githubToken = process.env.GITHUB_TOKEN ?? null
  const railwayUrl = process.env.RAILWAY_BACKEND_URL ?? null

  return {
    env: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    tigris: {
      endpoint: tigrisEndpoint,
      region: process.env.TIGRIS_REGION ?? "auto",
      bucket: tigrisBucket,
      accessKey: tigrisAccess,
      secretKey: tigrisSecret,
      enabled: Boolean(tigrisBucket && tigrisAccess && tigrisSecret),
    },
    mongo: {
      uri: mongoUri,
      db: process.env.MONGODB_DB ?? "gnulense",
      enabled: Boolean(mongoUri),
    },
    github: {
      token: githubToken,
      mediaRepo: process.env.GITHUB_MEDIA_REPO ?? "abdou-da0wew/GNULense-media",
      mediaBranch: process.env.GITHUB_MEDIA_BRANCH ?? "main",
      enabled: Boolean(githubToken),
    },
    vercel: {
      deployHook: process.env.VERCEL_DEPLOY_HOOK ?? null,
      revalidateSecret: process.env.VERCEL_REVALIDATE_SECRET ?? null,
    },
    railway: {
      url: railwayUrl,
      enabled: Boolean(railwayUrl),
    },
    crawler: {
      shardId: Number(process.env.CRAWL_SHARD_ID ?? 0),
      shardTotal: Number(process.env.CRAWL_SHARD_TOTAL ?? 5),
      domain: "gnu.org",
      rateLimitMs: 2000,
      jitterMs: 500,
      maxAssetBytes: 5 * 1024 * 1024,
    },
  }
}

export function isLocalMode(): boolean {
  const c = getConfig()
  return !c.tigris.enabled && !c.mongo.enabled
}

export function hasRailway(): boolean {
  return getConfig().railway.enabled
}

export function assertShardConfig(): void {
  const c = getConfig().crawler
  if (c.shardId < 0 || c.shardId >= c.shardTotal) {
    throw new Error(`CRAWL_SHARD_ID ${c.shardId} out of range 0..${c.shardTotal - 1}`)
  }
}
