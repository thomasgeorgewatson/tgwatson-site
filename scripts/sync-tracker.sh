#!/usr/bin/env bash
# Sync the reverse-split-arb data feed into this site and deploy via GitHub Pages.
# Copies the scanner's dashboard_data.json into the unlisted tracker page, and
# commits + pushes only when the data actually changed. Idempotent and quiet
# when there is nothing new (exits 0 without an empty commit).
set -euo pipefail

SRC="/Users/tw/Documents/Claude/reverse-split-arb/dashboard_data.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REL="tracker-bbd24e/data.json"
DEST="$REPO_DIR/$REL"

if [ ! -f "$SRC" ]; then
  echo "sync-tracker: source not found: $SRC" >&2
  exit 1
fi

cp "$SRC" "$DEST"

cd "$REPO_DIR"

# Nothing changed (working tree matches index/HEAD for this file) -> done.
if [ -z "$(git status --porcelain -- "$REL")" ]; then
  exit 0
fi

git add -- "$REL"
git commit -q -m "tracker: refresh data" -- "$REL"
git push -q

echo "sync-tracker: pushed updated data ($REL)"
