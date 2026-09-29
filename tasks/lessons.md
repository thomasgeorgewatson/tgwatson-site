# Lessons — tgwatson-site

- **[Data feeds]** (2026-09): FRED `fredgraph.csv` resets the HTTP/2 stream (curl exit 92) for ANY custom User-Agent, browser-like or not — call it with curl's default UA. Multi-id requests (`id=A,B`) only work for same-frequency series, and `cosd` binds only the first id, so trim dates client-side. Learned from: dashboard build, all FRED calls failing under a Chrome UA.
- **[Data feeds]** (2026-09): Yahoo's chart API 429s plain curl from this Mac; CNBC's `quote.cnbc.com/.../restQuote` and `ts-api.cnbc.com/harmony/app/charts/{1D,5D,1M,6M,1Y}.json` answer with `Access-Control-Allow-Origin: *`, so a static Pages site can poll live quotes straight from the browser. The CNBC "1Y" chart over-delivers (~2 yrs) — trim it. Learned from: dashboard build.
