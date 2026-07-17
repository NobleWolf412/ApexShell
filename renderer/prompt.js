// Apex — ApexPrompt: the app's stand-in for window.prompt(), which Electron
// renderers DO NOT implement (it throws, unsupported by design). The theme
// panel learned this 2026-07-13 (J49's never-click-tested leg) and went
// inline; the workspace picker re-hit the same wall 2026-07-16 ("add
// workspace → select folder does nothing"). One shared modal instead of three
// local copies. Usage: const v = await ApexPrompt('Name:', 'default');
// resolves the entered string, or null on Cancel / Esc / backdrop click.
'use strict';

window.ApexPrompt = (message, initial) => new Promise((resolve) => {
  // Singleton: a second prompt while one is open would stack (two boxes) and,
  // via callers that post on resolve, double-fire (e.g. two taskDelegate for
  // one id). Refuse the second — the caller's await resolves null, a no-op.
  if (document.querySelector('.apxPrompt')) { resolve(null); return; }
  const wrap = document.createElement('div');
  wrap.className = 'apxPrompt';
  const box = document.createElement('div');
  box.className = 'apxPromptBox';
  const msg = document.createElement('div');
  msg.className = 'apxPromptMsg';
  msg.textContent = message || '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.maxLength = 120;
  inp.value = initial || '';
  const btns = document.createElement('div');
  btns.className = 'apxPromptBtns';
  const ok = document.createElement('button');
  ok.className = 'primary';
  ok.textContent = 'OK';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  const done = (v) => { wrap.remove(); resolve(v); };
  ok.onclick = () => done(inp.value);
  cancel.onclick = () => done(null);
  inp.addEventListener('keydown', (e) => {
    // stop here — else the same Esc bubbles to shell.js AFTER this box removed
    // itself, and its "is a prompt open?" guard finds none and collapses the panes
    if (e.key === 'Enter') { e.stopPropagation(); done(inp.value); }
    else if (e.key === 'Escape') { e.stopPropagation(); done(null); }
  });
  // clicking the dim backdrop = cancel (mousedown so a drag out of the input
  // that ENDS on the backdrop doesn't count as a click-away)
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
  btns.append(ok, cancel);
  box.append(msg, inp, btns);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  inp.focus();
  inp.select();
});
