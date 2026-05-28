# Reverse-Split Tracker — unlisted page

Slug: `tracker-bbd24e` (random, unguessable). Lives at `/tracker-bbd24e/`.

## Build
- [x] Create `tracker-bbd24e/index.html` — page shell: reuses `/css/style.css` + `/js/site.js`
      (theme toggle, reveal, page-nav, container). Adds `noindex,nofollow` meta. Static filter
      controls. Links scoped `tracker.css` + `tracker.js`.
- [x] Create `tracker-bbd24e/tracker.css` — scoped table / filter / badge styles using the site's
      design tokens (no dark dev-tool styling). Responsive (stacked cards on mobile). Theme-aware badges.
- [x] Create `tracker-bbd24e/tracker.js` — fetch sibling `data.json`, render 4 sections, wire filters.
- [x] Copy current `dashboard_data.json` -> `tracker-bbd24e/data.json` (initial, so first deploy has data).
- [x] Create `robots.txt` at site root — `Disallow: /tracker-bbd24e/`.
- [x] Create `scripts/sync-tracker.sh` (chmod +x) — copy data, commit+push only if changed, idempotent.

## Sections (skip if empty in data)
1. Upcoming — status==upcoming, sort eff_iso asc
2. Pending (vote/TBD) — status==pending_tbd, sort sent_at desc
3. Recently Effective — status==effective, sort eff_iso desc
4. Dropped / LOW — status==dropped, hidden behind toggle by default
(Exclude status==aged)

## Filters (vanilla JS)
- Score checkboxes HIGH/MED/PREBUY/LOW (LOW off by default)
- Treatment dropdown (populated from data)
- Ticker search box
- "Show dropped" toggle
- Header shows `updated` + `counts`

## Columns
Ticker · Ratio · Eff Date · Days · Cur->Post · TA · Treatment · Score (badge) · Filed · EDGAR link (_blank)

## Verify
- [x] Local preview: sections render, sort correct, filters work, dark mode + mobile OK
- [x] noindex meta + robots.txt present; page NOT linked from nav/home/projects
- [x] Commit page infra + initial data.json + script + robots; push (Pages auto-deploys)
- [x] Run `bash scripts/sync-tracker.sh` by hand — confirm idempotent no-op when unchanged
- [x] Confirm tgwatson.com/tracker-bbd24e/ serves the page live; report final URL

## Review
**Done & live at https://tgwatson.com/tracker-bbd24e/** (HTTP 200; data.json 200; robots serving).

What was built:
- New unlisted page at `/tracker-bbd24e/` reusing `/css/style.css` + `/js/site.js` (theme toggle,
  reveals, page-nav). Scoped `tracker.css` (badges/table/responsive) + `tracker.js` (fetch + render +
  filters). Nothing imported from the dark `dashboard.html`.
- 4 sections with required sorts: Upcoming (eff_iso asc), Pending (sent_at desc), Effective
  (eff_iso desc), Dropped (hidden behind toggle). `aged` excluded. Empty-in-data sections skipped.
- Filters: score checkboxes (LOW off by default), treatment dropdown (populated from data), ticker
  search, show-dropped toggle. Header shows `updated` + counts.
- `robots.txt` Disallow + `noindex,nofollow` meta; not linked from nav/home/projects/blog.
- `scripts/sync-tracker.sh`: copies feed, commits+pushes only on change, idempotent no-op otherwise.

Verified in preview: section render + sort, all filters, light/dark themes, mobile stacked cards,
zero console errors. Verified live via curl. Sync script verified as a clean no-op (exit 0, no commit).

Design decision (not in spec): the "show dropped" toggle is the master switch for the Dropped bucket,
so the score checkboxes (LOW off by default) do NOT re-hide its rows — otherwise toggling "show
dropped" would reveal an empty section, since every dropped record is LOW-scored.

Residual notes:
- The copy→commit→push branch of the sync script wasn't live-fired (data hadn't changed); it's the
  same git sequence used for the deploy push and will run automatically on the next scan.
- GitHub Pages serves all repo files, so `/tasks/todo.md`, `/scripts/sync-tracker.sh`, and `/robots.txt`
  are publicly readable and mention the slug. The slug is already exposed via the required robots.txt
  Disallow, so this doesn't change the protection model (noindex + unlisted + unguessable), but if you
  want zero slug references in served files, move tasks/ + scripts/ out of the Pages-served tree.
