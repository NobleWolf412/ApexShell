// App Builder — import/audit mode (slice 9). Read-only legacy-project audit and
// user-approved mapping onto the six blueprint areas. Mirrors
// extensions/personas/lib/importer.js's discipline exactly: change nothing in
// the source, validate structure, propose a mapping the user reviews before
// anything is built, and never invent an answer for a section nobody mapped.
// The source folder (or bare PROJECT.md's folder) is never copied, written, or
// otherwise mutated by any function in this module.
'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./contract');
const { KEYS } = require('./interview');

// Mirrors personas/lib/importer.js's MAX_CANONICAL_BYTES — a generous ceiling
// for a hand-written project doc, not a hard technical limit.
const MAX_SOURCE_BYTES = 256 * 1024;
// Mirrors drafts.js's own per-answer limit, so a mapped section can never
// produce an answer the draft store would refuse a moment later.
const MAX_MAPPED_ANSWER = 12000;

// Heading text -> the blueprint area it most likely describes. Checked in
// order, first match wins, so a heading that could read as either (e.g. a
// combined "Vision and Users" heading matches "idea" first) still yields a
// single, reviewable suggestion — the user can always retarget the row.
// "Risks and Open Questions" deliberately matches nothing: risks has no
// interview area in v1 (§ Blueprint Review — the vision/users collapse is the
// only card->section partition that avoids splitting an answer), so that
// content is surfaced unmapped rather than folded into a card it doesn't
// belong to.
function suggestedKey(heading) {
  const text = heading.toLowerCase();
  const patterns = [
    ['idea', /idea|pitch|elevator|why\s+now|vision/],
    ['users', /user|audience|job|customer|persona/],
    ['scope', /scope|mvp|non.?goal/],
    ['platform', /platform|stack|target|constraint/],
    ['architecture', /architecture|component|integrat|owns?\s+data|data\s+owner/],
    ['delivery', /deliver|milestone|verif|lift.?off|roadmap/],
  ];
  const match = patterns.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : null;
}

// Split a Markdown body into ##-level sections, same shape as personas'
// splitSections: any preamble before the first heading becomes its own
// section rather than being dropped, and a headingless body still yields one
// section so it stays reviewable instead of silently disappearing.
function splitSections(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let current = null;
  let preamble = [];
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (!current && preamble.length) {
        preamble = preamble.filter((entry) => !/^#\s+/.test(entry));
        if (preamble.join('\n').trim())
          sections.push({ heading: 'Preamble', lines: preamble });
      }
      if (current) sections.push(current);
      current = { heading: heading[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  if (!sections.length && body.trim())
    sections.push({ heading: 'Project notes', lines: [body.trim()] });
  return sections.map((section, index) => ({
    index,
    heading: section.heading,
    content: section.lines.join('\n').trim(),
    suggestedKey: suggestedKey(section.heading),
  }));
}

// A path segment of '..' is refused before it is ever resolved — defense in
// depth against a crafted bus message, not a restriction on WHERE a legitimate
// import may live (the entire point of import is bringing in a project from
// outside the projects workspace; see design/app-builder-v1.md § Import).
function hasTraversalSegment(raw) {
  return raw.split(/[\\/]+/).some((part) => part === '..');
}

// Read-only inspection of an existing project folder (or the folder holding a
// bare PROJECT.md). Never writes, never follows a symlink, never throws past
// its own Error — every failure is a plain-language message a caller can show
// directly. Mirrors auditImportFolder in extensions/personas/lib/importer.js
// function-for-function; only the target shape (six blueprint areas instead
// of the persona card keys) differs.
function auditImportFolder(folder) {
  if (typeof folder !== 'string' || !folder)
    throw new Error('Choose a folder to import first.');
  if (!path.isAbsolute(folder))
    throw new Error('Import folder must be an absolute path.');
  if (hasTraversalSegment(folder))
    throw new Error('Import folder path cannot contain ".." segments.');
  let stat;
  try { stat = fs.lstatSync(folder); }
  catch { throw new Error('That folder does not exist or is not reachable.'); }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error('Import source must be a regular directory, not a link.');
  const root = path.resolve(folder);
  const markdown = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name);
  const preferred = 'PROJECT.md';
  const byNamePreferred = markdown.find((name) => name.toLowerCase() === preferred.toLowerCase());
  const byFolderName = markdown.find((name) => name.toLowerCase() === (path.basename(root) + '.md').toLowerCase());
  const canonicalName = byNamePreferred || byFolderName ||
    (markdown.length === 1 ? markdown[0] : null);
  if (!canonicalName) {
    throw new Error(markdown.length
      ? 'This folder has more than one Markdown file and none is named PROJECT.md — pick the folder that holds just the one project doc.'
      : 'This folder has no Markdown file to import — pick a folder with a PROJECT.md (or a single .md file) in it.');
  }
  const canonicalFile = path.join(root, canonicalName);
  const canonicalStat = fs.lstatSync(canonicalFile);
  if (canonicalStat.isSymbolicLink() || !canonicalStat.isFile())
    throw new Error('The project doc must be a regular file, not a link.');
  if (canonicalStat.size > MAX_SOURCE_BYTES)
    throw new Error('The project doc is larger than the 256 KB import limit.');
  const canonical = fs.readFileSync(canonicalFile, 'utf8');
  const parsed = parseFrontmatter(canonical);
  const errors = parsed.errors.map((message) => ({ code: 'frontmatter', message }));
  if (parsed.attributes.schema_version !== undefined && parsed.attributes.schema_version !== 1)
    errors.push({ code: 'schema-version', message: 'This project doc declares a schema_version the builder does not understand (only 1 is supported).' });
  const warnings = [];
  if (!parsed.attributes.name) warnings.push({ code: 'missing-name', message: 'No portable name found in the frontmatter yet — one will be suggested from the folder.' });
  if (!parsed.attributes.display_name) warnings.push({ code: 'missing-display-name', message: 'No display name found in the frontmatter yet — one will be suggested from the folder.' });
  if (!parsed.attributes.description) warnings.push({ code: 'missing-description', message: 'No one-sentence pitch found in the frontmatter yet — add one during review.' });
  const sections = splitSections(parsed.body);
  if (!sections.length) errors.push({ code: 'empty-source', message: 'This project doc has no Markdown content to map.' });
  return {
    sourceFolder: root,
    canonicalFile,
    canonical,
    frontmatter: parsed.attributes,
    displayName: String(parsed.attributes.display_name || parsed.attributes.name || path.basename(root))
      .replace(/[\r\n]+/g, ' ').trim().slice(0, 80),
    description: String(parsed.attributes.description || '')
      .replace(/[\r\n]+/g, ' ').trim().slice(0, 240),
    sections,
    errors,
    warnings,
  };
}

// The gaps a mapping leaves behind — the blueprint areas no section currently
// targets. Cheap and pure, so it can be recomputed after every single-row
// mapping edit without re-reading anything (the targeted-revision path).
function mappingGaps(mapping) {
  const mapped = new Set(Object.values(mapping || {}).filter((key) => KEYS.includes(key)));
  return KEYS.filter((key) => !mapped.has(key));
}

// Turn an approved mapping into the six area answers. Only sections the user
// explicitly targeted contribute text — an area nobody mapped is an empty
// string, never a guess (§ HARD SEMANTIC RULES: never invent). Byte-for-byte
// the shape of personas/lib/importer.js's answersFromMapping, retargeted at
// the studio interview KEYS.
function answersFromMapping(audit, mapping) {
  if (!audit || !Array.isArray(audit.sections)) throw new Error('Run the import audit first.');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new Error('The import mapping is invalid.');
  const grouped = Object.fromEntries(KEYS.map((key) => [key, []]));
  for (const section of audit.sections) {
    const key = mapping[String(section.index)];
    if (key === null || key === '' || key === undefined) continue;
    if (!KEYS.includes(key)) throw new Error('That import mapping points at an area the builder does not have: ' + key);
    grouped[key].push(`## ${section.heading}\n\n${section.content}`.trim());
  }
  return Object.fromEntries(KEYS.map((key) => {
    const answer = grouped[key].join('\n\n');
    if (answer.length > MAX_MAPPED_ANSWER)
      throw new Error(`The sections mapped to "${key}" add up to more than ${MAX_MAPPED_ANSWER} characters — trim one before importing.`);
    return [key, answer];
  }));
}

module.exports = {
  MAX_SOURCE_BYTES,
  MAX_MAPPED_ANSWER,
  suggestedKey,
  splitSections,
  auditImportFolder,
  mappingGaps,
  answersFromMapping,
};
