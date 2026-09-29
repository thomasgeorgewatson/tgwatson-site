/* tgwatson.com/dashboard — Housing desk
   Snapshot (data.json, built by scripts/build-dashboard.py) + live CNBC quotes polled
   from the browser. No libraries: every chart is hand-drawn SVG. */
(function () {
  'use strict';

  // ------------------------------------------------------------ plumbing
  var $ = function (s, r) { return (r || document).querySelector(s); };
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

  var QUOTE_URL = function (syms) {
    return 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
      syms.map(encodeURIComponent).join('%7C') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
  };
  var BARS_URL = function (sym, range) {
    return 'https://ts-api.cnbc.com/harmony/app/charts/' + range + '.json?symbol=' + encodeURIComponent(sym);
  };

  var NAMES = {
    DHI: 'D.R. Horton', LEN: 'Lennar', PHM: 'PulteGroup', NVR: 'NVR', TOL: 'Toll Brothers',
    KBH: 'KB Home', MTH: 'Meritage Homes', MHO: 'M/I Homes', CCS: 'Century Communities',
    GRBK: 'Green Brick Partners', LGIH: 'LGI Homes', DFH: 'Dream Finders Homes', BZH: 'Beazer Homes',
    HOV: 'Hovnanian', FOR: 'Forestar', JOE: 'St. Joe', HHH: 'Howard Hughes', FPH: 'Five Point',
    BN: 'Brookfield Corp', SKY: 'Champion Homes', CVCO: 'Cavco', BLDR: 'Builders FirstSource',
    RKT: 'Rocket Companies', ITB: 'iShares Home Construction', XHB: 'SPDR Homebuilders'
  };
  var BLOCKS = { A: 'Production builders', B: 'Land and capital', C: 'Manufactured, supply, mortgage' };
  var TAPE = [['ITB', 'Home construction ETF'], ['XHB', 'Homebuilders ETF'], ['.SPX', 'S&P 500'],
    ['US2Y', '2-yr Treasury'], ['US10Y', '10-yr Treasury'], ['US30Y', '30-yr Treasury'],
    ['@LBR.1', 'Lumber futures'], ['.VIX', 'VIX']];
  var METRICS = [['1d', 'Today', 4], ['1m', '1 month', 15], ['ytd', 'Year to date', 35], ['hi', 'Off 52-wk high', 50]];
  var TOPICS = [['all', 'All'], ['builders', 'Builders'], ['rates', 'Rates'], ['housing', 'Housing data'], ['florida', 'Florida'], ['land', 'Land']];
  var STATES = [['all', 'All'], ['FL', 'Florida'], ['GA SC NC', 'Georgia and Carolinas'], ['TN', 'Tennessee']];
  var DEFAULTS = { price: null, down: 10, ti: 2, lotLo: 20, lotHi: 35, bd: 1 }; // finished lots run 20-35% of price

  var S = {
    d: null, q: {}, live: false, lastTick: null, status: null, drawer: null, booted: false,
    metric: store('hd-metric') || '1d', ref: store('hd-ref') || '1y', rate: null,
    a: Object.assign({}, DEFAULTS, store('hd-assume') || {}),
    topic: 'all', tickerFilter: null, st: 'all', sort: { k: 'activeYoy', dir: -1 }
  };

  // ------------------------------------------------------------ numbers
  function num(v) { return v == null ? NaN : parseFloat(String(v).replace(/[,%$+]/g, '')); }
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
  function px(v) { return isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–'; }
  function ms(iso) { return Date.parse(iso + 'T12:00:00Z'); }
  function dshort(iso) { return new Date(ms(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function dmonth(iso) { return new Date(ms(iso)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function isoMinus(iso, days) { var d = new Date(ms(iso)); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
  function todayIso() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
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

  // ------------------------------------------------------------ rates model
  function rates() {
    var ob = series('OBMMIC30YF'), t10 = series('DGS10'), pm = series('MORTGAGE30US');
    var base = ob.length ? ob : pm;
    var print = last(base);
    var t10At = at(t10, print[0]);
    var spread = t10At ? print[1] - t10At[1] : NaN;
    var live10 = num(S.q.US10Y && S.q.US10Y.last);
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

  /* Line chart. o.series: [{pts:[[ms,v]], cls, label, color}], o.band: [i,j] shades between two series,
     o.yFmt, o.tip(msAt, values[]), o.endLabels, o.intraday, o.m (margins) */
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
    var pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.02 || 1; y0 -= pad; y1 += pad;
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
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
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
      var avg = A.reduce(function (a, b) { return a + b; }, 0) / A.length;
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
    var s4 = [];
    if (e1) s4.push(esc(name(e1.sym)) + ' reports ' + dshort(e1.date));
    if (f1) s4.push('the Fed decides ' + dshort(f1.date));
    if (s4.length) out.push('Next: ' + s4.join('; ') + '.');
    $('#lede').innerHTML = out.join(' ');
  }

  // ------------------------------------------------------------ hero: rates to dirt
  function refRate(R) {
    var r = refs(R).filter(function (x) { return x.k === S.ref; })[0] || refs(R)[1];
    return r;
  }
  function selRate(R) { return S.rate == null ? R.now : S.rate; }

  function renderHero(pulse) {
    var R = rates(), ref = refRate(R), sel = selRate(R), P = price(), whatIf = S.rate != null;
    var payRef = payment(P, ref.rate), paySel = payment(P, sel);
    var buys = afford(payRef, sel), sh = lotShare();
    var refTxt = ref.k === 'today' ? 'today' : ref.label.toLowerCase() + ' (' + ref.rate.toFixed(2) + '%)';
    var c10 = num(S.q.US10Y && S.q.US10Y.change) * 100;

    var links = [
      { k: '10-yr Treasury', v: R.live10.toFixed(2) + '%',
        d: R.liveOk && isFinite(c10) ? dir(c10, signed(c10, 1, ' bp') + ' today') : 'FRED close, ' + dshort(last(series('DGS10'))[0]) },
      { k: 'Mortgage spread over the 10-yr', v: '+' + R.spread.toFixed(2),
        d: '1-yr average ' + R.spreadAvg.toFixed(2) },
      { k: whatIf ? '30-yr mortgage, what-if' : '30-yr mortgage, today', v: sel.toFixed(2) + '%', wi: whatIf,
        d: whatIf ? 'Today ' + R.now.toFixed(2) + '%' : 'Optimal Blue ' + R.print[1].toFixed(2) + '% on ' + dshort(R.print[0]) + (R.liveOk ? ', moved with the 10-yr since' : '') },
      { k: 'Monthly payment on a ' + usdK(P) + ' home', v: usd(paySel),
        d: ref.rate === sel ? 'Same as ' + refTxt : dir(paySel - payRef, signed(paySel - payRef, 0).replace(/(\d+)/, function (x) { return '$' + (+x).toLocaleString('en-US'); }) + ' vs ' + refTxt) },
      { k: 'House that payment budget buys', v: usdK(buys),
        d: Math.abs(buys - P) < 1 ? 'Set a compare rate or drag the rate' : dir(buys - P, usdK(buys - P) + ' of price') },
      { k: 'Finished lot at ' + Math.round(sh[0] * 100) + '\u2013' + Math.round(sh[1] * 100) + '% of price', v: usdKRange(buys, sh), range: true,
        d: Math.abs(buys - P) < 1 ? usdKRange(P, sh) + ' at the compare rate' : dir(buys - P, usdK((buys - P) * sh[0]) + ' to ' + usdK((buys - P) * sh[1]) + ' per lot') }
    ];
    var ol = $('#chain');
    ol.innerHTML = links.map(function (l, i) {
      return '<li class="link' + (l.wi ? ' is-whatif' : '') + (l.range ? ' is-range' : '') + (pulse ? ' is-pulse' : '') + '" style="animation-delay:' + (i * 110) + 'ms">' +
        '<div class="link-k">' + l.k + '</div><div class="link-v">' + l.v + '</div><div class="link-d">' + l.d + '</div></li>';
    }).join('');

    // compare segment
    $('#ref-seg').innerHTML = refs(R).map(function (r) {
      return '<button type="button" data-ref="' + r.k + '" aria-pressed="' + (r.k === S.ref) + '">' + r.label +
        (r.k === 'today' ? '' : ' <span class="sr-only">' + r.rate.toFixed(2) + '%</span>') + '</button>';
    }).join('');

    var slider = $('#rate');
    if (document.activeElement !== slider) slider.value = sel.toFixed(2);
    $('#rate-out').textContent = sel.toFixed(2) + '%';
    $('#rate-reset').hidden = !whatIf;

    // assumptions + buydown
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
    // pins for the named rates: labels under the axis, a second row when a narrow chart can't fit them
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

    // the move: shaded between compare price and the curve, from compare rate to selected rate
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

    // handle
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

  function fillBlanks() {
    var map = { 'a-price': Math.round(price()).toLocaleString('en-US'), 'a-down': S.a.down, 'a-ti': S.a.ti, 'a-lotLo': S.a.lotLo, 'a-lotHi': S.a.lotHi, 'a-bd': S.a.bd };
    Object.keys(map).forEach(function (id) { var i = $('#' + id); if (document.activeElement !== i) i.value = map[id]; });
  }
  var LIMITS = { price: [50000, 5e6], down: [0, 50], ti: [0, 6], lotLo: [5, 60], lotHi: [5, 60], bd: [0.125, 4] };
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

  // ------------------------------------------------------------ tape
  function renderTape(flash) {
    var host = $('#tape'), prev = {};
    Array.prototype.forEach.call(host.querySelectorAll('.tick'), function (t) { prev[t.dataset.sym] = t.dataset.last; });
    host.innerHTML = TAPE.map(function (t) {
      var q = S.q[t[0]] || {}, isRate = /^US/.test(t[0]);
      var v = isRate ? num(q.last).toFixed(3) + '%' : px(num(q.last));
      var d = /UNCH/.test(q.change_pct + q.change) ? 'unch' :
        isRate ? dir(num(q.change), signed(num(q.change) * 100, 1, ' bp')) : dir(num(q.change_pct), signed(num(q.change_pct), 2, '%'));
      var changed = flash && prev[t[0]] && prev[t[0]] !== String(q.last);
      return '<div class="tick' + (changed ? ' flash' : '') + '" data-sym="' + t[0] + '" data-last="' + esc(q.last) + '">' +
        '<div class="tick-k">' + t[1] + '</div><span class="tick-v">' + v + '</span><span class="tick-d">' + d + '</span></div>';
    }).join('');
  }

  // ------------------------------------------------------------ board (plat)
  function barsOf(sym) { return S.d.bars[sym] || []; }
  function metricVal(sym, k) {
    var q = S.q[sym] || {}, lastPx = num(q.last), b = barsOf(sym);
    if (k === '1d') return num(q.change_pct);
    if (!isFinite(lastPx) || !b.length) return NaN;
    if (k === '1m') { var p = b[Math.max(0, b.length - 22)]; return (lastPx / p[1] - 1) * 100; }
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
  function divColor(t) { // t in [-1, 1]; stepped so equal colors mean equal bins
    var mid = hexRgb(css('--mid')), pole = hexRgb(css(t >= 0 ? '--up' : '--down'));
    var k = Math.round(Math.min(1, Math.abs(t)) * STEPS) / STEPS;
    return mid.map(function (v, i) { return Math.round(v + (pole[i] - v) * k); });
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
    // streets: dashed centerlines in the gaps
    if (W >= 560) {
      el('line', { class: 'street', x1: rects[0].w + street / 2, x2: rects[0].w + street / 2, y1: 0, y2: H }, svg);
      el('line', { class: 'street', x1: rects[1].x, x2: W, y1: rects[1].h + street / 2, y2: rects[1].h + street / 2 }, svg);
    }
    blocks.forEach(function (b, bi) {
      var R = rects[bi];
      el('rect', { class: 'block-edge', x: R.x + .5, y: R.y + .5, width: R.w - 1, height: R.h - 1 }, svg);
      var ms_ = b.items.map(function (i) { return i.m; }).filter(isFinite);
      var avg = ms_.length ? ms_.reduce(function (a, v) { return a + v; }, 0) / ms_.length : NaN;
      var bl = el('text', { class: 'block-label', x: R.x + 8, y: R.y + 16 }, svg, 'Block ' + b.k);
      el('tspan', { class: 'block-sub', dx: 8 }, bl, BLOCKS[b.k]);
      if (isFinite(avg) && R.w > 250) el('text', { class: 'block-sub', x: R.x + R.w - 8, y: R.y + 16, 'text-anchor': 'end' }, svg, 'avg ' + signed(avg, 1, '%'));
      var inner = { x: R.x + 3, y: R.y + head, w: R.w - 6, h: R.h - head - 3 };
      squarify(b.items, inner).forEach(function (c) { drawLot(svg, c, lim); });
    });
    // legend
    var one = S.metric === 'hi';
    var cells = [];
    for (var s = one ? 0 : -STEPS; s <= STEPS; s++) {
      if (one && s > 0) break;
      cells.push('<i style="background:' + rgbStr(divColor(one ? -(STEPS + s) / STEPS : s / STEPS)) + '"></i>');
    }
    if (one) cells.reverse();
    $('#plat-legend').innerHTML = '<span class="ramp">' + (one ? MINUS + lim + '%' : MINUS + lim + '%') +
      ' <span class="ramp-bar" aria-hidden="true">' + cells.join('') + '</span> ' + (one ? 'at the high' : '+' + lim + '%') + '</span>' +
      '<span>Color is ' + METRICS.filter(function (m) { return m[0] === S.metric; })[0][1].toLowerCase() + ', capped at the ends.</span>' +
      '<span>Lot area follows the square root of market cap.</span>';
  }

  function drawLot(svg, c, lim) {
    var sym = c.it.sym, v = c.it.m, t = isFinite(v) ? v / lim : 0;
    if (S.metric === 'hi') t = Math.min(0, t);
    var fill = divColor(t), ink = textOn(fill);
    var g = el('g', { class: 'lot', tabindex: 0, role: 'button', 'data-sym': sym,
      'aria-label': name(sym) + ', ' + signed(v, 1, '%') + ' ' + S.metric }, svg);
    el('rect', { class: 'lot-edge', x: c.x + 1, y: c.y + 1, width: Math.max(0, c.w - 2), height: Math.max(0, c.h - 2), fill: rgbStr(fill) }, g);
    var fs = Math.max(11, Math.min(22, Math.sqrt(c.w * c.h) / 5.2));
    if (c.w > 34 && c.h > 22) {
      el('text', { class: 'lot-sym', x: c.x + 7, y: c.y + 6 + fs, 'font-size': fs, style: 'fill:' + ink }, g, sym);
      if (c.h > fs * 2 + 10) el('text', { class: 'lot-val', x: c.x + 7, y: c.y + 8 + fs * 2, 'font-size': fs * 0.78, style: 'fill:' + ink }, g, signed(v, 1, '%'));
      if (c.w > 120 && c.h > fs * 3 + 18) el('text', { class: 'lot-name', x: c.x + 7, y: c.y + c.h - 8, 'font-size': 11.5, style: 'fill:' + ink + ';opacity:.8' }, g, name(sym));
    }
    g.addEventListener('pointermove', function (e) { showTip(lotTip(sym), e.clientX, e.clientY); });
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', function () { var r = g.getBoundingClientRect(); showTip(lotTip(sym), r.left + r.width / 2, r.top + r.height / 2); });
    g.addEventListener('blur', hideTip);
    g.addEventListener('click', function () { hideTip(); openTicker(sym, g); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); openTicker(sym, g); } });
  }
  function lotTip(sym) {
    var q = S.q[sym] || {}, e = S.d.earnings[sym];
    return '<b>' + esc(name(sym)) + '</b> ' + sym +
      row('Last', px(num(q.last))) + row('Today', signed(metricVal(sym, '1d'), 2, '%')) +
      row('1 month', signed(metricVal(sym, '1m'), 1, '%')) + row('Year to date', signed(metricVal(sym, 'ytd'), 1, '%')) +
      row('Off 52-wk high', signed(metricVal(sym, 'hi'), 1, '%')) + row('Market cap', big(mcap(q.mktcapView))) +
      (e ? row('Reports', dshort(e.date) + (e.confirmed ? '' : ' est.')) : '');
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
        return '<b>' + new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) + '</b>' +
          row('30-yr mortgage', v[0].toFixed(2) + '%') + row('10-yr Treasury', v[1].toFixed(2) + '%') + row('Spread', (v[0] - v[1]).toFixed(2));
      }
    });
    drawYieldCurve();

    var fed = last(series('DFEDTARU')), f1 = (S.d.fomc || []).filter(function (f) { return f.date >= todayIso(); })[0];
    var days = f1 ? Math.round((ms(f1.date) - ms(todayIso())) / 864e5) : null;
    var s2 = num(S.q.US2Y && S.q.US2Y.last), s10 = num(S.q.US10Y && S.q.US10Y.last);
    var fha = last(series('OBMMIFHA30YF')), jumbo = last(series('OBMMIJUMBO30YF')), m15 = last(series('MORTGAGE15US'));
    var facts = [
      ['Fed funds, upper bound', fed ? fed[1].toFixed(2) + '%' : '–'],
      ['Next Fed decision', f1 ? dshort(f1.date) + '<small>' + (days === 0 ? 'today' : 'in ' + days + ' days') + (f1.sep ? ', with projections' : '') + '</small>' : '–'],
      ['2s10s curve', isFinite(s2 - s10) ? signed((s10 - s2) * 100, 0, ' bp') + '<small>live</small>' : '–'],
      ['30-yr FHA', fha ? fha[1].toFixed(2) + '%<small>' + dshort(fha[0]) + '</small>' : '–'],
      ['30-yr jumbo', jumbo ? jumbo[1].toFixed(2) + '%<small>' + dshort(jumbo[0]) + '</small>' : '–'],
      ['15-yr fixed', m15 ? m15[1].toFixed(2) + '%<small>Freddie Mac, ' + dshort(m15[0]) + '</small>' : '–']
    ];
    $('#rate-facts').innerHTML = facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
  }

  function drawYieldCurve() {
    var host = $('#ch-curve'); host.innerHTML = '';
    var W = host.clientWidth, H = host.clientHeight, c = S.d.curve; if (!W || !c.now.points.length) return;
    var m = { t: 10, r: 74, b: 22, l: 42 };
    var sets = [['now', 'Now', 's-ink', 'var(--ink)'], ['1m', 'A month ago', 's-ink2', 'var(--ink-3)'], ['1y', 'A year ago', 's-ink3', 'var(--ink-3)']]
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
    hit.addEventListener('pointermove', mv); hit.addEventListener('pointerdown', mv);
    hit.addEventListener('pointerleave', function () { xh.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  // ------------------------------------------------------------ housing pulse
  var PULSE = [
    ['HOUST1F', 'Single-family starts', function (v) { return Math.round(v) + 'k'; }, 'pct'],
    ['PERMIT1', 'Single-family permits', function (v) { return Math.round(v) + 'k'; }, 'pct'],
    ['HSN1F', 'New home sales', function (v) { return Math.round(v) + 'k'; }, 'pct'],
    ['MSACSR', "Months' supply, new homes", function (v) { return v.toFixed(1); }, 'abs'],
    ['NHFSEPUCS', 'Completed new homes for sale', function (v) { return Math.round(v) + 'k'; }, 'pct'],
    ['MSPNHSUS', 'Median new home price', usdK, 'pct'],
    ['CSUSHPINSA', 'Case-Shiller national index', function (v) { return v.toFixed(1); }, 'pct'],
    ['FLBPPRIVSA', 'Florida permits, all units', function (v) { return (v / 1000).toFixed(1) + 'k'; }, 'pct']
  ];
  function renderPulse() {
    var host = $('#multiples');
    host.innerHTML = PULSE.map(function (p) {
      return '<div class="mini" id="mini-' + p[0] + '"><div class="mini-k"></div><div class="mini-v"></div><div class="mini-d"></div><div class="mini-chart"></div></div>';
    }).join('');
    PULSE.forEach(function (p) {
      var obs = series(p[0]), l = last(obs); if (!l) return;
      var box = $('#mini-' + p[0]), prev = at(obs, isoMinus(l[0], 365));
      var chg = p[3] === 'abs' ? l[1] - prev[1] : (l[1] / prev[1] - 1) * 100;
      var vals = obs.map(function (o) { return o[1]; });
      var flag = l[1] >= Math.max.apply(null, vals) ? 'High since ' + obs[0][0].slice(0, 4) :
                 l[1] <= Math.min.apply(null, vals) ? 'Low since ' + obs[0][0].slice(0, 4) : '';
      box.querySelector('.mini-k').textContent = p[1];
      box.querySelector('.mini-v').innerHTML = p[2](l[1]) + (flag ? '<span class="mini-flag">' + flag + '</span>' : '');
      box.querySelector('.mini-d').innerHTML = dmonth(l[0]) + ', ' + dir(chg, p[3] === 'abs' ? signed(chg, 1, ' mo') : signed(chg, 1, '%')) + ' on the year';
      lineChart(box.querySelector('.mini-chart'), {
        series: [{ pts: obs.map(function (o) { return [ms(o[0]), o[1]]; }), cls: 's-ink' }],
        yFmt: p[2], yTicks: 2, xTicks: 3, markLast: true, m: { l: 40, r: 6, b: 18, t: 4 },
        aria: p[1] + ', twelve years',
        tip: function (t, v) { return '<b>' + new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) + '</b>' + row(p[1], p[2](v[0])); }
      });
    });
  }

  // ------------------------------------------------------------ markets
  function metroRows() {
    return S.d.metros.map(function (m) {
      var r = { name: m.name, state: m.state, cbsa: m.cbsa };
      var lp = last(m.price), la = last(m.active), ld = last(m.dom), lc = last(m.cuts);
      if (!lp || !la) return null;
      var yp = at(m.price, isoMinus(lp[0], 360)), ya = at(m.active, isoMinus(la[0], 360)), yd = ld && at(m.dom, isoMinus(ld[0], 360));
      r.asof = la[0];
      r.price = lp[1]; r.priceYoy = yp ? (lp[1] / yp[1] - 1) * 100 : NaN;
      r.active = la[1]; r.activeYoy = ya ? (la[1] / ya[1] - 1) * 100 : NaN;
      r.dom = ld ? ld[1] : NaN; r.domYoy = yd ? ld[1] - yd[1] : NaN;
      r.cutShare = lc ? lc[1] / la[1] * 100 : NaN;
      r.spark = m.active.slice(-36);
      return r;
    }).filter(Boolean);
  }
  function yoyCell(v, cap, txt) {
    var w = isFinite(v) ? Math.min(1, Math.abs(v) / cap) * 34 : 0;
    var col = v > 0 ? 'var(--up)' : 'var(--down)';
    return '<td class="yoy"><i style="width:' + w.toFixed(1) + 'px;background:' + col + '"></i>' + txt + '</td>';
  }
  function spark(pts) {
    if (!pts || pts.length < 2) return '';
    var vs = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    var W = 140, H = 26, d = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + (2 + i / (pts.length - 1) * (W - 6)).toFixed(1) + ',' + (3 + (1 - (p[1] - lo) / (hi - lo || 1)) * (H - 6)).toFixed(1);
    }).join('');
    var lx = W - 4, ly = 3 + (1 - (last(vs) - lo) / (hi - lo || 1)) * (H - 6);
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="var(--ink)" stroke-width="1.5"/>' +
      '<circle cx="' + lx + '" cy="' + ly.toFixed(1) + '" r="2.5" fill="var(--ink)"/></svg>';
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
      return '<tr data-cbsa="' + r.cbsa + '"><td class="l name">' + r.name + '<small>' + r.state + '</small></td>' +
        '<td>' + usdK(r.price) + '</td>' + yoyCell(r.priceYoy, 10, signed(r.priceYoy, 1, '%')) +
        '<td>' + Math.round(r.active).toLocaleString('en-US') + '</td>' + yoyCell(r.activeYoy, 40, signed(r.activeYoy, 0, '%')) +
        '<td>' + (isFinite(r.dom) ? Math.round(r.dom) : '–') + '</td>' + yoyCell(r.domYoy, 25, signed(r.domYoy, 0, '')) +
        '<td>' + (isFinite(r.cutShare) ? r.cutShare.toFixed(0) + '%' : '–') + '</td>' +
        '<td class="l">' + spark(r.spark) + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#mkt-table th[data-k]'), function (th) {
      th.setAttribute('aria-sort', th.dataset.k === k ? (dirn > 0 ? 'ascending' : 'descending') : 'none');
    });
    var any = metroRows()[0];
    if (any) $('#markets-note').textContent = 'Realtor.com listing data by metro for ' + dmonth(any.asof) +
      ', against a year earlier. Days is median days on market; cuts is the share of active listings with a price reduction.';
  }

  // ------------------------------------------------------------ calendar
  function events() {
    var ev = [];
    Object.keys(S.d.earnings || {}).forEach(function (sym) {
      var e = S.d.earnings[sym]; ev.push({ kind: 'earn', sym: sym, date: e.date, when: e.when, confirmed: e.confirmed });
    });
    (S.d.fomc || []).forEach(function (f) { ev.push({ kind: 'fomc', date: f.date, sep: f.sep }); });
    return ev.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function renderCalendar() {
    var t0 = todayIso(), t1 = isoMinus(t0, -60);
    var ev = events().filter(function (e) { return e.date >= t0 && e.date <= t1; });
    var host = $('#timeline'); host.innerHTML = '';
    var W = host.clientWidth; if (!W) return;
    var m = { l: 10, r: 10 }, axisY = 38;
    var X = function (iso) { return m.l + (ms(iso) - ms(t0)) / (ms(t1) - ms(t0)) * (W - m.l - m.r); };
    // one column per week (Monday start) under that week's span: day number + ticker
    var weeks = {}, placed = [];
    ev.forEach(function (e) {
      if (e.kind !== 'earn') return;
      var dow = (new Date(ms(e.date)).getUTCDay() + 6) % 7, wk = isoMinus(e.date, dow);
      (weeks[wk] = weeks[wk] || []).push(e);
    });
    Object.keys(weeks).forEach(function (wk) {
      weeks[wk].forEach(function (e, i) { placed.push({ e: e, x: Math.max(m.l, X(wk)) + 3, dx: X(e.date), lane: i }); });
    });
    var lanes = { length: Math.max.apply(null, [0].concat(Object.keys(weeks).map(function (w) { return weeks[w].length; }))) };
    var H = axisY + 20 + Math.max(1, lanes.length) * 17 + 6;
    host.style.height = H + 'px';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': 'Next 60 days of earnings and Fed meetings' }, host);
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
    ev.filter(function (e) { return e.kind === 'fomc'; }).forEach(function (e) {
      var x = X(e.date);
      el('path', { class: 'tl-fomc', d: 'M' + x + ',' + (axisY - 7) + 'l6,7l-6,7l-6,-7z' }, svg);
      el('text', { class: 'tl-label', x: x, y: axisY - 24, 'text-anchor': 'middle' }, svg, 'Fed');
    });
    placed.forEach(function (p) {
      var y = axisY + 20 + p.lane * 17;
      el('rect', { class: 'tl-mark', x: p.dx - 3, y: axisY - 3, width: 6, height: 6 }, svg);
      var t = el('text', { class: 'tl-label', x: p.x, y: y, style: 'cursor:pointer' }, svg);
      el('tspan', { class: 'tl-sub' }, t, p.e.date.slice(8).replace(/^0/, '') + ' ');
      el('tspan', {}, t, p.e.sym);
      t.addEventListener('click', function () { openTicker(p.e.sym); });
      t.addEventListener('pointermove', function (ev2) { showTip('<b>' + esc(name(p.e.sym)) + '</b>' + row('Reports', dshort(p.e.date) + (p.e.confirmed ? '' : ' est.')) + (p.e.when ? row('Timing', p.e.when) : ''), ev2.clientX, ev2.clientY); });
      t.addEventListener('pointerleave', hideTip);
    });
    $('#cal-list').innerHTML = ev.map(function (e) {
      if (e.kind === 'fomc') return '<li><span class="cal-date">' + dshort(e.date) + '</span><span class="cal-what"><b>Fed decision</b></span><span class="cal-when">' + (e.sep ? 'with projections' : '') + '</span></li>';
      return '<li><span class="cal-date">' + dshort(e.date) + '</span><span class="cal-what"><button type="button" data-open="' + e.sym + '"><b>' + e.sym + '</b> ' + esc(name(e.sym)) + '</button></span>' +
        '<span class="cal-when">' + [e.when, e.confirmed ? '' : 'est.'].filter(Boolean).join(', ') + '</span></li>';
    }).join('') || '<li>No earnings or Fed meetings in the next 60 days.</li>';
  }

  // ------------------------------------------------------------ wire
  function renderWire() {
    var seg = TOPICS.map(function (t) { return '<button type="button" data-topic="' + t[0] + '" aria-pressed="' + (S.topic === t[0] && !S.tickerFilter) + '">' + t[1] + '</button>'; });
    if (S.tickerFilter) seg.push('<button type="button" data-topic="all" aria-pressed="true">' + S.tickerFilter + ' ✕</button>');
    $('#topic-seg').innerHTML = seg.join('');
    var items = S.d.news.filter(function (n) {
      if (S.tickerFilter) return n.tickers.indexOf(S.tickerFilter) >= 0;
      return S.topic === 'all' || n.topic === S.topic;
    });
    $('#wire-note').textContent = items.length + ' headlines, newest first. Collected ' + ago(S.d.generated) + '; links open the source in a new tab.';
    $('#wire-list').innerHTML = items.slice(0, 40).map(function (n) {
      return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a><div class="wire-meta"><span>' + ago(n.ts) + '</span><span>' + esc(n.src) + '</span>' +
        n.tickers.map(function (t) { return '<button type="button" class="chip" data-ticker="' + t + '" aria-label="Headlines for ' + t + '">' + t + '</button>'; }).join('') + '</div></li>';
    }).join('') || '<li class="wire-empty">No headlines match. Pick All to see every topic.</li>';
  }

  // ------------------------------------------------------------ drawer
  var lastFocus = null;
  function openTicker(sym, from) {
    lastFocus = from || document.activeElement;
    S.drawer = { sym: sym, range: '1Y', vs: false };
    $('#scrim').hidden = false; $('#drawer').hidden = false;
    renderDrawer(); $('#dr-close').focus();
  }
  function closeDrawer() {
    if (!S.drawer) return;
    S.drawer = null; $('#scrim').hidden = true; $('#drawer').hidden = true; hideTip();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  var barCache = {};
  function fetchBars(sym, range) {
    var key = sym + range;
    if (barCache[key] && Date.now() - barCache[key].t < 6e4) return Promise.resolve(barCache[key].pts);
    return fetch(BARS_URL(sym, range)).then(function (r) { return r.json(); }).then(function (j) {
      var pts = j.barData.priceBars.map(function (b) { return [b.tradeTimeinMills, parseFloat(b.close)]; });
      if (range === '1Y') pts = pts.filter(function (p) { return p[0] >= Date.now() - 365 * 864e5; }); // the feed over-delivers
      barCache[key] = { t: Date.now(), pts: pts }; return pts;
    }).catch(function () {
      return range === '1Y' ? barsOf(sym).map(function (p) { return [ms(p[0]), p[1]]; }).filter(function (p) { return p[0] >= Date.now() - 365 * 864e5; }) : [];
    });
  }
  function renderDrawer() {
    var D = S.drawer; if (!D) return;
    var sym = D.sym, q = S.q[sym] || {}, e = S.d.earnings[sym];
    var lo = num(q.yrloprice), hi = num(q.yrhiprice), lp = num(q.last);
    var pos = isFinite(lo) && hi > lo ? Math.min(100, Math.max(0, (lp - lo) / (hi - lo) * 100)) : null;
    var news = S.d.news.filter(function (n) { return n.tickers.indexOf(sym) >= 0; });
    $('#dr-body').innerHTML =
      '<div class="dr-sym">' + sym + '</div><h2 class="dr-name" id="dr-name">' + esc(name(sym)) + '</h2>' +
      '<div class="dr-px"><span class="v">' + px(lp) + '</span><span class="d">' + dir(num(q.change_pct), signed(num(q.change), 2) + ' (' + signed(num(q.change_pct), 2, '%') + ')') + '</span></div>' +
      '<div class="dr-ctrl"><div class="seg" id="dr-range">' + ['1D', '5D', '1M', '6M', '1Y'].map(function (r) {
        return '<button type="button" data-range="' + r + '" aria-pressed="' + (D.range === r) + '">' + r + '</button>'; }).join('') + '</div>' +
      (sym !== 'ITB' ? '<div class="seg"><button type="button" id="dr-vs" aria-pressed="' + D.vs + '">Against ITB</button></div>' : '') + '</div>' +
      '<div class="dr-chart" id="dr-chart"></div>' +
      (pos != null ? '<div class="range52"><h3>52-week range</h3><div class="range52-bar"><i style="left:' + pos + '%"></i></div><div class="range52-ends"><span>' + px(lo) + '</span><span>' + px(hi) + '</span></div></div>' : '') +
      '<dl class="facts">' + [
        ['Market cap', big(mcap(q.mktcapView))], ['Next earnings', e ? dshort(e.date) + '<small>' + [e.when, e.confirmed ? '' : 'est.'].filter(Boolean).join(', ') + '</small>' : '–'],
        ['P/E', q.pe || '–'], ['Forward P/E', q.fpe || '–'], ['Dividend yield', q.dividendyield || '–'], ['Beta', q.beta || '–']
      ].map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<h3 style="margin-top:1.2rem">Headlines</h3><ul class="dr-news">' + (news.length ? news.slice(0, 8).map(function (n) {
        return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a><small>' + ago(n.ts) + ', ' + esc(n.src) + '</small></li>'; }).join('')
        : '<li><small>No tagged headlines in this snapshot.</small></li>') + '</ul>';
    drawDrawerChart();
  }
  function drawDrawerChart() {
    var D = S.drawer; if (!D) return;
    var host = $('#dr-chart'), want = D.sym + D.range + D.vs;
    host.dataset.want = want;
    Promise.all([fetchBars(D.sym, D.range), D.vs ? fetchBars('ITB', D.range) : Promise.resolve(null)]).then(function (r) {
      if (!S.drawer || host.dataset.want !== want) return;
      var a = r[0], b = r[1], intraday = D.range === '1D' || D.range === '5D';
      if (!a.length) { host.innerHTML = '<p class="sheet-note">Chart data is unavailable right now.</p>'; return; }
      var ser = [{ pts: a, cls: 's-ink', label: D.sym }];
      var fmtY = function (v) { return px(v); };
      if (b && b.length) {
        var a0 = a[0][1], b0 = b[0][1];
        ser = [{ pts: a.map(function (p) { return [p[0], p[1] / a0 * 100]; }), cls: 's-ink', label: D.sym },
               { pts: b.map(function (p) { return [p[0], p[1] / b0 * 100]; }), cls: 's-ink2', label: 'ITB', soft: true }];
        fmtY = function (v) { return v.toFixed(0); };
      }
      lineChart(host, {
        series: ser, endLabels: !!(b && b.length), markLast: !(b && b.length), intraday: intraday, yFmt: fmtY,
        aria: D.sym + ' price, ' + D.range,
        tip: function (t, v) {
          var when = new Date(t).toLocaleString('en-US', intraday ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          if (ser.length > 1) return '<b>' + when + '</b>' + row(D.sym, (v[0] - 100 >= 0 ? '+' : MINUS) + Math.abs(v[0] - 100).toFixed(1) + '%') + row('ITB', (v[1] - 100 >= 0 ? '+' : MINUS) + Math.abs(v[1] - 100).toFixed(1) + '%');
          return '<b>' + when + '</b>' + row('Close', px(v[0]));
        }
      });
    });
  }

  // ------------------------------------------------------------ palette + keys
  var pal = { items: [], sel: 0 };
  var SECTIONS = [['hero', 'Rates to dirt'], ['board', 'The board'], ['rates', 'Rates'], ['pulse', 'Housing pulse'], ['markets', 'Your markets'], ['calendar', 'Schedule'], ['wire', 'Wire']];
  function paletteItems(qs) {
    var q = qs.trim().toLowerCase(), out = [];
    var n = parseFloat(q.replace(/[$,%]/g, ''));
    if (q && isFinite(n) && /^[$\d.,%\s]+$/.test(q)) {
      if (n >= 2 && n <= 12) out.push({ label: 'Try a ' + n.toFixed(2) + '% mortgage rate', hint: 'Rates to dirt', run: function () { setRate(n); go('hero'); } });
      if (n >= 50000 && n <= 5e6) out.push({ label: 'Price the home at ' + usd(n), hint: 'Assumption', run: function () { S.a.price = n; store('hd-assume', S.a); renderHero(false); go('hero'); } });
    }
    var all = [];
    S.d.universe.concat([{ sym: 'ITB' }, { sym: 'XHB' }]).forEach(function (u) {
      all.push({ label: u.sym + '  ' + name(u.sym), hint: 'Open detail', key: (u.sym + ' ' + name(u.sym)).toLowerCase(), run: function () { openTicker(u.sym); } });
    });
    SECTIONS.forEach(function (s) { all.push({ label: s[1], hint: 'Go to section', key: s[1].toLowerCase(), run: function () { go(s[0]); } }); });
    S.d.metros.forEach(function (m) {
      all.push({ label: m.name + ', ' + m.state, hint: 'Your markets', key: (m.name + ' ' + m.state).toLowerCase(), run: function () { S.st = 'all'; renderMarketsSeg(); renderMarkets(); go('markets'); flashRow(m.cbsa); } });
    });
    METRICS.forEach(function (mt) { all.push({ label: 'Color the board by ' + mt[1].toLowerCase(), hint: 'The board', key: 'board color ' + mt[1].toLowerCase(), run: function () { setMetric(mt[0]); go('board'); } }); });
    all.push({ label: 'Switch day and night', hint: 't', key: 'theme dark light night day', run: toggleTheme });
    all.push({ label: 'Refresh quotes now', hint: 'r', key: 'refresh reload quotes', run: function () { poll(true); } });
    all.push({ label: 'Back to today’s rate', hint: 'Rates to dirt', key: 'reset rate today', run: function () { setRate(null); go('hero'); } });
    var hits = all.filter(function (i) { return !q || i.key.indexOf(q) >= 0; });
    hits.sort(function (a, b) { return (b.key.indexOf(q) === 0) - (a.key.indexOf(q) === 0); });
    return out.concat(hits).slice(0, 12);
  }
  function openPalette() {
    $('#palette').hidden = false; var i = $('#pal-input'); i.value = ''; updatePalette(); i.focus();
  }
  function closePalette() { $('#palette').hidden = true; }
  function updatePalette() {
    pal.items = paletteItems($('#pal-input').value); pal.sel = 0; drawPalette();
  }
  function drawPalette() {
    $('#pal-list').innerHTML = pal.items.map(function (it, i) {
      return '<li role="option" id="pal-' + i + '" aria-selected="' + (i === pal.sel) + '" data-i="' + i + '"><span>' + esc(it.label) + '</span><small>' + esc(it.hint) + '</small></li>';
    }).join('') || '<li><span>Nothing matches. Try a ticker like DHI, a metro like Tampa, or a rate like 6.25.</span></li>';
    $('#pal-input').setAttribute('aria-activedescendant', pal.items.length ? 'pal-' + pal.sel : '');
    var s = $('#pal-' + pal.sel); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function runPal(i) { var it = pal.items[i]; closePalette(); if (it) it.run(); }
  function go(id) { var t = document.getElementById(id); if (t) t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  function flashRow(cbsa) { var tr = $('#mkt-table tr[data-cbsa="' + cbsa + '"]'); if (tr) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); } }
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

  function bindUI() {
    bindBlanks(); bindCurveDrag();
    $('#rate').addEventListener('input', function (e) { setRate(parseFloat(e.target.value)); });
    $('#rate-reset').addEventListener('click', function () { setRate(null); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-ref],[data-metric],[data-st],[data-topic],[data-ticker],[data-open],[data-range],#dr-vs,[data-reset-price],th[data-k]');
      if (!t) return;
      if (t.dataset.ref) { S.ref = t.dataset.ref; store('hd-ref', S.ref); renderHero(false); }
      else if (t.dataset.metric) setMetric(t.dataset.metric);
      else if (t.dataset.st) { S.st = t.dataset.st; renderMarketsSeg(); renderMarkets(); }
      else if (t.dataset.topic) { S.topic = t.dataset.topic; S.tickerFilter = null; renderWire(); }
      else if (t.dataset.ticker) { S.tickerFilter = t.dataset.ticker; renderWire(); go('wire'); }
      else if (t.dataset.open) openTicker(t.dataset.open, t);
      else if (t.dataset.range) { S.drawer.range = t.dataset.range; renderDrawer(); }
      else if (t.id === 'dr-vs') { S.drawer.vs = !S.drawer.vs; renderDrawer(); }
      else if (t.hasAttribute('data-reset-price')) { S.a.price = null; store('hd-assume', S.a); renderHero(false); }
      else if (t.dataset.k) {
        var k = t.dataset.k;
        S.sort = { k: k, dir: S.sort.k === k ? -S.sort.dir : (k === 'name' ? 1 : -1) }; renderMarkets();
      }
    });
    $('#btn-theme').addEventListener('click', toggleTheme);
    $('#btn-palette').addEventListener('click', openPalette);
    $('#btn-help').addEventListener('click', function () { $('#keys').hidden = false; });
    $('#dr-close').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);
    $('#pal-input').addEventListener('input', updatePalette);
    $('#pal-input').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { pal.sel = Math.min(pal.items.length - 1, pal.sel + 1); drawPalette(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { pal.sel = Math.max(0, pal.sel - 1); drawPalette(); e.preventDefault(); }
      else if (e.key === 'Enter') { runPal(pal.sel); e.preventDefault(); }
    });
    $('#pal-list').addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) runPal(+li.dataset.i); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePalette(); $('#keys').hidden = true; closeDrawer(); return; }
      var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); openPalette(); }
      else if (e.key === '?') { $('#keys').hidden = false; }
      else if (e.key === 't') toggleTheme();
      else if (e.key === 'r') poll(true);
      else if (e.key === 'm') { var i = METRICS.map(function (m) { return m[0]; }).indexOf(S.metric); setMetric(METRICS[(i + 1) % METRICS.length][0]); }
    });
    // keep focus inside the drawer while it is open
    $('#drawer').addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = $('#drawer').querySelectorAll('button, a[href]'); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    var rt;
    addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(renderCharts, 150); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  }

  // ------------------------------------------------------------ live loop
  var timer = null;
  function poll(manual) {
    clearTimeout(timer);
    var syms = S.d.universe.map(function (u) { return u.sym; }).concat(TAPE.map(function (t) { return t[0]; }));
    return fetch(QUOTE_URL(syms), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      j.FormattedQuoteResult.FormattedQuote.forEach(function (q) { if (q.code === 0) S.q[q.symbol] = q; });
      S.live = true; S.lastTick = new Date();
      S.status = (S.q.DHI && S.q.DHI.curmktstatus) || S.status;
      renderLive(true);
    }).catch(function () {
      S.live = false; renderTitleblock();
    }).then(function () {
      if (document.hidden) return;
      timer = setTimeout(poll, S.status === 'REG_MKT' ? 20000 : 120000);
    });
  }
  function renderLive(flash) {
    renderTitleblock(); renderTape(flash); renderHero(false); renderBoard(); renderLede(); renderRates();
    if (S.drawer) {
      var q = S.q[S.drawer.sym] || {};
      var pxEl = $('#dr-body .dr-px');
      if (pxEl) pxEl.innerHTML = '<span class="v">' + px(num(q.last)) + '</span><span class="d">' + dir(num(q.change_pct), signed(num(q.change), 2) + ' (' + signed(num(q.change_pct), 2, '%') + ')') + '</span>';
    }
  }
  function renderCharts() {
    if (!S.d) return;
    renderHero(false); renderBoard(); renderRates(); renderPulse(); renderCalendar();
    if (S.drawer) drawDrawerChart();
  }

  // ------------------------------------------------------------ boot
  fetch('data.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    S.d = d; S.q = Object.assign({}, d.quotes);
    var anyQ = d.quotes.DHI || {};
    S.status = anyQ.curmktstatus || null;
    renderMetricSeg(); renderMarketsSeg(); bindUI();
    renderTitleblock(); renderLede(); renderHero(true); renderTape(false);
    renderBoard(); renderRates(); renderPulse(); renderMarkets(); renderCalendar(); renderWire();
    S.booted = true;
    poll();
  }).catch(function (err) {
    $('#lede').textContent = 'The data snapshot did not load (' + err.message + '). Run scripts/build-dashboard.py to rebuild dashboard/data.json.';
  });
})();
