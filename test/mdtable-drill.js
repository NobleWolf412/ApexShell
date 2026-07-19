'use strict';

// Pins the "chat renders GFM tables as a real <table>" contract. The chat feed
// is proportional-font, so raw `|---|---|` markdown wraps into unreadable
// rubble — mdTable.js is what stops that regressing.

const assert = require('assert');
const { render, _tryTable } = require('../renderer/mdTable');

// A minimal escape that matches chatView.js's esc() so tests exercise the same
// input shape mdTable receives at runtime (already-escaped text).
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A pass-through inline transformer so we can inspect table structure directly.
const inline = (s) => s;

// ---- basic table ---------------------------------------------------------
(function basic() {
  const src = esc('before\n\n| col a | col b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nafter');
  const html = render(src, inline);
  assert.match(html, /<table class="mdTable">/, 'emits a table element');
  assert.match(html, /<thead><tr><th>col a<\/th><th>col b<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><tr><td>3<\/td><td>4<\/td><\/tr><\/tbody>/);
  assert.match(html, /^before\n\n/, 'text before the table is preserved');
  assert.match(html, /\n\nafter$/, 'text after the table is preserved');
})();

// ---- alignment (:---, ---:, :---:) ---------------------------------------
(function alignment() {
  const src = esc('| l | c | r |\n|:---|:---:|---:|\n| a | b | c |');
  const html = render(src, inline);
  assert.match(html, /<th style="text-align:left">l<\/th>/);
  assert.match(html, /<th style="text-align:center">c<\/th>/);
  assert.match(html, /<th style="text-align:right">r<\/th>/);
  assert.match(html, /<td style="text-align:left">a<\/td>/);
  assert.match(html, /<td style="text-align:center">b<\/td>/);
  assert.match(html, /<td style="text-align:right">c<\/td>/);
})();

// ---- header-only table (no body rows) is valid GFM -----------------------
(function headerOnly() {
  const src = esc('| a | b |\n|---|---|\n');
  const html = render(src, inline);
  assert.match(html, /<table class="mdTable"><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><\/table>/);
})();

// ---- non-table text passes through untouched -----------------------------
(function passthrough() {
  const src = esc('just a paragraph with | a pipe | in it\nand another line');
  const html = render(src, inline);
  assert.equal(html, esc('just a paragraph with | a pipe | in it\nand another line'),
    'without a separator line, pipes are not a table');
  assert.doesNotMatch(html, /<table/);
})();

// ---- inline transformer runs per cell ------------------------------------
(function perCellInline() {
  const upper = (s) => s.toUpperCase();
  const src = esc('| a | b |\n|---|---|\n| x | y |');
  const html = render(src, upper);
  assert.match(html, /<th>A<\/th><th>B<\/th>/);
  assert.match(html, /<td>X<\/td><td>Y<\/td>/);
})();

// ---- table body ends on a blank line or a non-pipe paragraph -------------
(function bodyBounds() {
  const blank = esc('| a | b |\n|---|---|\n| 1 | 2 |\n\nnext paragraph');
  const h1 = render(blank, inline);
  assert.match(h1, /<td>1<\/td><td>2<\/td>/);
  assert.match(h1, /\n\nnext paragraph$/, 'blank line ends the table');

  const noPipe = esc('| a | b |\n|---|---|\n| 1 | 2 |\nprose without a pipe');
  const h2 = render(noPipe, inline);
  assert.match(h2, /<td>1<\/td><td>2<\/td>/);
  assert.match(h2, /prose without a pipe$/);
  assert.doesNotMatch(h2, /<td>prose without a pipe<\/td>/,
    'a plain paragraph line is not swallowed as a row');
})();

// ---- escaped HTML in cells stays escaped (XSS contract) ------------------
(function xssInCell() {
  const src = esc('| a | b |\n|---|---|\n| <script>alert(1)</script> | ok |');
  const html = render(src, inline);
  assert.doesNotMatch(html, /<script>/, 'a live <script> tag must never appear');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
})();

// ---- pipe-inside-code-in-header separator detection ----------------------
(function guardSeparator() {
  // No separator line → not a table, even with pipes on adjacent lines.
  const src = esc('| a | b |\n| c | d |\n| e | f |');
  const html = render(src, inline);
  assert.doesNotMatch(html, /<table/);
})();

// ---- tryTable at line 0 sanity ------------------------------------------
(function tryTableExport() {
  const t = _tryTable(['| a | b |', '|---|---|', '| 1 | 2 |'], 0);
  assert.ok(t, 'tryTable finds the table');
  assert.deepEqual(t.head, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2']]);
  assert.equal(t.next, 3);
})();

console.log('mdtable drill: PASS');
