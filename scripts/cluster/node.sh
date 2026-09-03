#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ROLE="${ROLE:-kid}"
SHARD_ID="${CRAWL_SHARD_ID:-0}"
SHARD_TOTAL="${CRAWL_SHARD_TOTAL:-5}"
COORD_PORT="${COORD_PORT:-4000}"
DAD_URL="${DAD_URL:-}"
NODE_ID="node-${SHARD_ID}-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"

export NODE_ID ROLE COORD_PORT
info "node start role=$ROLE shard=$SHARD_ID/$SHARD_TOTAL node=$NODE_ID port=$COORD_PORT"

install_cloudflared

# 1) Start coord server
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}" PATH="$BUN_INSTALL/bin:$PATH" bun run "$SCRIPT_DIR/coord-server.ts" &
COORD_PID=$!
info "coord server pid=$COORD_PID"
wait_for_port $COORD_PORT || { err "coord failed to start"; exit 1; }
info "coord up at http://127.0.0.1:$COORD_PORT/health"

# 2) Start cloudflared quick tunnel
CLOUDFLARED_LOG="/tmp/cloudflared-$SHARD_ID.log"
cloudflared tunnel --url "http://127.0.0.1:$COORD_PORT" --no-autoupdate > "$CLOUDFLARED_LOG" 2>&1 &
CF_PID=$!
info "cloudflared pid=$CF_PID log=$CLOUDFLARED_LOG"
TUNNEL_URL="$(get_tunnel_url "$CLOUDFLARED_LOG")"
if [ -z "$TUNNEL_URL" ]; then warn "no tunnel yet, using localhost"; TUNNEL_URL="http://127.0.0.1:$COORD_PORT"; fi
export TUNNEL_URL
info "tunnel url=$TUNNEL_URL"

# 3) Register / mesh
if [ "$ROLE" = "dad" ]; then
  info "dad ready — peers will POST to $TUNNEL_URL/register"
  echo "$TUNNEL_URL" > /tmp/gnulense-dad-url
else
  if [ -n "$DAD_URL" ]; then
    info "kid registering with dad $DAD_URL"
    for i in {1..10}; do
      if curl -sf -X POST "$DAD_URL/register" -H "content-type: application/json" -d "{\"nodeId\":\"$NODE_ID\",\"shardId\":$SHARD_ID,\"role\":\"$ROLE\",\"tunnelUrl\":\"$TUNNEL_URL\",\"crawled\":0,\"queueLen\":0}" >/dev/null 2>&1; then
        info "registered with dad"
        break
      fi
      sleep 2
    done
    # fetch peer list and gossip via SSE in background
    curl -N -s "$DAD_URL/events" 2>/dev/null | while read -r line; do
      if [[ "$line" == data:* ]]; then
        info "gossip $line"
      fi
    done &
  else
    warn "no DAD_URL — running isolated"
  fi
fi

# 4) Fallback watcher — if dad dies, lowest shard becomes dad
(
  while true; do
    sleep 15
    if [ "$ROLE" != "dad" ] && [ -n "$DAD_URL" ]; then
      if ! curl -sf "$DAD_URL/health" >/dev/null 2>&1; then
        warn "dad $DAD_URL down — checking fallbacks"
        # simple bully: if I'm lowest alive shard, become dad
        # fetch peers from last known dad, if fails, self-promote if shard 0
        if [ "$SHARD_ID" = "0" ]; then
          info "promoting to dad (fallback)"
          ROLE="dad"
          export ROLE
          # restart coord as dad? For now just log — next deploy will elect
        fi
      fi
    fi
  done
) &

# 5) Start crawler — gossip checkpoints to mesh
info "starting crawler shard $SHARD_ID"
# wrap crawler to gossip each checkpoint
CRAWL_LOG="/tmp/crawl-$SHARD_ID.log"
(
  BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}" PATH="$BUN_INSTALL/bin:$PATH" bun run crawl:shard 2>&1 | tee "$CRAWL_LOG" |
  while IFS= read -r line; do
    echo "$line"
    if echo "$line" | grep -q '"crawl.stored'; then
      url=$(echo "$line" | grep -o '"url":"[^"]*"' | head -n1 | cut -d'"' -f4)
      if [ -n "$url" ] && [ -n "${DAD_URL:-}" ]; then
        curl -sf -X POST "$DAD_URL/checkpoint" -H "content-type: application/json" -d "{\"url\":\"$url\",\"shardId\":$SHARD_ID,\"nodeId\":\"$NODE_ID\"}" >/dev/null 2>&1 || true
        # also gossip to peers via tunnel list
        for peer in $(curl -sf "$DAD_URL/peers" 2>/dev/null | grep -o '"tunnelUrl":"[^"]*"' | cut -d'"' -f4); do
          if [ "$peer" != "$TUNNEL_URL" ] && [ "$peer" != "$DAD_URL" ]; then
            curl -sf -X POST "$peer/checkpoint" -H "content-type: application/json" -d "{\"url\":\"$url\",\"shardId\":$SHARD_ID,\"nodeId\":\"$NODE_ID\"}" >/dev/null 2>&1 || true
          fi
        done
      fi
    fi
  done
) &
CRAWL_PID=$!

info "cluster ready — dad=$DAD_URL self=$TUNNEL_URL crawler pid=$CRAWL_PID"
info "logs: coord http://127.0.0.1:$COORD_PORT/peers , crawl $CRAWL_LOG , cloudflared $CLOUDFLARED_LOG"

wait $CRAWL_PID
info "crawler done — node staying alive for mesh"
wait $COORD_PID
