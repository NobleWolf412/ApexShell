// Apex — renderer extension injector. Loads last (after shell.js), asks main
// for the extension manifest, and injects each extension's stylesheets +
// renderer script. By this point the shell is fully booted, so extension
// renderers can register dock panes (ApexShell.registerDockPane) and speak
// the bus like any built-in module.
//
// CSP note: script-src 'self' covers same-scheme file: URLs — the injected
// tags point at ../extensions/<name>/… relative to index.html. If a script
// fails to load, the shell keeps running; the failure lands in the console
// (and therefore fails the smoke).
'use strict';
(function () {
  let injected = false;
  ApexBus.on('extList', (m) => {
    if (injected) return;   // one injection per document
    injected = true;
    for (const ext of m.extensions || []) {
      for (const href of ext.styles || []) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
      if (ext.renderer) {
        const s = document.createElement('script');
        // async=false keeps injected scripts executing in the ORDER main sent
        // them (dynamically created scripts default to async). A host extension
        // that exposes a global others register into — e.g. studio's ApexStudio,
        // consumed by the personas renderer — must run first; main/extensions.js
        // emits it ahead of its dependents (manifest `priority`).
        s.async = false;
        s.src = ext.renderer;
        s.onerror = () => console.error('[extensions] failed to load ' + ext.renderer);
        document.body.appendChild(s);
      }
    }
  });
  ApexBus.post('extList', {});
})();
