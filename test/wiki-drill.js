// Wiki Pipeline — headless drill for the mechanical core (store + parser).
// No model, no Electron: proves the free half and the output contract.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../extensions/wiki/lib/store');
const { buildPrompt, parseOutput, FILE_OPEN, FILE_END } = require('../extensions/wiki/lib/compile');

let pass = 0;
const ok = (label) => { console.log('PASS  ' + label); pass++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-drill-'));
const store = Store(root);
store.ensure();

// 1. ingest → queue derives
const stem = store.ingest('Redstone Notes', 'Pistons need a signal. Slime blocks stick.');
assert.equal(store.listRaw().length, 1, 'one raw entry');
assert.equal(store.status().queueDepth, 1, 'queue depth 1 after ingest');
ok('1 ingest adds a raw entry and the queue derives it');

// 2. write a page + mark compiled → entry leaves the queue, page appears
const written = store.writePage('redstone.md', '# Redstone\n\nPistons and slime.\n');
assert.equal(written, 'redstone.md', 'page written with sane name');
store.markCompiled(stem, [written], new Date().toISOString());
assert.equal(store.status().queueDepth, 0, 'queue empty after compile');
assert.equal(store.status().pageCount, 1, 'one wiki page');
ok('2 marking compiled removes the entry from the queue and records the page');

// 3. path traversal is sanitized on write
const evil = store.writePage('../../../etc/passwd', 'nope');
assert.ok(!evil.includes('..') && !evil.includes('/') && !evil.includes('\\'), 'no traversal in written name');
assert.ok(fs.existsSync(path.join(root, 'wiki', evil)), 'sanitized page landed inside wiki/');
ok('3 writePage confines output to wiki/ (path traversal sanitized)');

// 4. search finds content
const hits = store.searchPages('pistons');
assert.ok(hits.some((h) => h.page === 'redstone.md'), 'search finds the page');
assert.equal(store.searchPages('').length, 0, 'empty search returns nothing');
ok('4 search matches page content and no-ops on empty');

// 5. parseOutput — two file blocks
const two = [
  'Here is my compile:',
  `${FILE_OPEN} alpha.md===`,
  '---', 'title: Alpha', 'sources: [x]', '---', '# Alpha', 'body a',
  FILE_END,
  'and another',
  `${FILE_OPEN} beta.md=== (existing)`,
  '# Beta', 'body b',
  FILE_END,
].join('\n');
const p = parseOutput(two);
assert.equal(p.skip, false, 'not a skip');
assert.equal(p.files.length, 2, 'two files parsed');
assert.equal(p.files[0].path, 'alpha.md', 'first path');
assert.ok(p.files[0].content.includes('# Alpha'), 'first content');
assert.ok(p.files[1].content.includes('body b'), 'second content');
ok('5 parseOutput extracts multiple file blocks, ignores stray prose');

// 6. parseOutput — skip sentinel
assert.equal(parseOutput('nothing here ===APEX-WIKI-SKIP=== really').skip, true, 'skip detected');
ok('6 parseOutput detects the SKIP sentinel');

// 7. buildPrompt carries the entry + the output contract + the sources hint
const prompt = buildPrompt({ store, entryStem: stem, entryText: store.readRaw(stem), personaVoice: 'Rowan' });
assert.ok(prompt.includes('Slime blocks stick'), 'entry text present');
assert.ok(prompt.includes(FILE_OPEN) && prompt.includes(FILE_END), 'output markers present');
assert.ok(prompt.includes('sources: [' + stem + ']'), 'sources hint present');
assert.ok(prompt.includes('Rowan'), 'persona voice woven in');
ok('7 buildPrompt includes entry, output contract, sources hint, and voice');

try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* */ }
console.log('\nwiki drill: PASS (' + pass + '/7)');
