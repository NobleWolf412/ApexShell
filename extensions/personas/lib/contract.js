// Persona Contract v1 — portable package parsing and deterministic validation.
// Isolated library: no Electron imports, no runtime registration, no writes.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const REQUIRED_FRONTMATTER = ['schema_version', 'name', 'display_name', 'description'];
const BLUEPRINT_AREAS = [
  'identity', 'mission', 'communication', 'boundaries', 'working_method', 'action_posture',
];
const ACTION_POSTURES = new Set([
  'advisor', 'assisted-operator', 'operator', 'automated-worker',
]);
const ACTION_DECISIONS = new Set(['allowed', 'ask', 'blocked']);
const ACTION_CATEGORIES = new Set([
  'read_files', 'edit_files', 'run_commands', 'search_web', 'use_connectors',
  'send_external', 'change_system', 'delete_data',
]);
const WRITE_ACTIONS = new Set([
  'edit_files', 'send_external', 'change_system', 'delete_data',
]);
const ACCESS_MODES = new Set(['read-only', 'read-write']);
const RUNTIME_ONLY_KEYS = new Set([
  'provider', 'model', 'credentials', 'credential', 'executable_path', 'cwd',
  'runtime_env', 'permission_mode', 'api_key', 'token',
]);

function finding(code, message, file) {
  return { code, message, ...(file ? { file } : {}) };
}

function isSafePersonaId(value) {
  return typeof value === 'string' && value.length <= 64 &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function resolveInside(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  if (!isInside(root, resolved)) throw new Error('path escapes the persona workspace');
  return resolved;
}

function realPathInside(root, candidate) {
  const realRoot = fs.realpathSync.native(root);
  const realCandidate = fs.realpathSync.native(candidate);
  return isInside(realRoot, realCandidate);
}

function packagePaths(workspaceRoot, personaId) {
  if (!isSafePersonaId(personaId)) throw new Error('invalid persona id');
  const personasDir = resolveInside(workspaceRoot, 'personas');
  const personaDir = resolveInside(personasDir, personaId);
  return {
    workspaceRoot: path.resolve(workspaceRoot),
    personasDir,
    personaDir,
    canonical: resolveInside(personaDir, personaId + '.md'),
    blueprint: resolveInside(personaDir, 'blueprint.json'),
    collaboration: resolveInside(personaDir, 'collaboration.json'),
    memoryIndex: resolveInside(personaDir, 'memory', 'MEMORY.md'),
    scratchpad: resolveInside(personaDir, 'scratchpad.md'),
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

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
}

function validatePersonaPackage(workspaceRoot, personaId, options = {}) {
  const mode = options.mode === 'import' ? 'import' : 'native';
  const errors = [];
  const warnings = [];
  const suggestions = [];
  const addMissingBlueprint = (item) => (mode === 'import' ? warnings : errors).push(item);

  if (!isSafePersonaId(personaId)) {
    errors.push(finding('unsafe-id', 'Persona ID must be lowercase kebab-case and at most 64 characters.'));
    return { valid: false, errors, warnings, suggestions };
  }
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    errors.push(finding('missing-workspace', 'Persona workspace does not exist.', workspaceRoot));
    return { valid: false, errors, warnings, suggestions };
  }

  const paths = packagePaths(workspaceRoot, personaId);
  if (!fs.existsSync(paths.personaDir) || !fs.statSync(paths.personaDir).isDirectory()) {
    errors.push(finding('missing-persona-folder', 'Persona folder does not exist.', paths.personaDir));
    return { valid: false, errors, warnings, suggestions, paths };
  }
  if (!realPathInside(workspaceRoot, paths.personaDir)) {
    errors.push(finding('workspace-escape', 'Persona folder resolves outside the configured workspace.', paths.personaDir));
    return { valid: false, errors, warnings, suggestions, paths };
  }

  let canonicalText = null;
  let frontmatter = {};
  if (!fs.existsSync(paths.canonical) || !fs.statSync(paths.canonical).isFile()) {
    errors.push(finding('missing-canonical', 'Canonical Markdown file is missing.', paths.canonical));
  } else if (!realPathInside(workspaceRoot, paths.canonical)) {
    errors.push(finding('workspace-escape', 'Canonical resolves outside the configured workspace.', paths.canonical));
  } else {
    canonicalText = fs.readFileSync(paths.canonical, 'utf8');
    const parsed = parseFrontmatter(canonicalText);
    frontmatter = parsed.attributes;
    parsed.errors.forEach((message) => errors.push(finding('frontmatter', message, paths.canonical)));
    for (const key of REQUIRED_FRONTMATTER) {
      if (frontmatter[key] === undefined || frontmatter[key] === '') {
        const item = finding('missing-frontmatter',
          mode === 'import'
            ? `Imported persona needs mapping for portable field: ${key}`
            : `Required frontmatter field is missing: ${key}`,
          paths.canonical);
        (mode === 'import' ? warnings : errors).push(item);
      }
    }
    if (frontmatter.schema_version !== undefined &&
        frontmatter.schema_version !== SCHEMA_VERSION)
      errors.push(finding('schema-version', `Canonical schema_version must be ${SCHEMA_VERSION}.`, paths.canonical));
    if (frontmatter.name !== undefined && frontmatter.name !== personaId)
      errors.push(finding('name-mismatch', 'Frontmatter name must match the persona folder and filename.', paths.canonical));
    for (const key of ['aliases', 'modules']) {
      if (frontmatter[key] !== undefined && !stringArray(frontmatter[key]))
        errors.push(finding('frontmatter-type', `${key} must be an array of non-empty strings.`, paths.canonical));
      if (Array.isArray(frontmatter[key]) && new Set(frontmatter[key]).size !== frontmatter[key].length)
        errors.push(finding('frontmatter-duplicate', `${key} contains duplicate values.`, paths.canonical));
    }
  }

  let blueprint = null;
  if (!fs.existsSync(paths.blueprint)) {
    addMissingBlueprint(finding('missing-blueprint',
      mode === 'import' ? 'Imported persona has no builder blueprint yet.' : 'blueprint.json is missing.',
      paths.blueprint));
  } else if (!realPathInside(workspaceRoot, paths.blueprint)) {
    errors.push(finding('workspace-escape', 'Blueprint resolves outside the configured workspace.', paths.blueprint));
  } else {
    blueprint = readJson(paths.blueprint, errors);
    if (blueprint) {
      if (blueprint.schema_version !== SCHEMA_VERSION)
        errors.push(finding('schema-version', `Blueprint schema_version must be ${SCHEMA_VERSION}.`, paths.blueprint));
      for (const area of BLUEPRINT_AREAS) {
        const value = blueprint[area];
        if (!value || typeof value !== 'object' || Array.isArray(value))
          errors.push(finding('missing-blueprint-area', `Blueprint area is missing or invalid: ${area}`, paths.blueprint));
        else if (Object.keys(value).length === 0)
          warnings.push(finding('thin-blueprint-area', `Blueprint area is incomplete: ${area}`, paths.blueprint));
      }
      const actionPosture = blueprint.action_posture;
      const posture = actionPosture && actionPosture.mode;
      if (!ACTION_POSTURES.has(posture))
        errors.push(finding('action-posture', 'Action posture mode is not recognized.', paths.blueprint));
      if (actionPosture && actionPosture.actions !== undefined) {
        const actions = actionPosture.actions;
        if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
          errors.push(finding('action-categories', 'action_posture.actions must be an object.', paths.blueprint));
        } else {
          for (const [category, decision] of Object.entries(actions)) {
            if (!ACTION_CATEGORIES.has(category))
              errors.push(finding('action-category', `Unknown action category: ${category}`, paths.blueprint));
            if (!ACTION_DECISIONS.has(decision))
              errors.push(finding('action-decision', `Action decision must be allowed, ask, or blocked: ${category}`, paths.blueprint));
          }
        }
      }
      if (!blueprint.canonical_hash)
        warnings.push(finding('missing-canonical-hash', 'Blueprint has no approved canonical hash.', paths.blueprint));
      else if (canonicalText && blueprint.canonical_hash !== hashCanonical(canonicalText))
        warnings.push(finding('canonical-drift', 'Canonical changed after the blueprint was approved.', paths.canonical));
      const runtimeKeys = findRuntimeKeys(blueprint);
      if (runtimeKeys.length)
        errors.push(finding('runtime-data', `Runtime-only fields are not portable persona data: ${runtimeKeys.join(', ')}`, paths.blueprint));
    }
  }

  const modules = Array.isArray(frontmatter.modules) ? frontmatter.modules : [];
  const expectsCollaboration = modules.includes('collaboration');
  let collaboration = null;
  if (!fs.existsSync(paths.collaboration)) {
    if (expectsCollaboration)
      errors.push(finding('missing-collaboration', 'modules declares collaboration but collaboration.json is missing.', paths.collaboration));
  } else if (!realPathInside(workspaceRoot, paths.collaboration)) {
    errors.push(finding('workspace-escape', 'Collaboration contract resolves outside the configured workspace.', paths.collaboration));
  } else {
    if (!expectsCollaboration)
      warnings.push(finding('undeclared-collaboration', 'collaboration.json exists but the module is not declared.', paths.collaboration));
    collaboration = readJson(paths.collaboration, errors);
    if (collaboration) {
      if (collaboration.schema_version !== SCHEMA_VERSION)
        errors.push(finding('schema-version', `Collaboration schema_version must be ${SCHEMA_VERSION}.`, paths.collaboration));
      for (const key of ['capabilities', 'accepts', 'emits']) {
        if (!stringArray(collaboration[key]))
          errors.push(finding('collaboration-type', `${key} must be an array of non-empty strings.`, paths.collaboration));
      }
      if (!ACCESS_MODES.has(collaboration.default_access))
        errors.push(finding('collaboration-access', 'default_access must be read-only or read-write.', paths.collaboration));
      const runtimeKeys = findRuntimeKeys(collaboration);
      if (runtimeKeys.length)
        errors.push(finding('runtime-data', `Runtime-only fields are not collaboration data: ${runtimeKeys.join(', ')}`, paths.collaboration));
    }
  }

  if (blueprint && collaboration && collaboration.default_access === 'read-only') {
    const actions = blueprint.action_posture && blueprint.action_posture.actions;
    if (actions && typeof actions === 'object' && !Array.isArray(actions)) {
      const routineWrites = Object.entries(actions)
        .filter(([category, decision]) => WRITE_ACTIONS.has(category) && decision === 'allowed')
        .map(([category]) => category);
      if (routineWrites.length)
        warnings.push(finding('access-conflict',
          `Read-only collaboration conflicts with routinely allowed write actions: ${routineWrites.join(', ')}`,
          paths.collaboration));
    }
  }

  for (const [code, label, file] of [
    ['missing-memory-index', 'memory/MEMORY.md is missing.', paths.memoryIndex],
    ['missing-scratchpad', 'scratchpad.md is missing.', paths.scratchpad],
  ]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      errors.push(finding(code, label, file));
    else if (!realPathInside(workspaceRoot, file))
      errors.push(finding('workspace-escape', `${path.basename(file)} resolves outside the configured workspace.`, file));
  }

  return { valid: errors.length === 0, errors, warnings, suggestions, paths, frontmatter, blueprint };
}

module.exports = {
  ACCESS_MODES,
  ACTION_CATEGORIES,
  ACTION_DECISIONS,
  ACTION_POSTURES,
  BLUEPRINT_AREAS,
  REQUIRED_FRONTMATTER,
  SCHEMA_VERSION,
  findRuntimeKeys,
  hashCanonical,
  isSafePersonaId,
  packagePaths,
  parseFrontmatter,
  resolveInside,
  validatePersonaPackage,
};

