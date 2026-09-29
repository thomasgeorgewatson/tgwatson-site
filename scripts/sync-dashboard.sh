#!/usr/bin/env bash
# Rebuild the /dashboard/ snapshot and deploy via GitHub Pages.
# Live quotes come from the browser; this refreshes FRED, bars, earnings, FOMC and headlines.
# Commits + pushes only when data.json actually changed. A failed build (exit 1) leaves the
# existing snapshot in place and pushes nothing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REL="dashboard/data.json"

python3 "$SCRIPT_DIR/build-dashboard.py"

cd "$REPO_DIR"
if [ -z "$(git status --porcelain -- "$REL")" ]; then
  exit 0
fi

git add -- "$REL"
git commit -q -m "dashboard: refresh data" -- "$REL"
git push -q

echo "sync-dashboard: pushed updated data ($REL)"
