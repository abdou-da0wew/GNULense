#!/usr/bin/env bash
set -euo pipefail
export ROLE="kid"
export COORD_PORT="${COORD_PORT:-4000}"
# DAD_URL must be provided: the dad's cloudflared https://xxx.trycloudflare.com
if [ -z "${DAD_URL:-}" ]; then
  echo "kid needs DAD_URL env — the dad's tunnel url"
  echo "example: DAD_URL=https://abc.trycloudflare.com bash scripts/cluster/kid.sh"
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/node.sh"
