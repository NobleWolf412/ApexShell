// Wiki Pipeline — compile prompt + output parser (the model-facing half).
//
// The compile seat has NO tools (text in, text out) — safe by construction: the
// model never touches the disk. It reasons over one raw entry + the current
// wiki, and EMITS the page(s) to write in a strict block format that the store
// (main.js) parses and writes. All file I/O stays in code; all judgement in the
// model. That split is also the cost story — see design/wiki-pipeline-cost.md.
'use strict';

const FILE_OPEN = '===APEX-WIKI-FILE:';
const FILE_END = '===APEX-WIKI-END===';

// Pick related pages by naive keyword overlap so the model can update/link them
// without us shipping the WHOLE wiki into context every compile (cost lever #3).
function relatedPages(store, entryText, cap = 3, charBudget = 24000) {
  const words = new Set(String(entryText || '').toLowerCase().match(/[a-z]{4,}/g) || []);
  const scored = [];
  for (const name of store.listPages()) {
    let text;
    try { text = store.readPage(name); } catch { continue; }
    const pw = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    let score = 0;
    for (const w of pw) if (words.has(w)) score++;
    scored.push({ name, text, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  let used = 0;
  for (const p of scored) {
    if (p.score === 0 || out.length >= cap) break;
    if (used + p.text.length > charBudget) continue;
    used += p.text.length;
    out.push(p);
  }
  return out;
}

function buildPrompt({ store, entryStem, entryText, personaVoice }) {
  const pages = store.listPages();
  const indexLines = pages.map((name) => {
    let title = name;
    try { title = (store.readPage(name).split('\n').find((l) => l.trim()) || name).replace(/^#+\s*/, ''); }
    catch { /* keep name */ }
    return `- ${name} — ${title.slice(0, 90)}`;
  });
  const related = relatedPages(store, entryText);

  const voiceLine = personaVoice
    ? `Write in the voice and judgement of the persona "${personaVoice}" — that is who compiles this wiki.`
    : 'Write as a careful, neutral technical librarian.';

  return [
    '[wiki-compile] You are compiling ONE raw entry into a durable, interlinked wiki.',
    voiceLine,
    '',
    'RULES:',
    '- Fold the entry into the wiki: create a new page for its topic, and/or update',
    '  existing pages it belongs in. Prefer updating an existing page over making a',
    '  near-duplicate. Cross-link pages by their filename.',
    `- Every page you write MUST cite this entry in its frontmatter: sources: [${entryStem}].`,
    '- Be faithful to the entry; do not invent facts. Summarize durable knowledge,',
    '  not the blow-by-blow. Keep only what a future reader would want.',
    '- Output ONLY file blocks, nothing else. For EACH page to create or replace,',
    '  emit its ENTIRE new content (you are rewriting the whole file) between markers:',
    '',
    `${FILE_OPEN} <page-filename>.md===`,
    '---',
    'title: <human title>',
    `sources: [${entryStem}]`,
    '---',
    '<full markdown content>',
    FILE_END,
    '',
    '- If the entry has nothing wiki-worthy, emit exactly: ===APEX-WIKI-SKIP===',
    '',
    '=== CURRENT WIKI PAGES (filenames + titles) ===',
    indexLines.length ? indexLines.join('\n') : '(none yet — this may be the first page)',
    '',
    related.length ? '=== RELATED EXISTING PAGES (full text — update these in place if the entry belongs) ===' : '',
    ...related.map((p) => `${FILE_OPEN} ${p.name}=== (existing)\n${p.text}\n${FILE_END}`),
    '',
    '=== RAW ENTRY TO COMPILE ===',
    entryText || '(empty)',
    '',
    'Now emit the file block(s).',
  ].filter((l) => l !== '').join('\n');
}

// Parse the model's reply into [{ path, content }]. Tolerant of stray prose
// around the blocks (we only trust what's between the markers).
function parseOutput(text) {
  const s = String(text || '');
  if (/===APEX-WIKI-SKIP===/.test(s)) return { skip: true, files: [] };
  const files = [];
  const re = new RegExp(FILE_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\s*([^\\n=]+?)\\s*===[^\\n]*\\n([\\s\\S]*?)\\n?' +
    FILE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  let m;
  while ((m = re.exec(s)) !== null) {
    const path = m[1].trim();
    const content = m[2];
    if (path) files.push({ path, content });
  }
  return { skip: false, files };
}

module.exports = { buildPrompt, parseOutput, relatedPages, FILE_OPEN, FILE_END };
