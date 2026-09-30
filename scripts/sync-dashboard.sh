#!/usr/bin/env bash
# Rebuild the /dashboard/ snapshot and deploy via GitHub Pages.
#   sync-dashboard.sh         full snapshot: FRED, bars, earnings, FOMC, releases, headlines (every 2h)
#   sync-dashboard.sh news    headlines only -> dashboard/news.json (every 30 min)
# Live quotes come from the browser. Commits + pushes only when the output changed. A failed
# build (exit 1) leaves the existing files in place and pushes nothing.
set -euo pipefail
MODE="${1:-full}"
echo "sync-dashboard ($MODE): $(date '+%F %T')"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# the two jobs share one repo; take turns (mkdir is atomic)
LOCK=/tmp/tgwatson-dashboard-sync.lock
for _ in $(seq 1 120); do mkdir "$LOCK" 2>/dev/null && break; sleep 1; done
[ -d "$LOCK" ] || { echo "sync-dashboard: lock busy, skipping"; exit 0; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

if [ "$MODE" = news ]; then
  python3 "$SCRIPT_DIR/build-dashboard.py" --news
  PATHS=(dashboard/news.json); MSG="dashboard: refresh headlines"
else
  python3 "$SCRIPT_DIR/build-dashboard.py"
  PATHS=(dashboard/data.json dashboard/news.json); MSG="dashboard: refresh data"
fi

cd "$REPO_DIR"
if [ -z "$(git status --porcelain -- "${PATHS[@]}")" ]; then
  exit 0
fi

git add -- "${PATHS[@]}"
git commit -q -m "$MSG" -- "${PATHS[@]}"
# the tracker sync pushes to the same branch; replay on top of whatever landed first
git pull -q --rebase --autostash
git push -q

echo "sync-dashboard: pushed ($MSG)"
