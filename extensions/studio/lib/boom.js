// App Builder — the boom loop's landing half (STUDIO v2, Wave C slice C2).
// Pure-ish lib code: fs only (the mockup.js store discipline), an INJECTABLE
// execFile seam for every git touch (args array, never a shell string — the
// B1 no-injection law applied to version control), no Electron, no bus, no
// seat wiring (main.js seats the surgeon and drives these). Four jobs:
//
//   1. The apply-time re-wall + plan (planApply): a VALIDATED surgeon report
//      is still only a claim — every edit path re-runs the C1 wall AND must
//      resolve inside the project dir (belt and braces: parseReply already
//      refused traversal, this refuses it again at the moment bytes would
//      land), 'modified' requires the file exists, 'created' requires it does
//      not, and v1's apply discipline requires hunks = the file's COMPLETE
//      new content (the parser stays C1's — hunks optional there; an edit
//      without content is refused HERE, never repaired).
//   2. The apply itself (applyEdits): atomic same-dir temp + rename per file
//      (the drafts.js/mockup.js primitive, verbatim), parents created for
//      'created' kinds. Always AFTER the ledger snapshot — backup-first is
//      the ordering contract the drill pins.
//   3. The ledger: entries {ts, intent<=200, files[{file,kind}], mode:
//      'git'|'backup', token, demoted?} in state/extensions/studio/
//      boomledger/<projectId>.json — atomic, capped 100, oldest dropped.
//      Backup mode copies each touched original to boomledger/<projectId>/
//      <token>/<relpath> BEFORE any write; git mode commits the touched
//      files (add -- <files>, never -A: a user's unrelated dirty files must
//      not be swept into a boom commit) and the commit hash is the token.
//   4. Revert: git mode = `git revert --no-edit <hash>` (refused honestly on
//      a dirty tree — a revert that eats uncommitted work is not a revert);
//      backup mode = restore the copies atomically, and remove files the
//      boom CREATED (their restore is absence).
//
// The kickoff excerpts (composeBoomKickoff) are this slice's one stated
// divergence from the C2 brief, documented rather than hidden: the disposable
// seat primitive (main/engine/seatHost.js createDisposable) is tool-disabled
// and scratch-cwd BY CONTRACT, and the engine is out of this slice's reach —
// so "in the PROJECT cwd" cannot mean the seat reads the project itself. The
// complete-content apply discipline only works if the surgeon has SEEN the
// current bytes, so the top resolver candidates' contents ride the kickoff,
// bounded (per-file at the hunks cap — over it is named honestly as
// delegate-sized — and few files). The day the disposable seam grows a
// walled-cwd mode, this block shrinks to nothing.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const surgeon = require('./surgeon');
const { isSafeProjectId } = require('./contract');

// ---- caps and shapes --------------------------------------------------------
const LEDGER_SCHEMA = 1;
const MAX_LEDGER_ENTRIES = 100;   // capped, oldest dropped (§ slice brief, verbatim)
const MAX_LEDGER_INTENT = 200;
// Kickoff file excerpts: few and small — a boom is a surgical strike on small
// files (§ brief: "small files only in v1; bigger = followup:'delegate'").
const MAX_KICKOFF_FILES = 4;
const MAX_KICKOFF_FILE_BYTES = surgeon.HUNKS_CAP;
// A git revert token is a commit hash and nothing else — pinned so a
// hand-edited ledger file can never smuggle a `--flag` onto the git argv
// (args-array already kills the shell; this kills option injection too).
const GIT_TOKEN_RE = /^[0-9a-f]{7,64}$/i;

const sliceIntent = (intent) => String(intent || '').trim().slice(0, MAX_LEDGER_INTENT);

// ---- store paths (the mockup.js dir discipline) ------------------------------
function boomRoot(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('App Builder state directory must be absolute.');
  return path.join(stateDir, 'boomledger');
}

function ledgerFile(stateDir, projectId) {
  if (!isSafeProjectId(projectId)) throw new Error('That is not a valid project id.');
  return path.join(boomRoot(stateDir), projectId + '.json');
}

function backupRoot(stateDir, projectId, token) {
  if (!isSafeProjectId(projectId)) throw new Error('That is not a valid project id.');
  if (typeof token !== 'string' || !/^[0-9]{10,17}$/.test(token))
    throw new Error('That ledger entry has no usable backup token.');
  return path.join(boomRoot(stateDir), projectId, token);
}

// Same link guard as mockup.ensureDir: a linked dir could redirect writes
// outside the state tree; refuse it before any read or write.
function ensureDir(dir, create) {
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Boom ledger store must be a regular directory, not a link.');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    if (!create) return null;
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// drafts.js's crash-safety primitive, verbatim: exclusive-flag temp in the
// SAME dir, then atomic rename — a reader sees the old bytes or the new,
// never a half-written file.
function atomicWriteFile(file, content) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
}

// ---- the apply-time re-wall --------------------------------------------------
// classifyEditPath is C1's wall (absolute of either flavor, colon, ~, .., any
// control char); the resolve-and-relative check after it is the belt-and-
// braces the brief demands: even a path some future parser bug let through
// must STILL land inside the project dir, checked at the moment of writing.
function resolveApplyPath(projectRoot, file) {
  const why = surgeon.classifyEditPath(file);
  if (why) throw new Error('Edit path refused (' + why + '): ' + String(file).slice(0, 80));
  const rel = String(file).trim().replace(/[\\/]+/g, '/');
  const abs = path.resolve(projectRoot, ...rel.split('/'));
  const back = path.relative(projectRoot, abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back))
    throw new Error('Edit path escapes the project: ' + rel);
  return { rel, abs };
}

/**
 * Turn a VALIDATED surgeon result into an apply plan, or refuse the whole
 * report ({ ok: false, error }) — one bad edit sinks the boom (the parseReply
 * philosophy carried to the landing: nothing is trimmed into acceptance).
 * Never writes. files: [{ file, abs, kind, content }].
 */
function planApply(projectRoot, result) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot))
    throw new Error('Boom apply needs an absolute project root.');
  if (!result || !Array.isArray(result.edits) || !result.edits.length)
    return { ok: false, error: 'The surgeon reported no edits to apply.' };
  const files = [];
  const seen = new Set();
  for (const edit of result.edits) {
    let where;
    try { where = resolveApplyPath(projectRoot, edit && edit.file); }
    catch (err) { return { ok: false, error: err.message }; }
    if (seen.has(where.rel))
      return { ok: false, error: 'The report names ' + where.rel + ' twice.' };
    seen.add(where.rel);
    if (typeof edit.hunks !== 'string' || !edit.hunks)
      return { ok: false, error: where.rel + ' carries no content — v1 applies complete-file hunks only (the surgeon was asked to delegate anything bigger).' };
    if (edit.hunks.length > surgeon.HUNKS_CAP)   // parser-enforced; re-pinned at the landing
      return { ok: false, error: where.rel + ' exceeds the ' + Math.floor(surgeon.HUNKS_CAP / 1024) + ' KB boom cap.' };
    let stat = null;
    try { stat = fs.lstatSync(where.abs); } catch { stat = null; }
    if (stat && (stat.isSymbolicLink() || !stat.isFile()))
      return { ok: false, error: where.rel + ' is not a regular file.' };
    if (edit.kind === 'modified' && !stat)
      return { ok: false, error: where.rel + ' does not exist — a "modified" edit needs an existing file.' };
    if (edit.kind === 'created' && stat)
      return { ok: false, error: where.rel + ' already exists — a "created" edit never overwrites.' };
    files.push({ file: where.rel, abs: where.abs, kind: edit.kind, content: edit.hunks });
  }
  return { ok: true, files };
}

/** Backup-first (backup mode's snapshot): copy every to-be-MODIFIED file's
 *  current bytes to boomledger/<projectId>/<token>/<relpath> before a single
 *  write lands. 'created' files have no original — absence IS their backup.
 *  Throws on any failure, BEFORE the apply ever runs. */
function backupFiles(stateDir, projectId, planFiles, token) {
  const root = backupRoot(stateDir, projectId, token);
  ensureDir(boomRoot(stateDir), true);
  let copied = 0;
  for (const f of planFiles) {
    if (f.kind !== 'modified') continue;
    const dest = path.join(root, ...f.file.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest, fs.constants.COPYFILE_EXCL);
    copied++;
  }
  return copied;
}

/** The landing: ALL parents for 'created' kinds first, THEN the atomic write
 *  primitive per file — the likeliest failure (a created path whose parent
 *  turns out to be a file) surfaces before a single byte lands, so a refused
 *  apply leaves the project untouched. Caller ordering is the contract —
 *  ledger snapshot (git dirty read, or backupFiles) ALWAYS precedes this. */
function applyEdits(planFiles) {
  for (const f of planFiles)
    if (f.kind === 'created') fs.mkdirSync(path.dirname(f.abs), { recursive: true });
  for (const f of planFiles) atomicWriteFile(f.abs, f.content);
  return planFiles.length;
}

// ---- the ledger --------------------------------------------------------------
// Rebuilt known fields only (the validator discipline applied to our OWN
// store — a hand-edited state file must not smuggle shapes back at the UI).
function cleanEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const files = (Array.isArray(e.files) ? e.files : [])
    .filter((f) => f && typeof f.file === 'string' &&
      (f.kind === 'modified' || f.kind === 'created'))
    .map((f) => ({ file: f.file, kind: f.kind }));
  const out = {
    ts: typeof e.ts === 'string' ? e.ts : new Date().toISOString(),
    intent: sliceIntent(e.intent),
    files,
    mode: e.mode === 'git' ? 'git' : 'backup',
    token: typeof e.token === 'string' ? e.token : null,
  };
  if (e.demoted === true) out.demoted = true;
  return out;
}

/** Read a project's ledger — fail-soft: missing, linked, or malformed reads
 *  as empty (entries individually re-cleaned). Newest LAST. */
function readLedger(stateDir, projectId) {
  const file = ledgerFile(stateDir, projectId);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== LEDGER_SCHEMA || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.map(cleanEntry);
  } catch { return []; }
}

/** Append one entry (atomic write, capped at MAX_LEDGER_ENTRIES — oldest
 *  dropped). Returns the persisted list. */
function appendLedgerEntry(stateDir, projectId, entry) {
  ensureDir(boomRoot(stateDir), true);
  const entries = readLedger(stateDir, projectId);
  entries.push(cleanEntry(entry));
  const kept = entries.slice(-MAX_LEDGER_ENTRIES);
  atomicWriteFile(ledgerFile(stateDir, projectId),
    JSON.stringify({ schema: LEDGER_SCHEMA, entries: kept }, null, 2) + '\n');
  return kept;
}

// ---- git (every touch through the injectable execFile seam) ------------------
const isGitRepo = (projectDir) => {
  try { return fs.existsSync(path.join(projectDir, '.git')); } catch { return false; }
};

// One shape for every git call: execFile('git', [args...], { cwd }) — an args
// ARRAY, no shell, no interpolation of user text into a command line. The
// seam is child_process.execFile in production, a recorder in the drill.
const runGit = (execFile, cwd, args) => new Promise((resolve, reject) => {
  try {
    execFile('git', args, { cwd, windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error('git ' + args[0] + ' failed: ' + (err.message || err)));
      else resolve(String(stdout || ''));
    });
  } catch (err) { reject(err); }
});

/** Dirty-file paths (porcelain), recorded before a git-mode apply — the
 *  snapshot that keeps the boom commit scoped to ITS files alone. */
async function gitDirtyFiles(execFile, cwd) {
  const out = await runGit(execFile, cwd, ['status', '--porcelain']);
  return out.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
}

/** Stage exactly the boom's files and commit; the hash is the revert token. */
async function gitCommitBoom(execFile, cwd, relFiles, intent) {
  await runGit(execFile, cwd, ['add', '--', ...relFiles]);
  await runGit(execFile, cwd, ['commit', '-m', 'boom: ' + (sliceIntent(intent) || '(no intent recorded)')]);
  return (await runGit(execFile, cwd, ['rev-parse', 'HEAD'])).trim();
}

/** Git-mode revert: refuse a dirty tree honestly (a revert that would eat
 *  uncommitted work is not a revert), then `git revert --no-edit <hash>`. */
async function gitRevertBoom(execFile, cwd, token) {
  if (typeof token !== 'string' || !GIT_TOKEN_RE.test(token))
    throw new Error('That ledger entry has no usable revert token.');
  const dirty = await gitDirtyFiles(execFile, cwd);
  if (dirty.length)
    throw new Error('The project working tree is dirty (' + dirty.length +
      ' file(s)) — commit or stash your changes before reverting a boom.');
  await runGit(execFile, cwd, ['revert', '--no-edit', token]);
}

/** Backup-mode revert: restore every copied original atomically; a file the
 *  boom CREATED has no copy — its restore is removal. Refuses (whole, before
 *  any restore) if a needed copy is missing: a half-revert would lie. */
function revertBackup(stateDir, projectId, projectRoot, entry) {
  const e = cleanEntry(entry);
  const root = backupRoot(stateDir, projectId, String(e.token || ''));
  const plan = [];
  for (const f of e.files) {
    const where = resolveApplyPath(projectRoot, f.file);   // the ledger is a claim too
    if (f.kind === 'created') { plan.push({ ...where, kind: 'created', from: null }); continue; }
    const from = path.join(root, ...where.rel.split('/'));
    let stat;
    try { stat = fs.lstatSync(from); } catch { stat = null; }
    if (!stat || stat.isSymbolicLink() || !stat.isFile())
      throw new Error('Backup copy missing for ' + where.rel + ' — this boom cannot be reverted.');
    plan.push({ ...where, kind: 'modified', from });
  }
  let restored = 0, removed = 0;
  for (const p of plan) {
    if (p.kind === 'created') {
      try { fs.unlinkSync(p.abs); removed++; } catch { /* already gone — absence achieved */ }
    } else {
      atomicWriteFile(p.abs, fs.readFileSync(p.from, 'utf8'));
      restored++;
    }
  }
  return { restored, removed };
}

// ---- the kickoff excerpts (the stated divergence — header) -------------------
/** Bounded current-content block for the top file-bearing candidates: the
 *  tool-less surgeon's only view of the code. Over-cap files are named as
 *  delegate-sized rather than truncated (a sliced file would invite a sliced
 *  rewrite). Fail-soft per file — an unreadable candidate just drops out. */
function kickoffFileExcerpts(projectRoot, candidates) {
  const lines = [];
  const seen = new Set();
  let taken = 0;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (taken >= MAX_KICKOFF_FILES) break;
    if (!c || typeof c.file !== 'string' || !c.file || seen.has(c.file)) continue;
    seen.add(c.file);
    let where;
    try { where = resolveApplyPath(projectRoot, c.file); } catch { continue; }
    let stat;
    try { stat = fs.lstatSync(where.abs); } catch { continue; }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    taken++;
    if (stat.size > MAX_KICKOFF_FILE_BYTES) {
      lines.push('--- ' + where.rel + ': ' + stat.size + ' bytes — over the ' +
        Math.floor(MAX_KICKOFF_FILE_BYTES / 1024) +
        ' KB boom cap. If the change lives here, report followup "' +
        surgeon.DELEGATE_FOLLOWUP + '". ---');
      continue;
    }
    let content;
    try { content = fs.readFileSync(where.abs, 'utf8'); } catch { continue; }
    lines.push('--- ' + where.rel + ' (current content, verbatim) ---', content);
  }
  if (!lines.length) return '';
  return [
    '',
    '',
    'CURRENT FILE CONTENT (the top candidates, read for you — you have no file',
    'tools in this session, so these bytes are your only view of the code; every',
    'edit must carry that file\'s COMPLETE new content in "hunks"):',
    ...lines,
  ].join('\n');
}

/** The C1 kickoff + the excerpts, one string for the disposable. */
function composeBoomKickoff({ displayName, intent, context, candidates, projectRoot }) {
  return surgeon.buildKickoff({ displayName, intent, context, candidates }) +
    kickoffFileExcerpts(projectRoot, candidates);
}

// The constants export wholesale as the module's public contract (the
// suggest.js precedent): the drill pins the caps and the ordering, main.js
// wires the flow, and nothing re-invents a number. sliceIntent and
// kickoffFileExcerpts are internal-only since the v2 sweep (nothing outside
// called them; appendLedgerEntry/gitCommitBoom and composeBoomKickoff carry
// their work).
module.exports = {
  LEDGER_SCHEMA,
  MAX_LEDGER_ENTRIES,
  MAX_LEDGER_INTENT,
  MAX_KICKOFF_FILES,
  ledgerFile,
  backupRoot,
  resolveApplyPath,
  planApply,
  backupFiles,
  applyEdits,
  readLedger,
  appendLedgerEntry,
  isGitRepo,
  gitDirtyFiles,
  gitCommitBoom,
  gitRevertBoom,
  revertBackup,
  composeBoomKickoff,
};
