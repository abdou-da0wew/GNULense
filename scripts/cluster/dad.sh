#!/usr/bin/env bash
set -euo pipefail
export ROLE="dad"
export COORD_PORT="${COORD_PORT:-4000}"
export CRAWL_SHARD_ID="${CRAWL_SHARD_ID:-0}"
export CRAWL_SHARD_TOTAL="${CRAWL_SHARD_TOTAL:-5}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/node.sh"
