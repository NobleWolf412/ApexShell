// App Builder Contract v1 — portable project package parsing and deterministic
// validation. Isolated library: no Electron imports, no runtime registration,
// no writes. Pattern-matched from extensions/personas/lib/contract.js — the
// path/frontmatter/hash primitives are the same shape by design; they are not
// shared because sharing them would mean rewiring the persona contract, which
// this slice does not touch.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const REQUIRED_FRONTMATTER = ['schema_version', 'name', 'display_name', 'description'];
// The six blueprint areas — the interview cards that feed the canonical. The
// PROJECT.md section headings are renameable (§ PROJECT.md template); coverage
// is validated from these areas in the blueprint, never from heading prose.
const BLUEPRINT_AREAS = ['idea', 'users', 'scope', 'platform', 'architecture', 'delivery'];
// Fields that describe a runtime, not a portable blueprint. No provider, model,
// credential, or machine path is allowed to enter the package (§ Portable
// project package).
const RUNTIME_ONLY_KEYS = new Set([
  'provider', 'model', 'credentials', 'credential', 'executable_path', 'cwd',
  'runtime_env', 'permission_mode', 'api_key', 'token',
]);
// An interview answer shorter than this reads as too thin to guide an Architect.
const THIN_AREA_CHARS = 120;

function finding(code, message, file) {
  return { code, message, ...(file ? { file } : {}) };
}

function isSafeProjectId(value) {
  return typeof value === 'string' && value.length <= 64 &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function resolveInside(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  if (!isInside(root, resolved)) throw new Error('path escapes the projects workspace');
  return resolved;
}

// realpath-based containment: catches a project folder that resolves outside the
// workspace through a symlink. Only safe to call once the path exists.
function realPathInside(root, candidate) {
  const realRoot = fs.realpathSync.native(root);
  const realCandidate = fs.realpathSync.native(candidate);
  return isInside(realRoot, realCandidate);
}

// Each project is one folder directly beneath the workspace (§ Portable project
// package): PROJECT.md is canonical, blueprint.json the approved snapshot,
// project-context.md the digest other tools read.
function projectPaths(workspaceRoot, projectId) {
  if (!isSafeProjectId(projectId)) throw new Error('invalid project id');
  const projectDir = resolveInside(workspaceRoot, projectId);
  return {
    workspaceRoot: path.resolve(workspaceRoot),
    projectDir,
    canonical: resolveInside(projectDir, 'PROJECT.md'),
    blueprint: resolveInside(projectDir, 'blueprint.json'),
    context: resolveInside(projectDir, 'project-context.md'),
    notesDir: resolveInside(projectDir, 'notes'),
  };
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '[]') return [];
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function parseFrontmatter(text) {
  const errors = [];
  if (typeof text !== 'string')
    return { attributes: {}, body: '', errors: ['canonical content is not text'] };

  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---')
    return { attributes: {}, body: normalized, errors: ['missing opening frontmatter delimiter'] };

  const close = lines.indexOf('---', 1);
  if (close < 0)
    return { attributes: {}, body: '', errors: ['missing closing frontmatter delimiter'] };

  const attributes = {};
  let listKey = null;
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const list = line.match(/^\s+-\s+(.+)$/);
    if (list) {
      if (!listKey || !Array.isArray(attributes[listKey]))
        errors.push(`line ${i + 1}: list item has no list field`);
      else attributes[listKey].push(parseScalar(list[1]));
      continue;
    }

    if (/^\s/.test(line)) {
      errors.push(`line ${i + 1}: nested frontmatter is not supported in v1`);
      continue;
    }

    const pair = line.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/);
    if (!pair) {
      errors.push(`line ${i + 1}: invalid frontmatter field`);
      listKey = null;
      continue;
    }
    const key = pair[1];
    if (Object.prototype.hasOwnProperty.call(attributes, key))
      errors.push(`line ${i + 1}: duplicate field ${key}`);
    const raw = pair[2] || '';
    attributes[key] = raw ? parseScalar(raw) : [];
    listKey = raw ? null : key;
  }

  return { attributes, body: lines.slice(close + 1).join('\n'), errors };
}

function hashCanonical(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function readJson(file, errors) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) {
    errors.push(finding('invalid-json', `Cannot parse ${path.basename(file)}: ${err.message}`, file));
    return null;
  }
}

function findRuntimeKeys(value, at = '$', found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, i) => findRuntimeKeys(item, `${at}[${i}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = `${at}.${key}`;
    if (RUNTIME_ONLY_KEYS.has(key)) found.push(next);
    findRuntimeKeys(child, next, found);
  }
  return found;
}

// Best-effort digest of an area's answer text, for the thin/coverage heuristics.
// Areas are free-form objects; we join their string leaves rather than assume a
// fixed sub-shape, so the rules survive an interview that renames its fields.
function areaText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const parts = [];
  const walk = (node) => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(value);
  return parts.join(' ').trim();
}

function isNonEmptyList(value) {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim());
}

function significantTokens(text) {
  return new Set(String(text || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

// Read sibling projects' digests for the overlap suggestion. Never throws — a
// missing or unreadable neighbour simply contributes no overlap signal.
function readSiblingContexts(workspaceRoot, selfId) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(workspaceRoot, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === selfId || !isSafeProjectId(entry.name)) continue;
    try {
      const digest = fs.readFileSync(path.join(workspaceRoot, entry.name, 'project-context.md'), 'utf8');
      out.push({ id: entry.name, text: digest });
    } catch { /* no digest, no overlap signal */ }
  }
  return out;
}

// Validate a project package. Deterministic and total: it never throws on bad
// input, it returns { valid, errors, warnings, suggestions, ... }. Errors block,
// warnings require review, suggestions advise (§ Validation).
//
// mode:
//   'native'  (default) — an on-disk package that must be complete.
//   'import'  — an audited existing folder; a missing blueprint only warns.
//   'create'  — a target for a NEW package: the folder must NOT already exist
//               (would-overwrite is an error) and nothing is read.
function validateProjectPackage(workspaceRoot, projectId, options = {}) {
  const mode = ['native', 'import', 'create'].includes(options.mode) ? options.mode : 'native';
  const errors = [];
  const warnings = [];
  const suggestions = [];

  if (!isSafeProjectId(projectId)) {
    errors.push(finding('unsafe-id', 'Project ID must be lowercase kebab-case and at most 64 characters.'));
    return { valid: false, errors, warnings, suggestions };
  }
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    errors.push(finding('missing-workspace', 'Projects workspace does not exist.', workspaceRoot));
    return { valid: false, errors, warnings, suggestions };
  }

  const paths = projectPaths(workspaceRoot, projectId);

  if (mode === 'create') {
    if (fs.existsSync(paths.projectDir))
      errors.push(finding('would-overwrite', 'A project with this ID already exists; create never overwrites.', paths.projectDir));
    return { valid: errors.length === 0, errors, warnings, suggestions, paths };
  }

  if (!fs.existsSync(paths.projectDir) || !fs.statSync(paths.projectDir).isDirectory()) {
    errors.push(finding('missing-project-folder', 'Project folder does not exist.', paths.projectDir));
    return { valid: false, errors, warnings, suggestions, paths };
  }
  if (!realPathInside(workspaceRoot, paths.projectDir)) {
    errors.push(finding('workspace-escape', 'Project folder resolves outside the configured workspace.', paths.projectDir));
    return { valid: false, errors, warnings, suggestions, paths };
  }

  let canonicalText = null;
  let frontmatter = {};
  if (!fs.existsSync(paths.canonical) || !fs.statSync(paths.canonical).isFile()) {
    errors.push(finding('missing-canonical', 'PROJECT.md is missing.', paths.canonical));
  } else if (!realPathInside(workspaceRoot, paths.canonical)) {
    errors.push(finding('workspace-escape', 'PROJECT.md resolves outside the configured workspace.', paths.canonical));
  } else {
    canonicalText = fs.readFileSync(paths.canonical, 'utf8');
    const parsed = parseFrontmatter(canonicalText);
    frontmatter = parsed.attributes;
    parsed.errors.forEach((message) => errors.push(finding('frontmatter', message, paths.canonical)));
    for (const key of REQUIRED_FRONTMATTER) {
      if (frontmatter[key] === undefined || frontmatter[key] === '') {
        const item = finding('missing-frontmatter',
          mode === 'import'
            ? `Imported project needs mapping for portable field: ${key}`
            : `Required frontmatter field is missing: ${key}`,
          paths.canonical);
        (mode === 'import' ? warnings : errors).push(item);
      }
    }
    if (frontmatter.schema_version !== undefined &&
        frontmatter.schema_version !== SCHEMA_VERSION)
      errors.push(finding('schema-version', `PROJECT.md schema_version must be ${SCHEMA_VERSION}.`, paths.canonical));
    if (frontmatter.name !== undefined && frontmatter.name !== projectId)
      errors.push(finding('name-mismatch', 'Frontmatter name must match the project folder.', paths.canonical));
  }

  let blueprint = null;
  if (!fs.existsSync(paths.blueprint)) {
    (mode === 'import' ? warnings : errors).push(finding('missing-blueprint',
      mode === 'import' ? 'Imported project has no builder blueprint yet.' : 'blueprint.json is missing.',
      paths.blueprint));
  } else if (!realPathInside(workspaceRoot, paths.blueprint)) {
    errors.push(finding('workspace-escape', 'Blueprint resolves outside the configured workspace.', paths.blueprint));
  } else {
    blueprint = readJson(paths.blueprint, errors);
    if (blueprint) {
      if (blueprint.schema_version !== SCHEMA_VERSION)
        errors.push(finding('schema-version', `Blueprint schema_version must be ${SCHEMA_VERSION}.`, paths.blueprint));
      const runtimeKeys = findRuntimeKeys(blueprint);
      if (runtimeKeys.length)
        errors.push(finding('runtime-data', `Runtime-only fields are not portable blueprint data: ${runtimeKeys.join(', ')}`, paths.blueprint));

      // Area coverage — validated from the blueprint mapping, not the headings.
      for (const area of BLUEPRINT_AREAS) {
        const value = blueprint[area];
        if (value === undefined || value === null ||
            (typeof value !== 'object' && typeof value !== 'string'))
          errors.push(finding('missing-blueprint-area', `Blueprint area is missing or invalid: ${area}`, paths.blueprint));
        else if (!areaText(value))
          warnings.push(finding('incomplete-area', `Interview area is incomplete: ${area}`, paths.blueprint));
      }

      // Hash drift — the blueprint records a hash of the PROJECT.md it produced;
      // an external edit surfaces as review, never a silent regeneration.
      if (!blueprint.canonical_hash)
        warnings.push(finding('missing-canonical-hash', 'Blueprint has no approved canonical hash.', paths.blueprint));
      else if (canonicalText && blueprint.canonical_hash !== hashCanonical(canonicalText))
        warnings.push(finding('canonical-drift', 'PROJECT.md changed after the blueprint was approved.', paths.canonical));

      // The fluff-logic tripwires (§ Validation warnings).
      const scope = blueprint.scope;
      if (scope && typeof scope === 'object' && !isNonEmptyList(scope.non_goals))
        warnings.push(finding('scope-no-non-goals', 'Scope card names no non-goals.', paths.blueprint));
      const delivery = blueprint.delivery;
      if (delivery && typeof delivery === 'object' &&
          !isNonEmptyList(delivery.verification) &&
          !(typeof delivery.verification === 'string' && delivery.verification.trim()))
        warnings.push(finding('delivery-no-verification', 'Delivery names no verification expectation.', paths.blueprint));

      // Delegate route ↔ preset. Kept as a rule shape only: no delegate routing
      // exists yet (that is slice 8), so this fires only when a caller supplies
      // the live preset list AND the blueprint already carries a route.
      const route = delivery && typeof delivery === 'object' ? delivery.delegate_route : undefined;
      if (route && Array.isArray(options.presets) && !options.presets.includes(route))
        warnings.push(finding('missing-preset', `Delegate route references a preset that does not exist: ${route}`, paths.blueprint));

      // Suggestions — advisory only; heuristics never rewrite the blueprint.
      if (areaText(blueprint.idea).length < THIN_AREA_CHARS)
        suggestions.push(finding('thin-vision', 'Vision is too thin to guide an Architect.', paths.blueprint));
      if (areaText(blueprint.scope).length < THIN_AREA_CHARS)
        suggestions.push(finding('thin-mvp', 'MVP cut is too thin to guide an Architect.', paths.blueprint));

      // Orphan architecture component — named in architecture, touched by no
      // milestone or delivery note.
      const architecture = blueprint.architecture;
      if (architecture && typeof architecture === 'object' && Array.isArray(architecture.components)) {
        const deliveryText = areaText(delivery).toLowerCase();
        for (const component of architecture.components) {
          if (typeof component === 'string' && component.trim() &&
              !deliveryText.includes(component.trim().toLowerCase()))
            suggestions.push(finding('architecture-orphan', `Architecture names a component no milestone touches: ${component}`, paths.blueprint));
        }
      }

      // Overlap with an existing project's digest.
      const contexts = Array.isArray(options.existingContexts)
        ? options.existingContexts.map((text, i) => ({ id: `context-${i}`, text }))
        : readSiblingContexts(workspaceRoot, projectId);
      const selfTokens = significantTokens(
        `${frontmatter.display_name || ''} ${frontmatter.description || ''} ${areaText(blueprint.idea)}`);
      for (const sibling of contexts) {
        const shared = [...significantTokens(sibling.text)].filter((token) => selfTokens.has(token));
        if (shared.length >= 3)
          suggestions.push(finding('project-overlap', `Overlaps an existing project (${sibling.id}): ${shared.slice(0, 5).join(', ')}`, paths.blueprint));
      }
    }
  }

  // The digest other tools read is optional here, but if present it must stay
  // inside the workspace.
  if (fs.existsSync(paths.context) && !realPathInside(workspaceRoot, paths.context))
    errors.push(finding('workspace-escape', 'project-context.md resolves outside the configured workspace.', paths.context));

  return { valid: errors.length === 0, errors, warnings, suggestions, paths, frontmatter, blueprint };
}

module.exports = {
  BLUEPRINT_AREAS,
  REQUIRED_FRONTMATTER,
  SCHEMA_VERSION,
  THIN_AREA_CHARS,
  areaText,
  findRuntimeKeys,
  hashCanonical,
  isInside,
  isSafeProjectId,
  parseFrontmatter,
  projectPaths,
  resolveInside,
  validateProjectPackage,
};
