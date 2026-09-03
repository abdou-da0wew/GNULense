import { createLogger, newTraceId } from "../../core/platform/logger.js"
import { getDb } from "../../core/platform/db.mongo.js"
import { discordLogMain, discordLogShard, auditLog } from "../../core/platform/discord.js"

type Peer = { nodeId: string; shardId: number; role: string; tunnelUrl: string; crawled: number; queueLen: number; lastSeen: string }
const peers = new Map<string, Peer>()
let selfPeer: Peer | null = null
const sseClients: Set<WritableStreamDefaultWriter> = new Set()

const PORT = Number(process.env.COORD_PORT ?? 4000)
const NODE_ID = process.env.NODE_ID ?? `node-${Math.random().toString(36).slice(2,6)}`
const SHARD_ID = Number(process.env.CRAWL_SHARD_ID ?? 0)
const ROLE = process.env.ROLE ?? "kid"

const logger = createLogger({ traceId: newTraceId(), operation: `coord.${ROLE}` })

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const w of [...sseClients]) {
    w.write(new TextEncoder().encode(msg)).catch(() => sseClients.delete(w))
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/health") {
      return Response.json({ nodeId: NODE_ID, role: ROLE, shardId: SHARD_ID, peers: peers.size, self: selfPeer, uptime: process.uptime() })
    }
    if (url.pathname === "/peers") {
      return Response.json({ dad: ROLE === "dad" ? selfPeer : null, peers: [...peers.values()], self: selfPeer })
    }
    if (url.pathname === "/events") {
      const stream = new ReadableStream({
        start(controller) {
          const writer = controller as unknown as WritableStreamDefaultWriter
          sseClients.add(writer as any)
          controller.enqueue(new TextEncoder().encode(`event: hello\ndata: ${JSON.stringify({ nodeId: NODE_ID })}\n\n`))
        },
        cancel() {}
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } })
    }
    if (url.pathname === "/register" && req.method === "POST") {
      const peer = await req.json() as Peer
      peer.lastSeen = new Date().toISOString()
      peers.set(peer.nodeId, peer)
      logger.info("coord.register", { peer: peer.nodeId, tunnel: peer.tunnelUrl })
      discordLogMain({ level: "info", title: "Peer joined", description: `Node \`${peer.nodeId}\` joined mesh`, fields: [{ name: "role", value: peer.role, inline: true }, { name: "shard", value: String(peer.shardId), inline: true }, { name: "tunnel", value: peer.tunnelUrl.slice(0,40), inline: false }], traceId: peer.nodeId })
      auditLog("cluster.peer_joined", { nodeId: peer.nodeId, role: peer.role, shardId: peer.shardId })
      broadcast("peer_joined", peer)
      return Response.json({ ok: true, peers: [...peers.values()] })
    }
    if (url.pathname === "/checkpoint" && req.method === "POST") {
      const body = await req.json() as { url: string; shardId: number; nodeId: string }
      logger.info("coord.checkpoint", { url: body.url.slice(0,80), nodeId: body.nodeId })
      if (Math.random() < 0.1) discordLogShard({ shardId: body.shardId ?? 0, level: "info", title: "Gossip", description: `Checkpoint \`${body.url.slice(0,50)}\``, fields: [{ name: "node", value: body.nodeId, inline: true }], traceId: body.nodeId })
      broadcast("checkpoint", body)
      const db = await getDb().catch(() => null)
      if (db) await db.collection("cluster_gossip").insertOne({ ...body, at: new Date().toISOString() }).catch(()=>{})
      return Response.json({ ok: true })
    }
    if (url.pathname === "/heartbeat" && req.method === "POST") {
      const body = await req.json() as Partial<Peer>
      if (body.nodeId) {
        const p = peers.get(body.nodeId)
        if (p) { p.lastSeen = new Date().toISOString(); p.crawled = (body as any).crawled ?? p.crawled }
      }
      return Response.json({ ok: true, peers: [...peers.values()] })
    }
    return new Response("not found", { status: 404 })
  }
})

selfPeer = { nodeId: NODE_ID, shardId: SHARD_ID, role: ROLE, tunnelUrl: process.env.TUNNEL_URL ?? `http://127.0.0.1:${PORT}`, crawled: 0, queueLen: 0, lastSeen: new Date().toISOString() }
logger.info("coord.start", { nodeId: NODE_ID, role: ROLE, port: PORT, shardId: SHARD_ID })

setInterval(() => {
  const now = Date.now()
  for (const [id, p] of [...peers]) {
    if (now - new Date(p.lastSeen).getTime() > 30000) {
      peers.delete(id)
      logger.warn("coord.peer_timeout", { peer: id })
      discordLogMain({ level: "warn", title: "Peer timeout", description: `Node \`${id}\` timed out`, traceId: id, mention: true }); auditLog("cluster.peer_timeout", { nodeId: id })
      broadcast("peer_left", { nodeId: id })
    }
  }
}, 10000)

if (ROLE !== "dad" && process.env.DAD_URL) {
  const dadUrl = process.env.DAD_URL
  setInterval(async () => {
    try {
      await fetch(`${dadUrl}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodeId: NODE_ID, crawled: selfPeer?.crawled ?? 0 }) })
    } catch {}
  }, 10000)
}
