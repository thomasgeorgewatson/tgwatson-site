/* tgwatson.com/dashboard — Housing desk
   Snapshot (data.json, built by scripts/build-dashboard.py) + live CNBC quotes and intraday bars
   polled from the browser. No libraries: every chart is hand-drawn SVG.

   Everything with a value opens one detail panel, addressed by a ref that also lives in the URL hash:
     q:SYMBOL   any quote (builder, ETF, index, Treasury, futures)     e.g. #q:@LBR.1
     f:FRED_ID  any FRED series in the snapshot                       e.g. #f:HOUST1F
     m:CBSA     a metro from Your markets                             e.g. #m:45300
     mort, fed  the live mortgage rate and the Fed
   Words for each panel live in notes.js. */
(function () {
  'use strict';

  // ------------------------------------------------------------ plumbing
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  var NOTES = window.HD_NOTES || {};

  var QUOTE_URL = function (syms) {
    return 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
      syms.map(encodeURIComponent).join('%7C') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
  };
  var BARS_URL = function (sym, src) {
    return 'https://ts-api.cnbc.com/harmony/app/charts/' + src + '.json?symbol=' + encodeURIComponent(sym);
  };

  var NAMES = {
    DHI: 'D.R. Horton', LEN: 'Lennar', PHM: 'PulteGroup', NVR: 'NVR', TOL: 'Toll Brothers',
    KBH: 'KB Home', MTH: 'Meritage Homes', MHO: 'M/I Homes', CCS: 'Century Communities',
    GRBK: 'Green Brick Partners', LGIH: 'LGI Homes', DFH: 'Dream Finders Homes', BZH: 'Beazer Homes',
    HOV: 'Hovnanian', FOR: 'Forestar', JOE: 'St. Joe', HHH: 'Howard Hughes', FPH: 'Five Point',
    BN: 'Brookfield Corp', SKY: 'Champion Homes', CVCO: 'Cavco', BLDR: 'Builders FirstSource',
    RKT: 'Rocket Companies', ITB: 'iShares Home Construction', XHB: 'SPDR Homebuilders',
    '.SPX': 'S&P 500', '.RUT': 'Russell 2000', '.VIX': 'VIX', '.DXY': 'Dollar index', KRE: 'Regional banks ETF', MBB: 'Mortgage bonds ETF',
    US10Y: '10-yr Treasury', US2Y: '2-yr Treasury', US30Y: '30-yr Treasury', US3M: '3-mo bill', US5Y: '5-yr Treasury',
    '@LBR.1': 'Lumber futures', '@HG.1': 'Copper futures', '@HRC.1': 'Hot-rolled steel futures', '@CL.1': 'WTI crude futures', '@HO.1': 'Diesel futures'
  };
  var BLOCKS = { A: 'Production builders', B: 'Land and capital', C: 'Manufactured, supply, mortgage' };
  var GROUPS = [['rates', 'Rates'], ['stocks', 'Stocks'], ['costs', 'Materials']];
  var METRICS = [['1d', 'Today', 4], ['1m', '1 month', 15], ['ytd', 'Year to date', 35], ['hi', 'Off 52-wk high', 50]];
  var TOPICS = [['all', 'All'], ['builders', 'Builders'], ['rates', 'Rates'], ['housing', 'Housing data'], ['florida', 'Florida'], ['land', 'Land'], ['costs', 'Costs']];
  var STATES = [['all', 'All'], ['FL', 'Florida'], ['GA SC NC', 'Georgia and Carolinas'], ['TN', 'Tennessee']];
  var DEFAULTS = { price: null, down: 10, ti: 2, lotLo: 20, lotHi: 35, bd: 1, bf: 15000 }; // finished lots run 20-35% of price
  var PERMITS = [['FLBPPRIVSA', 'Florida'], ['GABPPRIVSA', 'Georgia'], ['NCBPPRIVSA', 'North Carolina'], ['SCBPPRIVSA', 'South Carolina'], ['TNBPPRIVSA', 'Tennessee']];
  var STATE_PERMIT = { FL: 'f:FLBPPRIVSA', GA: 'f:GABPPRIVSA', NC: 'f:NCBPPRIVSA', SC: 'f:SCBPPRIVSA', TN: 'f:TNBPPRIVSA' };

  var S = {
    d: null, q: {}, intra: {}, intraAt: null, live: false, lastTick: null, status: null, booted: false,
    metric: store('hd-metric') || '1d', ref: store('hd-ref') || '1y', rate: null,
    view: store('hd-view') || 'plat', movers: '1d', lbSort: { k: '1d', dir: -1 },
    dirtOpen: !!store('hd-dirt'),
    a: Object.assign({}, DEFAULTS, store('hd-assume') || {}),
    topic: 'all', tickerFilter: null, st: 'all', sort: { k: 'activeYoy', dir: -1 },
    drawer: false, trail: [], dv: {}
  };

  // ------------------------------------------------------------ numbers
  function num(v) { return v == null ? NaN : parseFloat(String(v).replace(/[,%$+]/g, '')); }
  function qty(s) { // "1.2M", "845.3K", "12,345" -> number
    var m = /^\s*([\d.,]+)\s*([TBMK])?/i.exec(s == null ? '' : String(s));
    return m ? parseFloat(m[1].replace(/,/g, '')) * ({ T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[(m[2] || '').toUpperCase()] || 1) : NaN;
  }
  function mcap(s) {
    var m = /([\d.]+)\s*([TBMK])/.exec(s || '');
    return m ? parseFloat(m[1]) * { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[m[2]] : NaN;
  }
  var MINUS = '−';
  function signed(v, d, unit) {
    if (!isFinite(v)) return '–';
    var s = Math.abs(v).toFixed(d == null ? 2 : d);
    if (+s === 0) return s + (unit || '');
    return (v > 0 ? '+' : MINUS) + s + (unit || '');
  }
  function dir(v, text) {
    var c = v > 0 ? 'up' : v < 0 ? 'down' : '';
    var g = v > 0 ? '▲' : v < 0 ? '▼' : '';
    return '<span class="' + c + '"><span class="dir" aria-hidden="true">' + g + '</span> ' + text + '</span>';
  }
  function usd(v) { return isFinite(v) ? (v < 0 ? MINUS : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US') : '–'; }
  function usdK(v) {
    if (!isFinite(v)) return '–';
    var a = Math.abs(v), s = v < 0 ? MINUS : '';
    return a >= 1e6 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : s + '$' + Math.round(a / 1e3) + 'K';
  }
  function big(v) {
    if (!isFinite(v)) return '–';
    return v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : '$' + (v / 1e6).toFixed(0) + 'M';
  }
  function px(v) {
    if (!isFinite(v)) return '–';
    var d = Math.abs(v) < 10 ? 3 : 2;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function count(v) { return !isFinite(v) ? '–' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : Math.round(v).toLocaleString('en-US'); }
  function ms(iso) { return Date.parse(iso + 'T12:00:00Z'); }
  function dshort(iso) { return new Date(ms(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function dmonth(iso) { return new Date(ms(iso)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function dlong(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  function isoMinus(iso, days) { var d = new Date(ms(iso)); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
  function todayIso() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
  function daysTo(iso) { return Math.round((ms(iso) - ms(todayIso())) / 864e5); }
  function inDays(iso) { var n = daysTo(iso); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? -n + ' days ago' : 'in ' + n + ' days'; }
  function last(a) { return a && a.length ? a[a.length - 1] : null; }
  function at(obs, iso) { // last observation on or before iso (binary search)
    if (!obs || !obs.length || obs[0][0] > iso) return null;
    var lo = 0, hi = obs.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (obs[mid][0] <= iso) lo = mid; else hi = mid - 1; }
    return obs[lo];
  }
  function series(id) { return (S.d.fred[id] && S.d.fred[id].obs) || []; }
  function ago(iso) {
    var h = (Date.now() - Date.parse(iso)) / 36e5;
    return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm ago' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago';
  }
  function name(sym) { return NAMES[sym] || (S.q[sym] && S.q[sym].name) || sym; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : NaN; }
  function isYield(sym) { return /^US\d/.test(sym); }
  function toMs(pts) { return pts.map(function (p) { return [ms(p[0]), p[1]]; }); }
  function stepify(pts) { // compressed step series -> drawable steps
    var out = [];
    pts.forEach(function (p, i) { if (i) out.push([p[0], pts[i - 1][1]]); out.push(p); });
    return out;
  }

  // one quote, formatted
  function qv(sym) { return num(S.q[sym] && S.q[sym].last); }
  function fmtQ(sym, v) { return isYield(sym) ? (isFinite(v) ? v.toFixed(3) + '%' : '–') : px(v); }
  function lastStr(sym) {
    var q = S.q[sym] || {};
    return isYield(sym) ? fmtQ(sym, num(q.last)) : (q.last ? String(q.last) : '–');
  }
  function chgQ(sym, short) {
    var q = S.q[sym] || {};
    if (/UNCH/.test(String(q.change_pct) + q.change)) return '<span>unch</span>';
    if (isYield(sym)) { var c = num(q.change) * 100; return dir(c, signed(c, 1, ' bp')); }
    var p = num(q.change_pct);
    return dir(p, short ? signed(p, 2, '%') : signed(num(q.change), Math.abs(num(q.change)) < 1 ? 3 : 2) + ' (' + signed(p, 2, '%') + ')');
  }

  // ------------------------------------------------------------ rates model
  function rates() {
    var ob = series('OBMMIC30YF'), t10 = series('DGS10'), pm = series('MORTGAGE30US');
    var base = ob.length ? ob : pm;
    var print = last(base);
    var t10At = at(t10, print[0]);
    var spread = t10At ? print[1] - t10At[1] : NaN;
    var live10 = qv('US10Y');
    var now = isFinite(live10) && isFinite(spread) ? live10 + spread : print[1];
    var cut = isoMinus(print[0], 365), sum = 0, n = 0;
    for (var i = 0; i < ob.length; i++) {
      if (ob[i][0] < cut) continue;
      var t = at(t10, ob[i][0]);
      if (t) { sum += ob[i][1] - t[1]; n++; }
    }
    var low = pm.reduce(function (a, p) { return p[1] < a[1] ? p : a; }, pm[0]);
    var peak = pm.filter(function (p) { return p[0] >= '2022-01-01'; })
      .reduce(function (a, p) { return p[1] > a[1] ? p : a; }, pm[0]);
    return {
      now: now, print: print, spread: spread, spreadAvg: n ? sum / n : NaN,
      live10: isFinite(live10) ? live10 : (last(t10) || [])[1], liveOk: isFinite(live10),
      t10At: t10At, yrAgo: at(base, isoMinus(print[0], 365)), low: low, peak: peak
    };
  }
  function refs(R) {
    return [
      { k: 'today', label: 'Today', rate: R.now },
      { k: '1y', label: 'A year ago', rate: R.yrAgo[1], date: R.yrAgo[0] },
      { k: 'low', label: R.low[0].slice(0, 4) + ' low', rate: R.low[1], date: R.low[0] },
      { k: 'peak', label: R.peak[0].slice(0, 4) + ' peak', rate: R.peak[1], date: R.peak[0] }
    ];
  }
  function factor(r) { var i = r / 1200; return i === 0 ? 1 / 360 : i / (1 - Math.pow(1 + i, -360)); }
  function price() { return S.a.price || (last(series('MSPNHSUS')) || [0, 400000])[1]; }
  function payment(P, r) { return P * (1 - S.a.down / 100) * factor(r) + P * S.a.ti / 1200; }
  function lotShare() { var a = S.a.lotLo / 100, b = S.a.lotHi / 100; return [Math.min(a, b), Math.max(a, b)]; }
  function usdKRange(v, sh) { return usdK(v * sh[0]) + '\u2013' + usdK(v * sh[1]); }
  function afford(pay, r) { return pay / ((1 - S.a.down / 100) * factor(r) + S.a.ti / 1200); }

  // ------------------------------------------------------------ tooltip
  var tip = $('#tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = x + 16 + w > innerWidth - 8 ? x - w - 16 : x + 16;
    var top = y + 16 + h > innerHeight - 8 ? y - h - 12 : y + 16;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function row(k, v) { return '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>'; }

  // ------------------------------------------------------------ chart kit
  function niceTicks(a, b, n) {
    var span = b - a, step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = [];
    for (var v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function timeTicks(x0, x1, n, intraday) {
    var DAY = 864e5, span = x1 - x0, ticks = [], fmt, d;
    if (intraday && span < 2 * DAY) {
      var k = Math.max(1, Math.ceil(span / 36e5 / n));
      d = new Date(x0); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
      for (; d.getTime() <= x1; d.setHours(d.getHours() + k)) ticks.push(d.getTime());
      fmt = function (t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' }); };
    } else if (span > 700 * DAY) {
      var y0 = new Date(x0).getUTCFullYear() + 1, y1 = new Date(x1).getUTCFullYear();
      var ky = Math.max(1, Math.ceil((y1 - y0 + 1) / n));
      for (var y = y0; y <= y1; y += ky) ticks.push(Date.UTC(y, 0, 1));
      fmt = function (t) { return String(new Date(t).getUTCFullYear()); };
    } else if (span > 50 * DAY) {
      d = new Date(x0); var m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      var km = Math.max(1, Math.ceil(span / (30.4 * DAY) / n));
      for (; m.getTime() <= x1; m.setUTCMonth(m.getUTCMonth() + km)) ticks.push(m.getTime());
      fmt = function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
    } else {
      var kd = Math.max(1, Math.ceil(span / DAY / n));
      d = new Date(x0); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
      for (; d.getTime() <= x1; d.setDate(d.getDate() + kd)) ticks.push(d.getTime());
      fmt = function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
    }
    return { ticks: ticks, fmt: fmt };
  }
  function nearest(pts, t) {
    var lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (pts[mid][0] < t) lo = mid; else hi = mid; }
    return Math.abs(pts[lo][0] - t) <= Math.abs(pts[hi][0] - t) ? lo : hi;
  }
  function pathOf(pts, X, Y) {
    var d = '';
    for (var i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + X(pts[i][0]).toFixed(1) + ',' + Y(pts[i][1]).toFixed(1);
    return d;
  }
  function svgLocalX(svg, e, W) { var r = svg.getBoundingClientRect(); return (e.clientX - r.left) * (W / r.width); }

  /* Line chart. o.series: [{pts:[[ms,v]], cls, label, color, soft}], o.band: [i,j] shades between two series,
     o.yFmt, o.tip(msAt, values[]), o.endLabels, o.intraday, o.m (margins), o.hlines: [{v, cls, label}],
     o.yInclude: values the y-range must contain, o.area: shade under the first series */
  function lineChart(host, o) {
    host.innerHTML = '';
    var W = host.clientWidth, H = host.clientHeight;
    var ser = o.series.filter(function (s) { return s.pts && s.pts.length > 1; });
    if (!W || !H || !ser.length) return;
    var m = Object.assign({ t: 8, r: o.endLabels ? 70 : 10, b: 20, l: 42 }, o.m || {});
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    ser.forEach(function (s) { s.pts.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }); });
    (o.yInclude || []).concat((o.hlines || []).map(function (h) { return h.v; })).forEach(function (v) {
      if (isFinite(v)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    });
    var pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.02 || 1; y0 -= pad; y1 += pad;
    if (x1 === x0) x1 = x0 + 1;
    var X = function (t) { return m.l + (t - x0) / (x1 - x0) * (W - m.l - m.r); };
    var Y = function (v) { return m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria || '' }, host);
    var ax = el('g', { class: 'axis' }, svg);
    niceTicks(y0, y1, o.yTicks || 4).forEach(function (v) {
      el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, ax);
      el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, ax, o.yFmt(v));
    });
    var tt = timeTicks(x0, x1, o.xTicks || 4, o.intraday);
    tt.ticks.forEach(function (t) {
      if (X(t) < m.l + 12 || X(t) > W - m.r - 12) return;
      el('text', { x: X(t), y: H - 4, 'text-anchor': 'middle' }, ax, tt.fmt(t));
    });
    (o.hlines || []).forEach(function (h) {
      if (!isFinite(h.v)) return;
      el('line', { class: 'hline ' + (h.cls || ''), x1: m.l, x2: W - m.r, y1: Y(h.v), y2: Y(h.v) }, svg);
      if (h.label) el('text', { class: 'hline-label', x: m.l + 4, y: Y(h.v) - 4 }, svg, h.label);
    });
    if (o.area) {
      var a0 = ser[0].pts;
      el('path', { class: 'area', d: pathOf(a0, X, Y) + 'L' + X(last(a0)[0]).toFixed(1) + ',' + (H - m.b) + 'L' + X(a0[0][0]).toFixed(1) + ',' + (H - m.b) + 'Z' }, svg);
    }
    if (o.band) {
      var a = ser[o.band[0]].pts, bmap = {};
      ser[o.band[1]].pts.forEach(function (p) { bmap[p[0]] = p[1]; });
      var pair = a.filter(function (p) { return bmap[p[0]] != null; });
      if (pair.length > 1) {
        var d = pathOf(pair, X, Y);
        for (var i = pair.length - 1; i >= 0; i--) d += 'L' + X(pair[i][0]).toFixed(1) + ',' + Y(bmap[pair[i][0]]).toFixed(1);
        el('path', { class: 'band', d: d + 'Z' }, svg);
      }
    }
    ser.forEach(function (s) {
      el('path', { class: 'series ' + (s.cls || 's-ink'), d: pathOf(s.pts, X, Y), style: s.color ? 'stroke:' + s.color : null }, svg);
    });
    if (o.endLabels) {
      var labs = ser.map(function (s) { return { y: Y(last(s.pts)[1]), s: s }; }).sort(function (p, q) { return p.y - q.y; });
      for (var j = 1; j < labs.length; j++) if (labs[j].y - labs[j - 1].y < 15) labs[j].y = labs[j - 1].y + 15;
      labs.forEach(function (l) {
        el('text', { class: 'dlabel' + (l.s.soft ? ' soft' : ''), x: W - m.r + 7, y: l.y + 4 }, svg, l.s.label);
      });
    }
    if (o.markLast) {
      var lp = last(ser[0].pts);
      el('circle', { class: 'dot', cx: X(lp[0]), cy: Y(lp[1]), r: 3.5, style: 'fill:var(--ink)' }, svg);
    }
    if (!o.tip) return;
    // hover layer
    var xh = el('line', { class: 'xhair', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
    var dots = ser.map(function (s) {
      return el('circle', { class: 'dot', r: 4, visibility: 'hidden', style: 'fill:' + (s.color || (s.soft ? 'var(--ink-3)' : 'var(--ink)')) }, svg);
    });
    var hit = el('rect', { class: 'hit', x: m.l, y: 0, width: W - m.l - m.r, height: H }, svg);
    function move(e) {
      var t = x0 + (svgLocalX(svg, e, W) - m.l) / (W - m.l - m.r) * (x1 - x0);
      var base = ser[0].pts, t0 = base[nearest(base, t)][0];
      xh.setAttribute('x1', X(t0)); xh.setAttribute('x2', X(t0)); xh.setAttribute('visibility', 'visible');
      var vals = ser.map(function (s, k) {
        var p = s.pts[nearest(s.pts, t0)];
        dots[k].setAttribute('cx', X(p[0])); dots[k].setAttribute('cy', Y(p[1])); dots[k].setAttribute('visibility', 'visible');
        return p[1];
      });
      showTip(o.tip(t0, vals), e.clientX, e.clientY);
    }
    function leave() { xh.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); hideTip(); }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') move(e); });
    hit.addEventListener('pointerleave', leave);
  }

  // tiny inline sparkline; base draws a dashed reference (prior close)
  function sparkSvg(pts, o) {
    o = o || {};
    if (!pts || pts.length < 2) return '<svg class="' + (o.cls || 'spark') + '" aria-hidden="true"></svg>';
    var W = o.w || 140, H = o.h || 26, vs = pts.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (isFinite(o.base)) { lo = Math.min(lo, o.base); hi = Math.max(hi, o.base); }
    var t0 = pts[0][0], t1 = last(pts)[0] || t0 + 1;
    var X = function (t) { return 2 + (t - t0) / ((o.t1 || t1) - t0 || 1) * (W - 6); };
    var Y = function (v) { return 3 + (1 - (v - lo) / (hi - lo || 1)) * (H - 6); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('');
    var col = o.color || 'var(--ink)';
    var lp = last(pts);
    return '<svg class="' + (o.cls || 'spark') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      (isFinite(o.base) ? '<line x1="0" x2="' + W + '" y1="' + Y(o.base).toFixed(1) + '" y2="' + Y(o.base).toFixed(1) + '" stroke="var(--ink-3)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>' : '') +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + X(lp[0]).toFixed(1) + '" cy="' + Y(lp[1]).toFixed(1) + '" r="2.3" fill="' + col + '"/></svg>';
  }

  // ------------------------------------------------------------ title block + lede
  var STATUS = { REG_MKT: 'Open', PRE_MKT: 'Pre-market', POST_MKT: 'After hours', CLOSED: 'Closed' };
  function renderTitleblock() {
    var st = S.status;
    $('#tb-market').textContent = STATUS[st] || (st ? 'Closed' : 'Unknown');
    $('.tb-market').classList.toggle('is-open', st === 'REG_MKT');
    $('#tb-live').textContent = S.live && S.lastTick
      ? 'Live ' + S.lastTick.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
      : 'Snapshot only';
    var g = new Date(S.d.generated);
    $('#tb-snap').textContent = g.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
      g.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('#btn-theme').textContent = document.documentElement.getAttribute('data-theme') === 'study' ? 'Day' : 'Night';
    var day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    var sess = S.status === 'REG_MKT' ? 'regular session' : S.status === 'PRE_MKT' ? 'pre-market' : S.status === 'POST_MKT' ? 'after hours' : 'market closed';
    $('#today-note').textContent = day + ' \u00B7 ' + sess.charAt(0).toUpperCase() + sess.slice(1);
  }

  function renderLede() {
    var R = rates(), out = [];
    var dy = R.now - R.yrAgo[1];
    var s1 = 'The 30-year is running near <b>' + R.now.toFixed(2) + '%</b>, ' +
      Math.abs(dy * 100).toFixed(0) + ' bp ' + (dy >= 0 ? 'above' : 'below') + ' a year ago';
    var c10 = num(S.q.US10Y && S.q.US10Y.change) * 100;
    if (isFinite(c10)) s1 += Math.abs(c10) < 0.5 ? ', with the 10-year flat today' :
      ', with the 10-year ' + (c10 > 0 ? 'up ' : 'down ') + Math.abs(c10).toFixed(1) + ' bp today';
    out.push(s1 + '.');

    var A = S.d.universe.filter(function (u) { return u.block === 'A'; })
      .map(function (u) { return num(S.q[u.sym] && S.q[u.sym].change_pct); }).filter(isFinite);
    if (A.length) {
      var avg = mean(A);
      var spx = num(S.q['.SPX'] && S.q['.SPX'].change_pct);
      var verb = S.status === 'REG_MKT' ? 'are' : 'finished';
      var mover = S.d.universe.map(function (u) { return [u.sym, num(S.q[u.sym] && S.q[u.sym].change_pct)]; })
        .filter(function (p) { return isFinite(p[1]); })
        .sort(function (p, q) { return Math.abs(q[1]) - Math.abs(p[1]); })[0];
      var s2 = 'Builders ' + verb + ' <b>' + signed(avg, 1, '%') + '</b> as a group';
      if (isFinite(spx)) s2 += ' against ' + signed(spx, 2, '%') + ' for the S&amp;P';
      if (mover) s2 += '; ' + esc(name(mover[0])) + ' moved most at ' + signed(mover[1], 1, '%');
      out.push(s2 + '.');
    }

    var lb = qv('@LBR.1'), lbBars = S.d.bars['@LBR.1'];
    if (isFinite(lb) && lbBars && lbBars.length) {
      var ly = at(lbBars, isoMinus(todayIso(), 365)) || lbBars[0];
      out.push('Lumber trades at <b>$' + Math.round(lb) + '</b>, ' + signed((lb / ly[1] - 1) * 100, 0, '%') + ' on the year.');
    }

    var inv = series('NHFSEPUCS'), li = last(inv);
    if (li) {
      var mx = Math.max.apply(null, inv.map(function (p) { return p[1]; }));
      var ms_ = last(series('MSACSR'));
      if (li[1] >= mx) out.push('Finished, unsold new homes stand at <b>' + Math.round(li[1]) + 'k</b>, the most since at least ' +
        inv[0][0].slice(0, 4) + (ms_ ? ', with ' + ms_[1].toFixed(1) + ' months of new-home supply' : '') + '.');
      else if (ms_) out.push('New-home supply sits at <b>' + ms_[1].toFixed(1) + ' months</b>.');
    }

    var ev = events().filter(function (e) { return e.date >= todayIso(); });
    var e1 = ev.filter(function (e) { return e.kind === 'earn'; })[0], f1 = ev.filter(function (e) { return e.kind === 'fomc'; })[0];
    var r1 = ev.filter(function (e) { return e.kind === 'rel' && e.ref; })[0];
    var s4 = [];
    if (e1) s4.push(esc(name(e1.sym)) + ' reports ' + dshort(e1.date));
    if (r1) s4.push(r1.name.charAt(0).toLowerCase() + r1.name.slice(1) + ' ' + dshort(r1.date));
    if (f1) s4.push('the Fed decides ' + dshort(f1.date));
    if (s4.length) out.push('Next: ' + s4.join('; ') + '.');
    $('#lede').innerHTML = out.join(' ');
    renderBand();
  }

  // builders against the S&P, drawn as a map scale bar: one segment per half point, capped at 4 points
  function gapHtml(g) {
    if (!isFinite(g)) return '';
    var pts = Math.abs(g), w = Math.max(3, Math.min(4, pts) * 40);
    return '<span class="bh-gap"><span class="gap-bar' + (pts > 4 ? ' is-capped' : '') + '" style="width:' + w.toFixed(0) + 'px" aria-hidden="true"></span>' +
      '<span><b>' + pts.toFixed(2) + ' pts</b> ' + (Math.abs(g) < 0.005 ? 'even with' : g < 0 ? 'under' : 'over') + ' the S&amp;P</span></span>';
  }

  // the "today" band: the two moves that matter to dirt, set big (presentation only; same numbers as the lede)
  function renderBand() {
    var host = $('#band-head'); if (!host) return;
    var A = S.d.universe.filter(function (u) { return u.block === 'A'; })
      .map(function (u) { return num(S.q[u.sym] && S.q[u.sym].change_pct); }).filter(isFinite);
    var avg = A.length ? mean(A) : NaN;
    var spx = num(S.q['.SPX'] && S.q['.SPX'].change_pct), itb = num(S.q.ITB && S.q.ITB.change_pct);
    var c10 = num(S.q.US10Y && S.q.US10Y.change) * 100, R = rates();
    var big = function (v, txt) {
      var c = v > 0 ? 'up' : v < 0 ? 'down' : '', g = v > 0 ? '\u25B2' : v < 0 ? '\u25BC' : '';
      return '<span class="bh-v ' + c + '"><span class="bh-g" aria-hidden="true">' + g + '</span>' + txt + '</span>';
    };
    host.innerHTML =
      '<button type="button" class="bh bh--main" data-open="q:ITB"><span class="bh-k">Production builders today</span>' + big(avg, signed(avg, 1, '%')) +
      '<span class="bh-s">S&amp;P 500 ' + dir(spx, signed(spx, 2, '%')) + '<i></i>ITB ' + dir(itb, signed(itb, 2, '%')) + '</span>' + gapHtml(avg - spx) + '</button>' +
      '<button type="button" class="bh" data-open="q:US10Y"><span class="bh-k">10-yr Treasury today</span>' + big(c10, signed(c10, 1, ' bp')) +
      '<span class="bh-s">at ' + lastStr('US10Y') + '<i></i>30-yr mortgage est. ' + R.now.toFixed(2) + '%</span></button>';
  }

  // ------------------------------------------------------------ today: tiles
  function tapeOf(group) { return (S.d.tape || []).filter(function (t) { return t.group === group; }); }
  function intraFor(sym) {
    if (sym !== 'mort') return S.intra[sym];
    var t = S.intra.US10Y, R = rates();
    return t && isFinite(R.spread) ? t.map(function (p) { return [p[0], p[1] + R.spread]; }) : null;
  }
  function prevClose(sym) {
    if (sym === 'mort') { var R = rates(); return num(S.q.US10Y && S.q.US10Y.previous_day_closing) + R.spread; }
    return num(S.q[sym] && S.q[sym].previous_day_closing);
  }
  function tileHtml(sym, label, flashed) {
    var ref = sym === 'mort' ? 'mort' : 'q:' + sym, v, d, sign;
    if (sym === 'mort') {
      var R = rates(), c = num(S.q.US10Y && S.q.US10Y.change) * 100;
      v = R.now.toFixed(2) + '%'; d = R.liveOk && isFinite(c) ? dir(c, signed(c, 1, ' bp')) : '<span>Optimal Blue</span>'; sign = c;
    } else {
      v = lastStr(sym); d = chgQ(sym, true);
      sign = isYield(sym) ? num(S.q[sym] && S.q[sym].change) : num(S.q[sym] && S.q[sym].change_pct);
    }
    var col = sign > 0 ? 'var(--up)' : sign < 0 ? 'var(--down)' : 'var(--ink)';
    return '<button type="button" class="tile' + (flashed ? ' flash' : '') + '" data-open="' + ref + '" data-sym="' + sym + '" data-last="' + esc(v) + '">' +
      '<span class="tile-k">' + esc(label) + '</span>' +
      '<span class="tile-v">' + v + '</span><span class="tile-d">' + d + '</span>' +
      sparkSvg(intraFor(sym), { cls: 'tile-spark', w: 160, h: 34, base: prevClose(sym), color: col }) + '</button>';
  }
  function renderTiles(flash) {
    var host = $('#tiles'), prev = {};
    $$('.tile', host).forEach(function (t) { prev[t.dataset.sym] = t.dataset.last; });
    host.innerHTML = GROUPS.map(function (g) {
      var items = tapeOf(g[0]).map(function (t) { return [t.sym, t.label]; });
      if (g[0] === 'rates') items.splice(1, 0, ['mort', '30-yr mortgage, est.']);
      return '<div class="tile-group"><h3 class="tile-gh">' + g[1] + '</h3><div class="tile-row">' + items.map(function (it) {
        var html = tileHtml(it[0], it[1], false);
        var changed = flash && prev[it[0]] && html.indexOf('data-last="' + esc(prev[it[0]]) + '"') < 0;
        return changed ? html.replace('class="tile"', 'class="tile flash"') : html;
      }).join('') + '</div></div>';
    }).join('');
  }

  // intraday bars for every tile: the latest session only
  var ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  function etMinutes(t) { var p = ET.formatToParts(new Date(t)); var g = function (k) { return +p.filter(function (x) { return x.type === k; })[0].value; }; return g('hour') * 60 + g('minute'); }
  function cashOnly(sym) { var t = (S.q[sym] || {}).type; return !isYield(sym) && t !== 'DERIVATIVE'; }
  function lastSession(pts, sym) {
    if (!pts.length) return pts;
    var day = new Date(last(pts)[0]).toDateString();
    var out = pts.filter(function (p) { return new Date(p[0]).toDateString() === day; });
    // stocks, ETFs and indexes: the 9:30-4:00 session only; thin pre-market prints draw false lines
    if (sym && cashOnly(sym)) {
      var rth = out.filter(function (p) { var m = etMinutes(p[0]); return m >= 570 && m <= 960; });
      if (rth.length > 1) out = rth;
    }
    return out;
  }
  var intraTimer = null;
  function pollIntra() {
    clearTimeout(intraTimer);
    var syms = (S.d.tape || []).map(function (t) { return t.sym; });
    return Promise.all(syms.map(function (sym) {
      return fetchSrc(sym, '1D').then(function (pts) { if (pts.length) S.intra[sym] = lastSession(pts, sym); }, function () {});
    })).then(function () {
      S.intraAt = new Date();
      renderTiles(false); renderSession();
    }).then(function () {
      if (!document.hidden) intraTimer = setTimeout(pollIntra, S.status === 'REG_MKT' ? 180000 : 900000);
    });
  }

  // ------------------------------------------------------------ today: the session
  function renderSession() {
    var pct = function (sym, cls, soft) {
      var pts = S.intra[sym], pc = prevClose(sym);
      if (!pts || !pts.length || !isFinite(pc)) return null;
      return { pts: pts.map(function (p) { return [p[0], (p[1] / pc - 1) * 100]; }), cls: cls, soft: soft, sym: sym,
        label: (sym === '.SPX' ? 'S&P' : sym) + ' ' + signed((last(pts)[1] / pc - 1) * 100, 2, '%') };
    };
    var ser = [pct('ITB', 's-ink'), pct('XHB', 's-ink2', true), pct('.SPX', 's-ink3', true)].filter(Boolean);
    var any = ser[0] && ser[0].pts;
    if (any) {
      var d = new Date(any[0][0]);
      $('#session-cap').textContent = (d.toDateString() === new Date().toDateString() ? 'Today\u2019s session' : 'Last session, ' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) +
        ': builders against the market, then the 10-year, both from the prior close';
    }
    lineChart($('#ch-session'), {
      series: ser, endLabels: true, intraday: true, yInclude: [0], hlines: [{ v: 0, cls: 'zero' }],
      yFmt: function (v) { return signed(v, Math.abs(v) < 1 && v !== 0 ? 1 : 0, '%'); },
      aria: 'Intraday percent change: home construction ETF, homebuilders ETF, S&P 500',
      tip: function (t, v) {
        return '<b>' + new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</b>' +
          ser.map(function (s, i) { return row(s.sym === '.SPX' ? 'S&P 500' : s.sym, signed(v[i], 2, '%')); }).join('');
      }
    });
    var t10 = S.intra.US10Y, pc10 = prevClose('US10Y');
    var from = any ? any[0][0] : 0, to = any ? last(any)[0] + 6e5 : Infinity; // same clock as the stock lines above
    var s10 = t10 && isFinite(pc10) ? t10.filter(function (p) { return p[0] >= from && p[0] <= to; }).map(function (p) { return [p[0], (p[1] - pc10) * 100]; }) : null;
    if (s10 && s10.length < 2) s10 = t10.map(function (p) { return [p[0], (p[1] - pc10) * 100]; });
    lineChart($('#ch-session10'), {
      series: [{ pts: s10, cls: 's-flag', label: '10-yr ' + (s10 ? signed(last(s10)[1], 1, ' bp') : '') }],
      endLabels: true, intraday: true, yInclude: [0], hlines: [{ v: 0, cls: 'zero' }], yTicks: 2,
      yFmt: function (v) { return signed(v, 0, ''); }, m: { b: 20 },
      aria: 'Intraday change in the 10-year Treasury yield, basis points',
      tip: function (t, v) { return '<b>' + new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</b>' + row('10-yr', signed(v[0], 1, ' bp')); }
    });
  }

  // ------------------------------------------------------------ today: leaders and laggards
  var MOVERS = [['1d', 'Today'], ['1m', '1 month'], ['ytd', 'YTD']];
  function renderMovers() {
    $('#movers-seg').innerHTML = MOVERS.map(function (m) { return '<button type="button" data-movers="' + m[0] + '" aria-pressed="' + (S.movers === m[0]) + '">' + m[1] + '</button>'; }).join('');
    var k = S.movers;
    var rows = S.d.universe.map(function (u) { return { sym: u.sym, v: metricVal(u.sym, k) }; })
      .filter(function (r) { return isFinite(r.v); }).sort(function (a, b) { return b.v - a.v; });
    var refs_ = [['ITB', metricVal('ITB', k)], ['S&P', metricVal('.SPX', k)]].filter(function (r) { return isFinite(r[1]); });
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); }).concat(refs_.map(function (r) { return Math.abs(r[1]); }), [0.5]));
    var pos = function (v) { return 50 + v / mx * 50; };
    $('#movers').innerHTML =
      '<div class="mv-refs">' + refs_.map(function (r) { return '<span style="left:' + pos(r[1]).toFixed(2) + '%"><i></i>' + r[0] + ' ' + signed(r[1], 1, '%') + '</span>'; }).join('') + '</div>' +
      rows.map(function (r) {
        var w = Math.abs(r.v) / mx * 50;
        return '<button type="button" class="mv" data-open="q:' + r.sym + '" data-tipsym="' + r.sym + '">' +
          '<span class="mv-sym">' + r.sym + '</span>' +
          '<span class="mv-track">' + refs_.map(function (x) { return '<i class="mv-ref" style="left:' + pos(x[1]).toFixed(2) + '%"></i>'; }).join('') +
          '<i class="mv-bar ' + (r.v >= 0 ? 'up-bg' : 'down-bg') + '" style="' + (r.v >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(2) + '%"></i></span>' +
          '<span class="mv-v ' + (r.v > 0 ? 'up' : r.v < 0 ? 'down' : '') + '">' + signed(r.v, 1, '%') + '</span></button>';
      }).join('');
  }

  // ------------------------------------------------------------ board (plat)
  function barsOf(sym) { return S.d.bars[sym] || []; }
  function metricVal(sym, k) {
    var q = S.q[sym] || {}, lastPx = num(q.last), b = barsOf(sym);
    if (k === '1d') return num(q.change_pct);
    if (!isFinite(lastPx) || !b.length) return NaN;
    if (k === '1m') { var p = at(b, isoMinus(todayIso(), 30)) || b[0]; return (lastPx / p[1] - 1) * 100; }
    if (k === 'ytd') { var y = at(b, (new Date().getFullYear() - 1) + '-12-31'); return y ? (lastPx / y[1] - 1) * 100 : NaN; }
    if (k === 'hi') {
      var hi = Math.max(num(q.yrhiprice) || 0, Math.max.apply(null, b.slice(-252).map(function (x) { return x[1]; })));
      return (lastPx / hi - 1) * 100;
    }
    return NaN;
  }
  function hexRgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function lum(c) {
    var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var STEPS = 5;
  // OKLab <-> sRGB, so the board ramp steps evenly in perceived lightness instead of muddying through RGB
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function toLab(c) {
    var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
        m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
        s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720420 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function lchRgb(L, C, h) { // chroma pulled in until the color fits sRGB
    for (var n = 0; n < 80; n++, C *= 0.97) {
      var a = C * Math.cos(h), b = C * Math.sin(h);
      var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
      var rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
      if (rgb.every(function (v) { return v >= -1e-4 && v <= 1 + 1e-4; }) || C < 0.001) return rgb.map(function (v) {
        v = Math.max(0, Math.min(1, v)); return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
      });
    }
  }
  var rampCache = {};
  function divColor(t) { // t in [-1, 1]; stepped so equal colors mean equal bins
    var k = Math.round(Math.min(1, Math.abs(t)) * STEPS);
    if (!k) return hexRgb(css('--mid'));
    // per-theme lightness stops (--ramp-l) skip the band where neither ink nor sheet text reads; chroma eases in (--ramp-e, --ramp-c)
    var pole = css(t >= 0 ? '--up' : '--down'), key = pole + '|' + k + '|' + css('--ramp-l') + css('--ramp-h');
    if (rampCache[key]) return rampCache[key];
    var Ls = css('--ramp-l').split(/\s+/).map(parseFloat), lab = toLab(hexRgb(pole));
    var C = Math.hypot(lab[1], lab[2]) * (parseFloat(css('--ramp-c')) || 1) * Math.pow(k / STEPS, parseFloat(css('--ramp-e')) || 1);
    // the down side rotates toward clay/ochre at small moves (--ramp-h degrees) so it reads as earth, not flesh
    var h = Math.atan2(lab[2], lab[1]) + (t < 0 ? (parseFloat(css('--ramp-h')) || 0) * Math.PI / 180 * (1 - k / STEPS) : 0);
    return (rampCache[key] = lchRgb(Ls[k - 1] || lab[0], Math.max(0.035, C), h));
  }
  function rgbStr(c) { return 'rgb(' + c.join(',') + ')'; }
  function textOn(c) {
    var ink = hexRgb(css('--ink')), sheet = hexRgb(css('--sheet'));
    return contrast(c, ink) >= contrast(c, sheet) ? 'var(--ink)' : 'var(--sheet)';
  }

  function squarify(items, rect) {
    var out = [], total = items.reduce(function (a, i) { return a + i.v; }, 0);
    if (!total) return out;
    var scale = rect.w * rect.h / total;
    var nodes = items.map(function (i) { return { item: i, a: i.v * scale }; });
    var r = Object.assign({}, rect), rowN = [];
    function worst(rw, len) {
      var s = 0, mx = 0, mn = Infinity;
      rw.forEach(function (n) { s += n.a; mx = Math.max(mx, n.a); mn = Math.min(mn, n.a); });
      return Math.max(len * len * mx / (s * s), (s * s) / (len * len * mn));
    }
    function lay(rw) {
      var s = rw.reduce(function (a, n) { return a + n.a; }, 0);
      if (r.w >= r.h) {
        var w = s / r.h, y = r.y;
        rw.forEach(function (n) { var h = n.a / w; out.push({ it: n.item, x: r.x, y: y, w: w, h: h }); y += h; });
        r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h };
      } else {
        var hh = s / r.w, x = r.x;
        rw.forEach(function (n) { var ww = n.a / hh; out.push({ it: n.item, x: x, y: r.y, w: ww, h: hh }); x += ww; });
        r = { x: r.x, y: r.y + hh, w: r.w, h: r.h - hh };
      }
    }
    var i = 0;
    while (i < nodes.length) {
      var len = Math.min(r.w, r.h);
      if (!rowN.length || worst(rowN.concat([nodes[i]]), len) <= worst(rowN, len)) { rowN.push(nodes[i]); i++; }
      else { lay(rowN); rowN = []; }
    }
    if (rowN.length) lay(rowN);
    return out;
  }

  function renderBoard() {
    $('#view-seg').innerHTML = [['plat', 'Plat'], ['table', 'Table']].map(function (v) {
      return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' + v[1] + '</button>'; }).join('');
    var table = S.view === 'table';
    $('#plat').hidden = table; $('#plat-legend').hidden = table; $('#lb-wrap').hidden = !table;
    $('#metric-seg').hidden = table;
    $('#board-note').textContent = table
      ? 'Every name on the board with its moves, valuation and rate sensitivity. "Per +10 bp" is the typical move on a day the 10-year rises 10 bp, fit on a year of daily data. Sort by any column; select a row for the full file.'
      : 'Public builders and land companies platted as lots. Lot area follows the square root of market cap; color follows the selected move. Select a lot for the full file.';
    if (table) return renderLeaderboard();
    var host = $('#plat'); host.innerHTML = '';
    var W = host.clientWidth, H = host.clientHeight; if (!W) return;
    var lim = METRICS.filter(function (m) { return m[0] === S.metric; })[0][2];
    var items = S.d.universe.map(function (u) {
      var q = S.q[u.sym] || {};
      return { sym: u.sym, block: u.block, cap: mcap(q.mktcapView), m: metricVal(u.sym, S.metric) };
    }).filter(function (i) { return isFinite(i.cap); });
    items.forEach(function (i) { i.v = Math.sqrt(i.cap); });
    var blocks = ['A', 'B', 'C'].map(function (b) {
      var its = items.filter(function (i) { return i.block === b; }).sort(function (p, q) { return q.v - p.v; });
      return { k: b, items: its, v: its.reduce(function (a, i) { return a + i.v; }, 0) };
    });
    var street = 18, head = 24, tot = blocks[0].v + blocks[1].v + blocks[2].v;
    var rects;
    if (W < 560) { // stack blocks
      var avail = H - 2 * street, y = 0;
      rects = blocks.map(function (b) { var h = avail * b.v / tot, r = { x: 0, y: y, w: W, h: h }; y += h + street; return r; });
    } else {
      var wA = (W - street) * blocks[0].v / tot, hB = (H - street) * blocks[1].v / (blocks[1].v + blocks[2].v);
      rects = [{ x: 0, y: 0, w: wA, h: H }, { x: wA + street, y: 0, w: W - wA - street, h: hB },
        { x: wA + street, y: hB + street, w: W - wA - street, h: H - hB - street }];
    }
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': 'Builder board' }, host);
    if (W >= 560) {
      el('line', { class: 'street', x1: rects[0].w + street / 2, x2: rects[0].w + street / 2, y1: 0, y2: H }, svg);
      el('line', { class: 'street', x1: rects[1].x, x2: W, y1: rects[1].h + street / 2, y2: rects[1].h + street / 2 }, svg);
    }
    blocks.forEach(function (b, bi) {
      var R = rects[bi];
      el('rect', { class: 'block-edge', x: R.x + .5, y: R.y + .5, width: R.w - 1, height: R.h - 1 }, svg);
      var avg = mean(b.items.map(function (i) { return i.m; }).filter(isFinite));
      var bl = el('text', { class: 'block-label', x: R.x + 8, y: R.y + 16 }, svg, 'Block ' + b.k);
      el('tspan', { class: 'block-sub', dx: 8 }, bl, BLOCKS[b.k]);
      if (isFinite(avg) && R.w > 250) el('text', { class: 'block-sub', x: R.x + R.w - 8, y: R.y + 16, 'text-anchor': 'end' }, svg, 'avg ' + signed(avg, 1, '%'));
      var inner = { x: R.x + 3, y: R.y + head, w: R.w - 6, h: R.h - head - 3 };
      squarify(b.items, inner).forEach(function (c) { drawLot(svg, c, lim); });
    });
    var one = S.metric === 'hi';
    var cells = [];
    for (var s = one ? 0 : -STEPS; s <= STEPS; s++) {
      if (one && s > 0) break;
      cells.push('<i style="background:' + rgbStr(divColor(one ? -(STEPS + s) / STEPS : s / STEPS)) + '"></i>');
    }
    if (one) cells.reverse();
    $('#plat-legend').innerHTML = '<span class="ramp">' + MINUS + lim + '%' +
      ' <span class="ramp-bar" aria-hidden="true">' + cells.join('') + '</span> ' + (one ? 'at the high' : '+' + lim + '%') + '</span>' +
      '<span>Color is ' + METRICS.filter(function (m) { return m[0] === S.metric; })[0][1].toLowerCase() + ', capped at the ends.</span>' +
      '<span>Lot area follows the square root of market cap.</span>';
  }

  function drawLot(svg, c, lim) {
    var sym = c.it.sym, v = c.it.m, t = isFinite(v) ? v / lim : 0;
    if (S.metric === 'hi') t = Math.min(0, t);
    var fill = divColor(t), ink = textOn(fill);
    var g = el('g', { class: 'lot', tabindex: 0, role: 'button', 'data-open': 'q:' + sym, 'data-tipsym': sym,
      'aria-label': name(sym) + ', ' + signed(v, 1, '%') + ' ' + S.metric }, svg);
    el('rect', { class: 'lot-edge', x: c.x + 1, y: c.y + 1, width: Math.max(0, c.w - 2), height: Math.max(0, c.h - 2), fill: rgbStr(fill) }, g);
    var fs = Math.max(11, Math.min(22, Math.sqrt(c.w * c.h) / 5.2));
    if (c.w > 34 && c.h > 22) {
      el('text', { class: 'lot-sym', x: c.x + 7, y: c.y + 6 + fs, 'font-size': fs, style: 'fill:' + ink }, g, sym);
      if (c.h > fs * 2 + 10) el('text', { class: 'lot-val', x: c.x + 7, y: c.y + 8 + fs * 2, 'font-size': fs * 0.78, style: 'fill:' + ink }, g, signed(v, 1, '%'));
      if (c.w > 120 && c.h > fs * 3 + 18) el('text', { class: 'lot-name', x: c.x + 7, y: c.y + c.h - 8, 'font-size': 11.5, style: 'fill:' + ink + ';opacity:.8' }, g, name(sym));
    }
  }
  function lotTip(sym) {
    var q = S.q[sym] || {}, e = S.d.earnings[sym], rb = rateBeta(sym);
    return '<b>' + esc(name(sym)) + '</b> ' + sym +
      row('Last', px(num(q.last))) + row('Today', signed(metricVal(sym, '1d'), 2, '%')) +
      row('1 month', signed(metricVal(sym, '1m'), 1, '%')) + row('Year to date', signed(metricVal(sym, 'ytd'), 1, '%')) +
      row('Off 52-wk high', signed(metricVal(sym, 'hi'), 1, '%')) + row('Market cap', big(mcap(q.mktcapView))) +
      (rb ? row('Per +10 bp in the 10-yr', signed(rb.b10, 1, '%')) : '') +
      (e ? row('Reports', dshort(e.date) + (e.confirmed ? '' : ' est.')) : '') + '<div class="tip-cue">Select for the full file</div>';
  }

  // ------------------------------------------------------------ board: table view
  function lbRow(sym) {
    var q = S.q[sym] || {}, e = S.d.earnings[sym], rb = rateBeta(sym);
    return { sym: sym, last: num(q.last), '1d': metricVal(sym, '1d'), '1m': metricVal(sym, '1m'), ytd: metricVal(sym, 'ytd'),
      hi: metricVal(sym, 'hi'), beta10: rb ? rb.b10 : NaN, cap: mcap(q.mktcapView), pe: num(q.pe), earn: e ? e.date : 'zzzz', e: e };
  }
  function pctCell(v, d) { return '<td class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + signed(v, d == null ? 1 : d, '%') + '</td>'; }
  function renderLeaderboard() {
    var k = S.lbSort.k, dn = S.lbSort.dir;
    var rows = S.d.universe.map(function (u) { return lbRow(u.sym); });
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === 'string') return x.localeCompare(y) * dn;
      return ((isFinite(x) ? x : 1e15 * dn) - (isFinite(y) ? y : 1e15 * dn)) * dn; // blanks sink either way
    });
    $('#lb-table tbody').innerHTML = rows.map(function (r) {
      var b = barsOf(r.sym).slice(-63).map(function (p) { return [ms(p[0]), p[1]]; });
      return '<tr data-open="q:' + r.sym + '" tabindex="0"><td class="l name">' + r.sym + '<small>' + esc(name(r.sym)) + '</small></td>' +
        '<td>' + px(r.last) + '</td>' + pctCell(r['1d'], 2) + pctCell(r['1m']) + pctCell(r.ytd) + pctCell(r.hi) +
        pctCell(r.beta10) + '<td>' + big(r.cap) + '</td><td>' + (isFinite(r.pe) ? r.pe.toFixed(1) : '–') + '</td>' +
        '<td>' + (r.e ? dshort(r.e.date) + (r.e.confirmed ? '' : '<small> est.</small>') : '–') + '</td>' +
        '<td class="l">' + sparkSvg(b, { w: 110, h: 24 }) + '</td></tr>';
    }).join('');
    $$('#lb-table th[data-lk]').forEach(function (th) {
      th.setAttribute('aria-sort', th.dataset.lk === k ? (dn > 0 ? 'ascending' : 'descending') : 'none');
    });
  }

  // ------------------------------------------------------------ statistics on daily bars
  function returns(b) { var r = []; for (var i = 1; i < b.length; i++) r.push([b[i][0], (b[i][1] / b[i - 1][1] - 1) * 100]); return r; }
  var betaCache = {};
  function rateBeta(sym) { // % move per +10 bp in the 10-yr, OLS on a year of daily closes
    if (isYield(sym)) return null;
    if (betaCache[sym] !== undefined) return betaCache[sym];
    var a = barsOf(sym), t = barsOf('US10Y'), tm = {};
    if (a.length < 60 || t.length < 60) return (betaCache[sym] = null);
    t.forEach(function (p) { tm[p[0]] = p[1]; });
    var xs = [], ys = [];
    for (var i = 1; i < a.length; i++) {
      var y0 = tm[a[i - 1][0]], y1 = tm[a[i][0]];
      if (y0 == null || y1 == null) continue;
      xs.push((y1 - y0) * 100); ys.push((a[i][1] / a[i - 1][1] - 1) * 100);
    }
    if (xs.length < 60) return (betaCache[sym] = null);
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < xs.length; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) * (xs[j] - mx); syy += (ys[j] - my) * (ys[j] - my); }
    return (betaCache[sym] = { b10: sxy / sxx * 10, r2: sxy * sxy / (sxx * syy), n: xs.length });
  }
  function corr(symA, symB) {
    var a = returns(barsOf(symA)), bm = {};
    returns(barsOf(symB)).forEach(function (p) { bm[p[0]] = p[1]; });
    var xs = [], ys = [];
    a.forEach(function (p) { if (bm[p[0]] != null) { xs.push(p[1]); ys.push(bm[p[0]]); } });
    if (xs.length < 60) return NaN;
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < xs.length; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) * (xs[j] - mx); syy += (ys[j] - my) * (ys[j] - my); }
    return sxy / Math.sqrt(sxx * syy);
  }
  function vol(b, n) {
    var r = returns(b.slice(-(n + 1))).map(function (p) { return p[1]; });
    if (r.length < 10) return NaN;
    var m_ = mean(r);
    return Math.sqrt(r.reduce(function (s, v) { return s + (v - m_) * (v - m_); }, 0) / (r.length - 1)) * Math.sqrt(252);
  }
  function drawdown(b) {
    var peak = -Infinity, dd = 0;
    b.forEach(function (p) { peak = Math.max(peak, p[1]); dd = Math.min(dd, p[1] / peak - 1); });
    return dd * 100;
  }

  // ------------------------------------------------------------ rates panel
  function renderRates() {
    var ob = series('OBMMIC30YF'), t10 = series('DGS10');
    var cut = isoMinus(last(ob)[0], 3 * 365);
    var mp = ob.filter(function (p) { return p[0] >= cut; }).map(function (p) { return [ms(p[0]), p[1]]; });
    var tp = t10.filter(function (p) { return p[0] >= cut; }).map(function (p) { return [ms(p[0]), p[1]]; });
    lineChart($('#ch-mort'), {
      series: [{ pts: mp, cls: 's-ink', label: '30-yr ' + last(mp)[1].toFixed(2) + '%' },
               { pts: tp, cls: 's-ink2', label: '10-yr ' + last(tp)[1].toFixed(2) + '%', soft: true }],
      band: [0, 1], endLabels: true, yFmt: function (v) { return v.toFixed(1) + '%'; },
      aria: '30-year mortgage rate and 10-year Treasury yield, three years',
      tip: function (t, v) {
        return '<b>' + dlong(t) + '</b>' +
          row('30-yr mortgage', v[0].toFixed(2) + '%') + row('10-yr Treasury', v[1].toFixed(2) + '%') + row('Spread', (v[0] - v[1]).toFixed(2));
      }
    });
    drawYieldCurve();

    var fed = last(series('DFEDTARU')), f1 = (S.d.fomc || []).filter(function (f) { return f.date >= todayIso(); })[0];
    var s2 = qv('US2Y'), s10 = qv('US10Y');
    var fha = last(series('OBMMIFHA30YF')), jumbo = last(series('OBMMIJUMBO30YF')), m15 = last(series('MORTGAGE15US'));
    var facts = [
      ['fed', 'Fed funds, upper bound', fed ? fed[1].toFixed(2) + '%' : '–'],
      ['fed', 'Next Fed decision', f1 ? dshort(f1.date) + '<small>' + inDays(f1.date) + (f1.sep ? ', with projections' : '') + '</small>' : '–'],
      ['f:T10Y2Y', '2s10s curve', isFinite(s2 - s10) ? signed((s10 - s2) * 100, 0, ' bp') + '<small>live</small>' : '–'],
      ['f:OBMMIFHA30YF', '30-yr FHA', fha ? fha[1].toFixed(2) + '%<small>' + dshort(fha[0]) + '</small>' : '–'],
      ['f:OBMMIJUMBO30YF', '30-yr jumbo', jumbo ? jumbo[1].toFixed(2) + '%<small>' + dshort(jumbo[0]) + '</small>' : '–'],
      ['f:MORTGAGE15US', '15-yr fixed', m15 ? m15[1].toFixed(2) + '%<small>Freddie Mac, ' + dshort(m15[0]) + '</small>' : '–'],
      ['q:US3M', '3-month bill', isFinite(qv('US3M')) ? qv('US3M').toFixed(2) + '%<small>live</small>' : '–'],
      ['q:MBB', 'Mortgage bonds (MBB)', lastStr('MBB') + '<small>' + chgQ('MBB', true) + '</small>']
    ];
    $('#rate-facts').innerHTML = facts.map(function (f) {
      return '<div data-open="' + f[0] + '" tabindex="0" role="button"><dt>' + f[1] + '</dt><dd>' + f[2] + '</dd></div>'; }).join('');
  }

  function drawYieldCurve() {
    var host = $('#ch-curve'); host.innerHTML = '';
    var W = host.clientWidth, H = host.clientHeight, c = S.d.curve; if (!W || !c.now.points.length) return;
    var m = { t: 10, r: 74, b: 22, l: 42 };
    var sets = [['now', 'Now', 's-ink'], ['1m', 'A month ago', 's-ink2'], ['1y', 'A year ago', 's-ink3']]
      .filter(function (s) { return c[s[0]].points.length; });
    var ys = [].concat.apply([], sets.map(function (s) { return c[s[0]].points.map(function (p) { return p[1]; }); }));
    var y0 = Math.min.apply(null, ys) - 0.15, y1 = Math.max.apply(null, ys) + 0.15;
    var sx0 = Math.sqrt(1 / 12), sx1 = Math.sqrt(30);
    var X = function (yr) { return m.l + (Math.sqrt(yr) - sx0) / (sx1 - sx0) * (W - m.l - m.r); };
    var Y = function (v) { return m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Treasury yield curve now, a month ago and a year ago' }, host);
    var ax = el('g', { class: 'axis' }, svg);
    niceTicks(y0, y1, 4).forEach(function (v) {
      el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, ax);
      el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, ax, v.toFixed(1) + '%');
    });
    [[1 / 12, '1M'], [0.5, '6M'], [1, '1Y'], [2, '2Y'], [5, '5Y'], [10, '10Y'], [30, '30Y']].forEach(function (t) {
      el('text', { x: X(t[0]), y: H - 4, 'text-anchor': 'middle' }, ax, t[1]);
    });
    var labs = [];
    sets.forEach(function (s) {
      var pts = c[s[0]].points;
      el('path', { class: 'series ' + s[2], d: pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('') }, svg);
      labs.push({ y: Y(last(pts)[1]), t: s[1], soft: s[0] !== 'now' });
    });
    labs.sort(function (a, b) { return a.y - b.y; });
    for (var j = 1; j < labs.length; j++) if (labs[j].y - labs[j - 1].y < 15) labs[j].y = labs[j - 1].y + 15;
    labs.forEach(function (l) { el('text', { class: 'dlabel' + (l.soft ? ' soft' : ''), x: W - m.r + 7, y: l.y + 4 }, svg, l.t); });
    var xh = el('line', { class: 'xhair', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
    var hit = el('rect', { class: 'hit', x: m.l, y: 0, width: W - m.l - m.r, height: H }, svg);
    var tenors = c.now.points.map(function (p) { return p[0]; });
    var tname = function (y) { return y < 1 ? Math.round(y * 12) + '-mo' : y + '-yr'; };
    function mv(e) {
      var x = svgLocalX(svg, e, W), best = tenors[0];
      tenors.forEach(function (t) { if (Math.abs(X(t) - x) < Math.abs(X(best) - x)) best = t; });
      xh.setAttribute('x1', X(best)); xh.setAttribute('x2', X(best)); xh.setAttribute('visibility', 'visible');
      var html = '<b>' + tname(best) + ' Treasury</b>';
      sets.forEach(function (s) {
        var p = c[s[0]].points.filter(function (q) { return q[0] === best; })[0];
        if (p) html += row(s[1] + ' (' + dshort(c[s[0]].asof) + ')', p[1].toFixed(2) + '%');
      });
      showTip(html, e.clientX, e.clientY);
    }
    hit.addEventListener('pointermove', mv);
    hit.addEventListener('pointerleave', function () { xh.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  // ------------------------------------------------------------ rates to dirt
  function refRate(R) { return refs(R).filter(function (x) { return x.k === S.ref; })[0] || refs(R)[1]; }
  function selRate(R) { return S.rate == null ? R.now : S.rate; }

  function renderHero(pulse) {
    var R = rates(), ref = refRate(R), sel = selRate(R), P = price(), whatIf = S.rate != null;
    var payRef = payment(P, ref.rate), paySel = payment(P, sel);
    var buys = afford(payRef, sel), sh = lotShare();
    var refTxt = ref.k === 'today' ? 'today' : ref.label.toLowerCase() + ' (' + ref.rate.toFixed(2) + '%)';
    var c10 = num(S.q.US10Y && S.q.US10Y.change) * 100;

    var links = [
      { k: '10-yr Treasury', v: R.live10.toFixed(2) + '%', open: 'q:US10Y',
        d: R.liveOk && isFinite(c10) ? dir(c10, signed(c10, 1, ' bp') + ' today') : 'FRED close, ' + dshort(last(series('DGS10'))[0]) },
      { k: 'Mortgage spread over the 10-yr', v: '+' + R.spread.toFixed(2), open: 'mort',
        d: '1-yr average ' + R.spreadAvg.toFixed(2) },
      { k: whatIf ? '30-yr mortgage, what-if' : '30-yr mortgage, today', v: sel.toFixed(2) + '%', wi: whatIf, open: 'mort',
        d: whatIf ? 'Today ' + R.now.toFixed(2) + '%' : 'Optimal Blue ' + R.print[1].toFixed(2) + '% on ' + dshort(R.print[0]) + (R.liveOk ? ', moved with the 10-yr since' : '') },
      { k: 'Monthly payment on a ' + usdK(P) + ' home', v: usd(paySel),
        d: ref.rate === sel ? 'Same as ' + refTxt : dir(paySel - payRef, signed(paySel - payRef, 0).replace(/(\d+)/, function (x) { return '$' + (+x).toLocaleString('en-US'); }) + ' vs ' + refTxt) },
      { k: 'House that payment budget buys', v: usdK(buys),
        d: Math.abs(buys - P) < 1 ? 'Set a compare rate or drag the rate' : dir(buys - P, usdK(buys - P) + ' of price') },
      { k: 'Finished lot at ' + Math.round(sh[0] * 100) + '\u2013' + Math.round(sh[1] * 100) + '% of price', v: usdKRange(buys, sh), range: true,
        d: Math.abs(buys - P) < 1 ? usdKRange(P, sh) + ' at the compare rate' : dir(buys - P, usdK((buys - P) * sh[0]) + ' to ' + usdK((buys - P) * sh[1]) + ' per lot') }
    ];
    $('#chain').innerHTML = links.map(function (l, i) {
      return '<li class="link' + (l.wi ? ' is-whatif' : '') + (l.range ? ' is-range' : '') + (pulse ? ' is-pulse' : '') + (l.open ? ' is-open' : '') + '" style="animation-delay:' + (i * 110) + 'ms"' +
        (l.open ? ' data-open="' + l.open + '" tabindex="0" role="button"' : '') + '>' +
        '<div class="link-k">' + l.k + '</div><div class="link-v">' + l.v + '</div><div class="link-d">' + l.d + '</div></li>';
    }).join('');

    var tg = $('#dirt-toggle');
    tg.setAttribute('aria-expanded', String(S.dirtOpen));
    tg.textContent = S.dirtOpen ? 'Close the calculator' : 'Open the calculator';
    $('#dirt-body').hidden = !S.dirtOpen;
    if (!S.dirtOpen) return;

    $('#ref-seg').innerHTML = refs(R).map(function (r) {
      return '<button type="button" data-ref="' + r.k + '" aria-pressed="' + (r.k === S.ref) + '">' + r.label +
        (r.k === 'today' ? '' : ' <span class="sr-only">' + r.rate.toFixed(2) + '%</span>') + '</button>';
    }).join('');

    var slider = $('#rate');
    if (document.activeElement !== slider) slider.value = sel.toFixed(2);
    $('#rate-out').textContent = sel.toFixed(2) + '%';
    $('#rate-reset').hidden = !whatIf;

    fillBlanks();
    var med = last(series('MSPNHSUS'));
    $('#price-note').innerHTML = S.a.price ? 'Custom price. <button type="button" class="linkish" data-reset-price>Use the median new home</button>' :
      'Median new home price, Census, ' + dmonth(med[0]) + '. Type any price.';
    var t = Math.max(0.5, sel - S.a.bd), L = P * (1 - S.a.down / 100), i = sel / 1200;
    var save = L * (factor(sel) - factor(t)), pv = save * (1 - Math.pow(1 + i, -84)) / i;
    $('#bd-rate').textContent = t.toFixed(2) + '%';
    $('#buydown').innerHTML = usd(pv) + '<small>' + (pv / P * 100).toFixed(1) + '% of the price, or ' +
      Math.round(pv / (P * sh[1]) * 100) + '\u2013' + Math.round(pv / (P * sh[0]) * 100) + '% of the lot. Saves the buyer ' + usd(save) + ' a month.</small>';

    drawAfford(R, ref, sel, P, payRef);
  }

  function drawAfford(R, ref, sel, P, payRef) {
    var host = $('#curve'); host.innerHTML = '';
    var W = host.clientWidth, H = host.clientHeight; if (!W) return;
    var m = { t: 26, r: 16, b: 44, l: 58 }, r0 = 2.5, r1 = 9.5;
    var pts = []; for (var r = r0; r <= r1 + 1e-9; r += 0.05) pts.push([r, afford(payRef, r)]);
    var y0 = afford(payRef, r1) * 0.95, y1 = afford(payRef, r0) * 1.03;
    var X = function (v) { return m.l + (v - r0) / (r1 - r0) * (W - m.l - m.r); };
    var pins = refs(R).map(function (p) { return { x: X(p.rate), label: p.label + ' ' + p.rate.toFixed(2) + '%', k: p.k, rate: p.rate }; })
      .filter(function (p) { return p.rate >= r0 && p.rate <= r1; }).sort(function (p, q) { return p.x - q.x; });
    var ends = [-Infinity, -Infinity], rowsUsed = 1;
    pins.forEach(function (p) {
      var w = p.label.length * 5.6, x = Math.min(Math.max(p.x, w / 2), W - m.r - w / 2);
      p.row = x - w / 2 >= ends[0] + 8 ? 0 : x - w / 2 >= ends[1] + 8 ? 1 : (ends[0] <= ends[1] ? 0 : 1);
      p.lx = Math.min(Math.max(x, ends[p.row] + 8 + w / 2), W - m.r - w / 2);
      ends[p.row] = p.lx + w / 2; if (p.row) rowsUsed = 2;
    });
    m.b += (rowsUsed - 1) * 14;
    var Y = function (v) { return m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Home price the same monthly payment supports at each mortgage rate. Selected ' + sel.toFixed(2) + '% buys ' + usdK(afford(payRef, sel)) }, host);
    var ax = el('g', { class: 'axis' }, svg);
    niceTicks(y0, y1, 5).forEach(function (v) {
      el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, ax);
      el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, ax, usdK(v));
    });
    for (var k = Math.ceil(r0); k <= r1; k++) el('text', { x: X(k), y: H - m.b + 16, 'text-anchor': 'middle' }, ax, k + '%');
    el('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, ax);
    if (Math.abs(sel - ref.rate) > 0.001) {
      var a = Math.min(sel, ref.rate), b = Math.max(sel, ref.rate);
      var seg = pts.filter(function (p) { return p[0] >= a - 1e-9 && p[0] <= b + 1e-9; });
      seg.unshift([a, afford(payRef, a)]); seg.push([b, afford(payRef, b)]);
      var d = pathOf(seg, X, Y) + 'L' + X(b) + ',' + Y(P) + 'L' + X(a) + ',' + Y(P) + 'Z';
      el('path', { class: sel > ref.rate ? 'curve-gap' : 'curve-gain', d: d }, svg);
    }
    el('line', { class: 'pin-line', x1: m.l, x2: W - m.r, y1: Y(P), y2: Y(P) }, svg);
    el('path', { class: 'curve-afford', d: pathOf(pts, X, Y) }, svg);
    pins.forEach(function (p) {
      el('line', { class: 'pin-line', x1: p.x, x2: p.x, y1: H - m.b, y2: Y(afford(payRef, p.rate)) }, svg);
      el('circle', { cx: p.x, cy: Y(afford(payRef, p.rate)), r: p.k === S.ref ? 5 : 3, style: p.k === S.ref ? 'fill:var(--sheet);stroke:var(--ink);stroke-width:2' : 'fill:var(--ink-3)' }, svg);
      el('text', { class: 'pin-label', x: p.lx, y: H - 6 - (rowsUsed - 1 - p.row) * 14, 'text-anchor': 'middle' }, svg, p.label);
    });
    var hy = Y(afford(payRef, sel)), hx = X(sel);
    el('circle', { class: 'handle-ring', cx: hx, cy: hy, r: 13 }, svg);
    el('circle', { class: 'handle', cx: hx, cy: hy, r: 7 }, svg);
    var lab = sel.toFixed(2) + '% buys ' + usdK(afford(payRef, sel));
    el('text', { class: 'handle-label', x: hx, y: hy - 18, 'text-anchor': hx > W - 110 ? 'end' : hx < m.l + 90 ? 'start' : 'middle' }, svg, lab);
    el('rect', { class: 'hit', x: m.l, y: 0, width: W - m.l - m.r, height: H, style: 'cursor:ew-resize' }, svg);
    host._g = { m: m, r0: r0, r1: r1, W: W, payRef: payRef, P: P }; // read by the stable drag handlers
  }

  function bindCurveDrag() {
    var host = $('#curve'), drag = false;
    function toRate(e) {
      var g = host._g, svg = host.querySelector('svg');
      var v = g.r0 + (svgLocalX(svg, e, g.W) - g.m.l) / (g.W - g.m.l - g.m.r) * (g.r1 - g.r0);
      return Math.round(Math.min(g.r1, Math.max(g.r0, v)) * 20) / 20;
    }
    host.addEventListener('pointerdown', function (e) {
      if (!host._g) return;
      drag = true; host.setPointerCapture(e.pointerId); hideTip(); setRate(toRate(e));
    });
    host.addEventListener('pointermove', function (e) {
      if (!host._g) return;
      var v = toRate(e);
      if (drag) { setRate(v); return; }
      var g = host._g, bp = afford(g.payRef, v);
      showTip('<b>At ' + v.toFixed(2) + '%</b>' + row('Budget buys', usdK(bp)) + row('Lot at ' + S.a.lotLo + '\u2013' + S.a.lotHi + '%', usdKRange(bp, lotShare())) +
        row('vs compare', usdK(bp - g.P)), e.clientX, e.clientY);
    });
    function end() { drag = false; }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('pointerleave', function () { if (!drag) hideTip(); });
  }
  function setRate(v) {
    var R = rates();
    S.rate = v == null || Math.abs(v - R.now) < 0.001 ? null : v;
    renderHero(false);
  }
  function setDirt(open) { S.dirtOpen = open; store('hd-dirt', open); renderHero(false); }
  function fillBlanks() {
    var map = { 'a-price': Math.round(price()).toLocaleString('en-US'), 'a-down': S.a.down, 'a-ti': S.a.ti, 'a-lotLo': S.a.lotLo, 'a-lotHi': S.a.lotHi, 'a-bd': S.a.bd };
    Object.keys(map).forEach(function (id) { var i = $('#' + id); if (document.activeElement !== i) i.value = map[id]; });
  }
  var LIMITS = { price: [50000, 5e6], down: [0, 50], ti: [0, 6], lotLo: [5, 60], lotHi: [5, 60], bd: [0.125, 4], bf: [3000, 60000] };
  function bindBlanks() {
    ['price', 'down', 'ti', 'lotLo', 'lotHi', 'bd'].forEach(function (k) {
      var inp = $('#a-' + k);
      inp.addEventListener('input', function () {
        var v = num(inp.value), lim = LIMITS[k];
        if (!isFinite(v) || v < lim[0] || v > lim[1]) return;
        S.a[k] = v; store('hd-assume', S.a); renderHero(false);
      });
      inp.addEventListener('blur', fillBlanks);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
    });
  }

  // ------------------------------------------------------------ small multiples (costs, pulse)
  var UNIT_FMT = {
    '%': function (v) { return v.toFixed(2) + '%'; }, pts: function (v) { return v.toFixed(2); },
    'k SAAR': function (v) { return Math.round(v) + 'k'; }, k: function (v) { return v >= 1000 ? (v / 1000).toFixed(2) + 'M' : Math.round(v) + 'k'; },
    months: function (v) { return v.toFixed(1); }, $: usdK, index: function (v) { return v.toFixed(1); },
    units: count, SAAR: count, '$/hr': function (v) { return '$' + v.toFixed(2); }
  };
  function fredFmt(id) { var s = S.d.fred[id]; return (s && UNIT_FMT[s.units]) || function (v) { return v.toFixed(2); }; }
  function fredAbs(id) { var s = S.d.fred[id]; return s && /^(%|pts|months)$/.test(s.units); }
  function fredTitle(id) { return (S.d.fred[id] || {}).title || id; }
  function yoyOf(id) {
    var obs = series(id), l = last(obs); if (!l) return null;
    var prev = at(obs, isoMinus(l[0], 360)); if (!prev || prev === l) return null;
    return fredAbs(id) ? l[1] - prev[1] : (l[1] / prev[1] - 1) * 100;
  }
  function yoyTxt(id, v) {
    var u = (S.d.fred[id] || {}).units;
    return u === 'months' ? signed(v, 1, ' mo') : u === '%' || u === 'pts' ? signed(v * 100, 0, ' bp') : signed(v, 1, '%');
  }
  function fredSpec(id, title, years) {
    var obs = series(id), l = last(obs); if (!l) return null;
    var cut = years ? isoMinus(l[0], Math.round(years * 365.25)) : '0';
    var shown = obs.filter(function (o) { return o[0] >= cut; });
    var vals = shown.map(function (o) { return o[1]; });
    var since = shown[0][0].slice(0, 4);
    var flag = shown.length > 24 && l[1] >= Math.max.apply(null, vals) ? 'High since ' + since :
               shown.length > 24 && l[1] <= Math.min.apply(null, vals) ? 'Low since ' + since : '';
    var chg = yoyOf(id), fmt = fredFmt(id);
    var per = obs.length > 1 && ms(l[0]) - ms(obs[obs.length - 2][0]) > 80 * 864e5 ? 'Q' + (Math.floor(+l[0].slice(5, 7) / 3) + 1) + ' ' + l[0].slice(0, 4) : dmonth(l[0]);
    return { ref: 'f:' + id, title: title || fredTitle(id), v: fmt(l[1]), flag: flag,
      d: per + (chg != null ? ', ' + dir(chg, yoyTxt(id, chg)) + ' on the year' : ''),
      pts: toMs(id === 'DFEDTARU' ? stepify(shown) : shown), fmt: fmt,
      tipDate: function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); } };
  }
  function quoteSpec(sym, title) {
    var b = barsOf(sym); if (!b.length) return null;
    var pts = toMs(b), lp = qv(sym);
    if (isFinite(lp) && last(pts)[0] < Date.now() - 12 * 36e5) pts.push([Date.now(), lp]);
    var cur = isFinite(lp) ? lp : last(b)[1], y1 = at(b, isoMinus(todayIso(), 365)) || b[0];
    var chg = isYield(sym) ? (cur - y1[1]) * 100 : (cur / y1[1] - 1) * 100;
    var vals = pts.map(function (p) { return p[1]; });
    var flag = cur >= Math.max.apply(null, vals) ? '52-wk high' : cur <= Math.min.apply(null, vals) ? '52-wk low' : '';
    return { ref: 'q:' + sym, title: title || name(sym), v: lastStr(sym), flag: flag,
      d: 'Live, ' + chgQ(sym, true) + ' today; ' + dir(chg, isYield(sym) ? signed(chg, 0, ' bp') : signed(chg, 1, '%')) + ' on the year',
      pts: pts, fmt: function (v) { return fmtQ(sym, v); }, tipDate: dlong };
  }
  function renderMultiples(host, specs) {
    specs = specs.filter(Boolean);
    host.innerHTML = specs.map(function (s, i) {
      return '<div class="mini" data-open="' + s.ref + '" tabindex="0" role="button" aria-label="Open ' + esc(s.title) + '">' +
        '<div class="mini-k">' + esc(s.title) + '<span class="open-cue">Open</span></div>' +
        '<div class="mini-v">' + s.v + (s.flag ? '<span class="mini-flag">' + s.flag + '</span>' : '') + '</div>' +
        '<div class="mini-d">' + s.d + '</div><div class="mini-chart" data-i="' + i + '"></div></div>';
    }).join('');
    specs.forEach(function (s, i) {
      lineChart($('.mini-chart[data-i="' + i + '"]', host), {
        series: [{ pts: s.pts, cls: 's-ink' }], yFmt: s.fmt, yTicks: 2, xTicks: 3, markLast: true, m: { l: 44, r: 6, b: 18, t: 4 },
        aria: s.title,
        tip: function (t, v) { return '<b>' + s.tipDate(t) + '</b>' + row(esc(s.title), s.fmt(v[0])); }
      });
    });
  }
  var COSTS_F = [['WPUIP2311001', 'PPI, residential construction inputs'], ['WPU081', 'PPI, lumber and wood'], ['WPU101', 'PPI, iron and steel'],
    ['WPU1333', 'PPI, ready-mix concrete'], ['WPU1321', 'PPI, sand, gravel, stone'], ['WPUSI012011', 'PPI, construction materials'],
    ['USCONS', 'Construction jobs'], ['CES2000000003', 'Construction hourly pay']];
  function renderCosts() {
    var specs = tapeOf('costs').map(function (t) { return quoteSpec(t.sym, t.label + ' futures'); })
      .concat(COSTS_F.map(function (c) { return fredSpec(c[0], c[1], 10); }));
    renderMultiples($('#cost-multiples'), specs);
  }
  var PULSE = [['HOUST1F', 'Single-family starts'], ['PERMIT1', 'Single-family permits'], ['HSN1F', 'New home sales'],
    ['MSACSR', "Months' supply, new homes"], ['NHFSEPUCS', 'Completed new homes for sale'], ['MSPNHSUS', 'Median new home price'],
    ['UNDCON1USA', 'Single-family under construction'], ['COMPU1USA', 'Single-family completions'], ['CSUSHPINSA', 'Case-Shiller national index'],
    ['EXHOSLUSM495S', 'Existing home sales'], ['HOSINVUSM495N', 'Existing homes for sale'], ['RHORUSQ156N', 'Homeownership rate']];
  function renderPulse() {
    renderMultiples($('#multiples'), PULSE.map(function (p) { return fredSpec(p[0], p[1]); }));
  }

  // ------------------------------------------------------------ markets
  function metroRow(m) {
    var r = { name: m.name, state: m.state, cbsa: m.cbsa };
    var lp = last(m.price), la = last(m.active), ld = last(m.dom), lc = last(m.cuts);
    if (!lp || !la) return null;
    var yp = at(m.price, isoMinus(lp[0], 360)), ya = at(m.active, isoMinus(la[0], 360)), yd = ld && at(m.dom, isoMinus(ld[0], 360));
    r.asof = la[0];
    r.price = lp[1]; r.priceYoy = yp ? (lp[1] / yp[1] - 1) * 100 : NaN;
    r.active = la[1]; r.activeYoy = ya ? (la[1] / ya[1] - 1) * 100 : NaN;
    r.dom = ld ? ld[1] : NaN; r.domYoy = yd ? ld[1] - yd[1] : NaN;
    r.cutShare = lc ? lc[1] / la[1] * 100 : NaN;
    var lpd = last(m.pend || []); r.pendRatio = lpd ? lpd[1] / la[1] : NaN;
    r.spark = m.active.slice(-36);
    return r;
  }
  function metroRows() { return S.d.metros.map(metroRow).filter(Boolean); }
  function yoyCell(v, cap, txt) {
    var w = isFinite(v) ? Math.min(1, Math.abs(v) / cap) * 34 : 0;
    var col = v > 0 ? 'var(--up)' : 'var(--down)';
    return '<td class="yoy"><i style="width:' + w.toFixed(1) + 'px;background:' + col + '"></i>' + txt + '</td>';
  }
  function renderMarkets() {
    var rows = metroRows().filter(function (r) { return S.st === 'all' || S.st.split(' ').indexOf(r.state) >= 0; });
    var k = S.sort.k, dirn = S.sort.dir;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === 'string') return x.localeCompare(y) * dirn;
      return ((isFinite(x) ? x : -1e15) - (isFinite(y) ? y : -1e15)) * dirn;
    });
    $('#mkt-table tbody').innerHTML = rows.map(function (r) {
      return '<tr data-open="m:' + r.cbsa + '" data-cbsa="' + r.cbsa + '" tabindex="0"><td class="l name">' + r.name + '<small>' + r.state + '</small></td>' +
        '<td>' + usdK(r.price) + '</td>' + yoyCell(r.priceYoy, 10, signed(r.priceYoy, 1, '%')) +
        '<td>' + Math.round(r.active).toLocaleString('en-US') + '</td>' + yoyCell(r.activeYoy, 40, signed(r.activeYoy, 0, '%')) +
        '<td>' + (isFinite(r.dom) ? Math.round(r.dom) : '–') + '</td>' + yoyCell(r.domYoy, 25, signed(r.domYoy, 0, '')) +
        '<td>' + (isFinite(r.cutShare) ? r.cutShare.toFixed(0) + '%' : '–') + '</td>' +
        '<td class="l">' + sparkSvg(r.spark.map(function (p) { return [ms(p[0]), p[1]]; })) + '</td></tr>';
    }).join('');
    $$('#mkt-table th[data-k]').forEach(function (th) {
      th.setAttribute('aria-sort', th.dataset.k === k ? (dirn > 0 ? 'ascending' : 'descending') : 'none');
    });
    var any = metroRows()[0];
    if (any) $('#markets-note').textContent = 'Realtor.com listing data by metro for ' + dmonth(any.asof) +
      ', against a year earlier. Days is median days on market; cuts is the share of active listings with a price reduction. Select a metro for its full file.';
    renderPermits();
  }
  function renderPermits() {
    $('#permits').innerHTML = PERMITS.map(function (p) {
      var obs = series(p[0]), l = last(obs); if (!l) return '';
      var three = mean(obs.slice(-3).map(function (o) { return o[1]; })), chg = yoyOf(p[0]);
      var pts = obs.slice(-60).map(function (o) { return [ms(o[0]), o[1]]; });
      return '<button type="button" class="permit" data-open="f:' + p[0] + '"><span class="permit-k">' + p[1] + '</span>' +
        '<span class="permit-v">' + count(three) + '<small>/mo, 3-mo avg</small></span>' +
        '<span class="permit-d">' + (chg != null ? dir(chg, signed(chg, 0, '%')) + ' yoy' : '') + '</span>' +
        sparkSvg(pts, { w: 150, h: 30, cls: 'permit-spark' }) + '</button>';
    }).join('');
  }

  // ------------------------------------------------------------ calendar
  function events() {
    var ev = [];
    Object.keys(S.d.earnings || {}).forEach(function (sym) {
      var e = S.d.earnings[sym]; ev.push({ kind: 'earn', sym: sym, date: e.date, when: e.when, confirmed: e.confirmed });
    });
    (S.d.fomc || []).forEach(function (f) { ev.push({ kind: 'fomc', date: f.date, sep: f.sep }); });
    (S.d.releases || []).forEach(function (r) { ev.push({ kind: 'rel', date: r.date, name: r.name, ref: r.ref, period: r.period, time: r.time }); });
    return ev.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function relTime(t) { var h = +t.slice(0, 2), m = t.slice(3); return (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM'); }
  function renderCalendar() {
    var t0 = todayIso(), t1 = isoMinus(t0, -60);
    var ev = events().filter(function (e) { return e.date >= t0 && e.date <= t1; });
    var host = $('#timeline'); host.innerHTML = '';
    var W = host.clientWidth; if (!W) return;
    var m = { l: 10, r: 10 }, axisY = 38;
    var X = function (iso) { return m.l + (ms(iso) - ms(t0)) / (ms(t1) - ms(t0)) * (W - m.l - m.r); };
    var weeks = {}, placed = [];
    ev.forEach(function (e) {
      if (e.kind !== 'earn') return;
      var dow = (new Date(ms(e.date)).getUTCDay() + 6) % 7, wk = isoMinus(e.date, dow);
      (weeks[wk] = weeks[wk] || []).push(e);
    });
    Object.keys(weeks).forEach(function (wk) {
      weeks[wk].forEach(function (e, i) { placed.push({ e: e, x: Math.max(m.l, X(wk)) + 3, dx: X(e.date), lane: i }); });
    });
    var lanes = Math.max.apply(null, [0].concat(Object.keys(weeks).map(function (w) { return weeks[w].length; })));
    var H = axisY + 20 + Math.max(1, lanes) * 17 + 6;
    host.style.height = H + 'px';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': 'Next 60 days of earnings, Fed meetings and data releases' }, host);
    el('line', { class: 'tl-axis', x1: m.l, x2: W - m.r, y1: axisY, y2: axisY }, svg);
    for (var d = 0; d <= 60; d++) {
      var iso = isoMinus(t0, -d), dow = new Date(ms(iso)).getUTCDay();
      if (dow === 1) {
        el('line', { class: 'tl-week', x1: X(iso), x2: X(iso), y1: axisY - 4, y2: axisY + 4 }, svg);
        if (d > 2 && d < 58) el('text', { class: 'tl-sub', x: X(iso), y: axisY - 8, 'text-anchor': 'middle' }, svg, dshort(iso));
      }
    }
    el('line', { class: 'tl-today', x1: X(t0), x2: X(t0), y1: axisY - 12, y2: axisY + 8 }, svg);
    el('text', { class: 'tl-sub', x: X(t0) + 4, y: axisY - 24 }, svg, 'Today');
    ev.filter(function (e) { return e.kind === 'rel'; }).forEach(function (e) {
      var c = el('circle', { class: 'tl-rel', cx: X(e.date), cy: axisY, r: 4.5, style: e.ref ? 'cursor:pointer' : null }, svg);
      c.addEventListener('pointermove', function (ev2) { showTip('<b>' + esc(e.name) + '</b>' + row('Release', dshort(e.date) + ', ' + relTime(e.time)) + row('Covers', esc(e.period)), ev2.clientX, ev2.clientY); });
      c.addEventListener('pointerleave', hideTip);
      if (e.ref) c.addEventListener('click', function () { hideTip(); openDetail(e.ref); });
    });
    ev.filter(function (e) { return e.kind === 'fomc'; }).forEach(function (e) {
      var x = X(e.date);
      var p = el('path', { class: 'tl-fomc', d: 'M' + x + ',' + (axisY - 7) + 'l6,7l-6,7l-6,-7z', style: 'cursor:pointer' }, svg);
      el('text', { class: 'tl-label', x: x, y: axisY - 24, 'text-anchor': 'middle' }, svg, 'Fed');
      p.addEventListener('click', function () { openDetail('fed'); });
    });
    placed.forEach(function (p) {
      var y = axisY + 20 + p.lane * 17;
      el('rect', { class: 'tl-mark', x: p.dx - 3, y: axisY - 3, width: 6, height: 6 }, svg);
      var t = el('text', { class: 'tl-label', x: p.x, y: y, style: 'cursor:pointer' }, svg);
      el('tspan', { class: 'tl-sub' }, t, p.e.date.slice(8).replace(/^0/, '') + ' ');
      el('tspan', {}, t, p.e.sym);
      t.addEventListener('click', function () { hideTip(); openDetail('q:' + p.e.sym); });
      t.addEventListener('pointermove', function (ev2) { showTip('<b>' + esc(name(p.e.sym)) + '</b>' + row('Reports', dshort(p.e.date) + (p.e.confirmed ? '' : ' est.')) + (p.e.when ? row('Timing', p.e.when) : ''), ev2.clientX, ev2.clientY); });
      t.addEventListener('pointerleave', hideTip);
    });
    var CAP = 14, shown = S.calAll ? ev : ev.slice(0, CAP);
    $('#cal-list').innerHTML = shown.map(function (e) {
      var date = '<span class="cal-date">' + dshort(e.date) + '<small>' + inDays(e.date) + '</small></span>';
      if (e.kind === 'fomc') return '<li class="is-fed">' + date + '<span class="cal-what"><button type="button" data-open="fed"><b>Fed decision</b></button></span><span class="cal-when">' + (e.sep ? 'with projections' : '') + '</span></li>';
      if (e.kind === 'rel') return '<li class="is-rel">' + date + '<span class="cal-what">' + (e.ref ? '<button type="button" data-open="' + e.ref + '">' : '<span>') + '<b>' + esc(e.name) + '</b> <span class="cal-sub">' + esc(e.period) + '</span>' + (e.ref ? '</button>' : '</span>') + '</span><span class="cal-when">' + relTime(e.time) + '</span></li>';
      return '<li>' + date + '<span class="cal-what"><button type="button" data-open="q:' + e.sym + '"><b>' + e.sym + '</b> ' + esc(name(e.sym)) + '</button></span>' +
        '<span class="cal-when">' + [e.when, e.confirmed ? '' : 'est.'].filter(Boolean).join(', ') + '</span></li>';
    }).join('') + (ev.length > CAP ? '<li class="cal-more"><button type="button" class="linkish" data-calall>' + (S.calAll ? 'Show the first ' + CAP : 'Show all ' + ev.length) + '</button></li>' : '') ||
      '<li>Nothing scheduled in the next 60 days.</li>';
  }

  // ------------------------------------------------------------ wire
  function newsItem(n) {
    return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a><div class="wire-meta"><span>' + ago(n.ts) + '</span><span>' + esc(n.src) + '</span>' +
      n.tickers.map(function (t) { return '<button type="button" class="chip" data-open="q:' + t + '" aria-label="Open ' + t + '">' + t + '</button>'; }).join('') + '</div></li>';
  }
  function renderWire() {
    var seg = TOPICS.map(function (t) { return '<button type="button" data-topic="' + t[0] + '" aria-pressed="' + (S.topic === t[0] && !S.tickerFilter) + '">' + t[1] + '</button>'; });
    if (S.tickerFilter) seg.push('<button type="button" data-topic="all" aria-pressed="true">' + S.tickerFilter + ' ✕</button>');
    $('#topic-seg').innerHTML = seg.join('');
    var items = S.d.news.filter(function (n) {
      if (S.tickerFilter) return n.tickers.indexOf(S.tickerFilter) >= 0;
      return S.topic === 'all' || n.topic === S.topic;
    });
    $('#wire-note').textContent = items.length + ' headlines, newest first. Collected ' + ago(S.d.generated) + '; links open the source in a new tab, ticker chips open the company.';
    $('#wire-list').innerHTML = items.slice(0, 40).map(newsItem).join('') || '<li class="wire-empty">No headlines match. Pick All to see every topic.</li>';
  }

  // ================================================================ detail panel
  var REF_RE = /^(q:.+|f:[A-Z0-9]+|m:\d+|mort|fed)$/;
  function isRef(r) { return REF_RE.test(r || ''); }
  function hashRef() { var h = decodeURIComponent(location.hash.slice(1)); return isRef(h) ? h : null; }
  function curRef() { return last(S.trail); }
  function metroOf(cbsa) { return S.d.metros.filter(function (m) { return m.cbsa === cbsa; })[0]; }
  function refLabel(ref) {
    if (ref === 'mort') return '30-yr mortgage';
    if (ref === 'fed') return 'The Fed';
    var k = ref.slice(2);
    if (ref[0] === 'q') return name(k);
    if (ref[0] === 'f') return fredTitle(k);
    var m = metroOf(k); return m ? m.name + ', ' + m.state : k;
  }
  function refValue(ref) {
    if (ref === 'mort') return rates().now.toFixed(2) + '%';
    if (ref === 'fed') { var f = last(series('DFEDTARU')); return f ? f[1].toFixed(2) + '%' : ''; }
    var k = ref.slice(2);
    if (ref[0] === 'q') return S.q[k] ? lastStr(k) + ' ' + chgQ(k, true) : '';
    if (ref[0] === 'f') { var l = last(series(k)); return l ? fredFmt(k)(l[1]) : ''; }
    var r = metroOf(k) && metroRow(metroOf(k)); return r ? usdK(r.price) : '';
  }
  function refExists(ref) {
    if (ref === 'mort' || ref === 'fed') return true;
    var k = ref.slice(2);
    if (ref[0] === 'q') return !!S.q[k];
    if (ref[0] === 'f') return !!S.d.fred[k];
    return !!metroOf(k);
  }

  var lastFocus = null;
  function openDetail(ref, from) {
    if (!isRef(ref) || !refExists(ref)) return;
    hideTip(); closePalette();
    if (!S.drawer) {
      lastFocus = from || document.activeElement;
      S.trail = [ref];
      history.pushState({ hd: 1 }, '', '#' + ref);
      showDrawer();
    } else {
      var i = S.trail.indexOf(ref);
      S.trail = i >= 0 ? S.trail.slice(0, i + 1) : S.trail.concat([ref]);
      history.replaceState({ hd: 1 }, '', '#' + ref);
    }
    renderDetail();
    $('#drawer').scrollTop = 0;
  }
  function showDrawer() {
    S.drawer = true; $('#scrim').hidden = false; $('#drawer').hidden = false;
    document.body.classList.add('drawer-open');
    // keyboard arrivals land on Close (with its ring); pointer and deep-link arrivals focus the panel itself, no ring
    setTimeout(function () { if (kbdNav) $('#dr-close').focus(); else $('#drawer').focus({ preventScroll: true }); }, 0);
  }
  function hideDrawer() {
    if (!S.drawer) return;
    S.drawer = false; S.trail = []; $('#scrim').hidden = true; $('#drawer').hidden = true; hideTip();
    document.body.classList.remove('drawer-open');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function closeDetail() {
    if (!S.drawer) return;
    if (history.state && history.state.hd) history.back(); // popstate hides it
    else { history.replaceState(null, '', location.pathname + location.search); hideDrawer(); }
  }
  function backDetail() {
    if (S.trail.length < 2) return closeDetail();
    S.trail.pop();
    history.replaceState(history.state, '', '#' + curRef());
    renderDetail();
  }
  function dv(ref, dflt) { return (S.dv[ref] = S.dv[ref] || Object.assign({}, dflt)); }

  function renderDetail() {
    var ref = curRef(); if (!ref) return;
    $('#dr-back').hidden = S.trail.length < 2;
    $('#dr-trail').innerHTML = S.trail.map(function (r, i) {
      return '<li>' + (i < S.trail.length - 1 ? '<button type="button" data-trail="' + i + '">' + esc(refLabel(r)) + '</button>' : '<span aria-current="page">' + esc(refLabel(r)) + '</span>') + '</li>';
    }).join('');
    var body = $('#dr-body');
    if (ref === 'mort') mortDetail(body);
    else if (ref === 'fed') fedDetail(body);
    else if (ref[0] === 'q') quoteDetail(body, ref.slice(2));
    else if (ref[0] === 'f') fredDetail(body, ref.slice(2));
    else metroDetail(body, ref.slice(2));
  }

  // shared pieces
  function drHead(kind, title, value, change, sub) {
    return '<div class="dr-kind">' + kind + '</div><h2 class="dr-name" id="dr-name">' + esc(title) + '</h2>' +
      '<div class="dr-px"><span class="v">' + value + '</span><span class="d">' + (change || '') + '</span></div>' +
      (sub ? '<p class="dr-sub">' + sub + '</p>' : '');
  }
  function segHtml(id, opts, cur) {
    return '<div class="seg seg--sm" id="' + id + '">' + opts.map(function (o, i) {
      return '<button type="button" data-seg="' + id + '" data-v="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '"' + (id === 'dr-range' ? ' aria-keyshortcuts="' + (i + 1) + '"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function notesHtml(ref) {
    var n = NOTES[ref]; if (!n) return '';
    return '<div class="dr-notes">' + (n.what ? '<p><b>What it is.</b> ' + n.what + '</p>' : '') + (n.why ? '<p><b>Why it matters.</b> ' + n.why + '</p>' : '') + '</div>';
  }
  function relatedHtml(ref, extra) {
    var rel = ((NOTES[ref] || {}).rel || []).concat(extra || []).filter(function (r, i, a) { return r !== ref && a.indexOf(r) === i && refExists(r); });
    if (!rel.length) return '';
    return '<h3 class="dr-h">Connected</h3><div class="dr-rel">' + rel.map(function (r) {
      return '<button type="button" class="rel" data-open="' + r + '"><span class="rel-k">' + esc(refLabel(r)) + '</span><span class="rel-v">' + refValue(r) + '</span></button>';
    }).join('') + '</div>';
  }
  var KEYWORDS = {
    'q:@LBR.1': /lumber|timber|softwood/i, 'q:@HG.1': /copper/i, 'q:@CL.1': /\boil\b|crude/i, 'q:@HO.1': /diesel|fuel/i, 'q:@HRC.1': /steel/i,
    'q:US10Y': /treasur|yield|bond/i, 'q:US2Y': /treasur|yield|fed\b|federal reserve/i, 'q:US30Y': /treasur|yield|bond/i, 'q:US3M': /fed\b|federal reserve|bills?/i,
    mort: /mortgage/i, fed: /\bfed\b|federal reserve|fomc|powell|rate cut/i, 'q:KRE': /bank|lend|credit/i, 'q:MBB': /mortgage/i,
    'q:ITB': /homebuild|builder/i, 'q:XHB': /homebuild|builder|building products/i,
    'f:HOUST1F': /housing starts|permits|construction/i, 'f:PERMIT1': /permit/i, 'f:HSN1F': /new home sales|new-home sales/i,
    'f:EXHOSLUSM495S': /existing[- ]home/i, 'f:CSUSHPINSA': /home prices|case-shiller/i, 'f:MSACSR': /inventory|supply/i, 'f:NHFSEPUCS': /inventory|spec/i,
    'f:WPUIP2311001': /construction costs|materials|tariff/i, 'f:WPU081': /lumber/i, 'f:WPU101': /steel/i, 'f:USCONS': /construction (jobs|employment|labor|workers)/i
  };
  function topicOf(ref) {
    var t = (S.d.tape || []).filter(function (x) { return 'q:' + x.sym === ref; })[0];
    if (t) return { costs: 'costs', rates: 'rates', stocks: 'builders' }[t.group];
    if (ref === 'mort' || ref === 'fed' || /^f:(OBMM|MORTGAGE|DGS|T10Y|DFED)/.test(ref)) return 'rates';
    if (/^f:(WPU|USCONS|CES)/.test(ref)) return 'costs';
    if (/^f:/.test(ref)) return 'housing';
    return null;
  }
  function newsFor(ref, sym) { // tagged or keyword matches first, then the section's topic
    var kw = KEYWORDS[ref];
    var hit = S.d.news.filter(function (n) { return (sym && n.tickers.indexOf(sym) >= 0) || (kw && kw.test(n.t)); });
    var tp = topicOf(ref);
    if (hit.length < 4 && tp) hit = hit.concat(S.d.news.filter(function (n) { return n.topic === tp && hit.indexOf(n) < 0; }).slice(0, 6 - hit.length));
    return hit;
  }
  function newsHtml(items) {
    return '<h3 class="dr-h">Headlines</h3><ul class="dr-news">' + (items.length ? items.slice(0, 8).map(function (n) {
      return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a><small>' + ago(n.ts) + ', ' + esc(n.src) + '</small></li>'; }).join('')
      : '<li><small>No matching headlines in this snapshot.</small></li>') + '</ul>';
  }
  function factsHtml(rows) {
    return '<dl class="facts">' + rows.filter(Boolean).map(function (f) {
      return '<div' + (f[2] ? ' data-open="' + f[2] + '" tabindex="0" role="button"' : '') + '><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('') + '</dl>';
  }
  function perfHtml(cells) {
    return '<div class="perf">' + cells.map(function (c) {
      return '<div class="perf-c ' + (c[1] > 0 ? 'up' : c[1] < 0 ? 'down' : '') + '"><span>' + c[0] + '</span><b>' + (isFinite(c[1]) ? c[2] : '–') + '</b></div>'; }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- quote detail
  var QRANGES = [['1D', '1D'], ['5D', '5D'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['YTD', 'YTD'], ['1Y', '1Y'], ['3Y', '3Y'], ['10Y', '10Y']];
  /* CNBC's range names don't match what they return: 1Y = 2 years daily, 6M = 3 years daily,
     5Y = 10 years weekly. Fetch the source that covers the range and cut it by date. */
  var SRC = { '1D': '1D', '5D': '5D', '1M': '1Y', '3M': '1Y', '6M': '1Y', YTD: '1Y', '1Y': '1Y', '3Y': '6M', '10Y': '5Y' };
  var RDAYS = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 1096, '10Y': 3653 }; // same bases as the performance strip
  var barCache = {};
  function fetchSrc(sym, src) {
    var key = sym + '|' + src, ttl = /D$/.test(src) ? 6e4 : 6e5;
    if (barCache[key] && Date.now() - barCache[key].t < ttl) return Promise.resolve(barCache[key].pts);
    return fetch(BARS_URL(sym, src)).then(function (r) { return r.json(); }).then(function (j) {
      var pts = j.barData.priceBars.map(function (b) { return [+b.tradeTimeinMills, parseFloat(b.close)]; }).filter(function (p) { return isFinite(p[1]); });
      barCache[key] = { t: Date.now(), pts: pts }; return pts;
    });
  }
  function rangePts(sym, range) {
    return fetchSrc(sym, SRC[range]).then(function (pts) {
      if (range === '1D') return lastSession(pts, sym);
      if (range === '5D') return pts;
      var cut = range === 'YTD' ? Date.UTC(new Date().getFullYear() - 1, 11, 31) : Date.now() - RDAYS[range] * 864e5;
      var i = 0; while (i < pts.length && pts[i][0] < cut) i++;
      var out = pts.slice(Math.max(0, i - 1));
      var lp = qv(sym);
      if (isFinite(lp) && out.length && Date.now() - last(out)[0] > 18 * 36e5 && S.status === 'REG_MKT') out.push([Date.now(), lp]);
      return out;
    }).catch(function () {
      if (/D$/.test(range) && range !== 'YTD') return [];
      var cut = Date.now() - (RDAYS[range] || 366) * 864e5;
      return toMs(barsOf(sym)).filter(function (p) { return p[0] >= cut; });
    });
  }
  function perfCells(sym) {
    var b = barsOf(sym), lp = qv(sym); if (!b.length || !isFinite(lp)) return null;
    var y = isYield(sym), t = todayIso();
    var ch = function (p) { return p ? (y ? (lp - p[1]) * 100 : (lp / p[1] - 1) * 100) : NaN; };
    var f = function (v) { return y ? signed(v, 0, ' bp') : signed(v, 1, '%'); };
    var d1 = y ? num(S.q[sym].change) * 100 : num(S.q[sym].change_pct);
    return [['Today', d1, y ? signed(d1, 1, ' bp') : signed(d1, 2, '%')],
      ['1 week', ch(at(b, isoMinus(t, 7))), 0], ['1 month', ch(at(b, isoMinus(t, 30))), 0], ['3 months', ch(at(b, isoMinus(t, 91))), 0],
      ['6 months', ch(at(b, isoMinus(t, 182))), 0], ['YTD', ch(at(b, (new Date().getFullYear() - 1) + '-12-31')), 0], ['1 year', ch(at(b, isoMinus(t, 365)) || b[0]), 0]]
      .map(function (c) { return [c[0], c[1], c[2] || f(c[1])]; });
  }
  function range52(sym) {
    var q = S.q[sym] || {}, lp = num(q.last), lo = num(q.yrloprice), hi = num(q.yrhiprice), b = barsOf(sym).slice(-252);
    var dated = true;
    if ((!(lo > 0) || !(hi > lo) || lp > hi * 1.001 || lp < lo * 0.999) && b.length) { // futures carry front-month-only ranges
      var v = b.map(function (p) { return p[1]; }); lo = Math.min.apply(null, v); hi = Math.max.apply(null, v); dated = false;
    }
    if (!(hi > lo) || !isFinite(lp)) return '';
    lo = Math.min(lo, lp); hi = Math.max(hi, lp);
    var pos = (lp - lo) / (hi - lo) * 100;
    return '<div class="range52"><h3 class="dr-h">52-week range</h3><div class="range52-bar"><i style="left:' + pos.toFixed(1) + '%"></i></div>' +
      '<div class="range52-ends"><span>' + fmtQ(sym, lo) + (dated && q.yrlodate ? ' <small>' + esc(q.yrlodate) + '</small>' : '') + '</span><span>' + Math.round(pos) + '% of the way up</span><span>' + fmtQ(sym, hi) + (dated && q.yrhidate ? ' <small>' + esc(q.yrhidate) + '</small>' : '') + '</span></div></div>';
  }
  function analystHtml(sym) {
    var a = (S.d.analyst || {})[sym]; if (!a) return '';
    var out = '', lp = qv(sym);
    if (a.target && a.target.priceTarget) {
      var t = a.target, lo = Math.min(t.lowPriceTarget, lp), hi = Math.max(t.highPriceTarget, lp);
      var P = function (v) { return ((v - lo) / (hi - lo) * 100).toFixed(1) + '%'; };
      var up = (t.priceTarget / lp - 1) * 100;
      out += '<h3 class="dr-h">Street</h3><div class="street-bar"><span class="sb-range" style="left:' + P(t.lowPriceTarget) + ';right:' + (100 - parseFloat(P(t.highPriceTarget))).toFixed(1) + '%"></span>' +
        '<i class="sb-tgt" style="left:' + P(t.priceTarget) + '" title="Consensus target"></i><i class="sb-px" style="left:' + P(lp) + '" title="Price"></i></div>' +
        '<div class="range52-ends"><span>Low ' + px(t.lowPriceTarget) + '</span><span>Consensus ' + px(t.priceTarget) + ', ' + dir(up, signed(up, 1, '%') + ' from here') + '</span><span>High ' + px(t.highPriceTarget) + '</span></div>' +
        '<p class="dr-sub">' + (a.rating ? 'Mean rating <b>' + esc(a.rating) + '</b>. ' : '') + [t.buy + ' buy', t.hold + ' hold', t.sell + ' sell'].join(', ') + ' in the current month\u2019s tally.</p>';
    }
    if (a.surprise && a.surprise.length) {
      var mx = Math.max.apply(null, a.surprise.map(function (s) { return Math.abs(num(s.pct)) || 0; }).concat([1]));
      out += '<h3 class="dr-h">Earnings against the estimate</h3><div class="surp">' + a.surprise.slice().reverse().map(function (s) {
        var p = num(s.pct), h = Math.abs(p) / mx * 34;
        return '<div class="surp-c"><span class="surp-bar-wrap"><i class="' + (p >= 0 ? 'up-bg' : 'down-bg') + '" style="height:' + h.toFixed(1) + 'px;' + (p >= 0 ? 'bottom:50%' : 'top:50%') + '"></i></span>' +
          '<b class="' + (p >= 0 ? 'up' : 'down') + '">' + signed(p, 1, '%') + '</b><span>' + esc(s.q) + '</span><small>$' + s.eps + ' vs $' + esc(s.est) + '</small></div>';
      }).join('') + '</div>';
    }
    return out;
  }
  function lumberCalc(sym) {
    var b = barsOf(sym), lp = qv(sym); if (!b.length || !isFinite(lp)) return '';
    var bf = S.a.bf, per = function (p) { return p / 1000 * bf; };
    var y1 = at(b, isoMinus(todayIso(), 365)) || b[0];
    var v = b.map(function (p) { return p[1]; }), lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    return '<div class="calc"><h3 class="dr-h">Per house</h3><p class="blanks">At <label class="blank"><span class="sr-only">Board feet per house</span><input id="a-bf" inputmode="numeric" size="6" value="' + Math.round(bf).toLocaleString('en-US') + '"></label> board feet of framing lumber a house, ' +
      'today\u2019s futures price is <b>' + usd(per(lp)) + '</b> of lumber, ' + dir(per(lp) - per(y1[1]), usd(per(lp) - per(y1[1])).replace(MINUS, '') + (lp >= y1[1] ? ' more' : ' less')) + ' than a year ago. ' +
      'Over the year it ranged ' + usd(per(lo)) + ' to ' + usd(per(hi)) + ', a swing of ' + usd(per(hi) - per(lo)) + ' a house, or ' + usdK((per(hi) - per(lo)) * 100) + ' across a 100-lot community.</p>' +
      '<p class="terms-note">Futures are the mill price for a 27,500 board-foot contract; builders pay dealer prices on top, but the moves pass through. Board feet per house is a rule of thumb that varies with the plan; type your own.</p></div>';
  }
  function peersHtml(sym) {
    var u = S.d.universe.filter(function (x) { return x.sym === sym; })[0]; if (!u) return '';
    var peers = S.d.universe.filter(function (x) { return x.block === u.block; }).map(function (x) { return lbRow(x.sym); })
      .sort(function (a, b) { return (b.cap || 0) - (a.cap || 0); });
    return '<h3 class="dr-h">' + BLOCKS[u.block] + '</h3><table class="mkt peers"><thead><tr><th class="l">Company</th><th>Today</th><th>1 mo</th><th>YTD</th><th>Per +10 bp</th><th>P/E</th></tr></thead><tbody>' +
      peers.map(function (r) {
        return '<tr data-open="q:' + r.sym + '" tabindex="0"' + (r.sym === sym ? ' class="is-self"' : '') + '><td class="l name">' + r.sym + '<small>' + esc(name(r.sym)) + '</small></td>' +
          pctCell(r['1d'], 2) + pctCell(r['1m']) + pctCell(r.ytd) + pctCell(r.beta10) + '<td>' + (isFinite(r.pe) ? r.pe.toFixed(1) : '–') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function quoteKind(sym) {
    var n = NOTES['q:' + sym], q = S.q[sym] || {};
    var k = (n && n.kind) || { STOCK: 'Stock', DERIVATIVE: 'Future', INDEX: 'Index', FUND: 'ETF', BOND: 'Treasury' }[q.type] || '';
    return [k, q.exchange, sym].filter(Boolean).map(esc).join(' · ');
  }

  function quoteDetail(body, sym) {
    var ref = 'q:' + sym, V = dv(ref, { range: isYield(sym) ? '1Y' : '1Y', cmp: 'none' }), q = S.q[sym] || {}, y = isYield(sym);
    var inUni = S.d.universe.some(function (u) { return u.sym === sym; });
    var cmpOpts = y ? [['none', 'Alone'], ['US2Y', '2-yr'], ['US10Y', '10-yr'], ['US30Y', '30-yr']] : [['none', 'Alone'], ['ITB', 'vs ITB'], ['.SPX', 'vs S&P'], ['US10Y', 'vs 10-yr']];
    cmpOpts = cmpOpts.filter(function (o) { return o[0] !== sym; });
    var rb = rateBeta(sym), b = barsOf(sym), e = S.d.earnings[sym];
    var stats = [];
    if (q.mktcapView) stats.push(['Market cap', big(mcap(q.mktcapView))]);
    if (inUni) stats.push(['Next earnings', e ? dshort(e.date) + '<small>' + [inDays(e.date), e.when, e.confirmed ? '' : 'est.'].filter(Boolean).join(', ') + '</small>' : '–']);
    if (q.pe) stats.push(['P/E, trailing', esc(q.pe)]);
    if (q.fpe) stats.push(['P/E, forward', esc(q.fpe)]);
    if (q.eps) stats.push(['EPS, trailing', '$' + esc(q.eps)]);
    if (q.revenuettm) stats.push(['Revenue, trailing', big(num(q.revenuettm))]);
    if (q.GROSMGNTTM) stats.push(['Gross margin', num(q.GROSMGNTTM).toFixed(1) + '%']);
    if (q.NETPROFTTM) stats.push(['Net margin', num(q.NETPROFTTM).toFixed(1) + '%']);
    if (q.ROETTM) stats.push(['Return on equity', num(q.ROETTM).toFixed(1) + '%']);
    if (q.DEBTEQTYQ) stats.push(['Debt to equity', num(q.DEBTEQTYQ).toFixed(2)]);
    if (q.dividendyield) stats.push(['Dividend yield', esc(q.dividendyield)]);
    if (q.beta) stats.push(['Beta to the market', esc(q.beta)]);
    if (rb) stats.push(['Per +10 bp in the 10-yr', signed(rb.b10, 2, '%') + '<small>R\u00b2 ' + rb.r2.toFixed(2) + ', ' + rb.n + ' days</small>', 'q:US10Y']);
    if (!y && b.length > 30) {
      stats.push(['Volatility, 30 days', vol(b, 21).toFixed(0) + '%<small>annualized</small>']);
      stats.push(['Worst drawdown, 1 yr', signed(drawdown(b.slice(-252)), 1, '%')]);
      if (sym !== 'ITB' && barsOf('ITB').length) { var c = corr(sym, 'ITB'); if (isFinite(c)) stats.push(['Correlation with ITB', c.toFixed(2) + '<small>daily, 1 yr</small>', 'q:ITB']); }
    }
    if (qty(q.volume) > 0 && qty(q.tendayavgvol) > 0) stats.push(['Volume vs 10-day avg', (qty(q.volume) / qty(q.tendayavgvol) * 100).toFixed(0) + '%<small>' + count(qty(q.volume)) + ' shares</small>']);
    if (q.last_time) stats.push(['Last trade', new Date(q.last_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })]);
    var perf = perfCells(sym), n = NOTES[ref] || {};
    var rel = [];
    if (inUni) rel = ['q:ITB', 'q:US10Y'];
    body.innerHTML =
      drHead(quoteKind(sym), q.name && !NAMES[sym] ? q.name : name(sym) + (q.name && /\(/.test(q.name) ? ' ' + q.name.replace(/^[^(]*/, '') : ''), '<span id="dr-last">' + lastStr(sym) + '</span>', '<span id="dr-chg">' + chgQ(sym) + '</span>') +
      '<div class="dr-ctrl">' + segHtml('dr-range', QRANGES, V.range) + segHtml('dr-cmp', cmpOpts, V.cmp) + '</div>' +
      '<p class="dr-rchg" id="dr-rchg">&nbsp;</p><div class="dr-chart" id="dr-chart"></div>' +
      (perf ? perfHtml(perf) : '') + range52(sym) +
      (n.calc === 'lumber' ? lumberCalc(sym) : '') +
      notesHtml(ref) +
      (stats.length ? '<h3 class="dr-h">Figures</h3>' + factsHtml(stats) : '') +
      analystHtml(sym) + peersHtml(sym) + relatedHtml(ref, rel) + newsHtml(newsFor(ref, sym));
    var bf = $('#a-bf');
    if (bf) bf.addEventListener('change', function () {
      var v = num(bf.value); if (!isFinite(v) || v < LIMITS.bf[0] || v > LIMITS.bf[1]) { bf.value = S.a.bf; return; }
      S.a.bf = v; store('hd-assume', S.a); renderDetail();
    });
    drawQuoteChart(sym);
  }
  function drawQuoteChart(sym) {
    var ref = 'q:' + sym, V = S.dv[ref], host = $('#dr-chart'); if (!host) return;
    var want = sym + V.range + V.cmp; host.dataset.want = want;
    var y = isYield(sym), cmp = V.cmp !== 'none' ? V.cmp : null, intraday = V.range === '1D' || V.range === '5D';
    Promise.all([rangePts(sym, V.range), cmp ? rangePts(cmp, V.range) : Promise.resolve(null)]).then(function (r) {
      if (!S.drawer || host.dataset.want !== want || !document.contains(host)) return;
      var a = r[0], b = r[1];
      if (!a || a.length < 2) { host.innerHTML = '<p class="sheet-note">Chart data is unavailable right now.</p>'; $('#dr-rchg').innerHTML = '&nbsp;'; return; }
      var a0 = a[0][1], aN = last(a)[1], ser, fmtY, hl = [];
      var base = V.range === '1D' ? prevClose(sym) : a0;
      if (!isFinite(base)) base = a0;
      var mixed = cmp && isYield(cmp) !== y;
      if (!cmp) {
        ser = [{ pts: a, cls: 's-ink', label: sym }];
        fmtY = function (v) { return y ? v.toFixed(2) + '%' : px(v); };
        hl = [{ v: base, cls: 'zero', label: V.range === '1D' ? 'prior close' : '' }];
      } else if (y) { // yields side by side, in level
        ser = [{ pts: a, cls: 's-ink', label: sym.replace('US', '') }, { pts: b || [], cls: 's-ink2', label: cmp.replace('US', ''), soft: true }];
        fmtY = function (v) { return v.toFixed(2) + '%'; };
      } else if (mixed) { // a price against the 10-yr: both as change from the start, 10-yr inverted in bp/10
        var b0 = b && b.length ? b[0][1] : NaN;
        ser = [{ pts: a.map(function (p) { return [p[0], (p[1] / a0 - 1) * 100]; }), cls: 's-ink', label: sym },
               { pts: (b || []).map(function (p) { return [p[0], -(p[1] - b0) * 10]; }), cls: 's-flag', label: '10-yr, inverted', soft: true }];
        fmtY = function (v) { return signed(v, 0, '%'); }; hl = [{ v: 0, cls: 'zero' }];
      } else {
        var c0 = b && b.length ? b[0][1] : NaN;
        ser = [{ pts: a.map(function (p) { return [p[0], (p[1] / a0 - 1) * 100]; }), cls: 's-ink', label: sym },
               { pts: (b || []).map(function (p) { return [p[0], (p[1] / c0 - 1) * 100]; }), cls: 's-ink2', label: cmp === '.SPX' ? 'S&P' : cmp, soft: true }];
        fmtY = function (v) { return signed(v, 0, '%'); }; hl = [{ v: 0, cls: 'zero' }];
      }
      var chg = y ? (aN - base) * 100 : (aN / base - 1) * 100;
      var rlabel = { '1D': 'the session', '5D': 'five days', YTD: 'the year to date' }[V.range] || 'the last ' + ({ '1M': 'month', '3M': 'three months', '6M': 'six months', '1Y': 'year', '3Y': 'three years', '10Y': 'ten years' }[V.range]);
      var hiP = Math.max.apply(null, a.map(function (p) { return p[1]; })), loP = Math.min.apply(null, a.map(function (p) { return p[1]; }));
      $('#dr-rchg').innerHTML = dir(chg, y ? signed(chg, 0, ' bp') : signed(chg, 1, '%')) + ' over ' + rlabel + '; range ' + fmtQ(sym, loP) + ' to ' + fmtQ(sym, hiP) +
        (mixed ? '. The 10-yr line is inverted and scaled so 10 bp = 1%: when the lines move together, rates are driving the stock.' : '');
      lineChart(host, {
        series: ser, endLabels: !!cmp, markLast: !cmp, intraday: intraday, yFmt: fmtY, hlines: hl, area: !cmp,
        aria: name(sym) + ', ' + V.range,
        tip: function (t, v) {
          var when = new Date(t).toLocaleString('en-US', intraday ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          if (!cmp) return '<b>' + when + '</b>' + row('Close', fmtQ(sym, v[0])) + row('From start', y ? signed((v[0] - base) * 100, 0, ' bp') : signed((v[0] / base - 1) * 100, 1, '%'));
          if (y) return '<b>' + when + '</b>' + row(sym, v[0].toFixed(3) + '%') + row(cmp, v[1].toFixed(3) + '%') + row('Gap', signed((v[0] - v[1]) * 100, 0, ' bp'));
          if (mixed) return '<b>' + when + '</b>' + row(sym, signed(v[0], 1, '%')) + row('10-yr', signed(-v[1] * 10, 0, ' bp'));
          return '<b>' + when + '</b>' + row(sym, signed(v[0], 1, '%')) + row(cmp === '.SPX' ? 'S&P 500' : cmp, signed(v[1], 1, '%')) + row('Gap', signed(v[0] - v[1], 1, ' pts'));
        }
      });
    });
  }

  // ---------------------------------------------------------------- FRED detail
  var FRANGES = [['2', '2Y'], ['5', '5Y'], ['10', '10Y'], ['all', 'All']];
  var RELEASED_IN = { // series -> the Census release (keyed by its page ref) that updates it
    HOUST1F: 'f:HOUST1F', HOUST: 'f:HOUST1F', PERMIT1: 'f:HOUST1F', UNDCON1USA: 'f:HOUST1F', COMPU1USA: 'f:HOUST1F',
    HSN1F: 'f:HSN1F', MSACSR: 'f:HSN1F', MSPNHSUS: 'f:HSN1F', NHFSEPUCS: 'f:HSN1F', RHORUSQ156N: 'f:RHORUSQ156N'
  };
  var PERIOD = { Daily: 'day', Weekly: 'week', Monthly: 'month', Quarterly: 'quarter' };
  function fredDetail(body, id) {
    var ref = 'f:' + id, s = S.d.fred[id], obs = s.obs, l = last(obs), prev = obs[obs.length - 2];
    var fmt = fredFmt(id), abs = fredAbs(id), V = dv(ref, { range: obs.length > 200 && ms(l[0]) - ms(obs[0][0]) > 6 * 365 * 864e5 ? '5' : 'all', view: 'level' });
    var yr = at(obs, isoMinus(l[0], 360)), chgP = prev ? (abs ? l[1] - prev[1] : (l[1] / prev[1] - 1) * 100) : NaN;
    var gap = prev ? (ms(l[0]) - ms(prev[0])) / 864e5 : 30;
    var freq = gap > 80 ? 'Quarterly' : gap > 20 ? 'Monthly' : gap > 5 ? 'Weekly' : 'Daily';
    var per = freq === 'Quarterly' ? 'Q' + (Math.floor(+l[0].slice(5, 7) / 3) + 1) + ' ' + l[0].slice(0, 4) : freq === 'Monthly' ? dmonth(l[0]) : dshort(l[0]) + ', ' + l[0].slice(0, 4);
    var vals = obs.map(function (o) { return o[1]; });
    var hiO = obs.reduce(function (a, o) { return o[1] > a[1] ? o : a; }), loO = obs.reduce(function (a, o) { return o[1] < a[1] ? o : a; });
    var pctile = vals.filter(function (v) { return v <= l[1]; }).length / vals.length * 100;
    var avg3 = mean(obs.slice(-3).map(function (o) { return o[1]; }));
    var chgTxt = function (v) { return abs ? (s.units === 'months' ? signed(v, 1, ' mo') : signed(v * 100, 0, ' bp')) : signed(v, 1, '%'); };
    var rel = (S.d.releases || []).filter(function (r) { return r.ref && r.ref === RELEASED_IN[id]; })[0];
    var canYoy = !abs && obs.length > 14;
    var views = canYoy ? [['level', 'Level'], ['yoy', 'Year over year']] : null;
    body.innerHTML =
      drHead('Data series · ' + freq + ' · FRED ' + esc(id), s.title, fmt(l[1]),
        (prev ? dir(chgP, chgTxt(chgP)) + ' from the prior ' + PERIOD[freq] : ''),
        per + (yr && yr !== l ? '. A year earlier: ' + fmt(yr[1]) + ', so ' + dir(abs ? l[1] - yr[1] : (l[1] / yr[1] - 1) * 100, chgTxt(abs ? l[1] - yr[1] : (l[1] / yr[1] - 1) * 100)) + '.' : '')) +
      '<div class="dr-ctrl">' + segHtml('dr-range', FRANGES, V.range) + (views ? segHtml('dr-view', views, V.view) : '') + '</div>' +
      '<div class="dr-chart" id="dr-chart"></div>' +
      notesHtml(ref) +
      '<h3 class="dr-h">Figures</h3>' + factsHtml([
        ['Latest', fmt(l[1]) + '<small>' + per + '</small>'],
        prev ? ['Prior', fmt(prev[1]) + '<small>' + (freq === 'Monthly' ? dmonth(prev[0]) : dshort(prev[0])) + '</small>'] : null,
        freq !== 'Daily' ? ['Three-period average', fmt(avg3)] : null,
        ['Rank in the data shown', 'Higher than ' + Math.round(pctile) + '%<small>of ' + vals.length + ' readings since ' + obs[0][0].slice(0, 4) + '</small>'],
        ['High', fmt(hiO[1]) + '<small>' + dmonth(hiO[0]) + '</small>'],
        ['Low', fmt(loO[1]) + '<small>' + dmonth(loO[0]) + '</small>'],
        rel ? ['Next release', dshort(rel.date) + '<small>' + inDays(rel.date) + ', ' + relTime(rel.time) + ' ET, covers ' + esc(rel.period) + '</small>'] : null
      ]) +
      (id === 'EXHOSLUSM495S' || id === 'HOSINVUSM495N' ? '<p class="terms-note">NAR licenses this series to FRED for a trailing year only.</p>' : '') +
      '<p class="dr-src"><a href="https://fred.stlouisfed.org/series/' + esc(id) + '" target="_blank" rel="noopener">Source and full history on FRED ↗</a></p>' +
      relatedHtml(ref) + newsHtml(newsFor(ref));
    drawFredChart(id);
  }
  function drawFredChart(id) {
    var ref = 'f:' + id, V = S.dv[ref], host = $('#dr-chart'); if (!host) return;
    var obs = series(id), l = last(obs), fmt = fredFmt(id);
    var cut = V.range === 'all' ? '0' : isoMinus(l[0], Math.round(+V.range * 365.25));
    var pts, yF = fmt, hl = [], lbl = fredTitle(id);
    if (V.view === 'yoy') {
      pts = obs.map(function (o) { var p = at(obs, isoMinus(o[0], 360)); return p && p !== o && p[0] < o[0] ? [o[0], (o[1] / p[1] - 1) * 100] : null; })
        .filter(function (p) { return p && p[0] >= cut && p[0] >= isoMinus(obs[0][0], -350); });
      yF = function (v) { return signed(v, 0, '%'); }; hl = [{ v: 0, cls: 'zero' }]; lbl = 'Change on the year';
    } else {
      pts = obs.filter(function (o) { return o[0] >= cut; });
      if (id === 'DFEDTARU') pts = stepify(pts);
      if (id === 'T10Y2Y') hl = [{ v: 0, cls: 'zero', label: 'inverted below' }];
    }
    var yrAgo = at(obs, isoMinus(l[0], 360));
    lineChart(host, {
      series: [{ pts: toMs(pts), cls: 's-ink' }], yFmt: yF, markLast: true, area: V.view !== 'yoy', hlines: hl.concat(V.view !== 'yoy' && yrAgo && yrAgo !== l ? [{ v: yrAgo[1], cls: 'ref', label: 'a year ago' }] : []),
      aria: lbl,
      tip: function (t, v) { return '<b>' + new Date(t).toLocaleDateString('en-US', { month: 'short', day: ms(l[0]) - ms(obs[obs.length - 2][0]) < 20 * 864e5 ? 'numeric' : undefined, year: 'numeric', timeZone: 'UTC' }) + '</b>' + row(esc(lbl), yF(v[0])); }
    });
  }

  // ---------------------------------------------------------------- metro detail
  var MCHARTS = [['price', 'Median list price', usdK, 'pct'], ['ppsf', 'List price per sq ft', function (v) { return '$' + Math.round(v); }, 'pct'],
    ['active', 'Active listings', count, 'pct'], ['newl', 'New listings', count, 'pct'], ['pend', 'Pending listings', count, 'pct'],
    ['dom', 'Median days on market', function (v) { return Math.round(v) + ' d'; }, 'abs'], ['cutp', 'Share with a price cut', function (v) { return v.toFixed(0) + '%'; }, 'abs'],
    ['absorb', 'Pending to active', function (v) { return v.toFixed(2); }, 'abs']];
  function metroSeries(m, k) {
    if (k === 'cutp') { var am = {}; m.active.forEach(function (p) { am[p[0]] = p[1]; }); return m.cuts.filter(function (p) { return am[p[0]]; }).map(function (p) { return [p[0], p[1] / am[p[0]] * 100]; }); }
    if (k === 'absorb') { var a2 = {}; m.active.forEach(function (p) { a2[p[0]] = p[1]; }); return (m.pend || []).filter(function (p) { return a2[p[0]]; }).map(function (p) { return [p[0], p[1] / a2[p[0]]]; }); }
    return m[k] || [];
  }
  function metroDetail(body, cbsa) {
    var m = metroOf(cbsa), r = metroRow(m), all = S.d.metros;
    var rank = function (k, hiFirst) {
      var vals = all.map(function (x) { var s = metroSeries(x, k), l = last(s), p = l && at(s, isoMinus(l[0], 360)); return { c: x.cbsa, v: l && p ? (k === 'dom' || k === 'cutp' || k === 'absorb' ? l[1] - p[1] : (l[1] / p[1] - 1) * 100) : NaN }; })
        .filter(function (x) { return isFinite(x.v); }).sort(function (a, b) { return hiFirst ? b.v - a.v : a.v - b.v; });
      var i = vals.map(function (x) { return x.c; }).indexOf(cbsa);
      return i < 0 ? '' : (i + 1) + ' of ' + vals.length;
    };
    var specs = MCHARTS.map(function (c) {
      var s = metroSeries(m, c[0]), l = last(s); if (!l || s.length < 2) return null;
      var p = at(s, isoMinus(l[0], 360)), chg = p ? (c[3] === 'abs' ? l[1] - p[1] : (l[1] / p[1] - 1) * 100) : NaN;
      return { k: c[0], title: c[1], v: c[2](l[1]), fmt: c[2], pts: toMs(s),
        d: isFinite(chg) ? dir(chg, c[3] === 'abs' ? signed(chg, c[0] === 'absorb' ? 2 : 0, c[0] === 'cutp' ? ' pts' : c[0] === 'dom' ? ' days' : '') : signed(chg, 1, '%')) + ' yoy' +
          (rank(c[0], true) ? '<small>rank ' + rank(c[0], true) + '</small>' : '') : '' };
    }).filter(Boolean);
    var yoyA = r.activeYoy, yoyP = r.priceYoy;
    var read = isFinite(yoyA) && isFinite(yoyP) ? (yoyA > 15 && yoyP < 0 ? 'Inventory is building and asking prices are giving way: a buyer\u2019s market forming, which usually reaches builder incentives and lot takedown pace within a couple of quarters.' :
      yoyA > 15 ? 'Inventory is building faster than prices are adjusting. Watch the price-cut share: it tends to turn before list prices do.' :
      yoyA < -5 ? 'Inventory is tightening against a year ago, which supports pricing and lot demand.' :
      'Inventory and pricing are roughly holding against a year ago.') : '';
    var st = STATE_PERMIT[m.state], sameState = all.filter(function (x) { return x.state === m.state && x.cbsa !== cbsa; }).map(function (x) { return 'm:' + x.cbsa; });
    var kw = new RegExp(m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    body.innerHTML =
      drHead('Metro · CBSA ' + esc(cbsa) + ' · Realtor.com, monthly', m.name + ', ' + m.state, usdK(r.price),
        dir(yoyP, signed(yoyP, 1, '%') + ' on the year'), 'Median list price, ' + dmonth(r.asof) + '. ' + Math.round(r.active).toLocaleString('en-US') + ' active listings, ' +
        dir(yoyA, signed(yoyA, 0, '%')) + ' on the year.') +
      (read ? '<p class="dr-read">' + read + '</p>' : '') +
      '<div class="multiples multiples--dr">' + specs.map(function (s, i) {
        return '<div class="mini"><div class="mini-k">' + s.title + '</div><div class="mini-v">' + s.v + '</div><div class="mini-d">' + s.d + '</div><div class="mini-chart" data-mi="' + i + '"></div></div>'; }).join('') + '</div>' +
      '<p class="terms-note">Ranks compare the year-over-year change across the ' + all.length + ' metros on this sheet, 1 = largest increase. Pending to active is pending listings divided by active listings: higher means listings are going under contract faster.</p>' +
      relatedHtml('m:' + cbsa, (st ? [st] : []).concat(sameState)) +
      '<p class="dr-src"><a href="https://www.realtor.com/research/data/" target="_blank" rel="noopener">Realtor.com research data ↗</a></p>' +
      newsHtml(S.d.news.filter(function (n) { return kw.test(n.t); }));
    specs.forEach(function (s, i) {
      lineChart($('.mini-chart[data-mi="' + i + '"]', body), {
        series: [{ pts: s.pts, cls: 's-ink' }], yFmt: s.fmt, yTicks: 2, xTicks: 3, markLast: true, m: { l: 44, r: 6, b: 18, t: 4 }, aria: s.title,
        tip: function (t, v) { return '<b>' + new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) + '</b>' + row(s.title, s.fmt(v[0])); }
      });
    });
  }

  // ---------------------------------------------------------------- mortgage detail
  function mortDetail(body) {
    var R = rates(), V = dv('mort', { range: '3' }), c10 = num(S.q.US10Y && S.q.US10Y.change) * 100, P = price();
    var rows = refs(R).map(function (x) {
      var pay = payment(P, x.rate);
      return '<tr><td class="l">' + x.label + (x.date ? ' <small>' + dmonth(x.date) + '</small>' : '') + '</td><td>' + x.rate.toFixed(2) + '%</td><td>' + usd(pay) + '</td><td>' + (x.k === 'today' ? '–' : dir(payment(P, R.now) - pay, usd(payment(P, R.now) - pay).replace(MINUS, ''))) + '</td></tr>';
    }).join('');
    body.innerHTML =
      drHead('Mortgage rate · live estimate', '30-year mortgage', R.now.toFixed(2) + '%', R.liveOk && isFinite(c10) ? dir(c10, signed(c10, 1, ' bp') + ' today with the 10-yr') : '',
        'Optimal Blue printed ' + R.print[1].toFixed(2) + '% on ' + dshort(R.print[0]) + ', ' + R.spread.toFixed(2) + ' over the 10-yr that day (1-yr average ' + R.spreadAvg.toFixed(2) + ').') +
      '<div class="dr-ctrl">' + segHtml('dr-range', [['1', '1Y'], ['3', '3Y'], ['12', '12Y']], V.range) + '</div>' +
      '<div class="dr-chart" id="dr-chart"></div>' +
      '<h3 class="dr-h">Spread over the 10-year</h3><div class="chart chart--short" id="dr-chart2"></div>' +
      '<h3 class="dr-h">What the rate does to a payment</h3><table class="mkt peers"><thead><tr><th class="l">Rate</th><th>30-yr</th><th>Payment on ' + usdK(P) + '</th><th>Today vs then</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="terms-note">Principal, interest, taxes and insurance at ' + S.a.down + '% down and ' + S.a.ti + '% a year for taxes and insurance. <button type="button" class="linkish" data-dirt>Open the calculator</button></p>' +
      notesHtml('mort') + relatedHtml('mort') + newsHtml(newsFor('mort'));
    drawMortCharts();
  }
  function drawMortCharts() {
    var V = S.dv.mort, host = $('#dr-chart'); if (!host) return;
    var yrs = +V.range, cut = isoMinus(todayIso(), Math.round(yrs * 365.25));
    var f = function (id) { return toMs(series(id).filter(function (p) { return p[0] >= cut; })); };
    var ser = yrs > 3 ? [{ pts: f('MORTGAGE30US'), cls: 's-ink', label: '30-yr' }, { pts: f('MORTGAGE15US'), cls: 's-ink2', label: '15-yr', soft: true }]
      : [{ pts: f('OBMMIC30YF'), cls: 's-ink', label: 'Conforming' }, { pts: f('OBMMIFHA30YF'), cls: 's-ink2', label: 'FHA', soft: true },
         { pts: f('OBMMIJUMBO30YF'), cls: 's-ink3', label: 'Jumbo', soft: true }, { pts: f('DGS10'), cls: 's-flag', label: '10-yr', soft: true }];
    lineChart(host, {
      series: ser, endLabels: true, yFmt: function (v) { return v.toFixed(1) + '%'; }, aria: 'Mortgage rates',
      tip: function (t, v) { return '<b>' + dlong(t) + '</b>' + ser.map(function (s, i) { return row(s.label, v[i].toFixed(2) + '%'); }).join(''); }
    });
    var ob = series('OBMMIC30YF'), t10 = series('DGS10'), R = rates();
    var sp = ob.filter(function (p) { return p[0] >= isoMinus(todayIso(), 3 * 365); }).map(function (p) { var t = at(t10, p[0]); return t ? [ms(p[0]), p[1] - t[1]] : null; }).filter(Boolean);
    lineChart($('#dr-chart2'), {
      series: [{ pts: sp, cls: 's-ink' }], markLast: true, yFmt: function (v) { return v.toFixed(1); }, yTicks: 3,
      hlines: [{ v: R.spreadAvg, cls: 'ref', label: '1-yr avg ' + R.spreadAvg.toFixed(2) }], aria: 'Mortgage spread over the 10-year, three years',
      tip: function (t, v) { return '<b>' + dlong(t) + '</b>' + row('Spread', v[0].toFixed(2) + ' pts'); }
    });
  }

  // ---------------------------------------------------------------- Fed detail
  function fedDetail(body) {
    var V = dv('fed', { range: '3' }), f = last(series('DFEDTARU')), up = f ? f[1] : NaN, mid = up - 0.125;
    var y2 = qv('US2Y'), b3 = qv('US3M'), lean = (y2 - mid) * 100;
    var meets = (S.d.fomc || []).filter(function (m) { return m.date >= todayIso(); });
    var chg = series('DFEDTARU'), lastMove = null;
    for (var i = chg.length - 1; i > 0; i--) if (chg[i][1] !== chg[i - 1][1]) { lastMove = [chg[i][0], chg[i][1] - chg[i - 1][1]]; break; }
    body.innerHTML =
      drHead('Federal Reserve · FOMC', 'The Fed', isFinite(up) ? (up - 0.25).toFixed(2) + '\u2013' + up.toFixed(2) + '%' : '–',
        meets[0] ? 'Next decision ' + dshort(meets[0].date) + ', ' + inDays(meets[0].date) : '',
        lastMove ? 'Last move: ' + (lastMove[1] > 0 ? 'a hike' : 'a cut') + ' of ' + Math.abs(lastMove[1] * 100).toFixed(0) + ' bp on ' + dshort(lastMove[0]) + ', ' + lastMove[0].slice(0, 4) + '.' : '') +
      (isFinite(lean) ? '<p class="dr-read">The 2-year sits <b>' + Math.abs(lean).toFixed(0) + ' bp ' + (lean < 0 ? 'below' : 'above') + '</b> the middle of the funds range. ' +
        (lean < -15 ? 'The market is leaning toward cuts over the next two years.' : lean > 15 ? 'The market is leaning toward hikes over the next two years.' : 'The market expects policy to stay roughly where it is.') +
        ' A rough read, not a futures-implied probability.</p>' : '') +
      '<div class="dr-ctrl">' + segHtml('dr-range', [['3', '3Y'], ['12', '12Y']], V.range) + '</div>' +
      '<div class="dr-chart" id="dr-chart"></div>' +
      factsHtml([['2-yr Treasury', isFinite(y2) ? y2.toFixed(3) + '%<small>live</small>' : '–', 'q:US2Y'], ['3-month bill', isFinite(b3) ? b3.toFixed(3) + '%<small>live</small>' : '–', 'q:US3M'],
        ['2s10s curve', isFinite(qv('US10Y') - y2) ? signed((qv('US10Y') - y2) * 100, 0, ' bp') : '–', 'f:T10Y2Y'], ['Fed funds, upper', isFinite(up) ? up.toFixed(2) + '%' : '–', 'f:DFEDTARU']]) +
      '<h3 class="dr-h">Meetings</h3><ol class="cal-list">' + meets.map(function (m) {
        return '<li><span class="cal-date">' + dshort(m.date) + '<small>' + m.date.slice(0, 4) + '</small></span><span class="cal-what"><b>Rate decision</b></span><span class="cal-when">' + inDays(m.date) + (m.sep ? ', with projections' : '') + '</span></li>'; }).join('') + '</ol>' +
      notesHtml('fed') + relatedHtml('fed') + newsHtml(newsFor('fed'));
    drawFedChart();
  }
  function drawFedChart() {
    var V = S.dv.fed, host = $('#dr-chart'); if (!host) return;
    var cut = isoMinus(todayIso(), Math.round(+V.range * 365.25));
    var ff = series('DFEDTARU'), start = at(ff, cut);
    var ffp = stepify((start ? [[cut, start[1]]] : []).concat(ff.filter(function (p) { return p[0] > cut; })));
    if (ffp.length && last(ffp)[0] < todayIso()) ffp.push([todayIso(), last(ffp)[1]]);
    var ser = [{ pts: toMs(ffp), cls: 's-ink', label: 'Funds, upper' }];
    if (+V.range <= 3) ser.push({ pts: toMs(series('DGS2').filter(function (p) { return p[0] >= cut; })), cls: 's-flag', label: '2-yr', soft: true });
    lineChart(host, {
      series: ser, endLabels: true, yFmt: function (v) { return v.toFixed(1) + '%'; }, aria: 'Fed funds target and the 2-year Treasury',
      tip: function (t, v) { return '<b>' + dlong(t) + '</b>' + ser.map(function (s, i) { return row(s.label, v[i].toFixed(2) + '%'); }).join(''); }
    });
  }

  function redrawDetailChart() {
    var ref = curRef(); if (!ref) return;
    if (ref === 'mort') drawMortCharts(); else if (ref === 'fed') drawFedChart();
    else if (ref[0] === 'q') drawQuoteChart(ref.slice(2)); else if (ref[0] === 'f') drawFredChart(ref.slice(2));
    else renderDetail();
  }
  function setSeg(id, v) {
    var ref = curRef(), V = S.dv[ref]; if (!V) return;
    if (id === 'dr-range') V.range = v; else if (id === 'dr-cmp') V.cmp = v; else if (id === 'dr-view') V.view = v;
    $$('#' + id + ' button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
    redrawDetailChart();
  }

  // ------------------------------------------------------------ palette + keys
  var pal = { items: [], sel: 0 };
  var SECTIONS = [['today', 'Today'], ['board', 'The board'], ['rates', 'Rates'], ['dirt', 'Rates to dirt'], ['costs', 'Build costs'], ['pulse', 'Housing pulse'], ['markets', 'Your markets'], ['calendar', 'Schedule'], ['wire', 'Wire']];
  function paletteItems(qs) {
    var q = qs.trim().toLowerCase(), out = [];
    var n = parseFloat(q.replace(/[$,%]/g, ''));
    if (q && isFinite(n) && /^[$\d.,%\s]+$/.test(q)) {
      if (n >= 2 && n <= 12) out.push({ label: 'Try a ' + n.toFixed(2) + '% mortgage rate', hint: 'Rates to dirt', run: function () { S.dirtOpen = true; store('hd-dirt', true); setRate(n); go('dirt'); } });
      if (n >= 50000 && n <= 5e6) out.push({ label: 'Price the home at ' + usd(n), hint: 'Assumption', run: function () { S.a.price = n; S.dirtOpen = true; store('hd-assume', S.a); renderHero(false); go('dirt'); } });
    }
    var all = [], seen = {};
    var add = function (ref, label, hint, extra) { if (seen[ref] || !refExists(ref)) return; seen[ref] = 1; all.push({ label: label, hint: hint, key: (label + ' ' + (extra || '')).toLowerCase(), run: function () { openDetail(ref); } }); };
    S.d.universe.forEach(function (u) { add('q:' + u.sym, u.sym + '  ' + name(u.sym), 'Company', BLOCKS[u.block]); });
    (S.d.tape || []).forEach(function (t) { add('q:' + t.sym, t.label, t.group === 'costs' ? 'Material' : t.group === 'rates' ? 'Rate' : 'Market', t.sym + ' ' + name(t.sym)); });
    add('mort', '30-yr mortgage rate', 'Rate', 'mortgage spread optimal blue freddie');
    add('fed', 'The Fed', 'Policy', 'fomc fed funds federal reserve meeting');
    Object.keys(S.d.fred).forEach(function (id) { add('f:' + id, fredTitle(id), 'Data series', id + ' ' + ((NOTES['f:' + id] || {}).what || '')); });
    S.d.metros.forEach(function (m) { add('m:' + m.cbsa, m.name + ', ' + m.state, 'Metro', 'market listings'); });
    SECTIONS.forEach(function (s) { all.push({ label: s[1], hint: 'Go to section', key: s[1].toLowerCase(), run: function () { go(s[0]); } }); });
    METRICS.forEach(function (mt) { all.push({ label: 'Color the board by ' + mt[1].toLowerCase(), hint: 'The board', key: 'board color ' + mt[1].toLowerCase(), run: function () { setMetric(mt[0]); go('board'); } }); });
    all.push({ label: 'Switch day and night', hint: 't', key: 'theme dark light night day', run: toggleTheme });
    all.push({ label: 'Refresh quotes now', hint: 'r', key: 'refresh reload quotes', run: function () { poll(true); } });
    all.push({ label: 'Back to today\u2019s rate', hint: 'Rates to dirt', key: 'reset rate today calculator', run: function () { setRate(null); go('dirt'); } });
    var words = q.split(/\s+/).filter(Boolean);
    var hits = all.filter(function (i) { return words.every(function (w) { return i.key.indexOf(w) >= 0; }); });
    hits.sort(function (a, b) { return (b.key.indexOf(q) === 0) - (a.key.indexOf(q) === 0) || (b.label.toLowerCase().indexOf(q) >= 0) - (a.label.toLowerCase().indexOf(q) >= 0); });
    return out.concat(hits).slice(0, 14);
  }
  function openPalette() { $('#palette').hidden = false; var i = $('#pal-input'); i.value = ''; updatePalette(); i.focus(); }
  function closePalette() { $('#palette').hidden = true; }
  function updatePalette() { pal.items = paletteItems($('#pal-input').value); pal.sel = 0; drawPalette(); }
  function drawPalette() {
    $('#pal-list').innerHTML = pal.items.map(function (it, i) {
      return '<li role="option" id="pal-' + i + '" aria-selected="' + (i === pal.sel) + '" data-i="' + i + '"><span>' + esc(it.label) + '</span><small>' + esc(it.hint) + '</small></li>';
    }).join('') || '<li><span>Nothing matches. Try DHI, lumber, starts, Tampa, or a rate like 6.25.</span></li>';
    $('#pal-input').setAttribute('aria-activedescendant', pal.items.length ? 'pal-' + pal.sel : '');
    var s = $('#pal-' + pal.sel); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function runPal(i) { var it = pal.items[i]; closePalette(); if (it) it.run(); }
  function go(id) {
    if (S.drawer) closeDetail();
    var t = document.getElementById(id);
    if (t) t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function toggleTheme() {
    var h = document.documentElement, dark = h.getAttribute('data-theme') === 'study';
    if (dark) h.removeAttribute('data-theme'); else h.setAttribute('data-theme', 'study');
    localStorage.setItem('tgw-theme', dark ? 'field' : 'study');
    renderTitleblock(); renderBoard();
  }
  function setMetric(k) { S.metric = k; store('hd-metric', k); renderMetricSeg(); renderBoard(); }
  function renderMetricSeg() {
    $('#metric-seg').innerHTML = METRICS.map(function (m) { return '<button type="button" data-metric="' + m[0] + '" aria-pressed="' + (S.metric === m[0]) + '">' + m[1] + '</button>'; }).join('');
  }
  function renderMarketsSeg() {
    $('#state-seg').innerHTML = STATES.map(function (s) { return '<button type="button" data-st="' + s[0] + '" aria-pressed="' + (S.st === s[0]) + '">' + s[1] + '</button>'; }).join('');
  }

  // section nav: mark the section in view
  function bindJump() {
    var links = $$('#jump a');
    links.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); go(a.getAttribute('href').slice(1)); }); });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('is-here', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    SECTIONS.forEach(function (s) { var t = document.getElementById(s[0]); if (t) io.observe(t); });
  }

  var kbdNav = false; // last input modality, for where the drawer puts focus
  function bindUI() {
    bindBlanks(); bindCurveDrag(); bindJump();
    document.addEventListener('keydown', function (e) { if (!e.metaKey || e.key === 'k') kbdNav = true; }, true);
    document.addEventListener('pointerdown', function () { kbdNav = false; }, true);
    $('#rate').addEventListener('input', function (e) { setRate(parseFloat(e.target.value)); });
    $('#rate-reset').addEventListener('click', function () { setRate(null); });
    $('#dirt-toggle').addEventListener('click', function () { setDirt(!S.dirtOpen); });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-calall]')) { S.calAll = !S.calAll; renderCalendar(); return; }
      var t = e.target.closest('[data-seg],[data-trail],[data-dirt],[data-ref],[data-metric],[data-view],[data-movers],[data-st],[data-topic],[data-open],[data-reset-price],th[data-k],th[data-lk]');
      if (!t || t.closest('a[href]')) return;
      var ds = t.dataset;
      if (ds.seg) setSeg(ds.seg, ds.v);
      else if (ds.trail != null) { S.trail = S.trail.slice(0, +ds.trail + 1); history.replaceState(history.state, '', '#' + curRef()); renderDetail(); }
      else if (t.hasAttribute('data-dirt')) { closeDetail(); setDirt(true); setTimeout(function () { go('dirt'); }, 50); }
      else if (ds.ref) { S.ref = ds.ref; store('hd-ref', S.ref); renderHero(false); }
      else if (ds.metric) setMetric(ds.metric);
      else if (ds.view) { S.view = ds.view; store('hd-view', S.view); renderBoard(); }
      else if (ds.movers) { S.movers = ds.movers; renderMovers(); }
      else if (ds.st) { S.st = ds.st; renderMarketsSeg(); renderMarkets(); }
      else if (ds.topic) { S.topic = ds.topic; S.tickerFilter = null; renderWire(); }
      else if (ds.open) openDetail(ds.open, t);
      else if (t.hasAttribute('data-reset-price')) { S.a.price = null; store('hd-assume', S.a); renderHero(false); }
      else if (ds.lk) { var lk = ds.lk; S.lbSort = { k: lk, dir: S.lbSort.k === lk ? -S.lbSort.dir : (lk === 'sym' || lk === 'earn' ? 1 : -1) }; renderLeaderboard(); }
      else if (ds.k) { var k = ds.k; S.sort = { k: k, dir: S.sort.k === k ? -S.sort.dir : (k === 'name' ? 1 : -1) }; renderMarkets(); }
    });
    // hover cards for anything carrying a ticker
    document.addEventListener('pointermove', function (e) {
      var t = e.target.closest && e.target.closest('[data-tipsym]');
      if (t) showTip(lotTip(t.dataset.tipsym), e.clientX, e.clientY);
    });
    document.addEventListener('pointerout', function (e) {
      var t = e.target.closest && e.target.closest('[data-tipsym]');
      if (t && !t.contains(e.relatedTarget)) hideTip();
    });
    $('#btn-theme').addEventListener('click', toggleTheme);
    $('#btn-palette').addEventListener('click', openPalette);
    $('#btn-help').addEventListener('click', function () { $('#keys').hidden = false; });
    $('#dr-close').addEventListener('click', closeDetail);
    $('#dr-back').addEventListener('click', backDetail);
    $('#scrim').addEventListener('click', closeDetail);
    $('#pal-input').addEventListener('input', updatePalette);
    $('#pal-input').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { pal.sel = Math.min(pal.items.length - 1, pal.sel + 1); drawPalette(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { pal.sel = Math.max(0, pal.sel - 1); drawPalette(); e.preventDefault(); }
      else if (e.key === 'Enter') { runPal(pal.sel); e.preventDefault(); }
    });
    $('#pal-list').addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) runPal(+li.dataset.i); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#palette').hidden || !$('#keys').hidden) { closePalette(); $('#keys').hidden = true; return; }
        closeDetail(); return;
      }
      var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Enter / Space on anything that opens
      var ot = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-open][role="button"],tr[data-open]');
      if ((e.key === 'Enter' || e.key === ' ') && ot) { e.preventDefault(); openDetail(ot.dataset.open, ot); return; }
      if (S.drawer) {
        if (e.key === 'Backspace') { e.preventDefault(); backDetail(); return; }
        if (/^[1-9]$/.test(e.key)) { var b = $$('#dr-range button')[+e.key - 1]; if (b) b.click(); return; }
      }
      if (e.key === '/') { e.preventDefault(); openPalette(); }
      else if (e.key === '?') { $('#keys').hidden = false; }
      else if (e.key === 't') toggleTheme();
      else if (e.key === 'r') poll(true);
      else if (e.key === 'm') { var i = METRICS.map(function (m) { return m[0]; }).indexOf(S.metric); setMetric(METRICS[(i + 1) % METRICS.length][0]); }
    });
    $('#drawer').addEventListener('keydown', function (e) { // keep focus inside the drawer
      if (e.key !== 'Tab') return;
      var f = $$('button:not([hidden]), a[href], input, [tabindex="0"]', $('#drawer')).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    function followHash() { // back/forward, or a new #ref typed or pasted while the page is open
      var r = hashRef();
      if (!r || !refExists(r)) { hideDrawer(); return; }
      if (r === curRef() && S.drawer) return;
      var i = S.trail.indexOf(r);
      S.trail = i >= 0 ? S.trail.slice(0, i + 1) : (S.drawer ? S.trail.concat([r]) : [r]);
      if (!S.drawer) showDrawer();
      renderDetail();
    }
    addEventListener('popstate', followHash);
    addEventListener('hashchange', followHash);
    var rt;
    addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(renderCharts, 150); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { poll(); pollIntra(); } });
  }

  // ------------------------------------------------------------ live loop
  var timer = null;
  function poll(manual) {
    clearTimeout(timer);
    var syms = S.d.universe.map(function (u) { return u.sym; }).concat((S.d.tape || []).map(function (t) { return t.sym; }), ['US5Y', '.DXY']);
    return fetch(QUOTE_URL(syms), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      j.FormattedQuoteResult.FormattedQuote.forEach(function (q) { if (q.code === 0) S.q[q.symbol] = q; });
      S.live = true; S.lastTick = new Date();
      S.status = (S.q.DHI && S.q.DHI.curmktstatus) || S.status;
      renderLive(true);
      if (manual) pollIntra();
    }).catch(function () {
      S.live = false; renderTitleblock();
    }).then(function () {
      if (document.hidden) return;
      timer = setTimeout(poll, S.status === 'REG_MKT' ? 20000 : 120000);
    });
  }
  function renderLive(flash) {
    renderTitleblock(); renderTiles(flash); renderSession(); renderMovers(); renderHero(false); renderBoard(); renderLede(); renderRates();
    var ref = curRef();
    if (S.drawer && ref && ref[0] === 'q') {
      var sym = ref.slice(2), l = $('#dr-last'), c = $('#dr-chg');
      if (l) l.textContent = lastStr(sym);
      if (c) c.innerHTML = chgQ(sym);
    }
  }
  function renderCharts() {
    if (!S.d) return;
    renderSession(); renderHero(false); renderBoard(); renderRates(); renderCosts(); renderPulse(); renderCalendar();
    if (S.drawer) redrawDetailChart();
  }

  // ------------------------------------------------------------ boot
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // closing the drawer walks history; keep the page still
  fetch('data.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    S.d = d; S.q = Object.assign({}, d.quotes);
    S.status = (d.quotes.DHI || {}).curmktstatus || null;
    renderMetricSeg(); renderMarketsSeg(); bindUI();
    renderTitleblock(); renderLede(); renderTiles(false); renderSession(); renderMovers();
    renderBoard(); renderRates(); renderHero(true); renderCosts(); renderPulse(); renderMarkets(); renderCalendar(); renderWire();
    S.booted = true;
    var r = hashRef();
    if (r && refExists(r)) { S.trail = [r]; showDrawer(); renderDetail(); }
    poll(); pollIntra();
  }).catch(function (err) {
    $('#lede').textContent = 'The data snapshot did not load (' + err.message + '). Run scripts/build-dashboard.py to rebuild dashboard/data.json.';
    console.error(err);
  });
})();
