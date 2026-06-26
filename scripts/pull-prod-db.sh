#!/usr/bin/env bash
#
# Snapshot the production D1 database into the local D1 used by `pnpm dev`.
#
# - Exports schema + data from the remote production DB (read-only).
# - Wipes the local D1 state and reloads it from the snapshot.
#
# This NEVER writes to production. Reports created while running `pnpm dev`
# land only in the local copy.
set -euo pipefail

DUMP="$(mktemp -t terremoto-prod-XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT

echo "→ Exporting production D1 (remote, read-only)…"
npx wrangler d1 export terremoto-reports \
  --remote --env production \
  --output "$DUMP"

echo "→ Resetting local D1 state…"
rm -rf .wrangler/state/v3/d1

echo "→ Loading snapshot into local D1…"
npx wrangler d1 execute terremoto-reports-local \
  --local --file "$DUMP"

echo "✓ Local D1 now mirrors production. Run: pnpm dev"
echo "  Note: images live in production R2 and will 404 locally."
