// Apex STUDIO — the design-mode overlay TEMPLATE (STUDIO v2, Wave F slice F3).
//
// This file is a template ASSET: Apex never runs it. The scaffold (the coder
// persona, guided by the F2 kickoff addendum) copies it into a generated app
// and includes it in DEV builds only — a plain script tag behind the stack's
// dev flag; design/design-mode.md in the Apex repo shows the per-stack
// shapes. Production builds carry none of it.
//
// What it does, standalone (no Apex required): reads the three contract
// spines — design/tokens.json, design/components.json, design/manifest.json
// (design/contract-spines.md is the schema authority) — over same-origin
// RELATIVE fetch, fail-soft per file: a missing or unusable spine disables
// just that panel with an honest note, never a throw, never a blank overlay.
// A floating launcher + panel (bottom-right) ride their OWN shadow root, so
// the app's CSS cannot restyle the panel and the panel's CSS cannot leak
// into the app. Element picking is the A5 mockup-annotate pattern
// (extensions/studio/lib/mockup.js PICKER_SCRIPT): one fixed,
// pointer-events-none highlight box, hover to aim, click to select, Escape
// to cancel — the overlay never mutates the app's DOM beyond hosting
// itself. A picked element resolves to its component ([data-component] mark
// first, else a class token naming a library component) and the panel
// offers variant/effect radio pickers plus the component's token-ROLE
// bindings resolved against tokens.json. A second tab walks the DOM into a
// component tree and lists the manifest's screens beside it.
//
// HONEST v1 LIMITS — read-only + clipboard. "Copy change" writes a precise,
// paste-ready instruction to the clipboard; it does NOT edit files and does
// NOT hot-apply. Real persistence needs a dev-server write endpoint the
// template cannot assume exists — out of scope for v1, and pretending
// otherwise would be worse than saying so. The Apex-connected future
// (Waves C / F2+): when the app runs under Apex's preview, the same overlay
// gains the AI half — the co-designer and the Surgeon — and picker changes
// become ordinary file writes to the spines. Pickers for taste, seats for
// structure.
//
// Self-containment law (A3, applied to the template itself): zero
// dependencies, zero imports, zero external URLs of any kind. The drill
// (test/studio-designmode-drill.js) holds this file to those checks
// statically.
(function () {
  'use strict';

  // A hot-reloading dev server can inject the same script twice; one
  // overlay per page, ever.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__apexDesignMode) return;
  window.__apexDesignMode = true;

  // ---- caps ----------------------------------------------------------------
  var MAX_SPINE_BYTES = 256 * 1024; // fail-soft ceiling per spine file
  var MAX_TREE_NODES = 200;         // the tree tab stays readable on huge pages
  var MAX_PICK_TEXT = 80;           // context slice for the copied instruction
  var MAX_PICK_HOPS = 6;            // hops up from a click to a component root

  var SPINES = [
    { key: 'tokens', file: 'tokens.json', label: 'token' },
    { key: 'components', file: 'components.json', label: 'component picker' },
    { key: 'manifest', file: 'manifest.json', label: 'manifest' },
  ];

  // ---- state ---------------------------------------------------------------
  var state = {
    open: false,
    tab: 'inspect',
    picking: false,
    picked: null,        // { selector, text, name, via, variant, effect }
    chooseVariant: null,
    chooseEffect: null,  // null means "(none)"
    copied: '',          // '', 'ok', 'failed'
    spines: {},          // key -> { data, note } — a note means that panel is disabled
  };
  var spinesRequested = false;
  var host = null, root = null, box = null, launcher = null, panel = null;
  var pickHandlers = null;

  // ---- spine loading (fail-soft, same-origin relative) ---------------------
  // The scaffolded app serves its repo's design/ dir beside the page. An
  // override global exists for dev servers with a different layout, but it
  // must stay a RELATIVE path: anything carrying a protocol (':') or a
  // protocol-relative '//' is refused and the default used — the overlay
  // never fetches off-origin.
  function designBase() {
    var base = 'design/';
    var o = window.APEX_DESIGN_BASE;
    if (typeof o === 'string' && o && o.indexOf(':') === -1 && o.indexOf('//') === -1)
      base = o.charAt(o.length - 1) === '/' ? o : o + '/';
    return base;
  }

  function loadSpine(spec) {
    state.spines[spec.key] = { data: null, note: 'loading ' + spec.file + '…' };
    function disable(reason) {
      // fail-soft: THIS panel is disabled with an honest note; the rest of
      // the overlay keeps working. Never a throw, never a silent blank.
      state.spines[spec.key] = {
        data: null,
        note: 'design/' + spec.file + ' ' + reason + ' — the ' + spec.label + ' panel is disabled.',
      };
      render();
    }
    if (typeof window.fetch !== 'function') { disable('needs fetch, which this browser lacks'); return; }
    try {
      window.fetch(designBase() + spec.file, { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) { disable('was not found (HTTP ' + res.status + ')'); return null; }
        return res.text();
      }).then(function (text) {
        if (text === null || text === undefined) return; // disabled above
        if (text.length > MAX_SPINE_BYTES) { disable('is implausibly large'); return; }
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (err) { disable('is not valid JSON'); return; }
        if (!parsed || typeof parsed !== 'object' || parsed.schema !== 1) {
          disable('is not a usable schema-1 file'); return;
        }
        state.spines[spec.key] = { data: parsed, note: null };
        render();
      }).catch(function () { disable('could not be fetched'); });
    } catch (err) { disable('could not be fetched'); }
  }

  function ensureSpines() {
    // Inert until first opened: a dev page pays the three tiny fetches only
    // when someone actually reaches for the overlay.
    if (spinesRequested) return;
    spinesRequested = true;
    for (var i = 0; i < SPINES.length; i++) loadSpine(SPINES[i]);
  }

  function reloadSpines() {
    // Edit tokens.json, hit reload, see the new values — the v1 stand-in
    // for hot-apply.
    for (var i = 0; i < SPINES.length; i++) loadSpine(SPINES[i]);
  }

  // ---- the component library view ------------------------------------------
  function libraryComponents() {
    var s = state.spines.components;
    var list = s && s.data && Array.isArray(s.data.components) ? s.data.components : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c && typeof c === 'object' && typeof c.name === 'string') out.push(c);
    }
    return out;
  }

  function componentByName(name) {
    var list = libraryComponents();
    for (var i = 0; i < list.length; i++)
      if (list[i].name === name) return list[i];
    return null;
  }

  // The contract's whole role vocabulary (design/contract-spines.md § the
  // token-role table) resolved against the tokens.json shape design.js
  // compiles. An unknown role or a missing group reads as unresolved —
  // shown honestly, never guessed.
  function resolveRole(role, tokens) {
    var dot = role.indexOf('.');
    if (dot < 1) return null;
    var group = role.slice(0, dot);
    var name = role.slice(dot + 1);
    try {
      if (group === 'color') return str(tokens.color[name]);
      if (group === 'type') return px(tokens.type.scale.sizes[name]);
      if (group === 'family') return str(tokens.type.family[name]);
      if (group === 'space') return px(tokens.space.steps[Number(name) - 1]);
      if (group === 'radius') return px(tokens.radius[name]);
      if (group === 'shadow') return str(tokens.shadow[name]);
      if (group === 'motion') return str(tokens.motion[name]);
    } catch (err) { return null; }
    return null;
  }
  function str(v) { return typeof v === 'string' ? v : null; }
  function px(v) { return typeof v === 'number' && isFinite(v) ? v + 'px' : null; }

  // ---- component resolution over the live DOM ------------------------------
  function classTokens(node) {
    var raw = typeof node.className === 'string' ? node.className : '';
    return raw.trim() ? raw.trim().split(/\s+/) : [];
  }

  // [data-component] is the contract's authoritative mark; a class token
  // naming a library component is the fallback. Walk up a few hops so a
  // click on a button's label still resolves the button.
  function componentAt(start) {
    var haveLibrary = libraryComponents().length > 0;
    var node = start, hops = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && hops < MAX_PICK_HOPS) {
      if (node !== host) {
        var mark = node.getAttribute ? node.getAttribute('data-component') : null;
        if (mark) return { el: node, name: mark, via: 'data-component' };
        if (haveLibrary) {
          var cls = classTokens(node);
          for (var i = 0; i < cls.length; i++)
            if (componentByName(cls[i])) return { el: node, name: cls[i], via: 'class' };
        }
      }
      node = node.parentElement;
      hops += 1;
    }
    return null;
  }

  // Current-state reads: an explicit data-variant / data-effect attribute
  // wins; else the first class token naming a declared option. No mark at
  // all reads as unmarked in the copy — honest, not guessed.
  function variantOf(node, comp) {
    var attr = node.getAttribute ? node.getAttribute('data-variant') : null;
    if (attr) return attr;
    var declared = Array.isArray(comp.variants) ? comp.variants : [];
    var cls = classTokens(node);
    for (var i = 0; i < cls.length; i++)
      if (declared.indexOf(cls[i]) !== -1) return cls[i];
    return null;
  }
  function effectOf(node, comp) {
    var attr = node.getAttribute ? node.getAttribute('data-effect') : null;
    if (attr) return attr;
    var declared = Array.isArray(comp.effects) ? comp.effects : [];
    var cls = classTokens(node);
    for (var i = 0; i < cls.length; i++)
      if (declared.indexOf(cls[i]) !== -1) return cls[i];
    return null;
  }

  // The A5 selector idiom, mirrored: id wins; else a tag.class chain (at
  // most 4 hops, 2 classes each); a class-free hop falls back to
  // :nth-of-type. A locating HINT for the instruction, not a query.
  function selectorFor(target) {
    if (target.id) return '#' + target.id;
    var parts = [];
    var node = target;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 4) {
      var part = node.tagName.toLowerCase();
      var cls = classTokens(node);
      if (cls.length) part += '.' + cls.slice(0, 2).join('.');
      else {
        var i = 1, sib = node;
        while ((sib = sib.previousElementSibling)) { if (sib.tagName === node.tagName) i += 1; }
        part += ':nth-of-type(' + i + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // ---- element picking (the A5 overlay pattern) ----------------------------
  function place(target) {
    if (!target) { box.style.display = 'none'; return; }
    var r = target.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
  }

  function pickTarget(e) {
    var t = e.target;
    if (!t || t.nodeType !== 1) return null;
    // Events from inside the shadow root retarget to the host at the
    // document level — the overlay can never pick itself.
    if (t === host) return null;
    if (t === document.documentElement || t === document.body) return null;
    return t;
  }

  function startPicking() {
    if (state.picking) return;
    state.picking = true;
    state.copied = '';
    pickHandlers = {
      move: function (e) { place(pickTarget(e)); },
      leave: function () { place(null); },
      click: function (e) {
        var t = pickTarget(e);
        if (!t) return; // our own panel — let its buttons keep working
        e.preventDefault();
        e.stopPropagation();
        selectElement(t);
      },
      key: function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); stopPicking(); render(); }
      },
    };
    document.addEventListener('mousemove', pickHandlers.move, true);
    document.addEventListener('mouseleave', pickHandlers.leave, true);
    document.addEventListener('click', pickHandlers.click, true);
    document.addEventListener('keydown', pickHandlers.key, true);
    render();
  }

  function stopPicking() {
    if (!state.picking) return;
    state.picking = false;
    document.removeEventListener('mousemove', pickHandlers.move, true);
    document.removeEventListener('mouseleave', pickHandlers.leave, true);
    document.removeEventListener('click', pickHandlers.click, true);
    document.removeEventListener('keydown', pickHandlers.key, true);
    pickHandlers = null;
    place(null);
  }

  function selectElement(clicked) {
    stopPicking();
    var hit = componentAt(clicked);
    var comp = hit ? componentByName(hit.name) : null;
    var target = hit ? hit.el : clicked;
    state.picked = {
      selector: selectorFor(target),
      text: (target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, MAX_PICK_TEXT),
      name: hit ? hit.name : null,
      via: hit ? hit.via : null,
      variant: comp ? variantOf(target, comp) : null,
      effect: comp ? effectOf(target, comp) : null,
    };
    state.chooseVariant = state.picked.variant;
    state.chooseEffect = state.picked.effect;
    state.copied = '';
    render();
  }

  // ---- the copied instruction (v1 persistence) -----------------------------
  // Precise enough for a coder seat (or a human) to apply without this page
  // open: component, locating selector, the exact from -> to, and the one
  // law restated. Clipboard is the WHOLE write path in v1 — see the header.
  function instructionText() {
    var p = state.picked;
    var lines = ['DESIGN CHANGE (from the design-mode overlay):'];
    lines.push('- component: ' + p.name + ' (declared in design/components.json)');
    lines.push('- element: ' + p.selector + (p.text ? ' ("' + p.text + '")' : ''));
    if (state.chooseVariant !== p.variant)
      lines.push('- variant: ' + (p.variant || '(unmarked)') + ' -> ' + state.chooseVariant);
    if ((state.chooseEffect || null) !== (p.effect || null))
      lines.push('- effect: ' + (p.effect || '(none)') + ' -> ' + (state.chooseEffect || '(none)'));
    lines.push('- the one law: no hard-coded colors or fonts — tokens only (design/tokens.json).');
    return lines.join('\n');
  }

  // Clipboard, fail-soft: the async API where it exists (secure contexts),
  // else the legacy textarea path — a dev overlay cannot assume its origin.
  // A copy that fails both ways reports failure instead of lying.
  function copyText(text, done) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { done(true); },
          function () { done(copyFallback(text)); }
        );
        return;
      }
    } catch (err) { /* fall through to the legacy path */ }
    done(copyFallback(text));
  }

  function copyFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    root.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    root.removeChild(ta);
    return ok;
  }

  function copyChange() {
    copyText(instructionText(), function (ok) {
      state.copied = ok ? 'ok' : 'failed';
      render();
    });
  }

  // ---- the component tree (tab two) ----------------------------------------
  // Depth counts COMPONENT nesting, not raw DOM depth, so the tree reads as
  // the app's composition, not its markup.
  function collectTree() {
    var out = [];
    var truncated = false;
    var haveLibrary = libraryComponents().length > 0;
    function matchNode(node) {
      var mark = node.getAttribute ? node.getAttribute('data-component') : null;
      if (mark) return { name: mark, via: 'data-component' };
      if (!haveLibrary) return null;
      var cls = classTokens(node);
      for (var i = 0; i < cls.length; i++)
        if (componentByName(cls[i])) return { name: cls[i], via: 'class' };
      return null;
    }
    function walk(node, depth) {
      if (truncated || !node || node.nodeType !== 1 || node === host) return;
      var hit = matchNode(node);
      var next = depth;
      if (hit) {
        if (out.length >= MAX_TREE_NODES) { truncated = true; return; }
        var comp = componentByName(hit.name);
        out.push({
          name: hit.name,
          via: hit.via,
          depth: depth,
          variant: comp ? variantOf(node, comp) : null,
        });
        next = depth + 1;
      }
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) walk(c, next);
    }
    if (document.body) walk(document.body, 0);
    return { nodes: out, truncated: truncated, haveLibrary: haveLibrary };
  }

  // ---- panel DOM (all of it behind the shadow boundary) --------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function note(text) { return el('div', 'note', text); }
  function fieldRow(k, v) {
    var row = el('div', 'row');
    row.appendChild(el('span', 'k', k));
    row.appendChild(el('span', 'v', v));
    return row;
  }
  function button(label, onClick) {
    var b = el('button', 'btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function radioGroup(name, options, current, onPick) {
    var wrap = el('div', 'group');
    wrap.appendChild(el('div', 'k', name));
    for (var i = 0; i < options.length; i++) {
      (function (opt) {
        var lab = el('label', 'radio');
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.checked = opt === current;
        input.addEventListener('change', function () { onPick(opt); });
        lab.appendChild(input);
        lab.appendChild(el('span', null, opt));
        wrap.appendChild(lab);
      })(String(options[i]));
    }
    return wrap;
  }

  function renderBindings(body, comp) {
    var tokens = state.spines.tokens;
    var bind = comp.tokens && typeof comp.tokens === 'object' ? comp.tokens : null;
    var parts = bind ? Object.keys(bind) : [];
    if (!parts.length) { body.appendChild(note('No token bindings declared for this component.')); return; }
    body.appendChild(el('div', 'hdr', 'token roles'));
    for (var i = 0; i < parts.length; i++) {
      var role = String(bind[parts[i]]);
      var value = tokens && tokens.data ? resolveRole(role, tokens.data) : null;
      body.appendChild(fieldRow(parts[i],
        role + (value !== null ? ' = ' + value : ' (value unresolved)')));
    }
  }

  function renderInspect(body) {
    if (state.picking) {
      body.appendChild(note('Picking — hover to aim, click to select, Escape to cancel.'));
      body.appendChild(button('cancel picking', function () { stopPicking(); render(); }));
    } else {
      body.appendChild(button('pick an element', startPicking));
    }
    var comps = state.spines.components;
    var toks = state.spines.tokens;
    if (comps && comps.note) body.appendChild(note(comps.note));
    if (toks && toks.note) body.appendChild(note(toks.note));
    var p = state.picked;
    if (!p) { body.appendChild(note('Nothing picked yet.')); return; }
    body.appendChild(fieldRow('element', p.selector + (p.text ? ' — "' + p.text + '"' : '')));
    if (!p.name) {
      body.appendChild(note('No component match: no [data-component] mark and no class naming a library component.'));
      return;
    }
    body.appendChild(fieldRow('component', p.name + ' (via ' + p.via + ')'));
    var comp = componentByName(p.name);
    if (!comp) {
      body.appendChild(note('"' + p.name + '" is not declared in design/components.json, so it has no pickers.'));
      return;
    }
    var variants = Array.isArray(comp.variants) ? comp.variants : [];
    if (variants.length) {
      body.appendChild(radioGroup('variant', variants, state.chooseVariant, function (opt) {
        state.chooseVariant = opt; state.copied = ''; render();
      }));
    } else {
      body.appendChild(note('No variants declared — nothing to pick.'));
    }
    var effects = Array.isArray(comp.effects) ? comp.effects : [];
    if (effects.length) {
      body.appendChild(radioGroup('effect', ['(none)'].concat(effects),
        state.chooseEffect === null ? '(none)' : state.chooseEffect, function (opt) {
          state.chooseEffect = opt === '(none)' ? null : opt; state.copied = ''; render();
        }));
    }
    renderBindings(body, comp);
    var changed = state.chooseVariant !== p.variant ||
      (state.chooseEffect || null) !== (p.effect || null);
    if (!changed) { body.appendChild(note('Pick a different variant or effect to copy a change.')); return; }
    body.appendChild(el('pre', 'pre', instructionText()));
    body.appendChild(button('copy change', copyChange));
    if (state.copied === 'ok') body.appendChild(note('Copied — paste it to your coder seat or apply it by hand.'));
    if (state.copied === 'failed') body.appendChild(note('The clipboard refused the write — copy the text above by hand.'));
  }

  function renderTree(body) {
    var comps = state.spines.components;
    if (comps && comps.note) body.appendChild(note(comps.note));
    var res = collectTree();
    body.appendChild(el('div', 'hdr', 'components in the DOM'));
    if (!res.nodes.length) {
      body.appendChild(note(res.haveLibrary
        ? 'No components found: no [data-component] marks and no library class names in the DOM.'
        : 'No [data-component] marks found — and without a usable design/components.json, class matching is off.'));
    }
    for (var i = 0; i < res.nodes.length; i++) {
      var n = res.nodes[i];
      var line = el('div', 'treeline',
        n.name + (n.variant ? ' [' + n.variant + ']' : '') + (n.via === 'class' ? ' (class)' : ''));
      line.style.paddingLeft = (n.depth * 12) + 'px';
      body.appendChild(line);
    }
    if (res.truncated) body.appendChild(note('Capped at ' + MAX_TREE_NODES + ' nodes.'));
    var man = state.spines.manifest;
    body.appendChild(el('div', 'hdr', 'manifest screens'));
    if (!man || man.note) {
      body.appendChild(note(man && man.note ? man.note : 'design/manifest.json is still loading.'));
      return;
    }
    var screens = Array.isArray(man.data.screens) ? man.data.screens : [];
    if (!screens.length) { body.appendChild(note('The manifest declares no screens yet.')); return; }
    for (var j = 0; j < screens.length; j++) {
      var s = screens[j];
      if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
      var uses = Array.isArray(s.uses) ? s.uses.length : 0;
      body.appendChild(fieldRow(s.id,
        (typeof s.title === 'string' && s.title ? s.title + ' — ' : '') +
        uses + ' component use' + (uses === 1 ? '' : 's')));
    }
  }

  function render() {
    if (!host) return;
    launcher.textContent = state.open ? 'close' : 'design';
    panel.style.display = state.open ? 'block' : 'none';
    if (!state.open) return;
    panel.textContent = ''; // full rebuild — the DOM is small, clarity wins
    var head = el('div', 'head');
    head.appendChild(el('span', 'title', 'design mode'));
    head.appendChild(button('reload spines', reloadSpines));
    panel.appendChild(head);
    var tabs = el('div', 'tabs');
    var tabNames = ['inspect', 'tree'];
    for (var i = 0; i < tabNames.length; i++) {
      (function (tab) {
        var b = button(tab, function () { state.tab = tab; render(); });
        b.className = 'tab' + (state.tab === tab ? ' on' : '');
        tabs.appendChild(b);
      })(tabNames[i]);
    }
    panel.appendChild(tabs);
    var body = el('div', 'body');
    if (state.tab === 'inspect') renderInspect(body);
    else renderTree(body);
    panel.appendChild(body);
  }

  function toggle() {
    state.open = !state.open;
    if (!state.open) stopPicking();
    else ensureSpines();
    render();
  }

  // The overlay's own chrome is deliberately hard-coded (the highlight blue
  // is A5's) — the one law binds the APP's surfaces, not the dev tool
  // inspecting them, and the panel must render even when tokens.json is the
  // thing that is broken.
  var PANEL_CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; }',
    '.hl { position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483647;',
    '  border: 2px solid #7aa2ff; border-radius: 2px; background: rgba(122,162,255,0.15); display: none; }',
    '.launcher { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;',
    '  background: #14161b; color: #e6e9ee; border: 1px solid #2c313c; border-radius: 999px;',
    '  padding: 6px 14px; font: 600 11px ui-monospace, Consolas, monospace;',
    '  letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }',
    '.launcher:hover { border-color: #7aa2ff; }',
    '.panel { position: fixed; right: 16px; bottom: 52px; width: 340px; max-height: 72vh;',
    '  overflow: auto; z-index: 2147483646; background: #14161b; color: #e6e9ee;',
    '  border: 1px solid #2c313c; border-radius: 8px; box-shadow: 0 8px 22px rgba(0,0,0,0.45);',
    '  font: 12px/1.55 ui-monospace, Consolas, monospace; display: none; }',
    '.head { display: flex; justify-content: space-between; align-items: center;',
    '  padding: 8px 10px; border-bottom: 1px solid #2c313c; }',
    '.title { font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;',
    '  font-size: 11px; color: #8a919c; }',
    '.tabs { display: flex; gap: 4px; padding: 6px 10px 0; }',
    '.tab { background: none; border: 1px solid #2c313c; border-radius: 5px; color: #8a919c;',
    '  padding: 3px 10px; cursor: pointer; font: inherit; }',
    '.tab.on { color: #e6e9ee; border-color: #7aa2ff; }',
    '.body { padding: 8px 10px; }',
    '.btn { background: #1d2027; border: 1px solid #2c313c; border-radius: 5px; color: #e6e9ee;',
    '  padding: 4px 10px; cursor: pointer; font: inherit; margin: 2px 0; }',
    '.btn:hover { border-color: #7aa2ff; }',
    '.note { color: #8a919c; margin: 6px 0; }',
    '.row { display: flex; gap: 6px; margin: 2px 0; }',
    '.k { color: #8a919c; flex: none; }',
    '.v { word-break: break-word; }',
    '.group { margin: 8px 0; }',
    '.radio { display: inline-flex; align-items: center; gap: 4px; margin: 2px 10px 2px 0; cursor: pointer; }',
    '.pre { white-space: pre-wrap; word-break: break-word; background: #0f1115;',
    '  border: 1px solid #2c313c; border-radius: 5px; padding: 6px; margin: 6px 0; font: inherit; }',
    '.treeline { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.hdr { margin: 10px 0 4px; color: #8a919c; text-transform: uppercase;',
    '  font-size: 10px; letter-spacing: 0.08em; }',
  ].join('\n');

  function init() {
    host = document.createElement('div');
    host.setAttribute('data-apex-design-mode', '');
    // The overlay's ONE structural footprint in the app is this host
    // element. Everything else lives behind the shadow boundary: the app's
    // CSS cannot restyle the panel, and the panel's CSS cannot leak out.
    root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = PANEL_CSS;
    root.appendChild(style);
    box = el('div', 'hl');
    root.appendChild(box);
    launcher = button('design', toggle);
    launcher.className = 'launcher';
    root.appendChild(launcher);
    panel = el('div', 'panel');
    root.appendChild(panel);
    (document.body || document.documentElement).appendChild(host);
    render();
  }

  try { init(); }
  catch (err) {
    // A dev convenience must never take the app down with it.
    try { console.warn('[apex design-mode] failed to start: ' + (err && err.message)); }
    catch (err2) { /* even the warning is best effort */ }
  }
})();
