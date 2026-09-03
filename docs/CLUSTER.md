# GNULense — Dad/Kids Cluster (5 nodes, fallback mesh, cloudflared)

Dad is first exit node, kids are fallbacks. All talk via SSE gossip over cloudflared tunnels.

## Roles

* **Dad (shard 0)** — first exit, holds peer registry. Exposes `GET /peers`, `POST /register`, `POST /checkpoint`, `GET /events` (SSE). Knows all tunnel URLs, broadcasts to kids.
* **Kids (shard 1..4)** — fallback dads. Each runs same `node.sh` with `ROLE=kid` and `DAD_URL=https://<dad>.trycloudflare.com`. Register on start, heartbeat every 10s, gossip checkpoints.
* **Fallback** — if dad health fails 3x, lowest alive shard promotes to dad (bully). Dad's tunnel URL is stored in `/tmp/gnulense-dad-url` and rebroadcast via Mongo `cluster_gossip` as backup.

## Mesh via cloudflared

Each node:
1. Starts `coord-server.ts` on `COORD_PORT=4000`
2. Starts `cloudflared tunnel --url http://127.0.0.1:4000` (quick tunnel, no auth)
3. Captures `https://xxx.trycloudflare.com` from log, exports `TUNNEL_URL`
4. Dad: writes `TUNNEL_URL` to `/tmp/gnulense-dad-url`, kids POST to it
5. Dad knows all `tunnelUrl`s, kids fetch `GET /peers` to know each other, gossip via `POST /checkpoint` to all peers

## Gossip (no WebRTC needed, SSE is enough on colab)

* **SSE**: `GET /events` streams `peer_joined`, `peer_left`, `checkpoint` (crawled url)
* **Checkpoint**: crawler logs `crawl.stored_tigris` -> `node.sh` tails log, POSTs `{url, shardId, nodeId}` to dad and to all peers. Peers add to `cluster_gossip` Mongo collection and local `seen` set so they skip it.
* **Heartbeat**: kid -> dad `POST /heartbeat` every 10s, dad prunes peers not seen in 30s

WebRTC upgrade is optional — SSE already gives dad->kids broadcast, HTTP POST gives kids->dad/kids mesh. For 0$ and colab NAT, SSE+cloudflared is more reliable than WebRTC STUN.

## Scripts (uploaded by Go manager)

* `scripts/cluster/common.sh` — logging, wait_for_port, get_tunnel_url, install cloudflared
* `scripts/cluster/coord-server.ts` — Bun HTTP, peers map, SSE, Mongo mirror
* `scripts/cluster/node.sh` — generic node (ROLE env). Starts coord, cloudflared, registers, starts crawler with gossip tail, runs fallback watcher
* `scripts/cluster/dad.sh` — `ROLE=dad bash node.sh`
* `scripts/cluster/kid.sh` — `ROLE=kid DAD_URL=... bash node.sh` (requires DAD_URL)

## Go Manager (dad)

`tools/colab-fleet` is the dad. It:

1. `colab-fleet cluster deploy` — creates 5 colab sessions (via `colaho` or `colab` CLI), uploads `.sh` + `coord-server.ts` via `colab exec "cat > ..."`
2. Runs `bash scripts/cluster/dad.sh` on shard 0, waits for its tunnel url, then runs `DAD_URL=<dad> bash scripts/cluster/kid.sh` on shards 1..4
3. Watches via `GET /health` on all tunnels, logs to `shard_checkpoints`, re-elects dad if needed
4. On kid disconnect, its shard's hash range is re-queued to next alive kid (hash % aliveCount)

## 0$ notes

* `cloudflared` quick tunnels are free, ephemeral, no config. Dad collects URLs, no static tunnel needed.
* Mongo `shard_checkpoints` is still source of truth if mesh dies — crawler manager also writes there.
* GitHub CDN for media still via `GNULense-media`, Tigris dual buckets for html/json.
* Railway door stays — if colab mesh dies, Railway cron can still trigger Vercel revalidate.

## Run locally (single node test)

```sh
COORD_PORT=4001 CRAWL_SHARD_ID=0 ROLE=dad bash scripts/cluster/node.sh
# in other terminal
DAD_URL=http://127.0.0.1:4001 CRAWL_SHARD_ID=1 ROLE=kid bash scripts/cluster/node.sh
curl http://127.0.0.1:4001/peers | jq
```

## Run on Colab (via manager)

```sh
go run ./tools/colab-fleet cluster deploy --shards 5
go run ./tools/colab-fleet status
go run ./tools/colab-fleet logs --shard 0 -f
```
