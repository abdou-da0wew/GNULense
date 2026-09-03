export const CRAWLER_CONFIG = {
  domain: "gnu.org",
  allowedHosts: ["gnu.org", "www.gnu.org", "alpha.gnu.org", "savannah.gnu.org"],
  rateLimitMs: 2000,
  jitterMs: 500,
  retryDelaysMs: [2000, 4000, 8000] as const,
  maxRetries: 3,
  maxAssetBytes: 5 * 1024 * 1024,
  checkpointEvery: 50,
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
