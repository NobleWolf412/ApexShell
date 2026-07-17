// Apex — usage view. Rail: per-subscription tracker units (two minimal
// vertical fill bars — session | weekly — above the model glyph), Claude
// anchored to the rail bottom, Codex above it (the operator's spec, 2026-07-13).
// Quarter pane: every tracked model as a row with HORIZONTAL fill bars
// (the operator, 2026-07-14 — the wide row is the space, use it); hover carries the
// full detail. All bars fill with USED %.
// Vertical-unit widget draft by the resident Qwen (offload row #10).
'use strict';

window.ApexUsage = (() => {
  const fmtReset = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const fmtAgo = (ms) => {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
  };
  const kTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

  // ---- the rail's vertical fill-bar unit (Qwen draft, reviewed) ----
  const makeUsageUnit = (glyph, title) => {
    const el = document.createElement('div');
    el.className = 'usageUnit';
    el.title = title;
    const ubars = document.createElement('div');
    ubars.className = 'ubars';
    for (let i = 0; i < 2; i++) {
      const bar = document.createElement('div');
      bar.className = 'ubar';
      const fill = document.createElement('div');
      fill.className = 'ufill';
      bar.appendChild(fill);
      ubars.appendChild(bar);
    }
    const glyphEl = document.createElement('div');
    glyphEl.className = 'uglyph';
    glyphEl.textContent = glyph;
    el.appendChild(ubars);
    el.appendChild(glyphEl);
    return el;
  };

  const sevClass = (el, pct) => {
    el.classList.toggle('crit', pct >= 90);
    el.classList.toggle('warn', pct >= 70 && pct < 90);
  };

  const setBar = (bar, pct) => {
    const fill = bar.querySelector('.ufill');
    if (pct == null) {
      fill.style.height = '0%';
      bar.classList.add('nodata');
      bar.classList.remove('warn', 'crit');
      return;
    }
    const c = Math.max(0, Math.min(100, pct));
    fill.style.height = c + '%';
    bar.classList.remove('nodata');
    sevClass(bar, c);
  };

  const updateUsageUnit = (el, d) => {
    const bars = el.querySelectorAll('.ubar');
    setBar(bars[0], d.sessionPct);
    setBar(bars[1], d.weeklyPct);
    el.classList.toggle('stale', !!d.stale);
    if (d.title !== undefined) el.title = d.title;
  };

  // ---- rail: subscription models only; Claude lowest (bottom-anchored) ----
  const rail = document.getElementById('railUsage');
  const unitCodex = makeUsageUnit('⬡', 'Codex — waiting for data');
  const unitClaude = makeUsageUnit('✱', 'Claude — waiting for data');
  rail.appendChild(unitCodex);   // above
  rail.appendChild(unitClaude);  // bottom anchor

  // ---- quarter view: rows with horizontal bars (session on top, weekly under) ----
  const list = document.getElementById('usageList');
  // bare-install empty state (R32): until any provider reports, say how to connect
  const note = document.createElement('div');
  note.className = 'paneNote';
  note.textContent = 'Nothing connected yet — these lanes light up once a provider ' +
    'is wired in. The Claude and Codex CLIs are picked up automatically when ' +
    'installed and signed in; local models and terminal tenants are launch config ' +
    '(the connect/ guides in the repo cover each lane).';
  note.hidden = true;
  list.appendChild(note);
  // Row order pairs the rail: Claude bottom, Codex above it (fixed 63px rows —
  // the rail's glyph pitch — so each row's bars sit on its icon's latitude);
  // qwen/agy ride above them (restored 2026-07-14, same expanding bars, no
  // rail glyph to pair).
  const rows = {};
  for (const [key, name] of [['qwen', 'Local (Ollama)'], ['agy', 'agy / Gemini'],
                             ['codex', 'Codex (Plus)'], ['claude', 'Claude (Max 20)']]) {
    const row = document.createElement('div');
    row.className = 'usageRow';
    row.dataset.key = key;   // claude/codex rows carry the open animation
    row.innerHTML =
      '<div class="urTop"><span class="uname"></span><span class="utext"></span></div>' +
      '<div class="hbar" hidden><i></i></div><div class="hbar" hidden><i></i></div>';
    row.querySelector('.uname').textContent = name;
    list.appendChild(row);
    const bars = row.querySelectorAll('.hbar');
    rows[key] = { row, hs: bars[0], hw: bars[1], text: row.querySelector('.utext') };
  }

  const setHBar = (bar, pct) => {
    if (pct == null) { bar.hidden = true; return; }
    bar.hidden = false;
    const c = Math.max(0, Math.min(100, pct));
    bar.querySelector('i').style.width = c + '%';
    sevClass(bar, c);
  };

  const setRow = (r, sessionPct, weeklyPct, stale, title, text) => {
    setHBar(r.hs, sessionPct);
    setHBar(r.hw, weeklyPct);
    r.row.classList.toggle('stale', !!stale);
    r.row.title = title;
    r.text.textContent = text;
  };

  const pct = (x) => (x == null ? '—' : Math.round(x) + '%');

  function render(u) {
    // "connected" needs REAL signal — markStale() placeholders are truthy
    // ({stale:true, asOf:null}), so mere presence proved nothing (Codex
    // review, R32): claude/codex = a successful fetch (asOf); agy = observed
    // activity; qwen = tokens actually burned.
    note.hidden = !!((u.claude && u.claude.asOf) || (u.codex && u.codex.asOf) ||
      (u.agy && (u.agy.turns24h > 0 || u.agy.lastActivity)) ||
      (u.qwen && u.qwen.today && u.qwen.today.tok > 0));
    // Claude — live provider numbers
    const c = u.claude;
    if (c) {
      const scoped = (c.scoped || []).map((s) => s.name + ' ' + pct(s.pct)).join(' · ');
      const title = 'Claude — session ' + pct(c.session && c.session.pct) +
        ' (resets ' + fmtReset(c.session && c.session.resetsAt) + ') · weekly ' +
        pct(c.weekly && c.weekly.pct) + ' (resets ' + fmtReset(c.weekly && c.weekly.resetsAt) + ')' +
        (scoped ? ' · ' + scoped : '') + (c.stale ? ' · STALE (endpoint unreachable)' : '');
      const s = c.session && c.session.pct, w = c.weekly && c.weekly.pct;
      updateUsageUnit(unitClaude, { sessionPct: s, weeklyPct: w, stale: c.stale, title });
      setRow(rows.claude, s, w, c.stale, title, 'S ' + pct(s) + ' · W ' + pct(w));
    }
    // Codex — provider numbers as-of-last-run
    const x = u.codex;
    if (x) {
      // `live` = the app-server's account read — the SERVER's numbers, all
      // machines counted (2026-07-14); otherwise it's local-rollout telemetry,
      // honest only as of the last run ON THIS BOX
      const src = x.live ? 'account read ' : 'as of last run ';
      const title = 'Codex (' + (x.plan || '?') + ') — ' +
        (x.session ? 'session ' + pct(x.session.pct) + ' · ' : '') +
        'weekly ' + pct(x.weekly && x.weekly.pct) +
        (x.weekly && x.weekly.resetsAt ? ' (resets ' + fmtReset(x.weekly.resetsAt) + ')' : '') +
        ' · ' + src + fmtAgo(x.asOf) + (x.stale ? ' · NO DATA' : '');
      const s = x.session ? x.session.pct : null, w = x.weekly ? x.weekly.pct : null;
      updateUsageUnit(unitCodex, { sessionPct: s, weeklyPct: w, stale: x.stale, title });
      setRow(rows.codex, s, w, x.stale, title, 'W ' + pct(w) + ' · ' + fmtAgo(x.asOf));
    }
    // agy — locally observed floor vs the documented cap (one bar: 24h)
    const a = u.agy;
    if (a) {
      const p = a.turns24h == null ? null : Math.min(100, (a.turns24h / a.cap) * 100);
      const title = 'agy — ' + (a.turns24h == null ? 'no local data' :
        a.turns24h + ' user turns in 24h of a ~' + a.cap + '-request cap (locally observed floor — ' +
        'provider truth unavailable)') +
        (a.lastActivity ? ' · last activity ' + fmtAgo(a.lastActivity) : '');
      setRow(rows.agy, null, p, a.turns24h == null, title,
        a.turns24h == null ? 'no data' : a.turns24h + '/' + a.cap + ' · 24h');
    }
    // qwen — exact volume, no cap → text only, no bars. Counts BOTH local
    // lanes: app seats + delegate.py calls (2026-07-14 — the "zero tokens"
    // week was all delegate-lane, invisible before). History is the per-day
    // ledger in state/usage-local.json — any range derivable, kept forever.
    const q = u.qwen;
    if (q && q.today) {
      const lane = (w) => (w.seatTok || w.delTok)
        ? ' (seat ' + kTok(w.seatTok) + ' / delegate ' + kTok(w.delTok) + ')' : '';
      const title = 'Local (Ollama, no limit) — session ' +
        kTok(q.session.prompt + q.session.eval) + ' tok / ' + q.session.turns + ' turns' +
        ' · today ' + kTok(q.today.tok) + lane(q.today) +
        ' · 7d ' + kTok(q.week.tok) + lane(q.week) +
        ' · 30d ' + kTok(q.month.tok) +
        ' · 365d ' + kTok(q.year.tok) +
        ' — exact, from Ollama; per-day ledger in state/usage-local.json';
      setRow(rows.qwen, null, null, false, title,
        kTok(q.today.tok) + ' today · ' + kTok(q.week.tok) + ' 7d');
    }
  }

  ApexBus.on('usageData', (m) => render(m.usage || {}));
  return { refresh: () => ApexBus.post('usageRefresh', {}) };
})();
