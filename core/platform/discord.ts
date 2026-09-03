import { getConfig } from "../config/index.js"

type Embed = {
  title?: string
  description?: string
  color?: number
  fields?: { name: string; value: string; inline?: boolean }[]
  timestamp?: string
  footer?: { text: string; icon_url?: string }
  author?: { name: string; icon_url?: string }
}

const COLORS = {
  info: 0x3498db,
  success: 0x2ecc71,
  warn: 0xf39c12,
  error: 0xe74c3c,
  audit: 0x9b59b6,
  trace: 0x95a5a6,
}

const WEBHOOK_NAMES: Record<number, string> = {
  0: "GNULense • wh-1-c1",
  1: "GNULense • wh-2-c2",
  2: "GNULense • wh-3-c3",
  3: "GNULense • wh-4-c4",
  4: "GNULense • wh-5-c5",
}
const MAIN_NAME = "GNULense • control-1t-na"
const MENTION_ID = process.env.DISCORD_MENTION_ID ?? "1276261981392867431"

function webhookForShard(shardId: number): string | null {
  const envMap: Record<number, string | undefined> = {
    0: process.env.WEBHOOK_WH_1,
    1: process.env.WEBHOOK_WH_2,
    2: process.env.WEBHOOK_WH_3,
    3: process.env.WEBHOOK_WH_4,
    4: process.env.WEBHOOK_WH_5,
  }
  return envMap[shardId] ?? null
}

function mainWebhook(): string | null {
  return process.env.WEBHOOK_MAIN ?? process.env.WEBHOOK_CONTROL ?? null
}

async function sendWebhook(url: string, username: string, embeds: Embed[], content?: string): Promise<void> {
  if (!url) return
  // fire-and-forget, duper fast, no await blocking caller if possible
  const body = JSON.stringify({
    username,
    avatar_url: "https://raw.githubusercontent.com/abdou-da0wew/GNULense/main/docs/logo.png",
    content: content ?? undefined,
    embeds,
  })
  // non-blocking fetch with 3s timeout, never throw
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 3000)
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: controller.signal,
  }).catch(() => {})
}

export function discordLogShard(opts: {
  shardId: number
  level: "info" | "success" | "warn" | "error"
  title: string
  description: string
  fields?: { name: string; value: string; inline?: boolean }[]
  traceId?: string
}): void {
  const url = webhookForShard(opts.shardId)
  if (!url) return
  const color = COLORS[opts.level] ?? COLORS.info
  const embed: Embed = {
    title: opts.title,
    description: opts.description,
    color,
    fields: [
      ...(opts.fields ?? []),
      ...(opts.traceId ? [{ name: "traceId", value: `\`${opts.traceId.slice(0, 8)}\``, inline: true }] : []),
      { name: "shard", value: `wh-${opts.shardId + 1}-c${opts.shardId + 1}`, inline: true },
      { name: "at", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `GNULense • shard ${opts.shardId} • ${opts.level}` },
    author: { name: WEBHOOK_NAMES[opts.shardId] ?? `shard-${opts.shardId}` },
  }
  void sendWebhook(url, WEBHOOK_NAMES[opts.shardId] ?? `wh-${opts.shardId}`, [embed])
}

export function discordLogMain(opts: {
  level: "info" | "success" | "warn" | "error" | "audit"
  title: string
  description: string
  fields?: { name: string; value: string; inline?: boolean }[]
  traceId?: string
  mention?: boolean
}): void {
  const url = mainWebhook()
  if (!url) return
  const color = COLORS[opts.level as keyof typeof COLORS] ?? COLORS.audit
  const embed: Embed = {
    title: opts.title,
    description: opts.description,
    color,
    fields: [
      ...(opts.fields ?? []),
      ...(opts.traceId ? [{ name: "traceId", value: `\`${opts.traceId.slice(0, 8)}\``, inline: true }] : []),
      { name: "at", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `GNULense • control-1t-na • ${opts.level}` },
    author: { name: MAIN_NAME },
  }
  const content = opts.mention ? `<@${MENTION_ID}>` : undefined
  void sendWebhook(url, MAIN_NAME, [embed], content)
}

// audit helper: structured, never leaks internals
export function auditLog(event: string, meta: Record<string, unknown>, traceId?: string): void {
  const level = event.includes("error") || event.includes("failed") ? "error" : event.includes("warn") || event.includes("rate") ? "warn" : "info"
  discordLogMain({
    level: level as any,
    title: `Audit: ${event}`,
    description: Object.entries(meta).map(([k, v]) => `**${k}**: \`${String(v).slice(0, 100)}\``).join("\n") || "—",
    fields: [{ name: "event", value: event, inline: true }],
    traceId,
    mention: level === "error" || event.includes("dad") || event.includes("rate") || event.includes("done"),
  })
}
