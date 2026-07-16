// Apex — the chat center (Phase 2). the operator's ruling, 2026-07-12: read like the
// official Claude panel — ONE column, top-down document flow, tool calls as
// quiet ⏺ rows, no left/right bubbles — and NEVER leave him guessing what a
// seat is doing. The status strip above the composer always shows exactly one
// truth: ready — your turn · working (what + elapsed) · WAITING ON YOU
// (permission, answerable right there) · session ended.
//
// The engine (main/engine/) owns all state that matters; this view is a
// projection — on reload the host reannounces seats + unanswered permission
// requests and this module rebuilds idempotently (R23 by architecture).
'use strict';
window.ApexChat = (function () {
  const chats = new Map();        // id -> chat state
  let active = null;
  let history = {};               // persona -> [{sessionId,title,ts}]

  // ---------- DOM scaffold ----------
  const stage = document.querySelector('.stage');
  const area = document.createElement('div');
  area.id = 'chatArea';
  area.hidden = true;
  area.innerHTML = '<div id="chatTabs"></div><div id="chatMain"></div>';
  document.body.appendChild(area);
  const tabsEl = area.querySelector('#chatTabs');
  const mainEl = area.querySelector('#chatMain');

  const railMenu = document.createElement('div');
  railMenu.id = 'railMenu';
  railMenu.hidden = true;
  document.body.appendChild(railMenu);

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------- repo identity (multi-repo work) ----------
  // A chat's repo shows as a small tab chip, hue derived from the path so the
  // same repo always wears the same color — scannable at a glance.
  const repoName = (cwd) => (String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '');
  const repoHue = (cwd) => {
    let h = 0;
    const s = String(cwd || '').toLowerCase();
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  };

  // Markdown-lite over ESCAPED text — fenced code, inline code, bold,
  // heading lines. Model output never reaches innerHTML unescaped. The shared
  // linkifier recognizes bounded Windows paths and visible-target HTTP(S).
  const linkify = (s) => ApexLinkify.linkifyEscaped(s);
  function md(s) {
    const parts = esc(s).split(/```(?:\w*\n)?/);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) { out += '<pre>' + parts[i].replace(/\n$/, '') + '</pre>'; continue; }
      out += linkify(parts[i])
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/^(#{1,4}) (.+)$/gm, '<b>$2</b>');
    }
    return out;
  }

  // ---------- per-chat construction ----------
  // PTY seats (R25): a real terminal fills the column — xterm mount, slim
  // status (live/ended), no composer/permissions (the human IS the gate).
  function createPtyChat(id, title) {
    const wrap = document.createElement('div');
    wrap.className = 'chatWrap';
    wrap.hidden = true;
    // no status strip on a terminal — it shows its own state (the operator, live);
    // exit lands in the terminal + tab dot. No header (the operator, 2026-07-14):
    // the tab carries the title, End Session lives in the tab row.
    wrap.innerHTML =
      '<div class="chatCol">' +
        '<div class="termMount"></div>' +
      '</div>';
    mainEl.appendChild(wrap);
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue('--' + n).trim() || '#888';
    const c = {
      id, title, wrap, pty: true,
      feed: null,
      busy: false, dead: false, permQueue: [],
      term: null,
    };
    c.term = ApexTermView({
      container: wrap.querySelector('.termMount'),
      post: (m) => ApexBus.post(m.type, m),
      seatId: id,
      themeVars: { bg: v('bg'), surface: v('surface'), edge: v('edge'), text: v('text'),
                   dim: v('dim'), faint: v('faint'), accent: v('accent'), good: v('good'),
                   warning: v('warning'), critical: v('critical') },
    });
    // click anywhere in the pane = keyboard goes to the terminal
    wrap.querySelector('.termMount').addEventListener('mousedown', () =>
      setTimeout(() => c.term.focus(), 0));
    chats.set(id, c);
    renderTabs();
    switchTo(id);
    setTimeout(() => { c.term.fit(); c.term.focus(); }, 50);
    return c;
  }

  function createChat(id, title, pty) {
    if (chats.has(id)) { retitle(id, title); return chats.get(id); }
    if (pty) return createPtyChat(id, title);
    const wrap = document.createElement('div');
    wrap.className = 'chatWrap';
    wrap.hidden = true;
    // No header (the operator, 2026-07-14): the tab already carries the title, the
    // meta repeated nothing useful, and End Session moved to the TAB ROW —
    // deliberately far from the input so it can't be clicked by accident.
    wrap.innerHTML =
      '<div class="chatCol">' +
        '<div class="feed"></div>' +
        // ONE row above the bar (the operator's third dial-in, 2026-07-14): status
        // text + elapsed + hint on the left, pinned context numbers + the
        // three bare dials on the right — no stacked rows.
        // the operator, 2026-07-13 still governs the permission WORDING: "auto sounds
        // like it's the same as bypass" — it is very nearly its OPPOSITE. The
        // short titles stay distinct and the full behavior text rides each
        // option's title attribute.
        '<div class="statusStrip"><span class="sdot"></span><span class="stext"></span>' +
          '<span class="elapsed"></span><span class="hint"></span>' +
          '<span class="ctxTop"><span class="lbl"></span><span class="dials">' +
          '<select class="modelSel" title="model"><option value="" hidden>model</option>' +
            '<option value="fable">fable</option><option value="opus">opus</option>' +
            '<option value="sonnet">sonnet</option><option value="haiku">haiku</option>' +
          '</select>' +
          '<select class="effortSel" title="effort — changing restarts the seat; history carries over">' +
            '<option value="" hidden>effort</option><option value="low">low</option>' +
            '<option value="medium">medium</option><option value="high">high</option>' +
            '<option value="xhigh">xhigh</option><option value="max">max</option>' +
          '</select>' +
          '<select class="mode" title="permissions">' +
            '<option value="manual" title="Ask me every time">Ask</option>' +
            '<option value="auto" title="Use my saved rules — anything new still asks">Saved rules</option>' +
            '<option value="acceptEdits" title="File edits pass — still asks before commands">Edits pass</option>' +
            '<option value="dontAsk" title="Never ask — blocks anything not already allowed">Never ask</option>' +
            '<option value="bypassPermissions" class="risky" title="Allow everything — never asks">Bypass ⚠</option>' +
          '</select>' +
        '</span></span></div>' +
        '<div class="permCard" hidden></div>' +
        // the divider above the input IS the context meter — colors only; the
        // numbers live pinned in the status row above
        '<div class="ctxBar"><div class="fill"></div></div>' +
        '<div class="composer"><div class="stage-row"></div>' +
          '<div class="crow"><textarea rows="2" placeholder="Message the seat — Enter to send, Shift+Enter for a new line"></textarea>' +
          '<button class="cattach" type="button" title="Attach photos or files" aria-label="Attach photos or files">&#128206;</button>' +
          '<button class="csend">Send</button></div></div>' +
      '</div>';
    mainEl.appendChild(wrap);

    const c = {
      id, title, wrap,
      feed: wrap.querySelector('.feed'),
      strip: wrap.querySelector('.statusStrip'),
      permCard: wrap.querySelector('.permCard'),
      ta: wrap.querySelector('textarea'),
      sendBtn: wrap.querySelector('.csend'),
      sessionId: null, model: null, local: false,
      busy: false, dead: false, everSent: false, gotInit: false,
      wrapping: false, wrapped: false,       // End-Session close-out state
      ctxUsed: 0, ctxWindow: 0,              // live context meter
      activity: '', startTs: 0,
      permQueue: [],               // projection of the host-owned queue
      curText: null, curBuf: '', runningTool: null,
      staging: null,
    };
    chats.set(id, c);

    // composer wiring
    const doSend = () => send(c);
    c.sendBtn.onclick = doSend;
    c.ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
      if (e.key === 'Escape' && c.busy) ApexBus.post('seatStop', { id: c.id });
    });
    c.ta.addEventListener('input', () => {
      c.ta.style.height = 'auto';
      c.ta.style.height = Math.min(c.ta.scrollHeight, 180) + 'px';
    });
    if (window.ApexImageStaging)
      c.staging = ApexImageStaging({ textarea: c.ta, stageRow: wrap.querySelector('.stage-row'),
        attachButton: wrap.querySelector('.cattach'), seatId: c.id });
    // pin/unpin: scrolling up disengages autoscroll; returning to the bottom re-engages
    // + mark the user bubble currently stuck to the top (sticky is pure CSS;
    //   the class only drives the lifted shadow)
    // DISENGAGE requires a real gesture (wheel-up / scrollbar drag) — the
    // scroll event alone is ambiguous: programmatic scrolls fire it too, and
    // during a replay burst a stale not-near-bottom read flipped autoscroll
    // off, after which every settle snap refused to move (the operator, 2026-07-14:
    // feed still landed short after reload). Re-engage-at-bottom stays on the
    // scroll event — that direction can't misfire.
    c.feed.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) c.userScrolled = true;
    }, { passive: true });
    c.feed.addEventListener('pointerdown', (e) => {
      // clicks landing in the scrollbar gutter (right of the content box)
      if (e.offsetX >= c.feed.clientWidth) c.sbDrag = true;
    });
    addEventListener('pointerup', () => { c.sbDrag = false; });
    c.feed.addEventListener('scroll', () => {
      if (c.sbDrag && !nearBottom(c)) c.userScrolled = true;
      if (nearBottom(c)) c.userScrolled = false;
      const top = c.feed.getBoundingClientRect().top;
      c.feed.querySelectorAll('.msg.user').forEach((u) =>
        u.classList.toggle('stuck', u.getBoundingClientRect().top <= top + 1));
    });
    const activateLink = (target) => {
      const web = target.closest('.webLink');
      if (web) {
        ApexBus.post('openUrl', { url: web.dataset.url || web.textContent });
        return true;
      }
      const local = target.closest('.pathLink');
      if (!local) return false;
      ApexBus.post('artifactOpen', { id: c.id,
        path: local.dataset.path || local.textContent });
      // An explicit click IS intent — pull the Viewer tab open for it.
      if (window.ApexShell) ApexShell.openDock('viewer');
      return true;
    };
    c.feed.addEventListener('click', (e) => {
      if (activateLink(e.target)) e.preventDefault();
    });
    c.feed.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && activateLink(e.target))
        e.preventDefault();
    });

    // R26: the mode select posts intent; the ENGINE's echo sets the value —
    // what you see is host truth, not renderer hope.
    const modeSel = wrap.querySelector('.mode');
    modeSel.onchange = () => {
      // No toast here and no early styling (J44): the CLI can REFUSE a change,
      // and a dial that celebrates before the answer arrives is a dial that lies.
      ApexBus.post('seatMode', { id: c.id, mode: modeSel.value });
    };
    // model = LIVE switch (set_model, bundle-verified); engine echo confirms
    const modelSel = wrap.querySelector('.modelSel');
    modelSel.onchange = () => {
      if (!modelSel.value) return;
      ApexBus.post('seatModel', { id: c.id, model: modelSel.value });
    };
    // effort = SEAMLESS RESTART into the same session (no live subtype —
    // labeled honestly; history carries via the resume backfill)
    const effortSel = wrap.querySelector('.effortSel');
    effortSel.onchange = () => {
      if (!effortSel.value) return;
      if (c.busy) {
        ApexToast('seat is mid-turn — let it finish, then change effort');
        effortSel.value = c.effortShown || '';
        return;
      }
      ApexToast('restarting seat at effort ' + effortSel.value + ' — history carries over');
      ApexBus.post('seatRelaunch', { id: c.id, effort: effortSel.value });
    };
    retitle(id, title);
    setStatus(c);
    renderTabs();
    switchTo(id);
    return c;
  }

  function retitle(id, title) {
    const c = chats.get(id);
    if (!c) return;
    c.title = title;
    renderTabs();
  }

  // End Session = wrap-first (the operator, 2026-07-14): first click sends the
  // close-out contract (loose ends → memory/scratchpad → SESSION REFLECTION);
  // the button becomes Close and the second click actually ends the seat.
  // The tab ✕ stays the no-wrap force-close. The button lives in the TAB ROW
  // (the operator, same day: the header is gone, and near the input it would be too
  // easy to click by accident).
  function endSession(c) {
    if (!c) return;
    const closeNow = () => { ApexBus.post('seatClose', { id: c.id }); removeChat(c.id); };
    // nothing to wrap: terminals, dead, local (no chain/files), or a truly
    // blank seat. "never sent + never inited" alone is NOT blank — a restored
    // chat sits in exactly that state until first input (mute CLI, J8) while
    // carrying a whole session; its sessionId is the tell (the operator's End Session
    // went straight to close on a restored chat, 2026-07-13).
    if (c.pty || c.dead || c.local || (!c.everSent && !c.gotInit && !c.sessionId)) return closeNow();
    if (c.wrapping) {
      if (c.busy) { ApexToast('still wrapping up — wait for the reflection (✕ on the tab force-closes)'); return; }
      return closeNow();
    }
    if (c.busy) {
      ApexToast('seat is mid-turn — let it finish, then End Session (✕ on the tab force-closes)');
      return;
    }
    c.wrapping = true;
    ApexBus.post('seatWrap', { id: c.id });
    // the engine echoes the wrap prompt as a user event; busy state follows
    // from the turn's own stream events
    ApexToast('wrapping up — the seat ties loose ends, saves memory, then writes its reflection');
    setStatus(c);   // setStatus re-renders the tabs, which relabels the button
  }

  function removeChat(id) {
    const c = chats.get(id);
    if (!c) return;
    if (c.term) c.term.dispose();
    c.wrap.remove();
    chats.delete(id);
    if (active === id) { active = null; const next = [...chats.keys()].pop(); if (next) switchTo(next); }
    renderTabs();
    if (!chats.size) { area.hidden = true; stage.style.display = ''; }
  }

  function switchTo(id) {
    active = id;
    for (const [cid, c] of chats) c.wrap.hidden = cid !== id;
    area.hidden = false;
    stage.style.display = 'none';
    renderTabs();
    const c = chats.get(id);
    if (!c) return;
    if (c.pty) { c.term.fit(); c.term.focus(); return; }
    c.feed.scrollTop = c.feed.scrollHeight; c.ta.focus();
  }

  function renderTabs() {
    tabsEl.textContent = '';
    for (const [id, c] of chats) {
      const t = document.createElement('div');
      t.className = 'chatTab' + (id === active ? ' active' : '');
      const dot = document.createElement('span');
      dot.className = 'dot ' + (c.dead ? 'dead' : c.permQueue.length ? 'perm' : c.busy ? 'busy' : 'live');
      const label = document.createElement('span');
      label.className = 't';
      label.textContent = c.title;
      // repo chip: which folder this chat works out of (hue is repo-stable)
      if (c.cwd) {
        const repo = document.createElement('span');
        repo.className = 'repoBadge';
        repo.textContent = repoName(c.cwd);
        repo.title = 'working directory: ' + c.cwd;
        repo.style.color = 'hsl(' + repoHue(c.cwd) + ' 55% 72%)';
        repo.style.borderColor = 'hsl(' + repoHue(c.cwd) + ' 45% 45%)';
        label.appendChild(repo);
      }
      // chain chip (task board): "⛓ 2/3" on a seat running a route step
      if (c.chainBadge) {
        const chip = document.createElement('span');
        chip.className = 'chainBadge';
        chip.textContent = c.chainBadge;
        chip.title = 'this seat is running a task-board step';
        label.appendChild(chip);
      }
      const x = document.createElement('button');
      x.className = 'x'; x.textContent = '✕'; x.title = 'Close now (no wrap-up)';
      x.onclick = (e) => { e.stopPropagation(); ApexBus.post('seatClose', { id }); removeChat(id); };
      t.append(dot, label, x);
      t.onclick = () => switchTo(id);
      tabsEl.appendChild(t);
    }
    // End Session for the ACTIVE chat — far right of the tab row, deliberately
    // away from the composer (accidental-click distance is the point)
    const ac = chats.get(active);
    if (ac) {
      const eb = document.createElement('button');
      eb.id = 'endBtn';
      eb.textContent = (ac.wrapping || ac.wrapped) ? 'Close' : 'End Session';
      eb.title = ac.pty ? 'close this terminal'
        : ac.wrapping ? 'wrap-up sent — Close ends the seat'
        : 'wrap up this chat, then close it (✕ on the tab skips the wrap)';
      eb.onclick = () => endSession(chats.get(active));
      tabsEl.appendChild(eb);
    }
  }

  // ---------- THE STATUS STRIP (the whole point) ----------
  function setStatus(c) {
    const strip = c.strip;
    const stext = strip.querySelector('.stext');
    const elapsed = strip.querySelector('.elapsed');
    const hint = strip.querySelector('.hint');
    strip.className = 'statusStrip';
    elapsed.textContent = '';
    hint.textContent = '';
    if (c.dead) {
      strip.classList.add('dead');
      stext.textContent = 'session ended — history keeps it';
    } else if (c.permQueue.length) {
      strip.classList.add('perm');
      const p = c.permQueue[0];
      stext.textContent = 'WAITING ON YOU — allow or deny: ' + p.tool +
        (c.permQueue.length > 1 ? '  (+' + (c.permQueue.length - 1) + ' more waiting)' : '');
      hint.textContent = 'answer below';
    } else if (c.busy) {
      strip.classList.add('working');
      stext.textContent = 'working — ' + (c.activity || 'starting') + '…';
      elapsed.textContent = Math.max(0, Math.round((Date.now() - c.startTs) / 1000)) + 's';
      hint.textContent = 'esc to stop';
    } else if (c.wrapped) {
      strip.classList.add('dead');
      stext.textContent = 'wrapped up — press Close to end the session (history keeps it)';
    } else if (c.wrapping) {
      strip.classList.add('working');
      stext.textContent = 'wrapping up — waiting on the seat…';
    } else if (!c.everSent && !c.gotInit) {
      stext.textContent = 'ready — the session wakes on your first message';   // J8, honestly
    } else {
      stext.textContent = 'ready — your turn';
    }
    renderTabs();
  }

  // ---------- the context meter (the divider bar above the input) ----------
  // used = the prompt the model last consumed (fresh + cache tokens); window =
  // the ceiling, wire-reported on results. Colors only (the operator): accent →
  // warning ≥65% → critical ≥85%; hover carries the numbers. No window yet →
  // the bar stays an empty divider (never a guessed %).
  const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 10e6 ? 0 : 1) + 'M'
                       : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
  function renderCtx(c) {
    const bar = c.wrap.querySelector('.ctxBar');
    if (!bar || !c.ctxUsed) return;
    const fill = bar.querySelector('.fill');
    const top = c.wrap.querySelector('.ctxTop');       // pinned numbers row
    const lbl = top.querySelector('.lbl');
    bar.classList.remove('warn', 'hot');
    top.classList.remove('warn', 'hot');
    if (c.ctxWindow) {
      const pct = Math.min(100, (c.ctxUsed / c.ctxWindow) * 100);
      fill.style.width = Math.max(1.5, pct) + '%';
      if (pct >= 85) { bar.classList.add('hot'); top.classList.add('hot'); }
      else if (pct >= 65) { bar.classList.add('warn'); top.classList.add('warn'); }
      lbl.textContent = 'context ' + Math.round(pct) + '% — ' +
        fmtTok(c.ctxUsed) + ' / ' + fmtTok(c.ctxWindow);
    } else {
      fill.style.width = '0';
      lbl.textContent = 'context ' + fmtTok(c.ctxUsed) + ' — ceiling after first turn';
    }
  }
  setInterval(() => {
    const c = chats.get(active);
    if (c && c.busy && !c.dead) {
      c.strip.querySelector('.elapsed').textContent =
        Math.max(0, Math.round((Date.now() - c.startTs) / 1000)) + 's';
    }
  }, 1000);

  // ---------- feed rendering ----------
  // Autoscroll intent, not proximity: pinned unless the user scrolls UP
  // (the operator's report — the 60px at-bottom check lost its grip mid-stream and
  // fresh text slid under the composer). Sending or scrolling back down
  // re-pins; the turn's end scrolls one last time if pinned.
  const nearBottom = (c) => c.feed.scrollHeight - c.feed.scrollTop - c.feed.clientHeight < 60;
  const keep = (c, fn) => { fn(); if (!c.userScrolled) c.feed.scrollTop = c.feed.scrollHeight; };
  // A replayed feed scrolls to bottom BEFORE late layout lands (thumb decode,
  // line-clamp measure, fonts) — the tail ended a few px under the composer
  // (the operator, 2026-07-14, post-reload). Settle = re-scroll after paint, after a
  // beat, and on every image the batch loaded.
  const settleScroll = (c) => {
    const snap = () => { if (!c.userScrolled) c.feed.scrollTop = c.feed.scrollHeight; };
    // pin EVERY FRAME for a beat rather than snapping once late — the single
    // 180ms correction read as a visible hop (the operator: "snapped up… a little
    // jarring"); per-frame corrections land before paint and read as still
    const until = performance.now() + 500;
    const loop = () => { snap(); if (performance.now() < until) requestAnimationFrame(loop); };
    loop();
    c.feed.querySelectorAll('img').forEach((i) => {
      if (!i.complete) i.addEventListener('load', snap, { once: true });
    });
  };

  function addUser(c, text, thumbs) {
    keep(c, () => {
      const el = document.createElement('div');
      el.className = 'msg user';
      // text lives in its own block so long messages can line-clamp (the VS
      // Code pattern: >~3 lines collapse, chevron expands) — matters double
      // here because the bubble PINS while the reply streams (J48)
      const btxt = document.createElement('div');
      btxt.className = 'btxt';
      const who = document.createElement('span');
      who.className = 'who'; who.textContent = '❯';
      btxt.appendChild(who);
      btxt.appendChild(document.createTextNode(text));
      el.appendChild(btxt);
      if (thumbs && thumbs.length) {
        const row = document.createElement('div');
        row.className = 'thumbs';
        for (const t of thumbs) {
          const i = document.createElement('img');
          i.src = t;
          // sent thumbs stay inspectable too (the operator: "in case I pasted the wrong one")
          i.style.cursor = 'zoom-in';
          i.title = 'click to inspect in the Viewer tab';
          i.onclick = () => {
            if (window.ApexViewer) ApexViewer.show({ kind: 'img', uri: t, name: 'sent image' });
            if (window.ApexShell) ApexShell.openDock('viewer');
          };
          row.appendChild(i);
        }
        el.appendChild(row);
      }
      c.feed.appendChild(el);
      // clamp only when it actually overflows (measure with the clamp on —
      // scrollHeight > clientHeight means lines were cut). A backgrounded chat
      // has no layout (display:none → heights read 0), so fall back to a text
      // heuristic there or backfilled long messages would never collapse.
      el.classList.add('clamp');
      const long = btxt.clientHeight
        ? btxt.scrollHeight > btxt.clientHeight + 2
        : (text.split('\n').length > 3 || text.length > 360);
      if (!long) {
        el.classList.remove('clamp');
      } else {
        const exp = document.createElement('button');
        exp.className = 'mExp'; exp.textContent = '▾';
        exp.title = 'Show full message';
        exp.onclick = (e) => {
          e.stopPropagation();
          const collapsed = el.classList.toggle('clamp');
          exp.textContent = collapsed ? '▾' : '▴';
          exp.title = collapsed ? 'Show full message' : 'Collapse';
        };
        el.appendChild(exp);
      }
    });
  }
  function settleTool(c) {
    if (c.runningTool) { c.runningTool.classList.remove('running'); c.runningTool = null; }
  }
  function addTool(c, name, detail) {
    settleTool(c);
    keep(c, () => {
      const el = document.createElement('div');
      el.className = 'toolRow running';
      el.innerHTML = '<span class="tdot">⏺</span><span class="tname"></span><span class="tdetail"></span>';
      el.querySelector('.tname').textContent = name;
      const det = el.querySelector('.tdetail');
      det.textContent = detail || '';
      if (detail && /^[A-Za-z]:[\\\/]/.test(detail)) {   // a path = a door
        det.classList.add('pathLink');
        det.dataset.path = detail;
        det.title = 'open in the Viewer tab';
      }
      c.feed.appendChild(el);
      c.runningTool = el;
    });
  }
  function openText(c) {
    if (c.curText) return;
    settleTool(c);
    keep(c, () => {
      c.curText = document.createElement('div');
      c.curText.className = 'msg ai';
      c.curBuf = '';
      c.feed.appendChild(c.curText);
    });
  }
  function finalizeText(c, text) {
    // authoritative replace (streaming deltas may lag or misorder)
    if (!c.curText && !(text && text.trim())) return;
    if (!c.curText) openText(c);
    keep(c, () => { c.curText.innerHTML = md(text != null ? text : c.curBuf); });
    c.curText = null; c.curBuf = '';
  }

  // ---------- AskUserQuestion — a QUESTION, not a permission ----------
  // It arrives over the same can_use_tool channel as a tool grant, so the app
  // rendered it as Allow/Deny and replied "allow" with no answers — the CLI
  // then correctly reported "The user did not answer the questions." the operator saw
  // options offered and never got to pick (2026-07-13). The tool's own schema
  // names the seam: `answers` is "collected by the permission component", i.e.
  // the client fills it in and hands it back as updatedInput.
  function renderQuestion(c, p, card) {
    card.classList.add('question');
    const picked = new Map();          // question text -> Set(labels) | string
    const qs = p.input.questions;
    const blocks = [];                 // one per question — only the active one shows
    const tabs = [];                   // the operator: "each question is a tab, like VS Code"

    const submit = document.createElement('button');
    submit.className = 'allow'; submit.textContent = 'Send answer';
    submit.disabled = true;

    const answered = (q) => {
      const v = picked.get(q.question);
      return !!v && (v instanceof Set ? v.size > 0 : !!String(v).trim());
    };
    const refresh = () => {
      submit.disabled = qs.some((q) => !answered(q));
      // a tab tells you at a glance whether it still owes an answer
      qs.forEach((q, i) => tabs[i] && tabs[i].classList.toggle('done', answered(q)));
    };
    const show = (i) => {
      blocks.forEach((b, j) => { b.hidden = j !== i; });
      tabs.forEach((t, j) => t.classList.toggle('active', j === i));
    };

    const head = document.createElement('div');
    const tool = document.createElement('span');
    tool.className = 'ptool';
    tool.textContent = qs.length > 1 ? 'Questions (' + qs.length + ')' : 'Question';
    head.appendChild(tool);
    card.appendChild(head);

    // A single question needs no tab strip — one question, one panel.
    if (qs.length > 1) {
      const strip = document.createElement('div');
      strip.className = 'qtabs';
      qs.forEach((q, i) => {
        const t = document.createElement('button');
        t.className = 'qtab';
        t.textContent = q.header || ('Q' + (i + 1));
        t.title = q.question;
        t.onclick = () => show(i);
        tabs.push(t);
        strip.appendChild(t);
      });
      card.appendChild(strip);
    }

    for (const q of qs) {
      const block = document.createElement('div');
      block.className = 'qblock';
      blocks.push(block);

      const qt = document.createElement('div');
      qt.className = 'qtext'; qt.textContent = q.question;
      block.appendChild(qt);

      const multi = !!q.multiSelect;
      for (const opt of (q.options || [])) {
        const row = document.createElement('label');
        row.className = 'qopt';
        const box = document.createElement('input');
        box.type = multi ? 'checkbox' : 'radio';
        box.name = 'q' + p.requestId + p.input.questions.indexOf(q);
        const txt = document.createElement('div');
        const lab = document.createElement('div');
        lab.className = 'qoptLabel'; lab.textContent = opt.label;
        txt.appendChild(lab);
        if (opt.description) {
          const d = document.createElement('div');
          d.className = 'qoptDesc'; d.textContent = opt.description;
          txt.appendChild(d);
        }
        box.onchange = () => {
          if (multi) {
            const set = picked.get(q.question) instanceof Set
              ? picked.get(q.question) : new Set();
            if (box.checked) set.add(opt.label); else set.delete(opt.label);
            picked.set(q.question, set);
          } else {
            picked.set(q.question, opt.label);
            block.querySelectorAll('.qother').forEach((i) => { i.value = ''; });
          }
          refresh();
        };
        row.append(box, txt);
        block.appendChild(row);
      }

      // "Other" is always available to the operator — the tool guarantees it.
      const other = document.createElement('input');
      other.type = 'text'; other.className = 'qother';
      other.placeholder = 'Other — type your own answer';
      other.oninput = () => {
        if (other.value.trim()) {
          picked.set(q.question, other.value.trim());
          block.querySelectorAll('input[type=radio],input[type=checkbox]')
            .forEach((i) => { i.checked = false; });
        } else picked.delete(q.question);
        refresh();
      };
      block.appendChild(other);
      card.appendChild(block);
    }
    show(0);
    refresh();

    const send = (answers) => {
      ApexBus.post('seatPerm', {
        id: c.id, requestId: p.requestId, allow: true,
        input: Object.assign({}, p.input, { answers }),
      });
      c.permQueue.shift();
      addTool(c, answers ? '✓ answered' : '✕ skipped', 'Question');
      settleTool(c);
      renderPerm(c);
    };

    submit.onclick = () => {
      const answers = {};
      for (const q of qs) {
        const v = picked.get(q.question);
        answers[q.question] = v instanceof Set ? [...v].join(', ') : String(v);
      }
      send(answers);
    };

    // Skipping is legitimate — it's a question, not a gate. Deny returns the
    // CLI's own "did not answer" and the seat carries on.
    const skip = document.createElement('button');
    skip.className = 'deny'; skip.textContent = 'Skip';
    skip.onclick = () => {
      ApexBus.post('seatPerm', { id: c.id, requestId: p.requestId, allow: false });
      c.permQueue.shift();
      addTool(c, '✕ skipped', 'Question');
      settleTool(c);
      renderPerm(c);
    };

    card.append(submit, skip);
    card.hidden = false;
    setStatus(c);
  }

  // ---------- permission card (inline, in flow — not a modal) ----------
  function renderPerm(c) {
    const card = c.permCard;
    if (!c.permQueue.length) { card.hidden = true; setStatus(c); return; }
    const p = c.permQueue[0];
    card.textContent = '';
    card.classList.remove('question');
    if (p.tool === 'AskUserQuestion' && p.input && Array.isArray(p.input.questions))
      return renderQuestion(c, p, card);
    const head = document.createElement('div');
    const tool = document.createElement('span');
    tool.className = 'ptool'; tool.textContent = p.tool;
    head.appendChild(tool);
    if (c.permQueue.length > 1) {
      const more = document.createElement('span');
      more.className = 'pmore'; more.textContent = '+' + (c.permQueue.length - 1) + ' more waiting';
      head.appendChild(more);
    }
    const detail = document.createElement('div');
    detail.className = 'pdetail'; detail.textContent = p.detail || '';
    const desc = document.createElement('div');
    desc.className = 'pdesc'; desc.textContent = p.description || '';
    const allow = document.createElement('button');
    allow.className = 'allow'; allow.textContent = 'Allow';
    const deny = document.createElement('button');
    deny.className = 'deny'; deny.textContent = 'Deny';
    // The answer may carry rule updates — that IS "don't ask again" (J46).
    const answer = (ok, updates, choice) => {
      ApexBus.post('seatPerm', {
        id: c.id, requestId: p.requestId, allow: ok, input: p.input, updates, choice,
      });
      c.permQueue.shift();
      addTool(c, ok ? ((updates || choice) ? '✓ allowed + remembered' : '✓ allowed') : '✕ denied', p.tool);
      settleTool(c);
      renderPerm(c);
    };
    allow.onclick = () => answer(true);
    deny.onclick = () => answer(false);
    card.append(head, detail, desc, allow, deny);

    // "Always allow" — hand the CLI back its OWN suggestion for not asking again.
    // The payload is tool-shaped (the missing half of why VS Code was quiet and
    // Apex was not): a command tool (Bash/PowerShell) suggests an `addRules` that
    // saves that command; an edit tool suggests `setMode: acceptEdits`. VS Code
    // accumulated both over months. We pass the CLI's own objects through, only
    // pinning rule storage to the project's .claude/settings.local.json (durable,
    // the file VS Code fills) instead of the CLI's per-session default. No
    // suggestion = no button; we never invent a grant of our own.
    const sugg = (p.suggestions || []).filter((s) =>
      (s.type === 'addRules' && Array.isArray(s.rules) && s.rules.length) || s.type === 'setMode');
    if (sugg.length) {
      const label = (s) => s.type === 'setMode'
        ? 'switch to ' + s.mode + ' (stop asking for edits)'
        : s.rules.map((r) => r.toolName + (r.ruleContent ? '(' + r.ruleContent + ')' : '')).join(', ');
      const always = document.createElement('button');
      always.className = 'always';
      always.textContent = 'Always allow';
      // Show exactly what gets remembered — a rule the operator never read is a
      // permission he didn't really grant.
      always.title = 'Stop asking, by:\n' + sugg.map(label).join('\n');
      always.onclick = () => answer(true, sugg.map((s) =>
        s.type === 'addRules'
          ? { type: 'addRules', rules: s.rules, behavior: 'allow', destination: 'localSettings' }
          : s));   // setMode passes through as the CLI authored it
      card.append(always);
    }
    // Codex supplies its own ordered decisions. The engine retains and
    // validates the real decision objects; these ids only select among them.
    for (const ch of (p.rememberChoices || [])) {
      if (!ch || !ch.id) continue;
      const remembered = document.createElement('button');
      remembered.className = 'always';
      remembered.textContent = ch.label || 'Allow for session';
      remembered.title = ch.title || 'Allow matching requests without asking again.';
      remembered.onclick = () => answer(true, undefined, ch.id);
      card.append(remembered);
    }
    card.hidden = false;
    setStatus(c);
  }

  // ---------- sending ----------
  function send(c) {
    if (c.dead) return;
    const text = c.ta.value.trim();
    const staged = c.staging ? c.staging.list() : { images: [], files: [] };
    const imgs = staged.images || [];
    const files = staged.files || [];
    if (!text && !imgs.length && !files.length) return;
    const thumbs = imgs.map((i) => 'data:' + i.mediaType + ';base64,' + i.data);
    // typing again after a wrap-up = the session continues; un-arm the close
    // (setStatus below re-renders the tab row, which relabels the End button)
    if (c.wrapping || c.wrapped) { c.wrapping = false; c.wrapped = false; }
    ApexBus.post('seatSend', { id: c.id, text, images: imgs, files });
    const fileNote = files.length ? '\n' + files.map((f) => 'attachment: ' + f.name).join('\n') : '';
    addUser(c, (text || '(see attached)') + fileNote, thumbs);
    c.ta.value = ''; c.ta.style.height = 'auto';
    if (c.staging) c.staging.clear();
    c.everSent = true;
    c.userScrolled = false;             // sending re-pins the feed
    c.feed.scrollTop = c.feed.scrollHeight;
    c.busy = true; c.activity = 'starting'; c.startTs = Date.now();
    setStatus(c);
  }

  // ---------- engine events ----------
  // Mounting a seat's VIEW. Called for a brand-new seat (seatNew) and again for
  // a seat that outlived the window (seatList after a reload) — the engine lives
  // in main, so a reload kills only the view.
  // the closed permissions dial's hover carries the CURRENT mode's full wording
  // (short titles in the box, descriptions on hover — the operator, 2026-07-14)
  function syncModeTitle(sel) {
    const o = sel.selectedOptions[0];
    sel.title = 'permissions — ' + (o ? (o.title || o.textContent) : '');
  }

  function mountSeat(m) {
    const c = createChat(m.id, m.title, m.pty);
    // which repo this seat works out of — badges the tab; multi-repo truth
    if (m.cwd && c.cwd !== m.cwd) { c.cwd = m.cwd; renderTabs(); }
    if (c.pty) return;
    // seed the session id early — a resumed CLI is MUTE until first input
    // (J8), so no init ever comes to fill it (the header that displayed it is
    // gone, 2026-07-14, but the id still gates blank-vs-restored in endSession)
    if (m.sessionId && !c.gotInit) c.sessionId = m.sessionId;
    const sel = c.wrap.querySelector('.mode');
    if (sel && m.mode) {
      sel.value = m.mode;
      sel.classList.toggle('risky', m.mode === 'bypassPermissions');
      syncModeTitle(sel);
    }
    const ms = c.wrap.querySelector('.modelSel');
    // codex-lane seat (R33): the model dial carries the plan's TIERS
    // (sol/terra/luna — live model/list wire truth, 2026-07-14) and switches
    // LIVE (per-turn param). Permission policy stays launch-time read-only.
    if (ms && m.model === 'codex') {
      ms.textContent = '';
      const ph = document.createElement('option');
      ph.value = ''; ph.hidden = true; ph.textContent = 'model';
      ms.appendChild(ph);
      for (const t of ['sol', 'terra', 'luna']) {
        const o = document.createElement('option');
        o.value = t; o.textContent = t;
        o.title = { sol: 'GPT-5.6-Sol — latest frontier agentic coding model',
                    terra: 'GPT-5.6-Terra — balanced for everyday work',
                    luna: 'GPT-5.6-Luna — fast and affordable' }[t];
        ms.appendChild(o);
      }
      ms.value = m.codexModel || '';
      ms.title = 'model (codex tier) — applies from the next turn';
      const modeSel2 = c.wrap.querySelector('.mode');
      if (modeSel2) {
        modeSel2.disabled = true;
        modeSel2.title = 'set at launch — codex asks through permission cards per its approval policy';
      }
    } else if (ms && m.model && [...ms.options].some((o) => o.value === m.model)) ms.value = m.model;
    const es = c.wrap.querySelector('.effortSel');
    if (es && m.effort) { es.value = m.effort; c.effortShown = m.effort; }
    if (m.local) {   // local/qwen seats: no CLI session — no dials, no meter row
      const d = c.wrap.querySelector('.ctxTop');
      if (d) d.hidden = true;
    }
  }
  ApexBus.on('seatNew', mountSeat);
  ApexBus.on('seatMode', (m) => {          // engine echo — the CLI's word, not ours
    const c = chats.get(m.id);
    if (!c || c.pty) return;
    const sel = c.wrap.querySelector('.mode');
    if (sel) {
      sel.value = m.mode;                  // on a refusal this SNAPS BACK to the real mode
      sel.classList.toggle('risky', m.mode === 'bypassPermissions');
      syncModeTitle(sel);
    }
    if (m.error) ApexToast('permission mode UNCHANGED (still ' + m.mode + ') — ' + m.error);
    else ApexToast('permission mode → ' + m.mode);
  });
  // Bypass can only be set when a seat starts (the CLI refuses it live), so the
  // engine hands the dial's request here: restart into it, resuming the session.
  ApexBus.on('seatModeRelaunchNeeded', (m) => {
    const c = chats.get(m.id);
    if (!c) return;
    const sel = c.wrap.querySelector('.mode');
    if (sel) sel.value = m.current;        // the dial tells the truth while we ask
    if (c.busy) {
      ApexToast('seat is mid-turn — let it finish, then switch to bypass');
      return;
    }
    const ok = window.confirm(
      'Bypass can only be set when a seat starts — the Claude CLI refuses it mid-session.\n\n' +
      'Restart this seat in BYPASS? Every tool call runs with no prompt, including ' +
      'destructive ones.\n\nThe conversation resumes where it left off; nothing is lost.');
    if (!ok) return;
    ApexToast('restarting seat in bypass — history carries over');
    ApexBus.post('seatRelaunch', { id: c.id, permissions: 'bypassPermissions' });
  });
  ApexBus.on('seatModel', (m) => {         // engine echo — the CLI's word, not ours
    const c = chats.get(m.id);
    if (!c || c.pty) return;
    const ms = c.wrap.querySelector('.modelSel');
    if (ms && [...ms.options].some((o) => o.value === m.model)) ms.value = m.model;
    if (m.error) ApexToast('model UNCHANGED (still ' + (m.model || 'default') + ') — ' + m.error);
    else if (m.model) ApexToast('model → ' + m.model + ' (live)');
  });
  ApexBus.on('seatGone', (m) => {          // hand-off or relaunch — old card leaves
    removeChat(m.id);
  });
  ApexBus.on('seatTitle', (m) => retitle(m.id, m.title));
  ApexBus.on('seatList', (m) => {
    const live = new Set(m.seats.map((s) => s.id));
    for (const id of [...chats.keys()]) if (!live.has(id)) removeChat(id);
    // RELOAD SURVIVAL (the operator, 2026-07-13: "hitting reload keeps the session in
    // view but the chat disappears — I have to close it and reopen from
    // history"). The seat never died — it lives in main; only its VIEW did. The
    // renderer used to prune dead chats here and never rebuild live ones, so an
    // open seat came back as an empty shell. Mount what's missing, then ask the
    // engine to replay its transcript — the same backfill a resume uses (J26).
    // Replay = ask the engine to re-send the on-disk transcript. Clearing
    // first keeps a partial pre-boot paint (stray seatEvts auto-create chat
    // shells) from doubling up — but NEVER clear over something the user
    // already typed (the 2026-07-14 "it ate my input").
    const requestReplay = (c) => {
      if (c.replayed) return;
      c.replayed = true;
      if (!c.everSent) c.feed.textContent = '';
      ApexBus.post('seatReplay', { id: c.id });
    };
    for (const s of m.seats) {
      if (!chats.has(s.id)) mountSeat(s);
      const c = chats.get(s.id);
      // a PTY seat has no transcript (its scrollback is genuinely gone) and a
      // local seat has no CLI session — replay is for real Claude seats only.
      // A live chat that's already inited or carried user input replays never.
      if (!c || c.pty || c.local || s.local || c.gotInit || c.everSent) continue;
      if (s.sessionId) requestReplay(c);
      // No session id means a fresh seat is still starting. Do not arm replay:
      // Codex may announce the thread before its rollout contains metadata,
      // and reading that empty history caused the false "codex refused" banner.
    }
  });
  ApexBus.on('seatHistory', (m) => { history = m.history || {}; });

  ApexBus.on('seatEvt', (msg) => {
    const c = chats.get(msg.id);
    // NO auto-create: an unknown id here is a closed seat's in-flight tail (or
    // a pre-mount stray during boot, which replay rebuilds). Creating a shell
    // resurrected ✕'d chats as blank "Seat" tabs — which the roster prune then
    // swept all at once on the next real close (the operator's ✕-during-load ghost +
    // close-all, 2026-07-14). Chats are born from seatNew/seatList only.
    if (!c) return;
    const m = msg.m;
    if (c.pty) {                       // terminal lane: bytes in, bytes out
      if (m.type === 'ptyData') c.term.write(m.data);
      else if (m.type === 'dead') {
        c.dead = true;
        c.term.setDead();   // the terminal itself + the tab dot show the exit
        renderTabs();
      }
      return;
    }
    switch (m.type) {
      case 'init': {
        c.sessionId = m.sessionId; c.model = m.model || ''; c.local = !!m.local;
        c.gotInit = true;
        // the CLI's init names the ACTUAL model — the dropdown shows that
        // truth, not the requested value (the operator: the bar shows current settings)
        const ms2 = c.wrap.querySelector('.modelSel');
        if (ms2 && c.model) {
          const alias = ['fable', 'opus', 'sonnet', 'haiku', 'sol', 'terra', 'luna']
            .find((a) => c.model.includes(a));
          if (alias && [...ms2.options].some((o) => o.value === alias)) ms2.value = alias;
        }
        setStatus(c);
        break;
      }
      case 'user': addUser(c, m.text); break;
      case 'block':
        if (m.kind === 'text') openText(c);
        c.activity = m.kind === 'thinking' ? 'thinking' : c.activity || 'writing';
        c.busy = true; if (!c.startTs) c.startTs = Date.now();
        setStatus(c);
        break;
      case 'delta':
        openText(c);
        c.curBuf += m.text;
        keep(c, () => { c.curText.innerHTML = md(c.curBuf); });
        if (c.activity !== 'writing') { c.activity = 'writing'; setStatus(c); }
        break;
      case 'thinkingTick':
        if (c.activity !== 'thinking') { c.activity = 'thinking'; c.busy = true; setStatus(c); }
        break;
      case 'text': finalizeText(c, m.text); break;
      case 'tool':
        addTool(c, m.name, m.detail);
        c.activity = 'running ' + m.name; c.busy = true;
        setStatus(c);
        break;
      case 'permission':
        if (!c.permQueue.some((p) => p.requestId === m.requestId)) {   // reannounce-safe
          c.permQueue.push(m);
          renderPerm(c);
        }
        break;
      case 'context':
        // partial updates: assistant messages carry `used`, results carry
        // `window` — never clobber one with the other's absence
        if (m.used) c.ctxUsed = m.used;
        if (m.window) c.ctxWindow = m.window;
        renderCtx(c);
        break;
      case 'compacted': {
        // the CLI just summarized older conversation to make room — mark it in
        // the feed so a suddenly-smaller meter reads as what it is
        const row = document.createElement('div');
        row.className = 'toolRow';
        row.innerHTML = '<span class="tdot">⟲</span><span class="tname"></span><span class="tdetail"></span>';
        row.querySelector('.tname').textContent = 'context compacted';
        row.querySelector('.tdetail').textContent =
          (m.trigger === 'auto' ? 'auto (window nearly full)' : m.trigger || '') +
          (m.pre ? ' — was ' + fmtTok(m.pre) + ' tokens' : '');
        keep(c, () => c.feed.appendChild(row));
        break;
      }
      case 'result':
        c.busy = false; c.activity = ''; c.startTs = 0;
        if (c.wrapping) c.wrapped = true;   // the wrap turn settled — safe to close
        finalizeText(c, null);
        settleTool(c);
        setStatus(c);
        // a result also closes every replay batch (the engine caps backfill
        // with one) — settle the scroll after late layout lands
        settleScroll(c);
        break;
      case 'dead':
        c.dead = true; c.busy = false;
        c.ta.disabled = true; c.sendBtn.disabled = true;
        setStatus(c);
        break;
    }
  });

  // 'artifact' renders in the VIEWER dock tab now (viewer.js, the operator 2026-07-13)
  // — the per-chat side panel is retired; path clicks below open the tab.

  // ---------- rail menu (hover: active chats + history per persona) ----------
  let menuTimer = null;
  function openRailMenu(btn, persona) {
    clearTimeout(menuTimer);
    railMenu.textContent = '';
    const add = (label, fn, headClass) => {
      if (headClass) {
        const h = document.createElement('div');
        h.className = 'rmHead'; h.textContent = label;
        railMenu.appendChild(h);
        return;
      }
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { hideRailMenu(); fn(); };
      railMenu.appendChild(b);
    };
    add('NEW', null, true);
    add('＋ new ' + (persona || 'blank') + ' chat', () => ApexBus.post('seatCreate', { persona }));
    if (!persona) {                    // terminals live under the blank (+) button
      add('TERMINALS', null, true);
      add('agy — Gemini terminal', () => ApexBus.post('seatCreate', { terminal: 'agy' }));
      add('claude — terminal (PTY)', () => ApexBus.post('seatCreate', { terminal: 'claude' }));
      add('codex — terminal (PTY)', () => ApexBus.post('seatCreate', { terminal: 'codex' }));
      add('cmd — plain shell', () => ApexBus.post('seatCreate', { terminal: 'cmd' }));
    }
    const act = [...chats.values()].filter((c) => !persona || c.title.startsWith(persona));
    if (act.length) {
      add('ACTIVE', null, true);
      for (const c of act) add(c.title, () => switchTo(c.id));
    }
    const hist = (history[persona || 'Seat'] || history[persona] || []);
    if (hist.length && persona) {
      // Grouped by repo when the history spans more than one — a resume
      // carries its recorded cwd back so the chat reopens IN ITS OWN REPO
      // (main validates the path; unrecorded/legacy entries fall through to
      // the persona default, same as before).
      const repos = new Set(hist.slice(0, 12).map((h) => h.cwd || ''));
      if (repos.size > 1) {
        const groups = new Map();
        for (const h of hist.slice(0, 12)) {
          const key = h.cwd || '';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(h);
        }
        for (const [cwd, entries] of groups) {
          add('RESUME — ' + (cwd ? repoName(cwd).toUpperCase() : 'UNKNOWN REPO'), null, true);
          for (const h of entries)
            add(h.title, () => ApexBus.post('seatCreate',
              { persona, resume: h.sessionId, cwd: h.cwd }));
        }
      } else {
        add('HISTORY — resume', null, true);
        for (const h of hist.slice(0, 12))
          add(h.title, () => ApexBus.post('seatCreate',
            { persona, resume: h.sessionId, cwd: h.cwd }));
      }
    }
    const r = btn.getBoundingClientRect();
    railMenu.hidden = false;
    railMenu.style.right = (innerWidth - r.left + 6) + 'px';
    railMenu.style.top = Math.min(r.top, innerHeight - railMenu.offsetHeight - 10) + 'px';
  }
  function hideRailMenu() { railMenu.hidden = true; }
  function scheduleHide() { clearTimeout(menuTimer); menuTimer = setTimeout(hideRailMenu, 350); }
  railMenu.addEventListener('pointerenter', () => clearTimeout(menuTimer));
  railMenu.addEventListener('pointerleave', scheduleHide);

  // ---------- preset rail buttons (R32: extension-registered seats) ----------
  // Presets arrive from main (seatPresets, posted on boot + on request). The
  // shell owns only the blank + button; named seats are extension data.
  ApexBus.on('seatPresets', (m) => {
    const rail = document.getElementById('aiRail');
    if (!rail) return;
    rail.querySelectorAll('button[data-preset]').forEach((b) => b.remove());
    const blank = rail.querySelector('button[data-persona=""]');
    for (const p of m.presets || []) {
      const b = document.createElement('button');
      b.className = 'railBtn';
      b.dataset.persona = p.name;
      b.dataset.preset = '1';
      b.title = (p.title || ('New chat - ' + p.name)) + ' — double-click';
      b.textContent = p.letter || p.name.charAt(0).toUpperCase();
      rail.insertBefore(b, blank);
    }
  });

  // ---------- AI-bar defaults panel (J21's config tile, app edition) ----------
  // One tile: persona selector + the three dials. Values write `current`
  // (next launch); Set-as-default saves current AS that persona's default;
  // Reset restores it. The engine's launch layering: current → default →
  // _default baseline → hard 'manual'.
  let cfgShow = null;   // set by the panel below; ApexChat.showDefaults rides it
  (function buildCfgPanel() {
    const box = document.getElementById('seatCfg');
    if (!box) return;
    let cfg = {};
    let personaNames = [];   // from main's resolved config: presets + 'Seat'
    // concrete values only — 'default' is not a setting (the operator); Reset is
    // the road back. qwen/agy are blank-seat-only lanes, wired in render().
    const DIALS = {
      model: ['fable', 'opus', 'sonnet', 'haiku'],
      effort: ['low', 'medium', 'high', 'xhigh', 'max'],
      permissions: ['manual', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions'],
    };
    // The raw mode names lie to the eye — 'auto' reads like 'bypass' and is nearly
    // its opposite (the operator, 2026-07-13). Short titles in the box, the full
    // behavior wording on hover (the operator, 2026-07-14) — same pair the seat
    // dials use, so both surfaces read identically.
    const DIAL_LABELS = {
      manual: 'Ask',
      auto: 'Saved rules',
      acceptEdits: 'Edits pass',
      dontAsk: 'Never ask',
      bypassPermissions: 'Bypass ⚠',
    };
    const DIAL_DESCS = {
      manual: 'Ask me every time',
      auto: 'Use my saved rules — anything new still asks',
      acceptEdits: 'File edits pass — still asks before commands',
      dontAsk: 'Never ask — blocks anything not already allowed',
      bypassPermissions: 'Allow everything — never asks',
    };
    box.innerHTML =
      '<label><span class="cfgLbl">persona</span><select class="cfgPersona"></select><span class="cfgEff"></span></label>' +
      '<div class="cfgSep"></div>' +
      Object.keys(DIALS).map((k) =>
        '<label><span class="cfgLbl">' + k + '</span><select class="cfgDial" data-key="' + k + '"></select>' +
        '<span class="cfgEff" data-key="' + k + '"></span></label>').join('') +
      '<div class="cfgBtns"><button class="cfgDefault">Set as default</button>' +
      '<button class="cfgReset">Reset to default</button></div>';
    const personaSel = box.querySelector('.cfgPersona');
    // options rebuild from the config payload (R32: presets are extension
    // data, so the list is main's to send — a bare install shows only 'Seat')
    function refreshPersonaOptions() {
      const names = Object.keys(cfg);
      if (!names.length || names.join('|') === personaNames.join('|')) return;
      personaNames = names;
      const keep = personaSel.value;
      personaSel.textContent = '';
      for (const p of personaNames) {
        const o = document.createElement('option');
        o.value = p; o.textContent = p === 'Seat' ? 'blank seat' : p;
        personaSel.appendChild(o);
      }
      if (personaNames.includes(keep)) personaSel.value = keep;
    }
    for (const sel of box.querySelectorAll('.cfgDial')) {
      for (const v of DIALS[sel.dataset.key]) {
        const o = document.createElement('option');
        o.value = v; o.textContent = DIAL_LABELS[v] || v;
        if (DIAL_DESCS[v]) o.title = DIAL_DESCS[v];
        sel.appendChild(o);
      }
    }
    const RISKY = new Set(['bypassPermissions']);
    function render() {
      // main sends RESOLVED layers — current and default are always concrete
      const p = cfg[personaSel.value] || { current: {}, default: {} };
      const modelSel = box.querySelector('.cfgDial[data-key="model"]');
      // qwen (local) + agy (Gemini terminal) are blank-seat-only lanes —
      // personas need a chain-capable substrate (J22; agy is TTY-only, #76).
      // codex IS chain-capable (AGENTS.md substrate, 2026-07-14) — offered
      // to every persona, per TIER (J80: the composite splits to
      // model='codex' + codexModel in launchFor; labels match the live dial)
      for (const extra of [['qwen', 'qwen (local)'], ['agy', 'agy (Gemini terminal)'],
                           ['codex-sol', 'codex — sol (frontier)'],
                           ['codex-terra', 'codex — terra (balanced)'],
                           ['codex-luna', 'codex — luna (fast)']]) {
        const has = [...modelSel.options].find((o) => o.value === extra[0]);
        const want = extra[0].startsWith('codex') || personaSel.value === 'Seat';
        if (want && !has) {
          const o = document.createElement('option');
          o.value = extra[0]; o.textContent = extra[1];
          modelSel.appendChild(o);
        } else if (!want && has) has.remove();
      }
      for (const sel of box.querySelectorAll('.cfgDial')) {
        const k = sel.dataset.key;
        const cur = p.current[k] || '';
        if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
        sel.classList.toggle('risky', k === 'permissions' && RISKY.has(sel.value));
        const eff = box.querySelector('.cfgEff[data-key="' + k + '"]');
        eff.textContent = 'default: ' + (p.default[k] || '—');
      }
      // dials that don't exist for a lane grey out (the operator): qwen is chat-only
      // (no tools, no permission protocol); agy has no effort lever, and its
      // permissions are launch-time flags with no 'auto' equivalent
      const m = box.querySelector('.cfgDial[data-key="model"]').value;
      const effortD = box.querySelector('.cfgDial[data-key="effort"]');
      const permD = box.querySelector('.cfgDial[data-key="permissions"]');
      // codex KEEPS effort (maps to model_reasoning_effort — it defaults to
      // none, so the dial matters more there, not less)
      effortD.disabled = (m === 'qwen' || m === 'agy');
      effortD.title = effortD.disabled ? 'no effort lever on this lane' : '';
      permD.disabled = (m === 'qwen');
      permD.title = m === 'qwen' ? 'local qwen is chat-only — no tools, nothing to permit'
        : m === 'agy' ? 'agy asks in its own terminal; this sets its launch flag'
        : m.startsWith('codex') ? 'codex asks through our permission cards; on Windows the sandbox is a no-op — the cards are the boundary'
        : '';
      // per-lane holes: agy has no auto; codex's OWNED lane (R33) maps
      // manual→untrusted, acceptEdits→on-request, bypass→never — auto/dontAsk
      // have no approvalPolicy equivalent
      for (const o of permD.options)
        o.disabled = (m === 'agy' && o.value === 'auto') ||
          (m.startsWith('codex') && ['auto', 'dontAsk'].includes(o.value));
    }
    personaSel.onchange = render;
    box.addEventListener('change', (e) => {
      const sel = e.target.closest('.cfgDial');
      if (!sel) return;
      ApexBus.post('seatConfigSet', { persona: personaSel.value, key: sel.dataset.key, value: sel.value });
    });
    box.querySelector('.cfgDefault').onclick = () => {
      ApexBus.post('seatConfigDefault', { persona: personaSel.value });
      ApexToast(personaSel.value + ': current dials saved as its default');
    };
    box.querySelector('.cfgReset').onclick = () => {
      ApexBus.post('seatConfigReset', { persona: personaSel.value });
      ApexToast(personaSel.value + ': dials reset to its default');
    };
    // right-click on a rail button lands here (the operator, 2026-07-15): park the
    // defaults panel on that persona ('' → 'Seat', the blank seat's name)
    cfgShow = (persona) => {
      refreshPersonaOptions();
      if ([...personaSel.options].some((o) => o.value === persona)) {
        personaSel.value = persona;
        render();
      }
      box.scrollIntoView({ block: 'nearest' });
    };
    ApexBus.on('seatConfig', (m) => { cfg = m.config || {}; refreshPersonaOptions(); render(); });
    ApexBus.post('seatConfigGet', {});
  })();

  // Ask main what's still running. Nothing did this before — the seat list was
  // only ever PUSHED on change, so a reloaded window never learned about the
  // seats that outlived it (they kept running, unrendered). This is the trigger
  // for the reload-survival rebuild in the seatList handler above.
  ApexBus.post('seatList', {});
  ApexBus.post('seatHistory', {});

  return { openRailMenu, scheduleHide, hideRailMenu,
           showDefaults: (persona) => { if (cfgShow) cfgShow(persona); },
           newSeat: (persona) => ApexBus.post('seatCreate', { persona }),
           // task board hooks: chain chip on the tab + focus a step's seat
           setSeatBadge: (id, text) => {
             const c = chats.get(id);
             if (!c) return;
             c.chainBadge = text || '';
             renderTabs();
           },
           focusSeat: (id) => { if (chats.has(id)) switchTo(id); },
           hasSeat: (id) => chats.has(id),
           // for Safe quit: chats mid-turn or waiting on a permission answer
           busyCount: () => [...chats.values()]
             .filter((c) => !c.dead && (c.busy || c.permQueue.length)).length };
})();
