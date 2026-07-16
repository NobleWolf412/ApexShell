// Persona Builder — read-only legacy canonical audit and user-approved semantic
// mapping. Source folders are never copied or rewritten here.
'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./contract');
const { KEYS } = require('./interview');

const MAX_CANONICAL_BYTES = 256 * 1024;

function suggestedKey(heading) {
  const text = heading.toLowerCase();
  const patterns = [
    ['identity', /identity|background|who\s+i\s+am|character/],
    ['mission', /role|mission|purpose|responsibilit|scope/],
    ['communication', /communication|voice|style|tone/],
    ['boundaries', /boundar|limit|approval|never|guardrail/],
    ['working_method', /working|method|process|workflow|approach|how\s+i\s+work/],
    ['action_posture', /action|tool|autonom|permission|execution/],
  ];
  const match = patterns.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : null;
}

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
    sections.push({ heading: 'Canonical body', lines: [body.trim()] });
  return sections.map((section, index) => ({
    index,
    heading: section.heading,
    content: section.lines.join('\n').trim(),
    suggestedKey: suggestedKey(section.heading),
  }));
}

function auditImportFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    throw new Error('Import folder must be an absolute path.');
  const root = path.resolve(folder);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error('Import source must be a regular directory, not a link.');
  const markdown = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name);
  const preferred = path.basename(root) + '.md';
  const preferredMatch = markdown.find((name) => name.toLowerCase() === preferred.toLowerCase());
  const canonicalName = preferredMatch
    ? preferredMatch
    : markdown.length === 1 ? markdown[0] : null;
  if (!canonicalName)
    throw new Error(markdown.length ? 'Choose a folder with one clear canonical Markdown file.'
      : 'Import folder has no canonical Markdown file.');
  const canonicalFile = path.join(root, canonicalName);
  const canonicalStat = fs.lstatSync(canonicalFile);
  if (canonicalStat.isSymbolicLink() || !canonicalStat.isFile())
    throw new Error('Import canonical must be a regular file, not a link.');
  if (canonicalStat.size > MAX_CANONICAL_BYTES)
    throw new Error('Import canonical exceeds the 256 KB limit.');
  const canonical = fs.readFileSync(canonicalFile, 'utf8');
  const parsed = parseFrontmatter(canonical);
  const errors = parsed.errors.map((message) => ({ code: 'frontmatter', message }));
  if (parsed.attributes.schema_version !== undefined && parsed.attributes.schema_version !== 1)
    errors.push({ code: 'schema-version', message: 'Explicit imported schema_version must be 1.' });
  const warnings = [];
  if (!parsed.attributes.name) warnings.push({ code: 'missing-name', message: 'Portable name needs mapping.' });
  if (!parsed.attributes.display_name) warnings.push({ code: 'missing-display-name', message: 'Display name needs mapping.' });
  if (!parsed.attributes.description) warnings.push({ code: 'missing-description', message: 'One-sentence use case needs mapping.' });
  const sections = splitSections(parsed.body);
  if (!sections.length) errors.push({ code: 'empty-canonical', message: 'Canonical has no Markdown body to map.' });
  return {
    sourceFolder: root,
    canonicalFile,
    canonical,
    frontmatter: parsed.attributes,
    displayName: String(parsed.attributes.display_name || parsed.attributes.name || path.basename(root))
      .replace(/[\r\n]+/g, ' ').trim().slice(0, 80),
    description: String(parsed.attributes.description || 'Imported persona for review.')
      .replace(/[\r\n]+/g, ' ').trim().slice(0, 240),
    sections,
    errors,
    warnings,
  };
}

function answersFromMapping(audit, mapping) {
  if (!audit || !Array.isArray(audit.sections)) throw new Error('Import audit is unavailable.');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new Error('Import mapping is invalid.');
  const grouped = Object.fromEntries(KEYS.map((key) => [key, []]));
  for (const section of audit.sections) {
    const key = mapping[String(section.index)];
    if (key === null || key === '' || key === undefined) continue;
    if (!KEYS.includes(key)) throw new Error('Unknown import mapping target: ' + key);
    grouped[key].push(`## ${section.heading}\n\n${section.content}`.trim());
  }
  return Object.fromEntries(KEYS.map((key) => {
    const answer = grouped[key].join('\n\n');
    if (answer.length > 12000)
      throw new Error('Imported mapping exceeds the 12,000 character limit for: ' + key);
    return [key, answer];
  }));
}

module.exports = { MAX_CANONICAL_BYTES, suggestedKey, splitSections, auditImportFolder, answersFromMapping };

