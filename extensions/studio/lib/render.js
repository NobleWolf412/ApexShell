// App Builder — deterministic canonical (PROJECT.md) rendering primitives.
// Pattern-matched from extensions/personas/lib/render.js: the same section-marker
// discipline (heading text is free, the marker carries the section identity, so
// headings are renameable without breaking targeted regeneration or coverage).
'use strict';

const { hashCanonical, isSafeProjectId } = require('./contract');

// The six semantic sections of the canonical template (§ PROJECT.md template).
// `key` is the stable section identity carried in the marker; `heading` is the
// default prose heading a user may rename.
const SECTIONS = [
  { key: 'vision', heading: 'Vision and Users' },
  { key: 'scope', heading: 'Scope and MVP Cut' },
  { key: 'platform', heading: 'Platform and Stack' },
  { key: 'architecture', heading: 'Architecture Sketch' },
  { key: 'delivery', heading: 'Milestones and Delivery' },
  { key: 'risks', heading: 'Risks and Open Questions' },
];
const SECTION_KEYS = SECTIONS.map((section) => section.key);
const SECTION_HEADINGS = Object.fromEntries(SECTIONS.map((s) => [s.key, s.heading]));

// Mirror of personas/lib/render.js normalizePersonaId: fold a display name down
// to a safe project ID. Guaranteed to satisfy isSafeProjectId.
function normalizeProjectId(displayName) {
  const ascii = String(displayName || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let id = ascii || 'project';
  if (!/^[a-z]/.test(id)) id = 'project-' + id;
  id = id.slice(0, 64).replace(/-+$/g, '');
  return id || 'project';
}

function sectionBlock(key, body) {
  const heading = SECTION_HEADINGS[key];
  const text = String(body || '').trim();
  return [
    `<!-- app-builder:${key}:start -->`,
    `## ${heading}`,
    '',
    text || `<!-- ${key} not yet drafted -->`,
    `<!-- app-builder:${key}:end -->`,
  ].join('\n');
}

// Render the canonical PROJECT.md from an approved project shape:
//   { projectId, displayName, description, sections: { <key>: markdown } }
// Sections are keyed by SECTION_KEYS; a missing section renders as an empty
// placeholder rather than being dropped, so coverage stays visible.
function renderCanonical(project) {
  const projectId = project && project.projectId;
  if (!isSafeProjectId(projectId)) throw new Error('Project ID must be lowercase kebab-case and at most 64 characters.');
  const displayName = String((project && project.displayName) || '').trim();
  if (!displayName) throw new Error('Project display name cannot be empty.');
  const description = String((project && project.description) || '').trim();
  const sections = (project && project.sections) || {};

  const lines = [
    '---',
    'schema_version: 1',
    'name: ' + projectId,
    'display_name: ' + JSON.stringify(displayName),
    'description: ' + JSON.stringify(description),
    '---',
    '',
    '# ' + displayName,
    '',
  ];
  for (const key of SECTION_KEYS) {
    lines.push(sectionBlock(key, sections[key]), '');
  }
  return lines.join('\n').replace(/\n+$/g, '\n');
}

module.exports = {
  SECTIONS,
  SECTION_KEYS,
  SECTION_HEADINGS,
  normalizeProjectId,
  sectionBlock,
  renderCanonical,
};
