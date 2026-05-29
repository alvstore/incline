#!/usr/bin/env bash
# scripts/dr/sync-edge-functions.sh
# v1.0.0 — Deploy every edge function under supabase/functions/ to the DR project.
#
# Prereqs:
#   - supabase CLI installed and logged in (`supabase login`)
#   - $SUPABASE_DR_PROJECT_REF set to the standby project ref
#     (default: pmznpbsahetwmogezhff)
#
# Run after any edge-function change you want reflected on the DR project.
# This is intentionally NOT in the nightly cron — deploys mutate live functions
# and should be an explicit human action.

set -euo pipefail

DR_REF="${SUPABASE_DR_PROJECT_REF:-pmznpbsahetwmogezhff}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FUNCTIONS_DIR="$ROOT/supabase/functions"

if [ ! -d "$FUNCTIONS_DIR" ]; then
  echo "No supabase/functions directory at $FUNCTIONS_DIR" >&2
  exit 1
fi

cd "$ROOT"

echo "Syncing edge functions to standby project: $DR_REF"
echo

failed=()
ok=()

for dir in "$FUNCTIONS_DIR"/*/; do
  name="$(basename "$dir")"
  case "$name" in
    _shared|_*) echo "skip $name"; continue ;;
  esac
  if [ ! -f "$dir/index.ts" ]; then
    echo "skip $name (no index.ts)"
    continue
  fi

  printf "deploy %-40s ... " "$name"
  if supabase functions deploy "$name" --project-ref "$DR_REF" --no-verify-jwt >/tmp/dr-deploy.log 2>&1; then
    echo "ok"
    ok+=("$name")
  else
    echo "FAIL"
    failed+=("$name")
    tail -5 /tmp/dr-deploy.log | sed 's/^/    /'
  fi
done

echo
echo "Summary: ${#ok[@]} deployed, ${#failed[@]} failed"
if [ "${#failed[@]}" -gt 0 ]; then
  printf 'Failed: %s\n' "${failed[@]}"
  exit 1
fi
