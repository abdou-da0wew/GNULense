#!/usr/bin/env bash
set -euo pipefail
# Auto-restart harness — survives 12h colab cap, dad death, and keep-alive 404
# Runs forever, recreates kids before 12h, restarts dad if needed
COLAB_BIN="$HOME/.local/bin/colab"
PROJECT_DIR="/home/aboood/Documents/Projects/GNULense"
WEBHOOK_MAIN="${WEBHOOK_MAIN:-${WEBHOOK_CONTROL:-}}"
KIDS=(0 1 2)
SHARDS=3
SEEDS=("https://www.gnu.org/" "https://www.gnu.org/software/software.html" "https://www.gnu.org/philosophy/philosophy.html")

send_main() {
  local title="$1" desc="$2" level="${3:-info}"
  [ -z "$WEBHOOK_MAIN" ] && return 0
  local color=3447003
  case "$level" in success) color=3066993;; warn) color=15105570;; error) color=15158332;; esac
  local mention=""; [[ "$level" == "error" ]] && mention="<@1276261981392867431> "
  curl -s -X POST "$WEBHOOK_MAIN" -H "content-type: application/json" -d "{\"username\":\"GNULense • control-1t-na\",\"content\":\"$mention\",\"embeds\":[{\"title\":\"$title\",\"description\":\"$desc\",\"color\":$color,\"timestamp\":\"$(date -Iseconds)\"}]}" >/dev/null 2>&1 || true
}

# ensure colab sessions exist, recreate if lost or near 11h
ensure_kid() {
  local shard=$1
  local seed="${SEEDS[$((shard % 2))]}"
  local session="gnulense-kid-$shard"
  # check if session exists and keep-alive is healthy (not 404)
  if ! $COLAB_BIN sessions 2>&1 | grep -q "$session"; then
    echo "[$(date -Iseconds)] RECREATE $session (missing)"
    send_main "Recreating $session" "Session missing, creating new" "warn"
    $COLAB_BIN new --session "$session" 2>&1 | tail -n 5
    sleep 5
  else
    # check keep-alive log for 404
    if $COLAB_BIN log --session "$session" 2>&1 | grep -q "consecutive_4xx_errors.*404"; then
      echo "[$(date -Iseconds)] RECREATE $session (keep-alive 404, 12h cap)"
      send_main "Recreating $session (12h cap)" "Keep-alive 404, recreating" "warn"
      $COLAB_BIN stop --session "$session" 2>&1 | tail
      sleep 2
      $COLAB_BIN new --session "$session" 2>&1 | tail -n 5
      sleep 5
    fi
  fi
  # ensure crawler running
  local alive=$(printf 'ps aux | grep -q "[b]un.*crawl" && echo alive || echo dead\n' | $COLAB_BIN console --session "$session" 2>&1 | grep -a "alive\|dead" | tail -n 1 | tr -d '\r' || echo "dead")
  if [[ "$alive" != *"alive"* ]]; then
    echo "[$(date -Iseconds)] RESTART crawler $session"
    send_main "Restarting crawler $session" "Shard $shard seed $seed" "info"
    # ensure code and env
    printf 'if [ ! -d /tmp/GNULense ]; then git clone https://github.com/abdou-da0wew/GNULense.git /tmp/GNULense 2>&1 | tail -n 2; else cd /tmp/GNULense && git pull 2>&1 | tail -n 2; fi\n' | $COLAB_BIN console --session "$session" 2>&1 | tail -n 5
    $COLAB_BIN upload --session "$session" "$PROJECT_DIR/.env" "/tmp/GNULense/.env" 2>&1 | head -n 3
    printf 'curl -fsSL https://bun.sh/install | bash >/tmp/bun.log 2>&1 || true\n' | $COLAB_BIN console --session "$session" 2>&1 | tail -n 3
    printf 'cd /tmp/GNULense && SEED_URL=%s CRAWL_SHARD_ID=%s CRAWL_SHARD_TOTAL=%s FAST_CONCURRENCY=12 FAST_RATE_MS=100 BUN_INSTALL=~/.bun BUN_TMPDIR=~/.bun/tmp nohup bun --env-file=.env run crawl:shard > /tmp/crawl-kid-%s.log 2>&1 & echo started:$!\n' "$seed" "$shard" "$SHARDS" "$shard" | $COLAB_BIN console --session "$session" 2>&1 | grep -a "started" | tail -n 5
  else
    echo "[$(date -Iseconds)] $session alive"
  fi
}

send_main "Harness started" "Auto-restart for 2 kids, 12h cap handling, 2 shards hyper fast" "success"
echo "Harness started — will run forever, recreate before 12h"

# proactively recreate before 11h to avoid 404
CREATED_AT=$(date +%s)
while true; do
  for shard in "${KIDS[@]}"; do
    ensure_kid "$shard"
  done
  # if near 11h (39600s), pre-emptively recreate
  elapsed=$(( $(date +%s) - CREATED_AT ))
  if [ $elapsed -gt 39600 ]; then
    echo "[$(date -Iseconds)] 11h elapsed — pre-emptive recreate to avoid 12h cap"
    send_main "Pre-emptive recreate (11h)" "Recreating both kids before 12h cap" "info"
    for shard in "${KIDS[@]}"; do
      $COLAB_BIN stop --session "gnulense-kid-$shard" 2>&1 | tail
      sleep 2
      $COLAB_BIN new --session "gnulense-kid-$shard" 2>&1 | tail
    done
    CREATED_AT=$(date +%s)
  fi
  sleep 60
done
