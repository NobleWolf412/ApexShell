// Apex — Claude Code skills surface. Personas are `claude` CLI seats, so any
// SKILL.md under ~/.claude/skills (personal) or <repo>/.claude/skills (project)
// is auto-discovered and invocable by them. This module makes that system
// visible and authorable from Apex: list installed skills, create new ones,
// and promote a persona's captured recipe (project-scoped memory) into a real
// skill — bridging the recipe memory to Claude Code's skill system.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const bus = require('./bus');
const store = require('./store');

// Claude Code skill-name rules: lowercase kebab-case, <=64 chars, matches dir.
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESC_CAP = 1024;
const PERSONAS_WORKSPACE = path.join(__dirname, '..', 'state', 'extensions', 'personas', 'workspace.json');

function personalRoot() { return path.join(os.homedir(), '.claude', 'skills'); }
function projectRoot(repo) { return path.join(repo, '.claude', 'skills'); }

// Minimal frontmatter read — name + description only (never executes YAML).
function readSkillMeta(skillMd) {
  try {
    const text = fs.readFileSync(skillMd, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const attrs = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (kv) attrs[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    return { name: attrs.name || '', description: attrs.description || '' };
  } catch { return null; }
}

function scanDir(root) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const skillMd = path.join(root, e.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const meta = readSkillMeta(skillMd) || {};
    out.push({ id: e.name, name: meta.name || e.name, description: meta.description || '', path: skillMd });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function scanSkills(repo) {
  return {
    personal: scanDir(personalRoot()),
    project: (repo && fs.existsSync(repo)) ? scanDir(projectRoot(repo)) : [],
    repo: repo || null,
  };
}

// Persona recipes (project-scoped memory) are the natural skill candidates.
function personaWorkspace() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PERSONAS_WORKSPACE, 'utf8'));
    if (cfg && typeof cfg.workspace === 'string' && fs.existsSync(cfg.workspace)) return cfg.workspace;
  } catch { /* not configured */ }
  return null;
}

function scanRecipes() {
  const ws = personaWorkspace();
  if (!ws) return [];
  const personasDir = path.join(ws, 'personas');
  const out = [];
  let people;
  try { people = fs.readdirSync(personasDir, { withFileTypes: true }); } catch { return out; }
  for (const person of people) {
    if (!person.isDirectory() || person.name.startsWith('.')) continue;
    // memory/**/recipes/*.md at any project depth
    walkRecipes(path.join(personasDir, person.name, 'memory'), (file) => {
      let preview = '';
      try { preview = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 400); }
      catch { /* skip body */ }
      out.push({ persona: person.name, name: path.basename(file, '.md'), path: file, preview });
    });
  }
  return out.slice(0, 100);
}
function walkRecipes(dir, onFile) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRecipes(p, onFile);
    else if (e.isFile() && path.basename(dir) === 'recipes' && e.name.endsWith('.md')) onFile(p);
  }
}

// Never trust a raw path off the wire — every mutation reconstructs the
// skill directory from {scope, repo, id}, and the NAME_RE gate on the id
// kills traversal.
function resolveDir(scope, repo, id) {
  const clean = String(id || '').trim().toLowerCase();
  if (!NAME_RE.test(clean) || clean.length > 64) throw new Error('Unknown skill id.');
  let base;
  if (scope === 'project') {
    if (!repo || !path.isAbsolute(repo) || !fs.existsSync(repo))
      throw new Error('Project skill needs its repo folder.');
    base = projectRoot(repo);
  } else base = personalRoot();
  const dir = path.join(base, clean);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error('Skill not found: ' + clean);
  return { dir, id: clean };
}

function readSkill(scope, repo, id) {
  const { dir, id: clean } = resolveDir(scope, repo, id);
  const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const meta = readSkillMeta(path.join(dir, 'SKILL.md')) || {};
  const body = text.replace(/^---\n[\s\S]*?\n---\s*/, '');
  return { id: clean, name: meta.name || clean, description: meta.description || '', body: body.trim() };
}

function saveSkill({ scope, repo, id, description, body }) {
  const { dir, id: clean } = resolveDir(scope, repo, id);
  const desc = String(description || '').trim();
  if (!desc) throw new Error('A skill needs a description — it is how Claude decides when to use it.');
  if (desc.length > DESC_CAP) throw new Error('Description exceeds ' + DESC_CAP + ' characters.');
  const md = [
    '---',
    'name: ' + clean,
    'description: ' + desc.replace(/\n/g, ' '),
    '---',
    '',
    (String(body || '').trim() || '# ' + clean),
    '',
  ].join('\n');
  const file = path.join(dir, 'SKILL.md');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, md, 'utf8');
  fs.rmSync(file, { force: true });
  fs.renameSync(tmp, file);
  return { id: clean };
}

// Soft delete — same covenant as personas: archive, never erase. The skill
// folder moves whole into <root>/.archive/<id>--<stamp>.
function deleteSkill({ scope, repo, id }) {
  const { dir, id: clean } = resolveDir(scope, repo, id);
  const archiveRoot = path.join(path.dirname(dir), '.archive');
  fs.mkdirSync(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(archiveRoot, clean + '--' + stamp);
  fs.renameSync(dir, dest);
  return { id: clean, archivedTo: dest };
}

function createSkill({ scope, repo, name, description, body }) {
  const clean = String(name || '').trim().toLowerCase();
  if (!NAME_RE.test(clean) || clean.length > 64)
    throw new Error('Skill name must be lowercase kebab-case, letters/numbers/hyphens, up to 64 chars.');
  const desc = String(description || '').trim();
  if (!desc) throw new Error('A skill needs a description — it is how Claude decides when to use it.');
  if (desc.length > DESC_CAP) throw new Error('Description exceeds ' + DESC_CAP + ' characters.');
  let base;
  if (scope === 'project') {
    if (!repo || !path.isAbsolute(repo) || !fs.existsSync(repo))
      throw new Error('Choose an existing repo folder for a project skill.');
    base = projectRoot(repo);
  } else {
    base = personalRoot();
  }
  const dir = path.join(base, clean);
  if (fs.existsSync(dir)) throw new Error('A skill named "' + clean + '" already exists at this scope.');
  const md = [
    '---',
    'name: ' + clean,
    'description: ' + desc.replace(/\n/g, ' '),
    '---',
    '',
    (String(body || '').trim() || '# ' + clean + '\n\nDescribe the steps this skill should follow.'),
    '',
  ].join('\n');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md, { encoding: 'utf8', flag: 'wx' });
  return { path: path.join(dir, 'SKILL.md'), scope: scope === 'project' ? 'project' : 'personal', name: clean };
}

function register() {
  const log = store.openLog('skills');
  bus.on('skillList', (m) => bus.post('skillList', scanSkills(m && m.repo)));
  bus.on('skillRecipes', () => bus.post('skillRecipes', { recipes: scanRecipes() }));
  bus.on('skillPickRepo', async () => {
    try {
      const { dialog } = require('electron');
      const picked = await dialog.showOpenDialog({ title: 'Choose a repo for project skills', properties: ['openDirectory'] });
      if (!picked.canceled && picked.filePaths[0]) bus.post('skillRepoPicked', { path: picked.filePaths[0] });
    } catch (e) { bus.post('toast', { text: 'Could not open the folder picker: ' + e.message }); }
  });
  bus.on('skillCreate', (m) => {
    try {
      const created = createSkill(m || {});
      log('created ' + created.scope + ' skill ' + created.name);
      bus.post('skillCreated', { ok: true, ...created });
      bus.post('toast', { text: 'Skill "' + created.name + '" created — your ' + created.scope +
        ' persona seats will auto-discover it.' });
      bus.post('skillList', scanSkills(m && m.repo));
    } catch (err) {
      bus.post('skillCreated', { ok: false, error: err.message });
      bus.post('toast', { text: 'Skill not created: ' + err.message });
    }
  });
  bus.on('skillRead', (m) => {
    try {
      bus.post('skillContent', { ok: true, scope: (m && m.scope) || 'personal',
        repo: (m && m.repo) || null, ...readSkill(m && m.scope, m && m.repo, m && m.id) });
    } catch (err) { bus.post('skillContent', { ok: false, error: err.message }); }
  });
  bus.on('skillSave', (m) => {
    try {
      const saved = saveSkill(m || {});
      log('saved skill ' + saved.id);
      bus.post('skillSaved', { ok: true, id: saved.id });
      bus.post('toast', { text: 'Skill "' + saved.id + '" updated.' });
      bus.post('skillList', scanSkills(m && m.repo));
    } catch (err) {
      bus.post('skillSaved', { ok: false, error: err.message });
      bus.post('toast', { text: 'Skill not saved: ' + err.message });
    }
  });
  bus.on('skillDelete', (m) => {
    try {
      if (!m || m.confirmed !== true) throw new Error('Deleting a skill requires explicit confirmation.');
      const gone = deleteSkill(m);
      log('archived skill ' + gone.id);
      bus.post('toast', { text: 'Skill "' + gone.id + '" archived — recover it from .archive/' +
        path.basename(gone.archivedTo) + ' if needed.' });
      bus.post('skillList', scanSkills(m.repo));
    } catch (err) { bus.post('toast', { text: 'Skill not deleted: ' + err.message }); }
  });
  bus.on('ready', () => { bus.post('skillList', scanSkills(null)); bus.post('skillRecipes', { recipes: scanRecipes() }); });
}

module.exports = { register, scanSkills, scanRecipes, createSkill, readSkill, saveSkill, deleteSkill };
