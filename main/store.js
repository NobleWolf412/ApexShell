// Apex — JSON state store + wire logs. Lives in app/state/ (gitignored, in
// the Apex tree — local state, never platform-locked; plan §3). Two jobs:
// the chat-history index (J16: capped per persona, survives restarts) and
// the seat wire log (the old "Apex Seat" output channel, now a file —
// debug-ready duty).
'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const HISTORY_FILE = path.join(STATE_DIR, 'history.json');
const HISTORY_CAP = 12;   // per persona (J16)

function ensure(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ } }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
// Atomic: a crash mid-write must not truncate the file (readers fall back to
// {} and the state silently vanishes). Same tmp+rename as liveUpdate's
// restore file — the one place in the tree that already did this right.
function writeJson(file, obj) {
  ensure(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.rmSync(file, { force: true });
  fs.renameSync(tmp, file);
}

/** Record (or retitle) a chat in the history index. `cwd` = the repo/folder
 *  the seat worked out of — powers repo grouping and repo-faithful resume. */
function recordChat(persona, sessionId, title, cwd) {
  const h = readJson(HISTORY_FILE, {});
  const list = h[persona] || (h[persona] = []);
  const hit = list.find((e) => e.sessionId === sessionId);
  // A PLACEHOLDER MUST NEVER ERASE A REAL NAME. Seats record their starting
  // title on `init`, which on a resume was the bare persona — silently wiping
  // the name the chat had earned. Fixed at the source (seats.js passes the
  // stored title into a resume); this is the belt-and-braces (2026-07-13).
  if (hit) {
    const placeholder = !title || title === persona;
    if (!placeholder || !hit.title || hit.title === persona) hit.title = title;
    if (typeof cwd === 'string' && cwd) hit.cwd = cwd;
    hit.ts = Date.now();
  }
  else {
    const entry = { sessionId, title, ts: Date.now() };
    if (typeof cwd === 'string' && cwd) entry.cwd = cwd;
    list.unshift(entry);
    if (list.length > HISTORY_CAP) list.length = HISTORY_CAP;
  }
  writeJson(HISTORY_FILE, h);
}

function chatHistory() { return readJson(HISTORY_FILE, {}); }

/** Append-only wire log, one file per day per name. Returns (line) => void. */
function openLog(name) {
  ensure(LOG_DIR);
  const file = path.join(LOG_DIR, `${name}-${new Date().toISOString().slice(0, 10)}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  return (line) => {
    try { stream.write(new Date().toISOString().slice(11, 19) + ' ' + line + '\n'); }
    catch { /* a failed log line must never kill a seat */ }
  };
}

module.exports = { recordChat, chatHistory, openLog, writeJsonAtomic: writeJson };
