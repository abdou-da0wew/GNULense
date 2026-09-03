#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="/tmp/gnulense-cluster.log"
trace() { echo "[$(date -Iseconds)] [$1] $2" | tee -a "$LOG_FILE"; }
info() { trace "INFO" "$1"; }
warn() { trace "WARN" "$1"; }
err() { trace "ERR" "$1"; }
wait_for_port() {
  local port=$1
  for i in {1..30}; do
    if curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
get_tunnel_url() {
  local log=$1
  for i in {1..40}; do
    if grep -q "https://.*trycloudflare.com" "$log" 2>/dev/null; then
      grep -o "https://.*trycloudflare.com" "$log" | head -n1
      return 0
    fi
    sleep 1
  done
  echo ""
}
install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then return 0; fi
  info "installing cloudflared"
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared 2>/dev/null || wget -q -O /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /tmp/cloudflared
  sudo mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null || mv /tmp/cloudflared /tmp/cloudflared.bin 2>/dev/null || true
  export PATH="/tmp:/usr/local/bin:$PATH"
}
