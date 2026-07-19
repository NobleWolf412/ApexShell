// GFM tables over ALREADY-ESCAPED text. The chat renders in a proportional
// font, so a raw `| col | col |` table wraps into pipe-dash rubble — that is
// the "jumbled" bug this module fixes. Cells are rendered through a caller-
// supplied inline transformer (linkify + code + bold) so the same inline rules
// apply inside and outside a table, without a second pass over the emitted
// table HTML (which would double-transform).
'use strict';

(function init(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ApexMdTable = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
  // A GFM separator cell: three or more dashes, optional leading/trailing `:`
  // for alignment. Whitespace on either side is tolerant.
  const SEP_CELL = /^\s*:?-{3,}:?\s*$/;
  const HAS_PIPE = /\|/;
  // A separator LINE: one or more separator cells joined by pipes. Used to
  // spot the second line of a table AND to stop the body when a stray one
  // appears mid-stream (we don't consume it as a row).
  const SEP_LINE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

  function splitRow(row) {
    let r = row.replace(/^\s+|\s+$/g, '');
    if (r.startsWith('|')) r = r.slice(1);
    if (r.endsWith('|')) r = r.slice(0, -1);
    return r.split('|').map((c) => c.trim());
  }

  function alignmentOf(cell) {
    const s = cell.trim();
    const l = s.startsWith(':');
    const r = s.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  }

  // If a table starts at lines[i], return {head, aligns, rows, next}. Else null.
  function tryTable(lines, i) {
    if (i + 1 >= lines.length) return null;
    if (!HAS_PIPE.test(lines[i])) return null;
    if (!SEP_LINE.test(lines[i + 1])) return null;
    const head = splitRow(lines[i]);
    const sepCells = splitRow(lines[i + 1]);
    // Every separator cell must actually parse as a separator (SEP_LINE alone
    // would let `--- | text` through if we were sloppy).
    if (!sepCells.every((c) => SEP_CELL.test(c))) return null;
    const aligns = sepCells.map(alignmentOf);
    const rows = [];
    let j = i + 2;
    while (j < lines.length) {
      const ln = lines[j];
      if (!ln.trim()) break;                // blank line ends the table
      if (!HAS_PIPE.test(ln)) break;         // a plain paragraph line ends it
      if (SEP_LINE.test(ln)) break;          // a second separator ends it
      rows.push(splitRow(ln));
      j++;
    }
    return { head, aligns, rows, next: j };
  }

  function cellAttr(align) {
    return align ? ' style="text-align:' + align + '"' : '';
  }

  function render(escapedText, inline) {
    // Rejoined with a single '\n' between segments — that is exactly the
    // separator split() consumed between each buf-flush and the table (or
    // vice-versa), so the surrounding blank-line spacing round-trips.
    const lines = String(escapedText == null ? '' : escapedText).split('\n');
    const segments = [];
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      segments.push(inline(buf.join('\n')));
      buf = [];
    };
    let i = 0;
    while (i < lines.length) {
      const t = tryTable(lines, i);
      if (!t) { buf.push(lines[i]); i++; continue; }
      flush();
      let html = '<table class="mdTable"><thead><tr>';
      for (let k = 0; k < t.head.length; k++) {
        html += '<th' + cellAttr(t.aligns[k]) + '>' + inline(t.head[k]) + '</th>';
      }
      html += '</tr></thead>';
      if (t.rows.length) {
        html += '<tbody>';
        for (const r of t.rows) {
          html += '<tr>';
          for (let k = 0; k < r.length; k++) {
            html += '<td' + cellAttr(t.aligns[k]) + '>' + inline(r[k]) + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody>';
      }
      html += '</table>';
      segments.push(html);
      i = t.next;
    }
    flush();
    return segments.join('\n');
  }

  return { render, _tryTable: tryTable };
});
