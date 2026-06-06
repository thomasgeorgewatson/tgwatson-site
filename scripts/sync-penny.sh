#!/usr/bin/env bash
# Sync the Home Depot penny-tracker deals feed into this site and deploy via GitHub Pages.
# Copies penny-tracker/deals.json into the unlisted penny page, and commits + pushes only
# when the data actually changed. Idempotent and quiet when there is nothing new.
set -euo pipefail

SRC="/Users/tw/Documents/Claude/penny-tracker/deals.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REL="penny-5e8b2d/data.json"
DEST="$REPO_DIR/$REL"

if [ ! -f "$SRC" ]; then
  echo "sync-penny: source not found: $SRC" >&2
  exit 1
fi

cp "$SRC" "$DEST"

cd "$REPO_DIR"

# Nothing changed for this file -> done (no empty commit).
if [ -z "$(git status --porcelain -- "$REL")" ]; then
  exit 0
fi

git add -- "$REL"
git commit -q -m "penny: refresh data" -- "$REL"
git push -q

echo "sync-penny: pushed updated data ($REL)"
