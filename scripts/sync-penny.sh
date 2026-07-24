#!/usr/bin/env bash
# Sync the Home Depot penny-tracker deals feed into this site and deploy via GitHub Pages.
# Copies penny-tracker/deals.json into the penny page, and commits + pushes only when the
# data actually changed. Idempotent and quiet when there is nothing new.
#
# NOT SCHEDULED. Nothing has run this since 2026-06-06, and the page it feeds is now
# published as an ARCHIVED SNAPSHOT under /projects/. Running this would un-freeze that
# artifact — which is fine if you're reviving the tracker, but check the scraper still
# works first, and drop the .archive-note from projects/penny-tracker/index.html.
set -euo pipefail

SRC="/Users/tw/Documents/Claude/penny-tracker/deals.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REL="projects/penny-tracker/data.json"
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
