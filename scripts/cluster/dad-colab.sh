#!/usr/bin/env bash
set -euo pipefail
# Dad ONLY monitors — 2 kids on colab via colab console (exec broken)
COLAB_BIN="$HOME/.local/bin/colab"
PROJECT_DIR="/home/aboood/Documents/Projects/GNULense"
KIDS=(0 1 2)
SHARDS=3
SEEDS=("https://www.gnu.org/" "https://www.gnu.org/software/software.html" "https://www.gnu.org/philosophy/philosophy.html")
WEBHOOK_MAIN="${WEBHOOK_MAIN:-${WEBHOOK_CONTROL:-}}"
send_main() {
  local title="$1" desc="$2" level="${3:-info}"
  [ -z "$WEBHOOK_MAIN" ] && return 0
  local color=3447003
  case "$level" in success) color=3066993;; warn) color=15105570;; error) color=15158332;; esac
  local mention=""; [[ "$level" == "error" || "$level" == "warn" ]] && mention="<@1276261981392867431> "
  curl -s -X POST "$WEBHOOK_MAIN" -H "content-type: application/json" -d "{\"username\":\"GNULense • control-1t-na\",\"content\":\"$mention\",\"embeds\":[{\"title\":\"$title\",\"description\":\"$desc\",\"color\":$color,\"timestamp\":\"$(date -Iseconds)\"}]}" >/dev/null 2>&1 || true
}
spawn_kid() {
  local shard=$1
  local seed="${SEEDS[$((shard % 2))]}"
  echo "[$(date -Iseconds)] SPAWN kid $shard seed $seed"
  send_main "Spawning kid $shard" "Shard $shard/2 seed \`$seed\` 8 conc 200ms" "info"
  if ! $COLAB_BIN sessions 2>&1 | grep -q "gnulense-kid-$shard"; then
    echo "Creating colab session gnulense-kid-$shard"
    $COLAB_BIN new --session "gnulense-kid-$shard" 2>&1 | head -n 20
    sleep 5
  fi
  echo "Starting crawler on kid $shard via console"
  # use console for shell (exec is broken)
  printf 'if [ ! -d /tmp/GNULense ]; then git clone https://github.com/abdou-da0wew/GNULense.git /tmp/GNULense 2>&1 | tail -n 3; else cd /tmp/GNULense && git pull 2>&1 | tail -n 3; fi\n' | $COLAB_BIN console --session "gnulense-kid-$shard" 2>&1 | tail -n 20
  $COLAB_BIN upload --session "gnulense-kid-$shard" "$PROJECT_DIR/.env" "/tmp/GNULense/.env" 2>&1 | head
  printf 'curl -fsSL https://bun.sh/install | bash >/tmp/bun.log 2>&1 || true\n' | $COLAB_BIN console --session "gnulense-kid-$shard" 2>&1 | tail
  printf 'cd /tmp/GNULense && SEED_URL=%s CRAWL_SHARD_ID=%s CRAWL_SHARD_TOTAL=%s FAST_CONCURRENCY=12 FAST_RATE_MS=100 BUN_INSTALL=/root/.bun BUN_TMPDIR=/root/.bun/tmp nohup /root/.bun/bin/bun --env-file=.env run crawl:shard > /tmp/crawl-kid-%s.log 2>&1 & echo started pid:$!\n' "$seed" "$shard" "$SHARDS" "$shard" | $COLAB_BIN console --session "gnulense-kid-$shard" 2>&1 | tail -n 20
  echo "kid $shard spawned via console"
}
for s in 0 1; do screen -S gnulense-kid-$s -X quit 2>/dev/null || true; done
send_main "Dad colab monitor started" "2 kids on colab via console, 2 shards, 2 seeds, 8 conc, Tigris raw + Mongo manifest" "success"
echo "Dad colab monitor started — 2 kids, 2 seeds, hyper fast"
for shard in "${KIDS[@]}"; do
  spawn_kid "$shard"
  sleep 3
done
while true; do
  sleep 15
  for shard in "${KIDS[@]}"; do
    if ! $COLAB_BIN sessions 2>&1 | grep -q "gnulense-kid-$shard"; then
      echo "[$(date -Iseconds)] KID $shard SESSION DEAD — recreating"
      send_main "Kid $shard session dead" "Recreating colab session $shard" "error"
      spawn_kid "$shard"
      continue
    fi
    alive=$(printf 'ps aux | grep -q "[b]un.*crawl" && echo alive || echo dead\n' | $COLAB_BIN console --session "gnulense-kid-$shard" 2>&1 | grep -a "alive\|dead" | tail -n 1 | tr -d '\r')
    if [[ "$alive" != *"alive"* ]]; then
      echo "[$(date -Iseconds)] KID $shard CRAWLER DEAD — restarting"
      send_main "Kid $shard crawler dead" "Restarting crawler shard $shard" "warn"
      printf 'cd /tmp/GNULense && SEED_URL=%s CRAWL_SHARD_ID=%s CRAWL_SHARD_TOTAL=%s FAST_CONCURRENCY=12 FAST_RATE_MS=100 BUN_INSTALL=/root/.bun BUN_TMPDIR=/root/.bun/tmp nohup /root/.bun/bin/bun --env-file=.env run crawl:shard > /tmp/crawl-kid-%s.log 2>&1 & echo restarted\n' "${SEEDS[$((shard % 2))]}" "$shard" "$SHARDS" "$shard" | $COLAB_BIN console --session "gnulense-kid-$shard" 2>&1 | tail
    else
      echo "[$(date -Iseconds)] kid $shard alive"
    fi
  done
done
