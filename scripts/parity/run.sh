#!/usr/bin/env bash
set -euo pipefail

THEIRS_REPO=https://github.com/lawchat-oss/mcp-taiwan-legal-db
THEIRS_COMMIT=ef677ad63c3206fc211a083fad8b1d9ef5015222
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/judicial-parity.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

export UV_CACHE_DIR="$WORK/uv-cache" UV_PYTHON_INSTALL_DIR="$WORK/uv-python"
git init --quiet "$WORK/theirs"
git -C "$WORK/theirs" fetch --quiet --depth 1 "$THEIRS_REPO" "$THEIRS_COMMIT"
git -C "$WORK/theirs" checkout --quiet FETCH_HEAD
uv venv --quiet --python 3.12 "$WORK/venv"
VIRTUAL_ENV="$WORK/venv" uv pip install --quiet "$WORK/theirs"

cd "$ROOT"
bun scripts/parity/run.ts \
  --theirs-dir "$WORK/theirs" \
  --theirs-python "$WORK/venv/bin/python" \
  --theirs-home "$WORK/home" \
  --playwright-dir "$WORK/playwright" \
  "$@"
