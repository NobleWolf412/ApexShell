// Apex — monitor widget library (renderer). Ported from the VS Code build;
// gains: LIVE/DEMO badge from the pane's source type, a 'log' widget for
// action output, and a busy state that parks a pane's buttons while its
// source runs an action. Host-agnostic: the shell mounts grids; any future
// host reuses it unchanged.
'use strict';
window.ApexMonitors = (function () {
  const grids = [];
  // 'idle' = a source with nothing to report yet (sourceMcp's cold-start / no
  // focused project). Its glyph mirrors sourceMcp's own GLYPH.idle so the LED
  // reads '·', not the '?' fallback. (Structural audit D5, 2026-07-17.)
  const ICONS = { good: '✓', warning: '!', critical: '✕', idle: '·' };
  const angle = (v, max) => -110 + 220 * Math.min(1, Math.max(0, v / max));
  const pt = (deg) => {
    const r = (deg - 90) * Math.PI / 180;
    return (75 + 60 * Math.cos(r)).toFixed(1) + ' ' + (78 + 60 * Math.sin(r)).toFixed(1);
  };

  function gaugeSvg(w) {
    const max = w.max || 100;
    const zones = w.zones || [];
    const arc = (from, to, color, width, op) => {
      const a0 = angle(from, max), a1 = angle(to, max);
      const large = (a1 - a0) > 180 ? 1 : 0;
      return '<path d="M ' + pt(a0) + ' A 60 60 0 ' + large + ' 1 ' + pt(a1) +
             '" fill="none" stroke="' + color + '" stroke-width="' + width +
             '" stroke-linecap="round" opacity="' + op + '"/>';
    };
    let s = '<svg viewBox="0 0 150 96">';
    s += arc(0, max, 'var(--edge)', 9, 1);
    if (zones[0] != null) s += arc(zones[0], zones[1] ?? max, 'var(--warning)', 3.5, .9);
    if (zones[1] != null) s += arc(zones[1], max, 'var(--critical)', 3.5, .9);
    s += '<path class="fill" d="" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round"/>';
    s += '<line class="needle" x1="75" y1="78" x2="75" y2="30" stroke="var(--text)" stroke-width="2.2" stroke-linecap="round" transform="rotate(-110 75 78)"/>';
    s += '<circle cx="75" cy="78" r="4" fill="var(--dim)"/></svg>';
    return s;
  }

  function buildWidget(pane, w) {
    const el = document.createElement('div');
    el.className = w.kind;
    if (w.kind === 'led') {
      el.classList.add('good');
      el.innerHTML = '<span class="dot"></span><span class="ic">✓</span><b class="state">good</b><span class="lab"></span>';
      el.querySelector('.lab').textContent = '· ' + (w.label || w.bind);
    } else if (w.kind === 'gauge') {
      el.innerHTML = gaugeSvg(w) + '<div class="val">–</div><div class="lab"></div>';
      el.querySelector('.lab').textContent = w.label || w.bind;
    } else if (w.kind === 'stat') {
      el.innerHTML = '<div class="num">–</div><div class="lab"></div>';
      el.querySelector('.lab').textContent = w.label || w.bind;
    } else if (w.kind === 'list') {
      el.innerHTML = '<div class="lab"></div><div class="rows"></div>';
      el.querySelector('.lab').textContent = w.label || w.bind;
    } else if (w.kind === 'tiles') {
      // a row of mini day-cards (the weather week, the operator 2026-07-15) —
      // full-view-only by nature (not in COMPACT_KINDS). Data: an array of
      // { name, icon, cond, hi, lo, rain } — generic enough for other weeks.
      el.innerHTML = '<div class="lab"></div><div class="trow"></div>';
      el.querySelector('.lab').textContent = w.label || w.bind;
    } else if (w.kind === 'input') {
      // free-text setting → the source (the operator, 2026-07-15: "a field to enter
      // the location"). Submits action `cfg:<key>:<text>`; the source
      // validates, applies live, and persists to panes.json (operator rule:
      // panels write config, never hand-edits).
      el.className = 'minput';
      el.innerHTML = '<label></label><input type="text"><button>Set</button>';
      el.querySelector('label').textContent = w.label || w.key;
      const inp = el.querySelector('input');
      inp.placeholder = w.placeholder || '';
      const submit = () => {
        const v = inp.value.trim();
        if (!v) return;
        ApexBus.post('action', { paneId: pane.id, actionId: 'cfg:' + (w.key || 'value') + ':' + v });
        inp.value = '';
      };
      el.querySelector('button').addEventListener('click', submit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    } else if (w.kind === 'buttons') {
      el.className = 'btns';
      for (const b of w.items || []) {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.addEventListener('click', () =>
          ApexBus.post('action', { paneId: pane.id, actionId: b.id }));
        el.appendChild(btn);
      }
    } else if (w.kind === 'log') {
      el.className = 'mlog';
      el.innerHTML = '<div class="lab"></div><pre></pre>';
      el.querySelector('.lab').textContent = w.label || 'Activity';
    } else if (w.kind === 'settings') {
      // Operator dials: selects bound to a config object in the data stream;
      // each change posts a cfg action — the service validates, applies live,
      // persists, journals. Buttons not files (the standing operator rule).
      el.className = 'mset';
      const head = document.createElement('div');
      head.className = 'lab';
      head.textContent = w.label || 'Settings';
      el.appendChild(head);
      for (const it of w.items || []) {
        const row = document.createElement('div');
        row.className = 'srow';
        const lab = document.createElement('label');
        lab.textContent = it.label || it.key;
        const sel = document.createElement('select');
        sel.dataset.key = it.key;
        for (const o of it.options || []) {
          const op = document.createElement('option');
          op.value = String(o); op.textContent = String(o);
          sel.appendChild(op);
        }
        sel.addEventListener('change', () =>
          ApexBus.post('action', { paneId: pane.id, actionId: 'cfg:' + it.key + ':' + sel.value }));
        row.appendChild(lab); row.appendChild(sel);
        el.appendChild(row);
      }
    }
    // Optional fixed width so value-length changes never reflow the row
    // (region "vancouver" vs "ca" was hopping widgets around — J35).
    if (w.minWidth) el.style.minWidth = w.minWidth + 'px';
    return el;
  }

  function updateWidget(cfg, el, v) {
    if (cfg.kind === 'led') {
      el.className = 'led ' + v;
      el.querySelector('.ic').textContent = ICONS[v] || '?';
      el.querySelector('.state').textContent = v;
    } else if (cfg.kind === 'gauge') {
      const max = cfg.max || 100;
      el.querySelector('.val').textContent = v;
      const a = angle(v, max);
      el.querySelector('.needle').setAttribute('transform', 'rotate(' + a + ' 75 78)');
      const p0 = pt(angle(0, max)), p1 = pt(a);
      const large = (a - angle(0, max)) > 180 ? 1 : 0;
      el.querySelector('.fill').setAttribute('d', 'M ' + p0 + ' A 60 60 0 ' + large + ' 1 ' + p1);
    } else if (cfg.kind === 'stat') {
      const num = el.querySelector('.num');
      num.textContent = v;
      el.title = String(v);   // long values ellipsize (CSS) — hover carries the rest
    } else if (cfg.kind === 'list') {
      const rows = el.querySelector('.rows');
      rows.textContent = '';
      // array-guard like tiles: a non-array bind (e.g. an http-json endpoint
      // handing a scalar to a list widget) would otherwise throw and break the
      // whole pane's update loop. (Structural audit C3, 2026-07-17.)
      for (const r of (Array.isArray(v) ? v : [])) {
        const div = document.createElement('div');
        div.className = 'row';
        div.innerHTML = '<span></span><span></span>';
        div.children[0].textContent = r.name;
        div.children[1].textContent = r.value;
        rows.appendChild(div);
      }
    } else if (cfg.kind === 'tiles') {
      // TV-forecast cards (the operator's reference image, 2026-07-15): day banner,
      // big icon, condition, GIANT high, dimmer low
      const row = el.querySelector('.trow');
      row.textContent = '';
      for (const t of v || []) {
        const d = document.createElement('div');
        d.className = 'wtile';
        d.innerHTML = '<div class="d"></div><div class="i"></div><div class="c"></div>' +
                      '<div class="hi"></div><div class="lo"></div><div class="r"></div>';
        d.children[0].textContent = t.name || '';
        d.children[1].textContent = t.icon || '·';
        d.children[2].textContent = t.cond || '';
        d.children[3].textContent = (t.hi || '–').replace('°', '');
        d.children[4].textContent = (t.lo || '–').replace('°', '');
        d.children[5].textContent = t.rain ? 'rain ' + t.rain : '';
        d.title = (t.name || '') + ' — ' + (t.cond || '') +
                  ' · high ' + (t.hi || '?') + ' low ' + (t.lo || '?');
        row.appendChild(d);
      }
    } else if (cfg.kind === 'settings') {
      for (const sel of el.querySelectorAll('select')) {
        if (document.activeElement === sel) continue;   // never fight the operator's open dropdown
        const cur = v && v[sel.dataset.key];
        if (cur !== undefined) sel.value = String(cur);
      }
    }
  }

  const COMPACT_KINDS = ['led', 'gauge', 'stat'];

  function buildGrid(container, panes, opts) {
    const compact = !!(opts && opts.compact);
    container.classList.add('mon-grid');
    if (compact) container.classList.add('compact');
    const entries = new Map();
    for (const p of panes) {
      // pane-level view targeting (the operator, 2026-07-15: the full pulldown =
      // ONLY the weather week): "only":"quarter" keeps a pane out of the
      // full grid, "only":"full" out of the quarter. Chips are config-built
      // in the shell, so a quarter-only pane keeps its bar chip.
      if (compact && p.only === 'full') continue;
      if (!compact && p.only === 'quarter') continue;
      const card = document.createElement('div');
      card.className = 'mon-pane';
      card.dataset.pane = p.id;   // chip-click navigation targets cards by id
      // "wide": the card spans the grid's full width (the week-of-tiles row)
      if (!compact && p.wide) card.classList.add('wide');
      const live = p.source && p.source.type && p.source.type !== 'demo';
      const head = document.createElement('div');
      head.className = 'mhead';
      head.innerHTML = '<b></b><span class="svc"></span><span class="badge"></span>';
      head.querySelector('b').textContent = p.title;
      head.querySelector('.svc').textContent = compact ? '' : (p.service || '');
      const badge = head.querySelector('.badge');
      badge.textContent = live ? 'LIVE' : 'DEMO';
      badge.classList.toggle('live', live);
      card.appendChild(head);
      const widgets = [];
      // Glance widgets (led/gauge/stat) flow in wrapped ROWS so cards stay
      // short enough for the quarter band; block widgets get full width.
      let row = null;
      for (const w of p.widgets || []) {
        // inputs are small enough for the quarter grid (the location field)
        if (compact && !COMPACT_KINDS.includes(w.kind) && w.kind !== 'input') continue;
        // per-widget view targeting (the operator, 2026-07-15: the full view should
        // be the week tiles, not a repeat of the quarter's Today stats):
        // "only":"quarter" hides it from the full grid, "only":"full" from
        // the quarter grid
        if (compact && w.only === 'full') continue;
        if (!compact && w.only === 'quarter') continue;
        const el = buildWidget(p, w);
        widgets.push({ cfg: w, el });
        if (COMPACT_KINDS.includes(w.kind)) {
          if (!row) { row = document.createElement('div'); row.className = 'wrow'; card.appendChild(row); }
          row.appendChild(el);
        } else {
          row = null;
          card.appendChild(el);
        }
      }
      entries.set(p.id, { card, widgets });
      container.appendChild(card);
    }
    const grid = {
      update(paneId, data) {
        const e = entries.get(paneId);
        if (!e) return;
        for (const { cfg, el } of e.widgets)
          if (cfg.bind && data[cfg.bind] !== undefined) updateWidget(cfg, el, data[cfg.bind]);
      },
      log(paneId, line) {
        const e = entries.get(paneId);
        if (!e) return;
        for (const { cfg, el } of e.widgets) {
          if (cfg.kind !== 'log') continue;
          const pre = el.querySelector('pre');
          const t = new Date();
          const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
          pre.textContent = (pre.textContent + '\n' + hh + ' ' + line)
            .split('\n').filter(Boolean).slice(-200).join('\n');
          pre.scrollTop = pre.scrollHeight;
        }
      },
      busy(paneId, b) {
        const e = entries.get(paneId);
        if (e) e.card.classList.toggle('busy', b);
      }
    };
    grids.push(grid);
    return grid;
  }

  return {
    buildGrid,
    dispatch: (paneId, data) => grids.forEach((g) => g.update(paneId, data)),
    log: (paneId, line) => grids.forEach((g) => g.log(paneId, line)),
    busy: (paneId, b) => grids.forEach((g) => g.busy(paneId, b))
  };
})();
