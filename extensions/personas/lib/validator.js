// Persona Builder — deterministic in-memory preview validation and advisory
// suggestions. No writes and no automatic identity repairs.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  ACTION_CATEGORIES,
  ACTION_DECISIONS,
  ACTION_POSTURES,
  BLUEPRINT_AREAS,
  REQUIRED_FRONTMATTER,
  findRuntimeKeys,
  hashCanonical,
  isSafePersonaId,
  packagePaths,
  parseFrontmatter,
} = require('./contract');
const { KEYS } = require('./interview');

function item(severity, code, message, repair) {
  return { severity, code, message, ...(repair ? { repair } : {}) };
}

function validatePreview(workspace, draft, foundationText) {
  const findings = [];
  const preview = draft && draft.preview;
  if (!preview) {
    findings.push(item('error', 'missing-preview', 'Generate the blueprint and canonical preview first.'));
    return summarize(findings);
  }
  if (!isSafePersonaId(preview.personaId))
    findings.push(item('error', 'unsafe-id', 'Persona ID must be lowercase kebab-case and at most 64 characters.'));

  const parsed = parseFrontmatter(preview.canonical);
  for (const message of parsed.errors)
    findings.push(item('error', 'frontmatter', message));
  for (const key of REQUIRED_FRONTMATTER) {
    if (parsed.attributes[key] === undefined || parsed.attributes[key] === '')
      findings.push(item('error', 'missing-frontmatter', 'Required frontmatter field is missing: ' + key));
  }
  if (parsed.attributes.schema_version !== 1)
    findings.push(item('error', 'schema-version', 'Canonical schema_version must be 1.'));
  if (parsed.attributes.name !== preview.personaId)
    findings.push(item('error', 'name-mismatch', 'Canonical name must match the preview persona ID.'));
  if (!Array.isArray(parsed.attributes.modules))
    findings.push(item('error', 'frontmatter-type', 'Canonical modules must be a list.'));

  const blueprint = preview.blueprint;
  if (!blueprint || blueprint.schema_version !== 1)
    findings.push(item('error', 'schema-version', 'Blueprint schema_version must be 1.'));
  if (blueprint) {
    for (const area of BLUEPRINT_AREAS) {
      if (!blueprint[area] || typeof blueprint[area] !== 'object' || Array.isArray(blueprint[area]))
        findings.push(item('error', 'missing-blueprint-area', 'Blueprint area is missing: ' + area));
    }
    const posture = blueprint.action_posture;
    if (!posture || !ACTION_POSTURES.has(posture.mode))
      findings.push(item('error', 'action-posture', 'Choose a recognized action posture.'));
    for (const category of ACTION_CATEGORIES) {
      if (!posture || !posture.actions || !ACTION_DECISIONS.has(posture.actions[category]))
        findings.push(item('error', 'action-decision', 'Choose allowed, ask, or blocked for ' + category + '.'));
    }
    const runtime = findRuntimeKeys(blueprint);
    if (runtime.length)
      findings.push(item('error', 'runtime-data', 'Blueprint contains runtime-only fields: ' + runtime.join(', ')));
  }

  const modules = Array.isArray(parsed.attributes.modules) ? parsed.attributes.modules : [];
  const hasModule = modules.includes('collaboration');
  const hasContract = Boolean(preview.collaboration);
  if (hasModule !== hasContract)
    findings.push(item('error', 'collaboration-mismatch', 'Canonical collaboration module and collaboration contract do not match.'));
  if (preview.collaboration) {
    const runtime = findRuntimeKeys(preview.collaboration);
    if (runtime.length)
      findings.push(item('error', 'runtime-data', 'Collaboration contains runtime-only fields: ' + runtime.join(', ')));
    if (preview.collaboration.default_access === 'read-only' && blueprint && blueprint.action_posture) {
      const writes = ['edit_files', 'send_external', 'change_system', 'delete_data']
        .filter((category) => blueprint.action_posture.actions[category] === 'allowed');
      if (writes.length)
        findings.push(item('warning', 'access-conflict',
          'Read-only collaboration conflicts with routinely allowed write actions: ' + writes.join(', ')));
    }
  }

  const actualHash = hashCanonical(preview.canonical);
  if (actualHash !== preview.generatedCanonicalHash || preview.canonicalDrift)
    findings.push(item('warning', 'canonical-drift',
      'Canonical changed after the blueprint baseline. Review the edit before accepting its hash.',
      'accept-canonical'));

  if (workspace && isSafePersonaId(preview.personaId)) {
    try {
      const paths = packagePaths(workspace, preview.personaId);
      if (fs.existsSync(paths.personaDir))
        findings.push(item('error', 'persona-collision', 'A persona folder with this ID already exists.'));
    } catch (err) {
      findings.push(item('error', 'workspace-path', err.message));
    }
  }

  for (const key of KEYS) {
    const answer = draft.answers && draft.answers[key];
    if (!answer || !answer.trim())
      findings.push(item('warning', 'incomplete-area', 'Interview area is incomplete: ' + key));
    else if (answer.trim().length < 120)
      findings.push(item('suggestion', 'thin-area', 'Consider adding more operational detail to: ' + key));
  }

  const foundationRules = String(foundationText || '').split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, '').trim().toLowerCase())
    .filter((line) => line.length >= 24);
  for (const key of KEYS) {
    const answer = String((draft.answers || {})[key] || '').toLowerCase();
    if (foundationRules.some((rule) => answer.includes(rule))) {
      findings.push(item('suggestion', 'foundation-duplication',
        'This area appears to repeat a shared foundation rule: ' + key));
    }
  }

  return summarize(findings);
}

function summarize(findings) {
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  const suggestions = findings.filter((finding) => finding.severity === 'suggestion');
  return { valid: errors.length === 0, errors, warnings, suggestions, findings };
}

module.exports = { validatePreview, summarize };

