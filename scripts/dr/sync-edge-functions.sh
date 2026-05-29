#!/usr/bin/env bash
# scripts/dr/sync-edge-functions.sh
# v1.1.0 — Deploy every edge function under supabase/functions/ to the DR project.
#
# Prereqs:
#   - supabase CLI installed/logged in OR $DR_SUPABASE_ACCESS_TOKEN available
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

if [ -n "${DR_SUPABASE_ACCESS_TOKEN:-}" ] && [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  export SUPABASE_ACCESS_TOKEN="$DR_SUPABASE_ACCESS_TOKEN"
fi

if command -v supabase >/dev/null 2>&1; then
  CLI=(supabase)
else
  CLI=(bunx supabase)
fi

if [ ! -d "$FUNCTIONS_DIR" ]; then
  echo "No supabase/functions directory at $FUNCTIONS_DIR" >&2
  exit 1
fi

cd "$ROOT"

echo "Syncing edge functions to standby project: $DR_REF"
echo

mapfile -t local_functions < <(find "$FUNCTIONS_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sed '/^_shared$/d;/^_/d' | sort)

"${CLI[@]}" functions deploy --project-ref "$DR_REF" --use-api --jobs 4 --prune
"${CLI[@]}" functions list --project-ref "$DR_REF" -o json > /tmp/dr-edge-functions.json

python3 - <<'PY' "${local_functions[@]}"
import json
import sys
from pathlib import Path

local = sorted(sys.argv[1:])
remote_data = json.loads(Path('/tmp/dr-edge-functions.json').read_text())
remote = sorted({row.get('slug') or row.get('name') for row in remote_data if row.get('slug') or row.get('name')})
missing = sorted(set(local) - set(remote))
extra = sorted(set(remote) - set(local))

print()
print(f"Local functions: {len(local)}")
print(f"Standby functions: {len(remote)}")
print("Missing on standby: " + (", ".join(missing) if missing else "none"))
print("Extra on standby: " + (", ".join(extra) if extra else "none"))

if missing or extra:
    raise SystemExit(1)
PY
