#!/usr/bin/env python3
"""Build dashboard/data.json -- the snapshot layer behind /dashboard/.

The page pulls LIVE quotes itself from CNBC (its quote + chart feeds are CORS-open).
This script gathers what a browser can't reach: FRED history (rates, housing, metro
listings), 1-year price bars, next earnings dates (Nasdaq), the FOMC calendar
(federalreserve.gov) and a headline wire (Google News RSS).

Every fetch shells to curl: the system python here has no SSL roots, and urllib's
timeout doesn't bound a wedged HTTPS read. Any single source failing is logged and
skipped -- the page renders whatever arrived.

Run:  python3 scripts/build-dashboard.py            (writes dashboard/data.json)
"""
import csv, io, json, re, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from xml.etree import ElementTree as ET

OUT = Path(__file__).resolve().parent.parent / "dashboard" / "data.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
TODAY = date.today()
errors = []


def get(url, tries=3, ua=UA):
    for i in range(tries):
        try:
            r = subprocess.run(["curl", "-sS", "-f", "-m", "30"] + (["-A", ua] if ua else []) + [url],
                               capture_output=True, timeout=45)
            if r.returncode == 0 and r.stdout:
                return r.stdout.decode("utf-8", "replace")
        except subprocess.TimeoutExpired:
            pass
        time.sleep(1.5 * (i + 1))
    errors.append(url)
    return None


# ---------------------------------------------------------------- universe
# block: A production builders, B land & capital, C manufactured, supply & mortgage
TICKERS = [
    ("DHI", "A"), ("LEN", "A"), ("PHM", "A"), ("NVR", "A"), ("TOL", "A"),
    ("KBH", "A"), ("MTH", "A"), ("MHO", "A"), ("CCS", "A"), ("GRBK", "A"),
    ("LGIH", "A"), ("DFH", "A"), ("BZH", "A"), ("HOV", "A"),
    ("FOR", "B"), ("JOE", "B"), ("HHH", "B"), ("FPH", "B"), ("BN", "B"),
    ("SKY", "C"), ("CVCO", "C"), ("BLDR", "C"), ("RKT", "C"),
]
BENCH = ["ITB", "XHB", ".SPX", ".VIX", "@LBR.1", "US10Y", "US2Y", "US30Y", "US3M", "US5Y"]

# ---------------------------------------------------------------- FRED
def years_ago(n):
    return (TODAY - timedelta(days=int(365.25 * n))).isoformat()

FRED = {
    # id: (title, units, start)
    "OBMMIC30YF": ("30-yr conforming (Optimal Blue)", "%", years_ago(3)),
    "OBMMIFHA30YF": ("30-yr FHA (Optimal Blue)", "%", years_ago(3)),
    "OBMMIJUMBO30YF": ("30-yr jumbo (Optimal Blue)", "%", years_ago(3)),
    "MORTGAGE30US": ("30-yr fixed (Freddie Mac PMMS)", "%", years_ago(12)),
    "MORTGAGE15US": ("15-yr fixed (Freddie Mac PMMS)", "%", years_ago(12)),
    "DGS10": ("10-yr Treasury", "%", years_ago(3)),
    "DGS2": ("2-yr Treasury", "%", years_ago(3)),
    "DFEDTARU": ("Fed funds target, upper", "%", years_ago(3)),
    "HOUST1F": ("Single-family starts", "k SAAR", years_ago(12)),
    "PERMIT1": ("Single-family permits", "k SAAR", years_ago(12)),
    "HSN1F": ("New home sales", "k SAAR", years_ago(12)),
    "MSACSR": ("Months' supply, new homes", "months", years_ago(12)),
    "MSPNHSUS": ("Median new home price", "$", years_ago(12)),
    "NHFSEPUCS": ("Completed new homes for sale", "k", years_ago(12)),
    "CSUSHPINSA": ("Case-Shiller national index", "index", years_ago(12)),
    "FLBPPRIVSA": ("Florida permits, all units", "units", years_ago(12)),
}
CURVE = ["DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3", "DGS5", "DGS7",
         "DGS10", "DGS20", "DGS30"]
CURVE_YRS = [1/12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30]

# Realtor.com metro series on FRED, keyed by CBSA. Chosen from where the deals are.
METROS = [
    ("45300", "Tampa", "FL"), ("36740", "Orlando", "FL"), ("35840", "Sarasota", "FL"),
    ("37340", "Palm Bay", "FL"), ("36100", "Ocala", "FL"), ("38940", "Port St. Lucie", "FL"),
    ("19660", "Daytona", "FL"), ("29460", "Lakeland", "FL"), ("39460", "Punta Gorda", "FL"),
    ("27260", "Jacksonville", "FL"), ("33100", "Miami", "FL"),
    ("12060", "Atlanta", "GA"), ("42340", "Savannah", "GA"), ("25940", "Hilton Head", "SC"),
    ("16700", "Charleston", "SC"), ("16740", "Charlotte", "NC"), ("39580", "Raleigh", "NC"),
    ("34980", "Nashville", "TN"),
]
METRO_SERIES = {"MEDLISPRI": "price", "ACTLISCOU": "active", "MEDDAYONMAR": "dom",
                "PRIREDCOU": "cuts"}


FRED_GATE = threading.Semaphore(3)  # FRED drops bursts of parallel requests


def fred(ids, start):
    """One CSV request for several series sharing a start date -> {id: [[date, v], ...]}."""
    with FRED_GATE:
        txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={','.join(ids)}&cosd={start}",
                  ua=None)  # FRED resets the stream for any UA but curl's own
    if not txt or not txt.startswith("observation_date"):
        if txt is not None:
            errors.append(f"FRED {ids}: bad payload")
        return {}
    rows = list(csv.reader(io.StringIO(txt)))
    out = {sid: [] for sid in rows[0][1:]}
    for row in rows[1:]:
        for sid, cell in zip(rows[0][1:], row[1:]):
            if cell not in ("", ".") and row[0] >= start:  # cosd only binds the 1st id
                v = float(cell)
                out[sid].append([row[0], round(v, 4) if abs(v) < 1000 else round(v)])
    return out


def curve_snapshots(series):
    """Yield curve today, ~1 month ago and ~1 year ago from each tenor's history."""
    snaps = {}
    for label, days in (("now", 0), ("1m", 30), ("1y", 365)):
        target = (TODAY - timedelta(days=days)).isoformat()
        pts, asof = [], None
        for sid, yrs in zip(CURVE, CURVE_YRS):
            obs = [p for p in series.get(sid, []) if p[0] <= target]
            if obs:
                pts.append([yrs, obs[-1][1]])
                asof = max(asof or "", obs[-1][0])
        snaps[label] = {"asof": asof, "points": pts}
    return snaps


# ---------------------------------------------------------------- CNBC
def cnbc_quotes(symbols):
    url = ("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols="
           + "%7C".join(s.replace("@", "%40") for s in symbols)
           + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json")
    txt = get(url)
    if not txt:
        return {}
    keep = ("name", "last", "change", "change_pct", "previous_day_closing", "mktcapView",
            "pe", "fpe", "yrhiprice", "yrloprice", "dividendyield", "beta", "last_time",
            "curmktstatus", "type")
    out = {}
    for q in json.loads(txt)["FormattedQuoteResult"]["FormattedQuote"]:
        if q.get("code") == 0:
            out[q["symbol"]] = {k: q.get(k) for k in keep if q.get(k) is not None}
    return out


def cnbc_bars(sym):
    txt = get(f"https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol={sym.replace('@', '%40')}")
    try:
        bars = json.loads(txt)["barData"]["priceBars"]
    except (TypeError, ValueError, KeyError):
        errors.append(f"bars {sym}")
        return []
    cut = years_ago(1.05)
    out = []
    for b in bars:
        d = f"{b['tradeTime'][:4]}-{b['tradeTime'][4:6]}-{b['tradeTime'][6:8]}"
        if d >= cut:
            out.append([d, round(float(b["close"]), 3)])
    return out


# ---------------------------------------------------------------- Nasdaq earnings
def next_earnings(sym):
    txt = get(f"https://api.nasdaq.com/api/analyst/{sym}/earnings-date")
    if not txt:
        return None
    try:
        rpt = json.loads(txt)["data"]["reportText"] or ""
    except (ValueError, KeyError, TypeError):
        return None
    m = re.search(r"on\s+(\d{1,2})/(\d{1,2})/(\d{4})\s*(before|after)?", rpt)
    if not m:
        return None
    d = date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    if d < TODAY - timedelta(days=3):
        return None
    when = {"before": "pre-market", "after": "after close"}.get(m.group(4) or "", "")
    return {"date": d.isoformat(), "when": when,
            "confirmed": "expected*" not in rpt}


# ---------------------------------------------------------------- FOMC
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}


def fomc():
    txt = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")
    if not txt:
        return []
    out = []
    for yr in (TODAY.year, TODAY.year + 1):
        i = txt.find(f"{yr} FOMC Meetings")
        if i < 0:
            continue
        j = txt.find(f"{yr - 1} FOMC Meetings", i)
        seg = txt[i: j if j > i else i + 40000]
        for mon, days in re.findall(
                r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<',
                seg, re.S):
            mon = mon.split("/")[-1].strip()
            nums = re.findall(r"\d+", days)
            if mon in MONTHS and nums:
                d = date(yr, MONTHS[mon], int(nums[-1]))
                if d >= TODAY - timedelta(days=1):
                    out.append({"date": d.isoformat(), "sep": "*" in days})
    return sorted(out, key=lambda e: e["date"])


# ---------------------------------------------------------------- news
NEWS_QUERIES = [
    ("builders", "homebuilder OR homebuilders when:3d"),
    ("builders", '"D.R. Horton" OR Lennar OR PulteGroup OR "Toll Brothers" OR NVR when:4d'),
    ("builders", '"KB Home" OR "Meritage Homes" OR "M/I Homes" OR "Century Communities" OR "Dream Finders" OR "LGI Homes" when:7d'),
    ("rates", '"mortgage rates" when:2d'),
    ("rates", '"Treasury yields" OR "Federal Reserve" rates when:2d'),
    ("housing", '"housing starts" OR "new home sales" OR "pending home sales" OR "existing home sales" when:7d'),
    ("florida", 'Florida housing market OR "Florida homebuilders" when:7d'),
    ("land", '"land development" OR "lot supply" OR "finished lots" OR "land banking" homebuilder when:14d'),
    ("land", 'Forestar OR "St. Joe Company" OR "Howard Hughes" OR "Brookfield Residential" when:10d'),
]
TAGS = {  # headline keyword -> ticker
    "D.R. Horton": "DHI", "DR Horton": "DHI", "Lennar": "LEN", "Pulte": "PHM", "NVR": "NVR",
    "Toll Brothers": "TOL", "KB Home": "KBH", "Meritage": "MTH", "M/I Homes": "MHO",
    "Century Communities": "CCS", "Green Brick": "GRBK", "LGI Homes": "LGIH",
    "Dream Finders": "DFH", "Beazer": "BZH", "Hovnanian": "HOV", "Forestar": "FOR",
    "St. Joe Co": "JOE", "St. Joe Company": "JOE", "(JOE)": "JOE", "Howard Hughes": "HHH", "Five Point": "FPH", "Brookfield": "BN",
    "Champion Homes": "SKY", "Cavco": "CVCO", "Builders FirstSource": "BLDR", "Rocket": "RKT",
}


# a headline must touch the business; Google's OR queries drift (bitcoin, gold, prep schools)
RELEVANT = re.compile(r"home|housing|mortgage|builder|rate|yield|treasur|fed\b|federal reserve|lot\b|lots\b|land|"
                      r"construction|real estate|permit|lumber|apartment|rent|develop|communit|acre|zoning|stock|shares|earnings",
                      re.I)
EXCLUDE = re.compile(r"canad|ottawa|australia|\bu\.?k\.?\b|britain|england|europe|london|n\.b\.|india|shanghai|china|"
                     r"hungry ghost|bitcoin|crypto|\bgold\b|farmer|\bprep\b|school|universit|varsity|volleyball|"
                     r"st\. joe's|county candidates", re.I)


def news():
    items, seen = [], set()
    for topic, q in NEWS_QUERIES:
        txt = get("https://news.google.com/rss/search?q=" + q.replace(" ", "+").replace('"', "%22")
                  + "&hl=en-US&gl=US&ceid=US:en")
        if not txt:
            continue
        try:
            root = ET.fromstring(txt)
        except ET.ParseError:
            errors.append(f"news parse {topic}")
            continue
        for it in root.iter("item"):
            title = unescape(it.findtext("title") or "")
            src = it.findtext("source") or ""
            if src and title.endswith(" - " + src):
                title = title[: -len(src) - 3]
            key = re.sub(r"[^a-z0-9]", "", title.lower())[:70]
            if not title or key in seen or not RELEVANT.search(title) or EXCLUDE.search(title):
                continue
            seen.add(key)
            try:
                ts = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
            except (TypeError, ValueError):
                continue
            tickers = sorted({t for k, t in TAGS.items() if k.lower() in title.lower()})
            items.append({"t": title, "src": src, "url": it.findtext("link"),
                          "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "topic": topic,
                          "tickers": tickers})
    items.sort(key=lambda x: x["ts"], reverse=True)
    per = {}  # cap each ticker, then each topic, so one busy story can't bury the rest
    items = [i for i in items if not i["tickers"] or
             per.setdefault(i["tickers"][0], []).append(i) or len(per[i["tickers"][0]]) <= 3]
    items = [i for i in items if per.setdefault(i["topic"], []).append(i) or len(per[i["topic"]]) <= 18]
    return items[:90]


# ---------------------------------------------------------------- main
def main():
    t0 = time.time()
    jobs = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for sid, (_, _, start) in FRED.items():  # mixed frequencies can't share a CSV
            jobs[("fred", sid)] = ex.submit(fred, [sid], start)
        jobs[("curve", "")] = ex.submit(fred, CURVE, years_ago(1.2))
        for cbsa, _, _ in METROS:
            jobs[("metro", cbsa)] = ex.submit(fred, [p + cbsa for p in METRO_SERIES], years_ago(4))
        for sym, _ in TICKERS:
            jobs[("bars", sym)] = ex.submit(cnbc_bars, sym)
            jobs[("earn", sym)] = ex.submit(next_earnings, sym)
        for sym in ("ITB", "XHB", ".SPX", "US10Y", "@LBR.1"):
            jobs[("bars", sym)] = ex.submit(cnbc_bars, sym)
        quotes_f = ex.submit(cnbc_quotes, [s for s, _ in TICKERS] + BENCH)
        fomc_f = ex.submit(fomc)
        news_f = ex.submit(news)

    res = {k: f.result() for k, f in jobs.items()}
    fred_all = {}
    for k, v in res.items():
        if k[0] in ("fred", "metro"):
            fred_all.update(v)
    fred_out = {sid: {"title": FRED[sid][0], "units": FRED[sid][1], "obs": fred_all[sid]}
                for sid in FRED if fred_all.get(sid)}
    metros = []
    for cbsa, name, st in METROS:
        m = {"cbsa": cbsa, "name": name, "state": st}
        for pre, key in METRO_SERIES.items():
            m[key] = fred_all.get(pre + cbsa, [])
        metros.append(m)

    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "universe": [{"sym": s, "block": b} for s, b in TICKERS],
        "quotes": quotes_f.result(),
        "bars": {k[1]: v for k, v in res.items() if k[0] == "bars" and v},
        "earnings": {k[1]: v for k, v in res.items() if k[0] == "earn" and v},
        "fred": fred_out,
        "curve": curve_snapshots(res[("curve", "")]),
        "metros": metros,
        "fomc": fomc_f.result(),
        "news": news_f.result(),
        "errors": errors,
    }
    # never replace a good snapshot with a hollow one: the page leans on these three
    missing = [k for k, ok in (("quotes", data["quotes"]), ("FRED", fred_out.get("OBMMIC30YF")),
                               ("metros", any(m["active"] for m in metros))) if not ok]
    if missing:
        print(f"build-dashboard: ABORT, no {', '.join(missing)}; kept the existing {OUT.name}", file=sys.stderr)
        for e in errors:
            print("  miss:", e, file=sys.stderr)
        sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"build-dashboard: {OUT.stat().st_size/1024:.0f} KB in {time.time()-t0:.0f}s; "
          f"{len(data['quotes'])} quotes, {len(data['bars'])} bar sets, {len(fred_out)} FRED, "
          f"{len(data['earnings'])} earnings, {len(data['fomc'])} FOMC, {len(data['news'])} headlines; "
          f"{len(errors)} errors", file=sys.stderr)
    for e in errors:
        print("  miss:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
