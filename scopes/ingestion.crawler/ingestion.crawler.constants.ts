export const CRAWLER_CONFIG = {
  domain: "gnu.org",
  allowedHosts: ["gnu.org", "www.gnu.org", "alpha.gnu.org", "savannah.gnu.org"],
  rateLimitMs: Number(process.env.FAST_RATE_MS ?? 100),
  jitterMs: Number(process.env.FAST_JITTER_MS ?? 50),
  concurrency: Number(process.env.FAST_CONCURRENCY ?? 12),
  retryDelaysMs: [500, 1000, 2000] as const,
  maxRetries: 2,
  maxAssetBytes: 5 * 1024 * 1024,
  checkpointEvery: 20,
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 GNULense/0.1 (+https://gnu.triecbot.xyz)",
} as const

export const MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".mp4", ".webm", ".mp3", ".ogg", ".wav",
  ".pdf", ".zip", ".tar", ".gz", ".xz", ".bz2",
])

export const MEDIA_CONTENT_TYPES = new Set([
  "image/", "video/", "audio/", "application/pdf", "application/zip", "application/x-tar", "application/gzip",
])
