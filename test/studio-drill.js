// Studio shell drill — the STUDIO dock pane + registerBuilder seam, headless.
// No Electron, no DOM: the renderer's document/window/ApexShell touchpoints are
// mocked the same way the persona-extension renderer gate mocks them. Proves the
// slice-1 contract: one dock pane at order 20, the ApexStudio.registerBuilder
// seam, PERSONAS|PROJECTS sub-tabs sorted by order, the lowest-order builder
// leading by default, in-place replacement of the PROJECTS placeholder, and
// user tab-switching.
'use strict';
const assert = require('assert');

function makeNode() {
  return {
    className: '', id: '', type: '', textContent: '', title: '',
    hidden: false, dataset: {}, children: [], listeners: {}, _html: '',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    addEventListener(t, fn) { this.listeners[t] = fn; },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...c) { this.children = c; },
    querySelector() { return null; },
  };
}

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// --- mock the renderer globals the studio script reaches for ---
const tabsNode = makeNode();
const viewsNode = makeNode();
const pane = makeNode();
pane.querySelector = (sel) =>
  sel === '.studioTabs' ? tabsNode : sel === '.studioViews' ? viewsNode : null;

let firstDiv = true;
global.document = {
  createElement(tag) {
    if (tag === 'div' && firstDiv) { firstDiv = false; return pane; }
    return makeNode();
  },
};
global.window = {};
let dock;
global.ApexShell = { registerDockPane(el, opts) { dock = { el, opts }; } };

const rendererPath = require.resolve('../extensions/studio/renderer');
delete require.cache[rendererPath];
require(rendererPath);
const studio = global.window.ApexStudio;

check('registers ONE dock pane at order 20 titled STUDIO', () => {
  assert.equal(dock.el, pane);
  assert.deepEqual(dock.opts, { order: 20 });
  assert.match(pane.innerHTML, /STUDIO/);
  assert.match(pane.innerHTML, /studioTabs/);
});

check('exposes the registerBuilder seam on window.ApexStudio', () => {
  assert.equal(typeof studio.registerBuilder, 'function');
});

check('PROJECTS ships as an empty placeholder sub-tab', () => {
  assert.equal(tabsNode.children.length, 1);
  assert.equal(tabsNode.children[0].textContent, 'PROJECTS');
  assert.equal(viewsNode.children.length, 1);
  assert.equal(viewsNode.children[0].dataset.builder, 'projects');
});

let personasMount;
check('a lower-order builder mounts, sorts first, and leads by default', () => {
  studio.registerBuilder({
    id: 'personas', label: 'PERSONAS', order: 10,
    mount: (el) => { personasMount = el; },
  });
  assert.ok(personasMount, 'mount received a view element');
  assert.equal(tabsNode.children.length, 2);
  assert.equal(tabsNode.children[0].textContent, 'PERSONAS'); // order 10 first
  assert.equal(tabsNode.children[1].textContent, 'PROJECTS'); // order 20 second
  const pv = viewsNode.children.find((v) => v.dataset.builder === 'personas');
  const jv = viewsNode.children.find((v) => v.dataset.builder === 'projects');
  assert.equal(pv.hidden, false); // lowest order leads until the user picks
  assert.equal(jv.hidden, true);
});

check('re-registering an id replaces its view in place (no new view/tab)', () => {
  const jvBefore = viewsNode.children.find((v) => v.dataset.builder === 'projects');
  let realMount;
  studio.registerBuilder({
    id: 'projects', label: 'PROJECTS', order: 20,
    mount: (el) => { realMount = el; el.appendChild(makeNode()); },
  });
  assert.equal(realMount, jvBefore, 'same view element reused');
  assert.equal(viewsNode.children.length, 2, 'no extra view added');
  assert.equal(tabsNode.children.length, 2, 'no extra tab added');
});

check('clicking a sub-tab activates it and hides the others', () => {
  const personasTab = tabsNode.children.find((t) => t.dataset.builder === 'personas');
  const projectsTab = tabsNode.children.find((t) => t.dataset.builder === 'projects');
  const pv = viewsNode.children.find((v) => v.dataset.builder === 'personas');
  const jv = viewsNode.children.find((v) => v.dataset.builder === 'projects');
  projectsTab.listeners.click();
  assert.equal(jv.hidden, false);
  assert.equal(pv.hidden, true);
  assert.equal(projectsTab.dataset.active, 'true');
  assert.equal(personasTab.dataset.active, 'false');
});

check('junk registrations are ignored', () => {
  const tabsBefore = tabsNode.children.length;
  studio.registerBuilder(null);
  studio.registerBuilder({ id: 'nomount' });
  studio.registerBuilder({ mount: () => {} });
  assert.equal(tabsNode.children.length, tabsBefore);
});

console.log('\nstudio-drill: ' + passed + ' checks passed');
