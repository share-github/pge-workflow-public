#!/usr/bin/env bash
# Pack PGE framework (.claude/ + .mcp.json) into a single tarball for distribution to other PJs.
# Output extracts directly at target repo root: `tar -xzf pge-bundle.tar.gz -C "$DST/"`.
#
# Usage:
#   .claude/scripts/pack-pge.sh                       # -> ./pge-bundle.tar.gz
#   .claude/scripts/pack-pge.sh /tmp/foo.tar.gz       # custom output path

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="${1:-$PWD/pge-bundle.tar.gz}"

cd "$SRC"

[[ -d .claude   ]] || { echo "ERROR: .claude/ not found at $SRC" >&2; exit 1; }
[[ -f .mcp.json ]] || { echo "ERROR: .mcp.json not found at $SRC" >&2; exit 1; }

tar --sort=name \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mtime='UTC 2026-01-01' \
  -czf "$OUT" \
  --exclude='.claude/cache' \
  --exclude='.claude/pge-dev-reports' \
  --exclude='.claude/scheduled_tasks.lock' \
  --exclude='.claude/settings.json' \
  --exclude='.claude/settings.local.json' \
  --exclude='.claude/docs-viewer' \
  --exclude='.claude/.DS_Store' \
  --exclude='.claude/statusline.sh' \
  .claude .mcp.json

echo "Created: $OUT ($(du -h "$OUT" | cut -f1))"
echo ""
echo "Extract on target (overwrites existing files):"
echo "  tar -xzf $(basename "$OUT") -C \"\$DST/\""
