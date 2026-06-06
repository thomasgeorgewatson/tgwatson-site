(function () {
  'use strict';

  var DASH = '—';

  document.addEventListener('DOMContentLoaded', function () {
    fetch('data.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        var meta = document.getElementById('penny-meta');
        if (meta) meta.textContent = 'Could not load data.';
        var host = document.getElementById('penny-cards');
        if (host) {
          var p = document.createElement('p');
          p.className = 'penny-error';
          p.textContent = 'The data feed is unavailable right now (' + err.message + ').';
          host.appendChild(p);
        }
      });
  });

  function render(data) {
    var deals = Array.isArray(data) ? data : (data.deals || []);
    renderMeta(data, deals);
    populateStores(data, deals);

    var host = document.getElementById('penny-cards');
    var grid = document.createElement('div');
    grid.className = 'penny-grid';
    host.appendChild(grid);

    var cards = deals.map(function (d) {
      var el = buildCard(d);
      grid.appendChild(el);
      reveal(el);
      return { d: d, el: el };
    });

    var emptyNote = document.createElement('p');
    emptyNote.className = 'penny-empty';
    emptyNote.textContent = 'No items match the current filters.';
    emptyNote.style.display = 'none';
    host.appendChild(emptyNote);

    wireFilters(cards, emptyNote);
    applyFilters(cards, emptyNote);
  }

  function renderMeta(data, deals) {
    var meta = document.getElementById('penny-meta');
    if (!meta) return;
    var c = (data && data.counts) || {};
    meta.textContent = '';
    appendText(meta, 'Updated ' + ((data && data.updated) || DASH));
    var parts = [
      [c.deals != null ? c.deals : deals.length, 'at your stores'],
      [c.clearance, 'on clearance'],
      [c.checked, 'checked']
    ];
    parts.forEach(function (p) {
      if (p[0] == null) return;
      dot(meta);
      appendText(meta, p[0] + ' ' + p[1]);
    });
  }

  function populateStores(data, deals) {
    var sel = document.getElementById('f-store');
    if (!sel) return;
    var seen = {};
    ((data && data.stores) || []).forEach(function (s) { seen[s] = true; });
    deals.forEach(function (d) {
      (d.stores || []).forEach(function (s) { if (s.store) seen[s.store] = true; });
    });
    Object.keys(seen).sort().forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    });
  }

  function buildCard(d) {
    var stores = d.stores || [];
    var card = document.createElement('article');
    card.className = 'penny-card reveal';

    var title = document.createElement('div');
    title.className = 'penny-card-title';
    if (d.itemId) {
      var a = document.createElement('a');
      a.href = 'https://www.homedepot.com/p/' + d.itemId;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = d.name || ('Item ' + d.itemId);
      title.appendChild(a);
    } else {
      title.textContent = d.name || DASH;
    }
    card.appendChild(title);

    var badges = document.createElement('div');
    badges.className = 'penny-badges';
    badges.appendChild(pbadge('pbadge-penny', '1¢ community penny'));
    if (d.any_clearance) badges.appendChild(pbadge('pbadge-clr', 'On clearance'));
    badges.appendChild(pbadge('pbadge-count', stores.length + (stores.length === 1 ? ' store' : ' stores')));
    card.appendChild(badges);

    var list = document.createElement('div');
    list.className = 'penny-stores';
    stores.forEach(function (s) { list.appendChild(storeRow(s)); });
    card.appendChild(list);

    var foot = document.createElement('div');
    foot.className = 'penny-card-foot';
    var sku = document.createElement('span');
    sku.textContent = 'SKU ' + (d.itemId || DASH);
    foot.appendChild(sku);
    if (d.itemId) {
      var hd = document.createElement('a');
      hd.className = 'penny-hd-link';
      hd.href = 'https://www.homedepot.com/p/' + d.itemId;
      hd.target = '_blank';
      hd.rel = 'noopener noreferrer';
      hd.textContent = 'View on Home Depot ↗';
      foot.appendChild(hd);
    }
    card.appendChild(foot);

    return card;
  }

  function storeRow(s) {
    var row = document.createElement('div');
    row.className = 'penny-store-row';
    row.setAttribute('data-store', (s.store || '').toLowerCase());

    var left = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'penny-store-name';
    name.textContent = s.store || DASH;
    left.appendChild(name);

    var bits = [];
    if (s.qty != null) bits.push(s.qty + ' in stock');
    if (s.on_clearance && s.pct_off != null) bits.push(Math.round(s.pct_off) + '% off → $' + s.price);
    if (bits.length) {
      var m = document.createElement('div');
      m.className = 'penny-store-meta';
      m.textContent = bits.join(' · ');
      left.appendChild(m);
    }
    row.appendChild(left);

    var loc = document.createElement('div');
    loc.className = 'penny-loc';
    loc.textContent = (s.aisle ? 'Aisle ' + s.aisle : '?') + (s.bay ? ', Bay ' + s.bay : '');
    row.appendChild(loc);

    return row;
  }

  function pbadge(cls, text) {
    var span = document.createElement('span');
    span.className = 'pbadge ' + cls;
    span.textContent = text;
    return span;
  }

  function wireFilters(cards, emptyNote) {
    var on = function () { applyFilters(cards, emptyNote); };
    var store = document.getElementById('f-store');
    if (store) store.addEventListener('change', on);
    var search = document.getElementById('f-search');
    if (search) search.addEventListener('input', on);
    var clr = document.getElementById('f-clearance');
    if (clr) clr.addEventListener('change', on);
  }

  function applyFilters(cards, emptyNote) {
    var store = (document.getElementById('f-store') || {}).value || '';
    var search = ((document.getElementById('f-search') || {}).value || '').trim().toLowerCase();
    var clrOnly = !!(document.getElementById('f-clearance') || {}).checked;
    var any = false;

    cards.forEach(function (c) {
      var d = c.d;
      var ok =
        (!clrOnly || d.any_clearance) &&
        (search === '' || (d.name || '').toLowerCase().indexOf(search) !== -1) &&
        (store === '' || (d.stores || []).some(function (s) { return s.store === store; }));
      c.el.style.display = ok ? '' : 'none';

      // when filtering to one store, hide the other stores' rows in each card
      var rows = c.el.querySelectorAll('.penny-store-row');
      rows.forEach(function (row) {
        row.style.display = (ok && store && row.getAttribute('data-store') !== store.toLowerCase())
          ? 'none' : '';
      });
      if (ok) any = true;
    });

    emptyNote.style.display = any ? 'none' : '';
  }

  function reveal(el) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('revealed'); });
    });
  }

  function dot(parent) {
    var s = document.createElement('span');
    s.className = 'dot';
    s.textContent = '·';
    parent.appendChild(s);
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text));
  }
})();
