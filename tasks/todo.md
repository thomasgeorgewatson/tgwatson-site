# Reverse-Split Tracker — unlisted page

Slug: `tracker-bbd24e` (random, unguessable). Lives at `/tracker-bbd24e/`.

## Build
- [ ] Create `tracker-bbd24e/index.html` — page shell: reuses `/css/style.css` + `/js/site.js`
      (theme toggle, reveal, page-nav, container). Adds `noindex,nofollow` meta. Static filter
      controls. Links scoped `tracker.css` + `tracker.js`.
- [ ] Create `tracker-bbd24e/tracker.css` — scoped table / filter / badge styles using the site's
      design tokens (no dark dev-tool styling). Responsive (stacked cards on mobile). Theme-aware badges.
- [ ] Create `tracker-bbd24e/tracker.js` — fetch sibling `data.json`, render 4 sections, wire filters.
- [ ] Copy current `dashboard_data.json` -> `tracker-bbd24e/data.json` (initial, so first deploy has data).
- [ ] Create `robots.txt` at site root — `Disallow: /tracker-bbd24e/`.
- [ ] Create `scripts/sync-tracker.sh` (chmod +x) — copy data, commit+push only if changed, idempotent.

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
- [ ] Local preview: sections render, sort correct, filters work, dark mode + mobile OK
- [ ] noindex meta + robots.txt present; page NOT linked from nav/home/projects
- [ ] Commit page infra + initial data.json + script + robots; push (Pages auto-deploys)
- [ ] Run `bash scripts/sync-tracker.sh` by hand — confirm idempotent no-op when unchanged
- [ ] Confirm tgwatson.com/tracker-bbd24e/ serves the page live; report final URL

## Review
(filled in on completion)
