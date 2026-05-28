(function () {
  'use strict';

  var SECTIONS = [
    {
      key: 'upcoming', title: 'Upcoming', status: 'upcoming',
      sort: function (a, b) { return (a.eff_iso || '').localeCompare(b.eff_iso || ''); }
    },
    {
      key: 'pending', title: 'Pending (vote / TBD)', status: 'pending_tbd',
      sort: function (a, b) { return (b.sent_at || '').localeCompare(a.sent_at || ''); }
    },
    {
      key: 'effective', title: 'Recently Effective', status: 'effective',
      sort: function (a, b) { return (b.eff_iso || '').localeCompare(a.eff_iso || ''); }
    },
    {
      key: 'dropped', title: 'Dropped / Low', status: 'dropped', dropped: true,
      sort: function (a, b) { return (b.sent_at || '').localeCompare(a.sent_at || ''); }
    }
  ];

  var COLUMNS = ['Ticker', 'Ratio', 'Eff Date', 'Days', 'Cur → Post', 'TA', 'Treatment', 'Score', 'Filed', ''];

  var DASH = '—';

  document.addEventListener('DOMContentLoaded', function () {
    fetch('data.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        var meta = document.getElementById('tracker-meta');
        if (meta) meta.textContent = 'Could not load data.';
        var host = document.getElementById('tracker-sections');
        if (host) {
          var p = document.createElement('p');
          p.className = 'tracker-error';
          p.textContent = 'The data feed is unavailable right now (' + err.message + ').';
          host.appendChild(p);
        }
      });
  });

  function render(data) {
    renderMeta(data);
    populateTreatments(data.records);

    var host = document.getElementById('tracker-sections');
    var built = [];

    SECTIONS.forEach(function (cfg) {
      var rows = data.records.filter(function (r) { return r.status === cfg.status; });
      if (!rows.length) return;               // skip sections empty in the data
      rows.sort(cfg.sort);
      var el = buildSection(cfg, rows);
      host.appendChild(el);
      built.push({ cfg: cfg, el: el });
      reveal(el);
    });

    var emptyNote = document.createElement('p');
    emptyNote.className = 'tracker-empty';
    emptyNote.textContent = 'No records match the current filters.';
    emptyNote.style.display = 'none';
    host.appendChild(emptyNote);

    wireFilters(built, emptyNote);
    applyFilters(built, emptyNote);
  }

  function renderMeta(data) {
    var meta = document.getElementById('tracker-meta');
    if (!meta) return;
    var c = data.counts || {};
    meta.textContent = '';
    appendText(meta, 'Updated ' + (data.updated || DASH));
    var parts = [
      [c.upcoming, 'upcoming'],
      [c.pending_tbd, 'pending'],
      [c.effective, 'effective'],
      [c.dropped, 'dropped']
    ];
    parts.forEach(function (p) {
      if (p[0] == null) return;
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.textContent = '·';
      meta.appendChild(dot);
      appendText(meta, p[0] + ' ' + p[1]);
    });
  }

  function populateTreatments(records) {
    var sel = document.getElementById('f-treatment');
    if (!sel) return;
    var seen = {};
    records.forEach(function (r) { if (r.treatment) seen[r.treatment] = true; });
    Object.keys(seen).sort().forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = prettyTreatment(t);
      sel.appendChild(opt);
    });
  }

  function buildSection(cfg, rows) {
    var section = document.createElement('section');
    section.className = 'tracker-section reveal' + (cfg.dropped ? ' dropped' : '');
    section.setAttribute('data-key', cfg.key);
    if (cfg.dropped) section.setAttribute('data-dropped', 'true');

    var h2 = document.createElement('h2');
    h2.textContent = cfg.title;
    section.appendChild(h2);

    var count = document.createElement('div');
    count.className = 'section-count';
    section.appendChild(count);

    var table = document.createElement('table');
    table.className = 'tracker-table';

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    COLUMNS.forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (r) { tbody.appendChild(buildRow(r)); });
    table.appendChild(tbody);
    section.appendChild(table);

    return section;
  }

  function buildRow(r) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-score', r.score || '');
    tr.setAttribute('data-treatment', r.treatment || '');
    tr.setAttribute('data-ticker', (r.ticker || '').toLowerCase());

    tr.appendChild(cell('Ticker', r.ticker || DASH, 'col-ticker'));
    tr.appendChild(cell('Ratio', r.ratio || DASH));
    tr.appendChild(cell('Eff Date', r.effective_date || DASH));
    tr.appendChild(cell('Days', r.days_to_eff == null ? DASH : String(r.days_to_eff), 'col-num'));
    tr.appendChild(cell('Cur → Post', curToPost(r), 'col-num'));
    tr.appendChild(cell('TA', r.transfer_agent || DASH, r.transfer_agent ? '' : 'muted'));
    tr.appendChild(cell('Treatment', prettyTreatment(r.treatment) || DASH));
    tr.appendChild(badgeCell(r.score));
    tr.appendChild(cell('Filed', r.sent_date || DASH, 'muted'));
    tr.appendChild(linkCell(r.edgar_url));

    return tr;
  }

  function curToPost(r) {
    var cur = r.price_str || DASH;
    var post = r.post_split || DASH;
    if (cur === DASH && post === DASH) return DASH;
    if (post === DASH) return cur;
    if (cur === DASH) return post;
    return cur + ' → ' + post;
  }

  function cell(label, value, className) {
    var td = document.createElement('td');
    td.setAttribute('data-label', label);
    if (className) td.className = className;
    td.textContent = value;
    return td;
  }

  function badgeCell(score) {
    var td = document.createElement('td');
    td.setAttribute('data-label', 'Score');
    if (score) {
      var span = document.createElement('span');
      span.className = 'badge badge-' + score;
      span.textContent = score;
      td.appendChild(span);
    } else {
      td.textContent = DASH;
    }
    return td;
  }

  function linkCell(url) {
    var td = document.createElement('td');
    td.setAttribute('data-label', 'Filing');
    if (url && /^https?:\/\//i.test(url)) {
      var a = document.createElement('a');
      a.className = 'edgar-link';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'EDGAR ↗';
      td.appendChild(a);
    } else {
      td.textContent = DASH;
    }
    return td;
  }

  function wireFilters(built, emptyNote) {
    var onChange = function () { applyFilters(built, emptyNote); };
    document.querySelectorAll('.f-score').forEach(function (cb) {
      cb.addEventListener('change', onChange);
    });
    var treatment = document.getElementById('f-treatment');
    if (treatment) treatment.addEventListener('change', onChange);
    var search = document.getElementById('f-search');
    if (search) search.addEventListener('input', onChange);
    var dropped = document.getElementById('f-dropped');
    if (dropped) dropped.addEventListener('change', onChange);
  }

  function applyFilters(built, emptyNote) {
    var scores = {};
    document.querySelectorAll('.f-score').forEach(function (cb) {
      if (cb.checked) scores[cb.value] = true;
    });
    var treatment = (document.getElementById('f-treatment') || {}).value || '';
    var search = ((document.getElementById('f-search') || {}).value || '').trim().toLowerCase();
    var showDropped = !!(document.getElementById('f-dropped') || {}).checked;

    var anyVisible = false;

    built.forEach(function (item) {
      var isDropped = !!item.cfg.dropped;
      if (isDropped && !showDropped) {
        item.el.style.display = 'none';
        return;
      }

      var visible = 0;
      item.el.querySelectorAll('tbody tr').forEach(function (tr) {
        // The dropped bucket is gated by its own "show dropped" toggle, so the
        // score checkboxes (LOW off by default) don't apply inside it.
        var ok =
          (isDropped || scores[tr.getAttribute('data-score')]) &&
          (treatment === '' || tr.getAttribute('data-treatment') === treatment) &&
          (search === '' || tr.getAttribute('data-ticker').indexOf(search) !== -1);
        tr.style.display = ok ? '' : 'none';
        if (ok) visible++;
      });

      var countEl = item.el.querySelector('.section-count');
      if (countEl) countEl.textContent = visible + (visible === 1 ? ' match' : ' matches');

      item.el.style.display = visible ? '' : 'none';
      if (visible) anyVisible = true;
    });

    emptyNote.style.display = anyVisible ? 'none' : '';
  }

  function prettyTreatment(t) {
    if (!t) return '';
    return t.replace(/_/g, ' ');
  }

  function reveal(el) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('revealed'); });
    });
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text));
  }
})();
