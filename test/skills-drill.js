// Apex — headless drill for the skills surface: create a SKILL.md, scan it
// back, validate names, and promote a persona recipe. Stubs bus + store so
// main/skills.js loads headless. Run: node test/skills-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// stub bus + store before requiring skills.js
const busPath = require.resolve('../main/bus');
const storePath = require.resolve('../main/store');
require.cache[busPath] = { id: busPath, filename: busPath, loaded: true,
  exports: { on() {}, post() {}, init() {}, inject() {} } };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true,
  exports: { openLog: () => () => {} } };

const skills = require('../main/skills');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-skillrepo-'));

gate('createSkill writes a valid SKILL.md a scan reads back', () => {
  const created = skills.createSkill({ scope: 'project', repo,
    name: 'run-migrations', description: 'Run DB migrations safely with a dry-run first.',
    body: '# Steps\n1. Dry run\n2. Apply' });
  assert.ok(fs.existsSync(created.path));
  const md = fs.readFileSync(created.path, 'utf8');
  assert.match(md, /^---\nname: run-migrations\ndescription: Run DB migrations/);
  const scan = skills.scanSkills(repo);
  const hit = scan.project.find((s) => s.id === 'run-migrations');
  assert.ok(hit, 'skill discovered by scan');
  assert.match(hit.description, /Run DB migrations/);
});

gate('name validation rejects bad names', () => {
  assert.throws(() => skills.createSkill({ scope: 'project', repo, name: 'Bad Name', description: 'x' }), /kebab-case/);
  assert.throws(() => skills.createSkill({ scope: 'project', repo, name: 'ok', description: '' }), /description/);
  assert.throws(() => skills.createSkill({ scope: 'project', repo, name: 'a'.repeat(65), description: 'x' }), /64/);
});

gate('refuses to overwrite an existing skill', () => {
  assert.throws(() => skills.createSkill({ scope: 'project', repo,
    name: 'run-migrations', description: 'dupe' }), /already exists/);
});

gate('body defaults when omitted', () => {
  const c = skills.createSkill({ scope: 'project', repo, name: 'quick-note', description: 'Jot a note.' });
  const md = fs.readFileSync(c.path, 'utf8');
  assert.match(md, /# quick-note/);
});

gate('readSkill round-trips frontmatter + body', () => {
  const s = skills.readSkill('project', repo, 'run-migrations');
  assert.equal(s.id, 'run-migrations');
  assert.match(s.description, /dry-run first/);
  assert.match(s.body, /1\. Dry run/);
});

gate('saveSkill rewrites description + body; name stays the folder', () => {
  skills.saveSkill({ scope: 'project', repo, id: 'run-migrations',
    description: 'Run migrations with a verified backup first.', body: '# New steps\n1. Backup\n2. Apply' });
  const s = skills.readSkill('project', repo, 'run-migrations');
  assert.match(s.description, /verified backup/);
  assert.match(s.body, /1\. Backup/);
  assert.throws(() => skills.saveSkill({ scope: 'project', repo, id: 'run-migrations', description: '' }), /description/);
});

gate('deleteSkill archives (recoverable), scan no longer lists it', () => {
  const gone = skills.deleteSkill({ scope: 'project', repo, id: 'quick-note' });
  assert.ok(fs.existsSync(path.join(gone.archivedTo, 'SKILL.md')), 'archived copy intact');
  const scan = skills.scanSkills(repo);
  assert.ok(!scan.project.some((s) => s.id === 'quick-note'));
  assert.ok(!scan.project.some((s) => s.id === '.archive'), '.archive never lists');
});

gate('mutations refuse traversal and unknown ids', () => {
  assert.throws(() => skills.readSkill('project', repo, '../evil'), /Unknown skill id/);
  assert.throws(() => skills.deleteSkill({ scope: 'project', repo, id: 'no-such-skill' }), /not found/);
});

gate('recipe scan finds project-scoped persona recipes', () => {
  // build a fake persona workspace and point the module's config at it by
  // writing the workspace.json the module reads
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-skillws-'));
  const recipeDir = path.join(ws, 'personas', 'scribe', 'memory', 'projects', 'apex', 'recipes');
  fs.mkdirSync(recipeDir, { recursive: true });
  fs.writeFileSync(path.join(recipeDir, 'reset-db.md'),
    '---\nname: reset db\n---\n\nDrop and re-seed the dev database in one command.');
  const cfgPath = path.join(__dirname, '..', 'state', 'extensions', 'personas', 'workspace.json');
  const had = fs.existsSync(cfgPath);
  const prev = had ? fs.readFileSync(cfgPath, 'utf8') : null;
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ schema: 1, workspace: ws }));
  try {
    const recipes = skills.scanRecipes();
    const hit = recipes.find((r) => r.name === 'reset-db' && r.persona === 'scribe');
    assert.ok(hit, 'recipe discovered');
    assert.match(hit.preview, /Drop and re-seed/);
  } finally {
    if (had) fs.writeFileSync(cfgPath, prev); else fs.rmSync(cfgPath, { force: true });
  }
});

console.log('\nSKILLS DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
