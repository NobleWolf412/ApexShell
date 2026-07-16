// Persona Builder workspace onboarding — deterministic headless gate.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stateDirFor, chooseDirectory } = require('../main/extensionServices');
const persona = require('../extensions/personas/main');
const foundation = require('../extensions/personas/lib/foundation');
const draftStore = require('../extensions/personas/lib/drafts');
const { CARDS, KEYS } = require('../extensions/personas/lib/interview');
const previewRenderer = require('../extensions/personas/lib/render');
const personaContract = require('../extensions/personas/lib/contract');
const previewValidator = require('../extensions/personas/lib/validator');
const importer = require('../extensions/personas/lib/importer');
const tester = require('../extensions/personas/lib/tester');
const creator = require('../extensions/personas/lib/creator');
const seatRuntime = require('../main/seats');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-persona-extension-'));
let passed = 0;

async function gate(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name + ' — ' + err.message);
    throw err;
  }
}

function fakeBus() {
  const handlers = new Map();
  const posts = [];
  return {
    handlers,
    posts,
    on(type, fn) { handlers.set(type, fn); },
    post(type, payload) { posts.push({ type, payload }); },
  };
}

function completeAnswers(prefix = 'Complete') {
  return Object.fromEntries(KEYS.map((key) => [key, `${prefix} answer for ${key}.`]));
}

function previewChoices(personaId = 'rowan') {
  return {
    personaId,
    mode: 'operator',
    actions: Object.fromEntries([...personaContract.ACTION_CATEGORIES].map((key) => [key, 'ask'])),
  };
}

function collaborationChoices(access = 'read-only') {
  return {
    enabled: true,
    default_access: access,
    capabilities: ['review code', 'run checks'],
    accepts: ['review packet'],
    emits: ['findings report'],
  };
}

function completeDisposableTest(bus, draft, disposableSeat) {
  bus.posts.length = 0;
  bus.handlers.get('personaTestPrepare')({ id: draft.id });
  const cases = bus.posts[0].payload.cases;
  bus.posts.length = 0;
  bus.handlers.get('personaTestStart')({
    id: draft.id, expectedRevision: draft.revision, approved: true,
  });
  const disposable = disposableSeat();
  disposable.onEvent({ type: 'init', tools: [] });
  disposable.onEvent({ type: 'text', text: 'TEST-SEAT-READY' });
  disposable.onEvent({ type: 'result', ok: true });
  for (let index = 0; index < cases.length; index++) {
    disposable.onEvent({ type: 'text', text: 'Observed permanent response ' + index });
    disposable.onEvent({ type: 'result', ok: true });
  }
}

(async () => {
  try {
    await gate('state directory stays one level under its root', () => {
      const root = path.join(scratch, 'state');
      assert.equal(stateDirFor(root, 'personas'), path.join(root, 'personas'));
      assert.throws(() => stateDirFor(root, '..'), /one path segment/);
      assert.throws(() => stateDirFor(root, path.join('personas', 'nested')), /one path segment/);
    });

    await gate('directory picker returns a resolved selection', async () => {
      const selected = path.join(scratch, 'picked');
      let received;
      const dialog = {
        async showOpenDialog(options) {
          received = options;
          return { canceled: false, filePaths: [selected] };
        },
      };
      assert.equal(await chooseDirectory(dialog, { title: ' Persona home ', defaultPath: scratch }), selected);
      assert.equal(received.title, 'Persona home');
      assert.deepEqual(received.properties, ['openDirectory', 'createDirectory']);
      assert.equal(received.defaultPath, scratch);
    });

    await gate('directory picker cancellation is null', async () => {
      const dialog = { async showOpenDialog() { return { canceled: true, filePaths: [] }; } };
      assert.equal(await chooseDirectory(dialog), null);
    });

    await gate('workspace config is atomic and round-trips', () => {
      const stateDir = path.join(scratch, 'roundtrip-state');
      const workspace = path.join(scratch, 'roundtrip-workspace');
      fs.mkdirSync(workspace);
      assert.equal(persona.writeWorkspaceConfig(stateDir, workspace), workspace);
      assert.deepEqual(persona.readWorkspaceConfig(stateDir), { workspace, error: null });
      assert.deepEqual(fs.readdirSync(stateDir), ['workspace.json']);
    });

    await gate('workspace status reports portable structure', () => {
      const stateDir = path.join(scratch, 'status-state');
      const workspace = path.join(scratch, 'status-workspace');
      fs.mkdirSync(path.join(workspace, 'personas', 'coder'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'personas', 'reviewer'));
      fs.writeFileSync(path.join(workspace, 'foundation.md'), '# Foundation\n');
      persona.writeWorkspaceConfig(stateDir, workspace);
      assert.deepEqual(persona.workspaceStatus(stateDir), {
        configured: true,
        workspace,
        exists: true,
        foundationReady: true,
        personasReady: true,
        personaCount: 2,
        error: null,
      });
    });

    await gate('missing and malformed workspace settings stay recoverable', () => {
      const stateDir = path.join(scratch, 'recover-state');
      fs.mkdirSync(stateDir);
      assert.equal(persona.workspaceStatus(stateDir).configured, false);
      fs.writeFileSync(path.join(stateDir, 'workspace.json'), '{"schema":2}');
      const malformed = persona.workspaceStatus(stateDir);
      assert.equal(malformed.configured, false);
      assert.match(malformed.error, /schema must be 1/);
    });

    await gate('status request publishes without opening a picker', () => {
      const bus = fakeBus();
      let pickerCalls = 0;
      persona.register({
        bus,
        stateDir: path.join(scratch, 'get-state'),
        async pickDirectory() { pickerCalls += 1; return null; },
      });
      bus.handlers.get('personaWorkspaceGet')();
      assert.equal(pickerCalls, 0);
      assert.equal(bus.posts.at(-1).type, 'personaWorkspaceStatus');
    });

    await gate('cancel leaves configuration unchanged', async () => {
      const bus = fakeBus();
      const stateDir = path.join(scratch, 'cancel-state');
      persona.register({ bus, stateDir, async pickDirectory() { return null; } });
      await bus.handlers.get('personaWorkspaceChoose')();
      assert.equal(fs.existsSync(path.join(stateDir, 'workspace.json')), false);
      assert.equal(bus.posts.at(-1).type, 'personaWorkspaceStatus');
    });

    await gate('explicit selection persists and publishes ready status', async () => {
      const bus = fakeBus();
      const stateDir = path.join(scratch, 'choose-state');
      const workspace = path.join(scratch, 'choose-workspace');
      fs.mkdirSync(workspace);
      persona.register({ bus, stateDir, async pickDirectory() { return workspace; } });
      await bus.handlers.get('personaWorkspaceChoose')();
      const post = bus.posts.at(-1);
      assert.equal(post.type, 'personaWorkspaceStatus');
      assert.equal(post.payload.configured, true);
      assert.equal(persona.readWorkspaceConfig(stateDir).workspace, workspace);
    });

    await gate('picker failure toasts and republishes status', async () => {
      const bus = fakeBus();
      persona.register({
        bus,
        stateDir: path.join(scratch, 'failure-state'),
        async pickDirectory() { throw new Error('picker failed'); },
      });
      await bus.handlers.get('personaWorkspaceChoose')();
      assert.deepEqual(bus.posts.map((post) => post.type), ['toast', 'personaWorkspaceStatus']);
      assert.match(bus.posts[0].payload.text, /picker failed/);
    });

    await gate('portable foundation default contains only shared rules', () => {
      assert.match(foundation.DEFAULT_FOUNDATION, /^# Shared Foundation/m);
      assert.match(foundation.DEFAULT_FOUNDATION, /user alone creates or permanently changes a persona/i);
      assert.match(foundation.DEFAULT_FOUNDATION, /provider and model binding outside persona identity/i);
      assert.match(foundation.DEFAULT_FOUNDATION, /structured evidence packets/i);
      assert.doesNotMatch(foundation.DEFAULT_FOUNDATION, /Mox|Jinx|Clio|Sable|Keith|Matt/);
    });

    await gate('foundation creation is explicit, no-clobber, and structural', () => {
      const workspace = path.join(scratch, 'foundation-create-workspace');
      fs.mkdirSync(workspace);
      const created = foundation.createFoundation(workspace, '# Shared\r\n\r\nRule');
      assert.equal(created.exists, true);
      assert.equal(created.content, '# Shared\n\nRule\n');
      assert.equal(created.revision, foundation.revisionOf(created.content));
      assert.equal(fs.statSync(path.join(workspace, 'personas')).isDirectory(), true);
      assert.throws(
        () => foundation.createFoundation(workspace, '# Replacement\n'),
        /will not overwrite/
      );
      assert.equal(fs.readFileSync(path.join(workspace, 'foundation.md'), 'utf8'), created.content);
    });

    await gate('invalid foundation content has no workspace side effects', () => {
      const workspace = path.join(scratch, 'foundation-invalid-workspace');
      fs.mkdirSync(workspace);
      assert.throws(() => foundation.createFoundation(workspace, '   '), /cannot be empty/);
      assert.equal(fs.existsSync(path.join(workspace, 'foundation.md')), false);
      assert.equal(fs.existsSync(path.join(workspace, 'personas')), false);
    });

    await gate('foundation save rejects stale revisions without losing either edit', () => {
      const workspace = path.join(scratch, 'foundation-conflict-workspace');
      fs.mkdirSync(workspace);
      const created = foundation.createFoundation(workspace, '# Original\n');
      fs.writeFileSync(path.join(workspace, 'foundation.md'), '# Outside edit\n');
      assert.throws(
        () => foundation.saveFoundation(workspace, '# Builder edit\n', created.revision),
        /changed since it was loaded/
      );
      assert.equal(fs.readFileSync(path.join(workspace, 'foundation.md'), 'utf8'), '# Outside edit\n');
      const refreshed = foundation.inspectFoundation(workspace);
      const saved = foundation.saveFoundation(workspace, '# Accepted edit', refreshed.revision);
      assert.equal(saved.content, '# Accepted edit\n');
      assert.deepEqual(fs.readdirSync(workspace).sort(), ['foundation.md', 'personas']);
    });

    await gate('foundation creation rejects a linked personas directory', () => {
      const workspace = path.join(scratch, 'foundation-link-workspace');
      const outside = path.join(scratch, 'foundation-link-outside');
      fs.mkdirSync(workspace);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(workspace, 'personas'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(
        () => foundation.createFoundation(workspace, '# Shared\n'),
        /symbolic link/
      );
      assert.equal(fs.existsSync(path.join(workspace, 'foundation.md')), false);
    });

    await gate('foundation bus create publishes result and refreshed state', () => {
      const bus = fakeBus();
      const stateDir = path.join(scratch, 'foundation-bus-state');
      const workspace = path.join(scratch, 'foundation-bus-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      persona.register({ bus, stateDir, async pickDirectory() { return null; } });
      bus.handlers.get('personaFoundationCreate')({ content: foundation.DEFAULT_FOUNDATION });
      assert.deepEqual(
        bus.posts.map((post) => post.type),
        ['personaFoundationResult', 'personaFoundationStatus', 'personaWorkspaceStatus']
      );
      assert.deepEqual(bus.posts[0].payload, { ok: true, action: 'created' });
      assert.equal(bus.posts[1].payload.exists, true);
      assert.equal(bus.posts[2].payload.foundationReady, true);
    });

    await gate('foundation bus conflict reports failure without replacing editor state', () => {
      const bus = fakeBus();
      const stateDir = path.join(scratch, 'foundation-conflict-state');
      const workspace = path.join(scratch, 'foundation-conflict-bus-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      const created = foundation.createFoundation(workspace, '# Original\n');
      fs.writeFileSync(path.join(workspace, 'foundation.md'), '# Outside\n');
      persona.register({ bus, stateDir, async pickDirectory() { return null; } });
      bus.handlers.get('personaFoundationSave')({
        content: '# Builder\n',
        expectedRevision: created.revision,
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaFoundationResult', 'toast']);
      assert.equal(bus.posts[0].payload.ok, false);
      assert.equal(bus.posts[0].payload.conflict, true);
      assert.match(bus.posts[0].payload.error, /changed since it was loaded/);
      assert.equal(fs.readFileSync(path.join(workspace, 'foundation.md'), 'utf8'), '# Outside\n');
    });

    await gate('six interview cards explain expected answers in depth', () => {
      assert.deepEqual(CARDS.map((card) => card.key), KEYS);
      assert.equal(CARDS.length, 6);
      for (const card of CARDS) {
        assert.ok(card.question.length > 30, card.key + ' question is too thin');
        assert.ok(card.explanation.length > 220, card.key + ' explanation is too thin');
        assert.ok(card.include.length >= 4, card.key + ' coverage is too thin');
        assert.ok(card.suggestions.length >= 4, card.key + ' suggestions are too thin');
        assert.ok(card.example.length > 300, card.key + ' example is too thin');
        assert.ok(card.help.length > 60, card.key + ' help is too thin');
      }
      assert.match(CARDS[0].explanation, /name field identifies the persona/i);
      assert.match(CARDS[5].explanation, /never grants a tool, credential, permission, or provider/i);
      assert.match(CARDS[5].explanation, /allowed, ask, or blocked/i);
      assert.doesNotMatch(JSON.stringify(CARDS), /Mox|Jinx|Clio|Sable|Keith|Matt/);
    });

    await gate('draft creation is atomic, complete, and runtime-local', () => {
      const stateDir = path.join(scratch, 'draft-create-state');
      const workspace = path.join(scratch, 'draft-create-workspace');
      fs.mkdirSync(stateDir);
      fs.mkdirSync(workspace);
      const draft = draftStore.createDraft(stateDir, workspace, {
        name: ' Rowan ',
        useCase: ' Review code independently. ',
      });
      assert.equal(draft.name, 'Rowan');
      assert.equal(draft.useCase, 'Review code independently.');
      assert.equal(draft.revision, 1);
      assert.equal(draft.currentCard, 0);
      assert.deepEqual(Object.keys(draft.answers), KEYS);
      assert.equal(Object.values(draft.answers).every((answer) => answer === ''), true);
      assert.deepEqual(fs.readdirSync(path.join(stateDir, 'drafts')), [draft.id + '.json']);
      assert.equal(fs.existsSync(path.join(workspace, 'drafts')), false);
      assert.throws(
        () => draftStore.createDraft(stateDir, workspace, { name: 'Bad\nName', useCase: 'Reject.' }),
        /single-line/
      );
    });

    await gate('draft updates are revision-gated and preserve prior data on conflict', () => {
      const stateDir = path.join(scratch, 'draft-update-state');
      const workspace = path.join(scratch, 'draft-update-workspace');
      fs.mkdirSync(stateDir);
      fs.mkdirSync(workspace);
      const created = draftStore.createDraft(stateDir, workspace, {
        name: 'Rowan',
        useCase: 'Review changes.',
      });
      const updated = draftStore.updateDraft(stateDir, created.id, created.revision, {
        currentCard: 1,
        answers: { identity: 'Evidence-first release engineer.' },
      });
      assert.equal(updated.revision, 2);
      assert.equal(updated.currentCard, 1);
      assert.equal(updated.answers.identity, 'Evidence-first release engineer.');
      assert.throws(
        () => draftStore.updateDraft(stateDir, created.id, 1, { currentCard: 2 }),
        /changed since it was loaded/
      );
      try { draftStore.updateDraft(stateDir, created.id, 1, { currentCard: 2 }); }
      catch (err) { assert.equal(err.code, 'DRAFT_CONFLICT'); }
      assert.deepEqual(draftStore.readDraft(stateDir, created.id), updated);
    });

    await gate('draft listing isolates workspaces and reports malformed files', () => {
      const stateDir = path.join(scratch, 'draft-list-state');
      const workspaceA = path.join(scratch, 'draft-list-a');
      const workspaceB = path.join(scratch, 'draft-list-b');
      fs.mkdirSync(stateDir);
      fs.mkdirSync(workspaceA);
      fs.mkdirSync(workspaceB);
      const draftA = draftStore.createDraft(stateDir, workspaceA, { name: 'A', useCase: 'Use A.' });
      draftStore.createDraft(stateDir, workspaceB, { name: 'B', useCase: 'Use B.' });
      fs.writeFileSync(path.join(stateDir, 'drafts', 'not-a-draft.json'), '{bad');
      const listed = draftStore.listDrafts(stateDir, workspaceA);
      assert.deepEqual(listed.drafts.map((draft) => draft.id), [draftA.id]);
      assert.equal(listed.warnings.length, 1);
      assert.match(listed.warnings[0], /Draft ID is invalid/);
    });

    await gate('linked draft stores are rejected before read or write', () => {
      const stateDir = path.join(scratch, 'draft-link-state');
      const outside = path.join(scratch, 'draft-link-outside');
      const workspace = path.join(scratch, 'draft-link-workspace');
      fs.mkdirSync(stateDir);
      fs.mkdirSync(outside);
      fs.mkdirSync(workspace);
      fs.symlinkSync(outside, path.join(stateDir, 'drafts'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(
        () => draftStore.createDraft(stateDir, workspace, { name: 'Link', useCase: 'Reject links.' }),
        /regular directory, not a link/
      );
      assert.deepEqual(fs.readdirSync(outside), []);
    });

    await gate('draft bus supports create, save, reopen, and confirmed delete', () => {
      const bus = fakeBus();
      const stateDir = path.join(scratch, 'draft-bus-state');
      const workspace = path.join(scratch, 'draft-bus-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      persona.register({ bus, stateDir, async pickDirectory() { return null; } });

      bus.handlers.get('personaDraftCreate')({ name: 'Rowan', useCase: 'Review releases.' });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaDraftResult', 'personaDraftStatus']);
      const created = bus.posts[1].payload.draft;
      assert.equal(bus.posts[1].payload.cards.length, 6);

      bus.posts.length = 0;
      bus.handlers.get('personaDraftSave')({
        id: created.id,
        expectedRevision: created.revision,
        changes: { currentCard: 1, answers: { identity: 'A careful reviewer.' } },
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaDraftResult', 'personaDraftStatus']);
      const saved = bus.posts[1].payload.draft;
      assert.equal(saved.answers.identity, 'A careful reviewer.');

      bus.posts.length = 0;
      bus.handlers.get('personaDraftOpen')({ id: created.id });
      assert.equal(bus.posts[0].payload.draft.revision, 2);

      bus.posts.length = 0;
      bus.handlers.get('personaDraftDelete')({ id: created.id, confirmed: false });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaDraftResult', 'toast']);
      assert.equal(fs.existsSync(draftStore.draftPath(stateDir, created.id)), true);

      bus.posts.length = 0;
      bus.handlers.get('personaDraftDelete')({ id: created.id, confirmed: true });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaDraftResult', 'personaDraftList']);
      assert.equal(fs.existsSync(draftStore.draftPath(stateDir, created.id)), false);
    });

    await gate('persona IDs normalize safely without preserving path syntax', () => {
      assert.equal(previewRenderer.normalizePersonaId(' Rowan Release Reviewer '), 'rowan-release-reviewer');
      assert.equal(previewRenderer.normalizePersonaId('../../Admin'), 'admin');
      assert.equal(previewRenderer.normalizePersonaId('42 Answers'), 'persona-42-answers');
      assert.equal(previewRenderer.normalizePersonaId('🔥'), 'persona');
      assert.equal(personaContract.isSafePersonaId(previewRenderer.normalizePersonaId('A'.repeat(100))), true);
    });

    await gate('blueprint and canonical render as a contract-valid package', () => {
      const workspace = path.join(scratch, 'preview-package-workspace');
      const draft = {
        name: 'Rowan "Release"',
        useCase: 'Review releases: independently and precisely.',
        answers: completeAnswers(),
      };
      const bundle = previewRenderer.renderBundle(draft, previewChoices('rowan-release'));
      assert.equal(bundle.blueprint.canonical_hash, personaContract.hashCanonical(bundle.canonical));
      assert.equal(bundle.canonicalDrift, false);
      assert.match(bundle.canonical, /<!-- persona-builder:identity:start -->/);
      const parsed = personaContract.parseFrontmatter(bundle.canonical);
      assert.equal(parsed.attributes.name, 'rowan-release');
      assert.equal(parsed.attributes.display_name, draft.name);

      const paths = personaContract.packagePaths(workspace, 'rowan-release');
      fs.mkdirSync(path.dirname(paths.memoryIndex), { recursive: true });
      fs.writeFileSync(paths.canonical, bundle.canonical);
      fs.writeFileSync(paths.blueprint, JSON.stringify(bundle.blueprint, null, 2));
      fs.writeFileSync(paths.memoryIndex, '# Memory\n');
      fs.writeFileSync(paths.scratchpad, '# Scratchpad\n');
      const report = personaContract.validatePersonaPackage(workspace, 'rowan-release');
      assert.equal(report.valid, true, JSON.stringify(report.errors));
      assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings));
    });

    await gate('preview generation refuses missing answers and action choices', () => {
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers() };
      draft.answers.boundaries = '';
      assert.throws(
        () => previewRenderer.renderBundle(draft, previewChoices()),
        /Complete the interview card: Persona-Specific Boundaries/
      );
      draft.answers.boundaries = 'Read-only review boundary.';
      const choices = previewChoices();
      choices.actions.delete_data = '';
      assert.throws(() => previewRenderer.renderBundle(draft, choices), /delete_data/);
    });

    await gate('manual canonical edits drift without false newline drift', () => {
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers() };
      const bundle = previewRenderer.renderBundle(draft, previewChoices());
      const noFinalNewline = previewRenderer.withCanonicalEdit(bundle, bundle.canonical.trimEnd());
      assert.equal(noFinalNewline.canonicalDrift, false);
      const edited = previewRenderer.withCanonicalEdit(bundle,
        bundle.canonical.replace('Complete answer for identity.', 'Manually refined identity.'));
      assert.equal(edited.canonicalDrift, true);
      assert.equal(edited.blueprint.canonical_hash, bundle.generatedCanonicalHash);
    });

    await gate('targeted regeneration preserves edits outside its marked section', () => {
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers() };
      const bundle = previewRenderer.renderBundle(draft, previewChoices());
      const manual = previewRenderer.withCanonicalEdit(bundle,
        bundle.canonical.replace('Complete answer for mission.', 'Manual mission stays.'));
      const identityEdited = previewRenderer.withCanonicalEdit(manual,
        manual.canonical.replace('Complete answer for identity.', 'Temporary identity edit.'));
      const regenerated = previewRenderer.regenerateSection(
        identityEdited,
        'identity',
        identityEdited.blueprint.identity.response
      );
      assert.match(regenerated.canonical, /Complete answer for identity\./);
      assert.match(regenerated.canonical, /Manual mission stays\./);
      assert.equal(regenerated.canonicalDrift, true);
      assert.throws(
        () => previewRenderer.regenerateSection(
          { ...bundle, canonical: bundle.canonical.replace('<!-- persona-builder:identity:start -->', '') },
          'identity',
          bundle.blueprint.identity.response
        ),
        /Section markers are missing/
      );
    });

    await gate('preview persists in a revisioned draft and rejects tampered drift state', () => {
      const stateDir = path.join(scratch, 'preview-draft-state');
      const workspace = path.join(scratch, 'preview-draft-workspace');
      fs.mkdirSync(stateDir);
      fs.mkdirSync(workspace);
      const created = draftStore.createDraft(stateDir, workspace, { name: 'Rowan', useCase: 'Review.' });
      const completed = draftStore.updateDraft(stateDir, created.id, created.revision,
        { answers: completeAnswers() });
      const bundle = previewRenderer.renderBundle(completed, previewChoices());
      const withPreview = draftStore.updateDraft(stateDir, created.id, completed.revision,
        { preview: bundle });
      assert.equal(withPreview.preview.canonicalDrift, false);
      const manual = previewRenderer.withCanonicalEdit(withPreview.preview,
        withPreview.preview.canonical.replace('# Rowan', '# Rowan — reviewed'));
      const saved = draftStore.updateDraft(stateDir, created.id, withPreview.revision,
        { preview: manual });
      assert.equal(saved.preview.canonicalDrift, true);

      const file = draftStore.draftPath(stateDir, created.id);
      const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
      tampered.preview.canonicalDrift = false;
      fs.writeFileSync(file, JSON.stringify(tampered));
      assert.throws(() => draftStore.readDraft(stateDir, created.id), /drift state is invalid/);
    });

    await gate('preview bus requires confirmation before replacing manual edits', () => {
      const bus = fakeBus();
      const stateDir = path.join(scratch, 'preview-bus-state');
      const workspace = path.join(scratch, 'preview-bus-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      let draft = draftStore.createDraft(stateDir, workspace, { name: 'Rowan', useCase: 'Review.' });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, { answers: completeAnswers() });
      persona.register({ bus, stateDir, async pickDirectory() { return null; } });

      bus.handlers.get('personaPreviewGenerate')({
        id: draft.id,
        expectedRevision: draft.revision,
        ...previewChoices(),
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaPreviewResult', 'personaPreviewStatus']);
      draft = bus.posts[1].payload.draft;

      bus.posts.length = 0;
      bus.handlers.get('personaPreviewSaveCanonical')({
        id: draft.id,
        expectedRevision: draft.revision,
        canonical: draft.preview.canonical.replace('# Rowan', '# Rowan edited'),
      });
      draft = bus.posts[1].payload.draft;
      assert.equal(draft.preview.canonicalDrift, true);

      bus.posts.length = 0;
      bus.handlers.get('personaPreviewGenerate')({
        id: draft.id,
        expectedRevision: draft.revision,
        ...previewChoices(),
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaPreviewResult']);
      assert.equal(bus.posts[0].payload.needsConfirmation, true);

      bus.posts.length = 0;
      bus.handlers.get('personaPreviewGenerate')({
        id: draft.id,
        expectedRevision: draft.revision,
        ...previewChoices(),
        confirmedOverwrite: true,
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaPreviewResult', 'personaPreviewStatus']);
      assert.equal(bus.posts[1].payload.bundle.canonicalDrift, false);
    });

    await gate('enabled collaboration renders a contract-valid optional module', () => {
      const workspace = path.join(scratch, 'collaboration-package-workspace');
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers() };
      const choices = { ...previewChoices(), collaboration: collaborationChoices() };
      const bundle = previewRenderer.renderBundle(draft, choices);
      assert.deepEqual(personaContract.parseFrontmatter(bundle.canonical).attributes.modules,
        ['collaboration']);
      assert.equal(bundle.collaboration.default_access, 'read-only');

      const paths = personaContract.packagePaths(workspace, 'rowan');
      fs.mkdirSync(path.dirname(paths.memoryIndex), { recursive: true });
      fs.writeFileSync(paths.canonical, bundle.canonical);
      fs.writeFileSync(paths.blueprint, JSON.stringify(bundle.blueprint));
      fs.writeFileSync(paths.collaboration, JSON.stringify(bundle.collaboration));
      fs.writeFileSync(paths.memoryIndex, '# Memory\n');
      fs.writeFileSync(paths.scratchpad, '# Scratchpad\n');
      const report = personaContract.validatePersonaPackage(workspace, 'rowan');
      assert.equal(report.valid, true, JSON.stringify(report.errors));
      assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings));
    });

    await gate('collaboration choices require complete fields and deduplicate lines', () => {
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers() };
      const incomplete = { ...previewChoices(), collaboration: collaborationChoices() };
      incomplete.collaboration.accepts = [];
      assert.throws(() => previewRenderer.renderBundle(draft, incomplete), /accepts/);
      const oversized = { ...previewChoices(), collaboration: collaborationChoices() };
      oversized.collaboration.emits = ['x'.repeat(241)];
      assert.throws(() => previewRenderer.renderBundle(draft, oversized), /limited to 100 items/);
      const duplicate = { ...previewChoices(), collaboration: collaborationChoices('read-write') };
      duplicate.collaboration.capabilities = ['review code', 'review code', ' run checks '];
      const bundle = previewRenderer.renderBundle(draft, duplicate);
      assert.deepEqual(bundle.collaboration.capabilities, ['review code', 'run checks']);
      assert.equal(bundle.collaboration.default_access, 'read-write');
    });

    await gate('read-only collaboration conflict is visible to Contract v1', () => {
      const workspace = path.join(scratch, 'collaboration-conflict-workspace');
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers() };
      const choices = { ...previewChoices(), collaboration: collaborationChoices() };
      choices.actions.edit_files = 'allowed';
      const bundle = previewRenderer.renderBundle(draft, choices);
      const paths = personaContract.packagePaths(workspace, 'rowan');
      fs.mkdirSync(path.dirname(paths.memoryIndex), { recursive: true });
      fs.writeFileSync(paths.canonical, bundle.canonical);
      fs.writeFileSync(paths.blueprint, JSON.stringify(bundle.blueprint));
      fs.writeFileSync(paths.collaboration, JSON.stringify(bundle.collaboration));
      fs.writeFileSync(paths.memoryIndex, '# Memory\n');
      fs.writeFileSync(paths.scratchpad, '# Scratchpad\n');
      const report = personaContract.validatePersonaPackage(workspace, 'rowan');
      assert.equal(report.valid, true);
      assert.equal(report.warnings.some((finding) => finding.code === 'access-conflict'), true);
      assert.throws(
        () => draftStore.validatePreview({ ...bundle, collaboration: null }),
        /does not match canonical modules/
      );
      const scalarModules = previewRenderer.withCanonicalEdit(
        previewRenderer.renderBundle(draft, previewChoices()),
        previewRenderer.renderBundle(draft, previewChoices()).canonical
          .replace('modules: []', 'modules: collaboration')
      );
      assert.throws(
        () => draftStore.validatePreview(scalarModules),
        /canonical modules must be a list/
      );
    });

    await gate('oversized collaboration preview cannot create an unreadable draft', () => {
      const stateDir = path.join(scratch, 'collaboration-size-state');
      const workspace = path.join(scratch, 'collaboration-size-workspace');
      fs.mkdirSync(stateDir);
      fs.mkdirSync(workspace);
      let draft = draftStore.createDraft(stateDir, workspace, { name: 'Rowan', useCase: 'Review.' });
      const largeAnswers = Object.fromEntries(KEYS.map((key) => [key, key + ':' + 'a'.repeat(11900)]));
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, { answers: largeAnswers });
      const collaboration = collaborationChoices();
      const largeItems = Array.from({ length: 100 }, (_, i) => String(i).padStart(3, '0') + 'x'.repeat(237));
      collaboration.capabilities = largeItems;
      collaboration.accepts = largeItems.map((item) => 'a' + item.slice(1));
      collaboration.emits = largeItems.map((item) => 'e' + item.slice(1));
      const bundle = previewRenderer.renderBundle(draft, {
        ...previewChoices(), collaboration,
      });
      assert.throws(
        () => draftStore.updateDraft(stateDir, draft.id, draft.revision, { preview: bundle }),
        /Draft exceeds the 256 KB limit/
      );
      const unchanged = draftStore.readDraft(stateDir, draft.id);
      assert.equal(unchanged.revision, draft.revision);
      assert.equal(unchanged.preview, null);
    });

    await gate('preview validator separates errors, warnings, and suggestions', () => {
      const workspace = path.join(scratch, 'validator-workspace');
      fs.mkdirSync(path.join(workspace, 'personas'), { recursive: true });
      const draft = {
        name: 'Rowan',
        useCase: 'Review.',
        answers: completeAnswers('Short'),
      };
      draft.preview = previewRenderer.renderBundle(draft, previewChoices());
      const report = previewValidator.validatePreview(workspace, draft, foundation.DEFAULT_FOUNDATION);
      assert.equal(report.valid, true);
      assert.equal(report.errors.length, 0);
      assert.equal(report.warnings.length, 0);
      assert.equal(report.suggestions.filter((finding) => finding.code === 'thin-area').length, 6);

      fs.mkdirSync(path.join(workspace, 'personas', 'rowan'));
      const collision = previewValidator.validatePreview(workspace, draft, foundation.DEFAULT_FOUNDATION);
      assert.equal(collision.valid, false);
      assert.equal(collision.errors.some((finding) => finding.code === 'persona-collision'), true);
    });

    await gate('manual canonical hash repair is explicit and clears only drift', () => {
      const workspace = path.join(scratch, 'validator-drift-workspace');
      fs.mkdirSync(workspace);
      const draft = { name: 'Rowan', useCase: 'Review.', answers: completeAnswers('Detailed '.repeat(20)) };
      const generated = previewRenderer.renderBundle(draft, previewChoices());
      draft.preview = previewRenderer.withCanonicalEdit(generated,
        generated.canonical.replace('# Rowan', '# Rowan — manually approved'));
      const drift = previewValidator.validatePreview(workspace, draft, '');
      const finding = drift.warnings.find((item) => item.code === 'canonical-drift');
      assert.equal(finding.repair, 'accept-canonical');
      const accepted = previewRenderer.acceptCanonical(draft.preview);
      assert.equal(accepted.canonicalDrift, false);
      assert.equal(accepted.blueprint.canonical_hash, personaContract.hashCanonical(accepted.canonical));
      draft.preview = accepted;
      assert.equal(previewValidator.validatePreview(workspace, draft, '').warnings
        .some((item) => item.code === 'canonical-drift'), false);
    });

    await gate('legacy import audit is read-only and proposes semantic mappings', () => {
      const source = path.join(scratch, 'Legacy Reviewer');
      fs.mkdirSync(source);
      const canonicalFile = path.join(source, 'legacy.md');
      const text = [
        '---',
        'name: legacy-reviewer',
        'display_name: Legacy Reviewer',
        'description: Reviews old systems.',
        'tier: specialist',
        '---',
        '# Legacy Reviewer',
        '## Who I Am',
        'A careful historical reviewer.',
        '## Mission and Scope',
        'Review old systems.',
        '## Unusual Rituals',
        'Preserve this role-specific section.',
      ].join('\n');
      fs.writeFileSync(canonicalFile, text);
      const before = fs.readFileSync(canonicalFile, 'utf8');
      const audit = importer.auditImportFolder(source);
      assert.equal(audit.errors.length, 0);
      assert.deepEqual(audit.sections.map((section) => section.suggestedKey),
        ['identity', 'mission', null]);
      const answers = importer.answersFromMapping(audit, { 0: 'identity', 1: 'mission', 2: 'working_method' });
      assert.match(answers.identity, /Who I Am/);
      assert.match(answers.working_method, /Unusual Rituals/);
      const preamble = importer.splitSections('# Preamble Persona\n\nKeep this unheaded context.\n\n## Identity\nKnown identity.');
      assert.deepEqual(preamble.map((section) => section.heading), ['Preamble', 'Identity']);
      assert.match(preamble[0].content, /Keep this unheaded context/);
      assert.throws(() => importer.answersFromMapping({
        sections: [{ index: 0, heading: 'Huge', content: 'x'.repeat(12001) }],
      }, { 0: 'identity' }), /12,000 character limit/);
      assert.equal(fs.readFileSync(canonicalFile, 'utf8'), before);
    });

    await gate('legacy import blocks explicit unsupported schema and linked sources', () => {
      const source = path.join(scratch, 'unsupported-import');
      const outside = path.join(scratch, 'unsupported-outside');
      fs.mkdirSync(source);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(source, 'unsupported-import.md'),
        '---\nschema_version: 9\nname: old\n---\n# Old\n\nBody\n');
      const audit = importer.auditImportFolder(source);
      assert.equal(audit.errors.some((finding) => finding.code === 'schema-version'), true);
      const linked = path.join(scratch, 'linked-import');
      fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => importer.auditImportFolder(linked), /regular directory, not a link/);
    });

    await gate('import bus creates only a mapped runtime draft', async () => {
      const stateDir = path.join(scratch, 'import-bus-state');
      const workspace = path.join(scratch, 'import-bus-workspace');
      const source = path.join(scratch, 'import-bus-source');
      fs.mkdirSync(workspace);
      fs.mkdirSync(source);
      const sourceFile = path.join(source, 'import-bus-source.md');
      const sourceText = '---\nname: old\ndisplay_name: Old Guide\ndescription: Guides old work.\n---\n# Old\n## Identity\nPatient guide.\n## Role\nGuide work.\n';
      fs.writeFileSync(sourceFile, sourceText);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      const bus = fakeBus();
      persona.register({ bus, stateDir, async pickDirectory() { return source; } });
      await bus.handlers.get('personaImportChoose')();
      assert.equal(bus.posts[0].type, 'personaImportAudit');
      const audit = bus.posts[0].payload;
      bus.posts.length = 0;
      bus.handlers.get('personaImportCreateDraft')({
        sourceFolder: source,
        name: audit.displayName,
        useCase: audit.description,
        mapping: { 0: 'identity', 1: 'mission' },
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaImportResult', 'personaDraftStatus']);
      assert.match(bus.posts[1].payload.draft.answers.identity, /Patient guide/);
      assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceText);
      assert.equal(fs.existsSync(path.join(workspace, 'old-guide')), false);
      bus.posts.length = 0;
      bus.handlers.get('personaImportCreateDraft')({
        sourceFolder: source,
        name: audit.displayName,
        useCase: audit.description,
        mapping: { 0: 'identity', 1: 'mission' },
      });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaImportResult', 'toast']);
      assert.equal(bus.posts[0].payload.ok, false);

      const largeState = path.join(scratch, 'large-import-state');
      const largeWorkspace = path.join(scratch, 'large-import-workspace');
      const largeSource = path.join(scratch, 'large-import-source');
      fs.mkdirSync(largeWorkspace);
      fs.mkdirSync(largeSource);
      const largeSections = KEYS.map((key) => `## ${key}\n${'\u0001'.repeat(11900)}`).join('\n');
      fs.writeFileSync(path.join(largeSource, 'large-import-source.md'),
        `---\nname: large\ndisplay_name: Large Import\ndescription: Tests cleanup.\n---\n# Large\n${largeSections}`);
      persona.writeWorkspaceConfig(largeState, largeWorkspace);
      foundation.createFoundation(largeWorkspace, foundation.DEFAULT_FOUNDATION);
      const largeBus = fakeBus();
      persona.register({ bus: largeBus, stateDir: largeState, async pickDirectory() { return largeSource; } });
      await largeBus.handlers.get('personaImportChoose')();
      largeBus.posts.length = 0;
      largeBus.handlers.get('personaImportCreateDraft')({
        sourceFolder: largeSource,
        name: 'Large Import',
        useCase: 'Tests cleanup.',
        mapping: Object.fromEntries(KEYS.map((key, index) => [String(index), key])),
      });
      assert.equal(largeBus.posts[0].payload.ok, false);
      assert.match(largeBus.posts[0].payload.error, /256 KB limit/);
      assert.equal(draftStore.listDrafts(largeState, largeWorkspace).drafts.length, 0);
      largeBus.posts.length = 0;
      largeBus.handlers.get('personaImportCreateDraft')({
        sourceFolder: largeSource,
        name: 'Large Import',
        useCase: 'Tests retained audit.',
        mapping: { 0: 'identity' },
      });
      assert.equal(largeBus.posts[0].payload.ok, true);
      assert.equal(draftStore.listDrafts(largeState, largeWorkspace).drafts.length, 1);
    });

    await gate('validation bus reports drift and explicit acceptance persists it', () => {
      const stateDir = path.join(scratch, 'validation-bus-state');
      const workspace = path.join(scratch, 'validation-bus-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      let draft = draftStore.createDraft(stateDir, workspace, { name: 'Rowan', useCase: 'Review.' });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, { answers: completeAnswers('Detailed '.repeat(20)) });
      let bundle = previewRenderer.renderBundle(draft, previewChoices());
      bundle = previewRenderer.withCanonicalEdit(bundle, bundle.canonical.replace('# Rowan', '# Rowan edited'));
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, { preview: bundle });
      const bus = fakeBus();
      persona.register({ bus, stateDir, async pickDirectory() { return null; } });
      bus.handlers.get('personaPreviewValidate')({ id: draft.id });
      assert.equal(bus.posts[0].type, 'personaValidationStatus');
      assert.equal(bus.posts[0].payload.report.warnings.some((finding) => finding.repair), true);
      bus.posts.length = 0;
      bus.handlers.get('personaPreviewAcceptCanonical')({ id: draft.id, expectedRevision: draft.revision });
      assert.deepEqual(bus.posts.map((post) => post.type), ['personaPreviewResult', 'personaPreviewStatus']);
      assert.equal(bus.posts[1].payload.bundle.canonicalDrift, false);
      const acceptedDraft = bus.posts[1].payload.draft;
      bus.posts.length = 0;
      bus.handlers.get('personaPreviewGenerate')({
        id: acceptedDraft.id,
        expectedRevision: acceptedDraft.revision,
        ...previewChoices(),
      });
      assert.equal(bus.posts[0].type, 'personaPreviewResult');
      assert.equal(bus.posts[0].payload.needsConfirmation, true);
    });

    await gate('disposable test packet derives expectations from the approved persona', () => {
      const draft = {
        name: 'Rowan',
        useCase: 'Review releases independently.',
        answers: completeAnswers('Persona-specific evidence '.repeat(12)),
      };
      draft.preview = previewRenderer.renderBundle(draft, {
        ...previewChoices(),
        actions: { ...previewChoices().actions, read_files: 'allowed' },
        collaboration: collaborationChoices(),
      });
      const cases = tester.buildCases(draft);
      assert.equal(cases.length, 7);
      assert.deepEqual(cases.map((item) => item.id), [
        'introduction', 'normal-work', 'disagreement', 'uncertainty',
        'action-gate', 'routine-action', 'handoff',
      ]);
      assert.match(cases.find((item) => item.id === 'action-gate').expected, /approved decision/);
      assert.match(cases.find((item) => item.id === 'handoff').expected, /review packet/);
      assert.match(cases.find((item) => item.id === 'normal-work').expected,
        /Persona-specific evidence/);
      const kickoff = tester.buildKickoff(draft, foundation.DEFAULT_FOUNDATION);
      assert.match(kickoff, /session only/);
      assert.match(kickoff, /Do not use tools/);
      assert.match(kickoff, /TEST-SEAT-READY/);
      assert.match(kickoff, /# Rowan/);
    });

    await gate('test bus checks usage, requires approval, and completes without registration', () => {
      const stateDir = path.join(scratch, 'test-seat-state');
      const workspace = path.join(scratch, 'test-seat-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      let draft = draftStore.createDraft(stateDir, workspace, {
        name: 'Rowan', useCase: 'Review releases independently.',
      });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, {
        answers: completeAnswers('Persona test evidence '.repeat(12)),
      });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, {
        preview: previewRenderer.renderBundle(draft, {
          ...previewChoices(),
          actions: { ...previewChoices().actions, read_files: 'allowed' },
          collaboration: collaborationChoices(),
        }),
      });
      const bus = fakeBus();
      let disposable;
      const controllers = [];
      persona.register({
        bus,
        stateDir,
        async pickDirectory() { return null; },
        usage: { claudeSnapshot() {
          return { session: { pct: 10 }, weekly: { pct: 35 }, stale: false, asOf: Date.now() };
        } },
        seats: { startDisposable(options) {
          disposable = options;
          const controller = {
            sent: [], closed: false,
            send(text) { this.sent.push(text); },
            close() { this.closed = true; },
          };
          controllers.push(controller);
          return controller;
        } },
      });
      bus.handlers.get('personaTestPrepare')({ id: draft.id });
      assert.equal(bus.posts[0].type, 'personaTestPrepared');
      assert.equal(bus.posts[0].payload.requiresApproval, true);
      assert.equal(bus.posts[0].payload.usage.session.pct, 10);
      const prepared = bus.posts[0].payload;
      bus.posts.length = 0;
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      assert.match(disposable.kickoff, /TEST-SEAT-READY/);
      assert.equal(disposable.cwd, undefined);
      assert.equal(bus.posts[0].payload.phase, 'starting');
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      assert.equal(bus.posts.at(-1).payload.phase, 'rejected');
      assert.equal(controllers[0].closed, false);
      disposable.onEvent({ type: 'init', tools: [] });
      disposable.onEvent({ type: 'text', text: 'TEST-SEAT-READY' });
      disposable.onEvent({ type: 'result', ok: true });
      assert.equal(controllers[0].sent[0], prepared.cases[0].prompt);
      for (let index = 0; index < prepared.cases.length; index++) {
        disposable.onEvent({ type: 'text', text: 'Observed response ' + index });
        disposable.onEvent({ type: 'result', ok: true });
      }
      assert.equal(controllers[0].closed, true);
      assert.equal(bus.posts.filter((post) => post.type === 'personaTestCaseResult').length,
        prepared.cases.length);
      assert.equal(bus.posts.at(-1).payload.phase, 'complete');
      assert.equal(fs.existsSync(path.join(workspace, 'personas', 'rowan')), false);

      bus.posts.length = 0;
      bus.handlers.get('personaTestPrepare')({ id: draft.id });
      const originalNow = Date.now;
      const preparedAt = originalNow();
      Date.now = () => preparedAt + 6 * 60 * 1000;
      try {
        bus.handlers.get('personaTestStart')({
          id: draft.id, expectedRevision: draft.revision, approved: true,
        });
      } finally { Date.now = originalNow; }
      assert.equal(bus.posts.at(-1).payload.phase, 'rejected');
      assert.match(bus.posts.at(-1).payload.error, /usage check expired/);
      assert.equal(controllers.length, 1);

      bus.posts.length = 0;
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      disposable.onEvent({ type: 'tool', name: 'Read' });
      assert.equal(controllers[1].closed, true);
      assert.equal(bus.posts.at(-1).payload.phase, 'error');

      bus.posts.length = 0;
      bus.handlers.get('personaTestPrepare')({ id: draft.id });
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      bus.handlers.get('personaTestStop')({});
      assert.equal(controllers[2].closed, true);
      assert.equal(bus.posts.at(-1).payload.phase, 'stopped');

      bus.handlers.get('personaTestPrepare')({ id: draft.id });
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      disposable.onEvent({ type: 'permission', tool: 'Read' });
      assert.equal(controllers[3].closed, true);
      assert.equal(bus.posts.at(-1).payload.phase, 'error');

      bus.handlers.get('personaTestPrepare')({ id: draft.id });
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      disposable.onEvent({ type: 'dead', code: 1 });
      assert.equal(controllers[4].closed, true);
      assert.equal(bus.posts.at(-1).payload.phase, 'error');

      bus.handlers.get('personaTestPrepare')({ id: draft.id });
      bus.handlers.get('personaTestStart')({
        id: draft.id, expectedRevision: draft.revision, approved: true,
      });
      disposable.onEvent({ type: 'init', tools: ['Read'] });
      assert.equal(controllers[5].closed, true);
      assert.match(bus.posts.at(-1).payload.error, /empty tool list/);
    });

    await gate('hidden disposable host stays out of roster and persistent history', () => {
      const claudePath = require.resolve('../main/engine/claudeSeat');
      const hostPath = require.resolve('../main/engine/seatHost');
      const actualClaude = require(claudePath);
      const disposableArgs = actualClaude.buildArgs({
        noSessionPersistence: true, tools: '', permissionMode: 'manual',
      });
      const toolsIndex = disposableArgs.indexOf('--tools');
      assert.notEqual(toolsIndex, -1);
      assert.equal(disposableArgs[toolsIndex + 1], '');
      // Apex keeps `manual` internally; claudeSeat translates it to the CLI's
      // accepted spelling at the process boundary.
      assert.deepEqual(disposableArgs.slice(-2), ['--permission-mode', 'default']);
      // The shell:true fallback quotes at spawn time: EVERY arg goes through
      // quoteForCmd, so the empty --tools value and the multi-word system
      // brief both survive the cmd.exe join.
      assert.equal(actualClaude.quoteForCmd(''), '""');
      assert.equal(actualClaude.quoteForCmd('plain'), 'plain');
      assert.equal(actualClaude.quoteForCmd('two words'), '"two words"');
      assert.equal(actualClaude.quoteForCmd('say "hi"'), '"say \\"hi\\""');
      assert.equal(actualClaude.quoteForCmd('dir\\ trailing\\'), '"dir\\ trailing\\\\"');
      // the brief has no backslashes, so quoting it = escape its quotes + wrap
      assert.equal(
        actualClaude.quoteForCmd(actualClaude.SEAT_ENV_BRIEF),
        '"' + actualClaude.SEAT_ENV_BRIEF.replace(/"/g, '\\"') + '"');
      const resolvedClaude = actualClaude.resolveClaudeLaunch();
      if (process.platform === 'win32' && resolvedClaude.command.toLowerCase().endsWith('.exe'))
        assert.equal(resolvedClaude.shell, false);
      let launch;
      const fakeSeat = {
        sent: [], disposed: false,
        send(text) { this.sent.push(text); },
        interrupt() {},
        dispose() { this.disposed = true; },
      };
      require.cache[claudePath].exports = {
        ...actualClaude,
        startSeat(options) { launch = options; return fakeSeat; },
      };
      delete require.cache[hostPath];
      try {
        const { createSeatHost } = require(hostPath);
        const emitted = [];
        const recorded = [];
        const observed = [];
        const host = createSeatHost({
          apexRoot: scratch,
          emit(message) { emitted.push(message); },
          log() {},
          record(...args) { recorded.push(args); },
        });
        const disposableSeat = host.createDisposable({
          kickoff: 'temporary kickoff',
          onEvent(message) { observed.push(message); },
        });
        assert.equal(launch.noSessionPersistence, true);
        assert.equal(launch.tools, '');
        assert.equal(launch.permissionMode, 'manual');
        assert.equal(path.dirname(launch.cwd), os.tmpdir());
        assert.match(path.basename(launch.cwd), /^apex-disposable-/);
        assert.equal(fs.existsSync(launch.cwd), true);
        assert.deepEqual(host.list(), []);
        assert.deepEqual(emitted, []);
        assert.deepEqual(recorded, []);
        assert.deepEqual(fakeSeat.sent, ['temporary kickoff']);
        launch.onEvent({ type: 'system', subtype: 'init', session_id: 'ephemeral', model: 'test', tools: [] });
        assert.deepEqual(observed[0].tools, []);
        launch.onEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'observed' }] } });
        assert.equal(observed[1].text, 'observed');
        disposableSeat.close();
        assert.equal(fakeSeat.disposed, true);
        launch.onExit(0);
        assert.equal(fs.existsSync(launch.cwd), false);
      } finally {
        require.cache[claudePath].exports = actualClaude;
        delete require.cache[hostPath];
      }
    });

    await gate('permanent package creation is atomic, complete, and preset-ready', () => {
      const workspace = path.join(scratch, 'creator-workspace');
      fs.mkdirSync(workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      const draft = {
        name: 'Rowan',
        useCase: 'Review releases independently.',
        answers: completeAnswers('Permanent persona evidence '.repeat(12)),
      };
      draft.preview = previewRenderer.renderBundle(draft, {
        ...previewChoices(), collaboration: collaborationChoices(),
      });
      const created = creator.createPackage(workspace, draft);
      assert.equal(created.personaId, 'rowan');
      assert.equal(created.report.valid, true);
      assert.equal(personaContract.validatePersonaPackage(workspace, 'rowan').valid, true);
      assert.deepEqual(fs.readdirSync(created.paths.personaDir).sort(),
        ['blueprint.json', 'collaboration.json', 'memory', 'rowan.md', 'scratchpad.md']);
      assert.match(fs.readFileSync(created.paths.memoryIndex, 'utf8'), /No durable memories/);
      assert.match(fs.readFileSync(created.paths.scratchpad, 'utf8'), /Rowan Scratchpad/);
      assert.equal(fs.readdirSync(path.join(workspace, 'personas'))
        .some((name) => name.includes('.creating-')), false);
      const presets = creator.listPresets(workspace);
      assert.equal(presets.length, 1);
      assert.equal(presets[0].name, 'Rowan');
      assert.equal(presets[0].cwd, workspace);
      assert.match(presets[0].kickoff, /foundation\.md/);
      assert.match(presets[0].kickoff, /personas\/rowan\/rowan\.md/);
      assert.match(presets[0].kickoff, /runtime settings, not the persona package/);
    });

    await gate('permanent creation never overwrites and rolls back invalid output', () => {
      const workspace = path.join(scratch, 'creator-safety-workspace');
      fs.mkdirSync(workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      const personasDir = path.join(workspace, 'personas');
      const existingDir = path.join(personasDir, 'rowan');
      fs.mkdirSync(existingDir);
      fs.writeFileSync(path.join(existingDir, 'sentinel.txt'), 'keep');
      const existingDraft = {
        name: 'Rowan', useCase: 'Review.',
        answers: completeAnswers('Existing package evidence '.repeat(12)),
      };
      existingDraft.preview = previewRenderer.renderBundle(existingDraft, previewChoices());
      assert.throws(() => creator.createPackage(workspace, existingDraft), /already exists/);
      assert.equal(fs.readFileSync(path.join(existingDir, 'sentinel.txt'), 'utf8'), 'keep');
      fs.mkdirSync(path.join(personasDir, '.abandoned-stage'));
      assert.deepEqual(creator.listPresets(workspace), []);

      const reservedDraft = {
        name: 'Seat', useCase: 'Collide with the built-in seat.',
        answers: completeAnswers('Reserved name evidence '.repeat(12)),
      };
      reservedDraft.preview = previewRenderer.renderBundle(reservedDraft, previewChoices('reserved-seat'));
      assert.throws(() => creator.createPackage(workspace, reservedDraft), /reserved by Apex/);
      assert.equal(fs.existsSync(path.join(personasDir, 'reserved-seat')), false);

      const renamedCanonicalDraft = {
        name: 'Mirror', useCase: 'Test canonical identity invariants.',
        answers: completeAnswers('Canonical name evidence '.repeat(12)),
      };
      renamedCanonicalDraft.preview = previewRenderer.renderBundle(
        renamedCanonicalDraft, previewChoices('mirror'));
      renamedCanonicalDraft.preview.canonical = renamedCanonicalDraft.preview.canonical
        .replace('display_name: "Mirror"', 'display_name: "External Reviewer"');
      renamedCanonicalDraft.preview.generatedCanonicalHash = personaContract.hashCanonical(
        renamedCanonicalDraft.preview.canonical);
      renamedCanonicalDraft.preview.blueprint.canonical_hash =
        renamedCanonicalDraft.preview.generatedCanonicalHash;
      assert.throws(() => creator.createPackage(workspace, renamedCanonicalDraft),
        /display_name must exactly match/);
      assert.equal(fs.existsSync(path.join(personasDir, 'mirror')), false);

      const invalidDraft = {
        name: 'Ember', useCase: 'Audit.',
        answers: completeAnswers('Rollback evidence '.repeat(12)),
      };
      invalidDraft.preview = previewRenderer.renderBundle(invalidDraft, {
        ...previewChoices('ember'), collaboration: collaborationChoices(),
      });
      invalidDraft.preview.collaboration.default_access = 'invalid';
      const foreignLock = path.join(personasDir, '.ember.create.lock');
      fs.writeFileSync(foreignLock, 'other creator');
      assert.throws(() => creator.createPackage(workspace, invalidDraft), /already in progress/);
      assert.equal(fs.readFileSync(foreignLock, 'utf8'), 'other creator');
      fs.unlinkSync(foreignLock);
      assert.throws(() => creator.createPackage(workspace, invalidDraft), /failed validation/);
      assert.equal(fs.existsSync(path.join(personasDir, 'ember')), false);
      assert.equal(fs.readdirSync(personasDir).some((name) => name.includes('.creating-')), false);
    });

    await gate('seat preset groups keep valid personas when one name conflicts', () => {
      const seats = seatRuntime.extensionApi;
      seats.registerPreset({ name: 'External Reviewer', kickoff: 'foreign' });
      assert.deepEqual(seats.checkPresetNames('persona-builder', ['Seat', 'External Reviewer']), [
        { name: 'Seat', reason: 'reserved by Apex' },
        { name: 'External Reviewer', reason: 'owned by another extension' },
      ]);
      const report = seats.replacePresetGroup('persona-builder', [
        { name: 'Rowan', kickoff: 'rowan' },
        { name: 'External Reviewer', kickoff: 'collision' },
        { name: 'Ember', kickoff: 'ember' },
      ]);
      assert.deepEqual(report.registered, ['Rowan', 'Ember']);
      assert.deepEqual(report.skipped, [
        { name: 'External Reviewer', reason: 'owned by another extension' },
      ]);
      assert.deepEqual(seats.checkPresetNames('another-extension', ['Rowan', 'Ember']), [
        { name: 'Rowan', reason: 'owned by another extension' },
        { name: 'Ember', reason: 'owned by another extension' },
      ]);
      seats.replacePresetGroup('persona-builder', []);
    });

    await gate('permanent creation requires the exact tested draft and refreshes presets', () => {
      const stateDir = path.join(scratch, 'permanent-bus-state');
      const workspace = path.join(scratch, 'permanent-bus-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      let draft = draftStore.createDraft(stateDir, workspace, {
        name: 'Rowan', useCase: 'Review releases independently.',
      });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, {
        answers: completeAnswers('Permanent bus evidence '.repeat(12)),
      });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, {
        preview: previewRenderer.renderBundle(draft, previewChoices()),
      });
      const bus = fakeBus();
      let disposable;
      const controller = { sent: [], send(text) { this.sent.push(text); }, close() {} };
      const presetGroups = [];
      persona.register({
        bus, stateDir, async pickDirectory() { return null; },
        usage: { claudeSnapshot() { return { stale: false, asOf: Date.now() }; } },
        seats: {
          startDisposable(options) { disposable = options; return controller; },
          checkPresetNames() { return []; },
          replacePresetGroup(owner, presets) {
            presetGroups.push({ owner, presets });
            return { registered: presets.map((preset) => preset.name), skipped: [] };
          },
        },
      });
      bus.posts.length = 0;
      bus.handlers.get('personaCreatePermanent')({
        id: draft.id, expectedRevision: draft.revision, confirmed: true,
      });
      assert.equal(bus.posts[0].payload.ok, false);
      assert.match(bus.posts[0].payload.error, /Complete the disposable test/);

      completeDisposableTest(bus, draft, () => disposable);
      bus.posts.length = 0;
      bus.handlers.get('personaCreatePermanent')({
        id: draft.id, expectedRevision: draft.revision, confirmed: true,
      });
      assert.equal(bus.posts[0].type, 'personaCreateResult');
      assert.equal(bus.posts[0].payload.ok, true);
      assert.equal(bus.posts[0].payload.personaId, 'rowan');
      assert.equal(personaContract.validatePersonaPackage(workspace, 'rowan').valid, true);
      assert.equal(presetGroups.at(-1).owner, 'persona-builder');
      assert.deepEqual(presetGroups.at(-1).presets.map((preset) => preset.name), ['Rowan']);
    });

    await gate('permanent creation preflights foreign names and reports a registration race', () => {
      const stateDir = path.join(scratch, 'permanent-collision-state');
      const workspace = path.join(scratch, 'permanent-collision-workspace');
      fs.mkdirSync(workspace);
      persona.writeWorkspaceConfig(stateDir, workspace);
      foundation.createFoundation(workspace, foundation.DEFAULT_FOUNDATION);
      let draft = draftStore.createDraft(stateDir, workspace, {
        name: 'Harbor', useCase: 'Audit releases independently.',
      });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, {
        answers: completeAnswers('Collision handling evidence '.repeat(12)),
      });
      draft = draftStore.updateDraft(stateDir, draft.id, draft.revision, {
        preview: previewRenderer.renderBundle(draft, previewChoices('harbor')),
      });
      const bus = fakeBus();
      let disposable;
      let preflightConflict = true;
      const controller = { send() {}, close() {} };
      persona.register({
        bus, stateDir, async pickDirectory() { return null; },
        usage: { claudeSnapshot() { return { stale: false, asOf: Date.now() }; } },
        seats: {
          startDisposable(options) { disposable = options; return controller; },
          checkPresetNames() {
            return preflightConflict
              ? [{ name: 'Harbor', reason: 'owned by another extension' }]
              : [];
          },
          replacePresetGroup() {
            return {
              registered: [],
              skipped: [{ name: 'Harbor', reason: 'owned by another extension' }],
            };
          },
        },
      });
      completeDisposableTest(bus, draft, () => disposable);

      bus.posts.length = 0;
      bus.handlers.get('personaCreatePermanent')({
        id: draft.id, expectedRevision: draft.revision, confirmed: true,
      });
      assert.equal(bus.posts[0].payload.ok, false);
      assert.match(bus.posts[0].payload.error, /owned by another extension/);
      assert.equal(fs.existsSync(path.join(workspace, 'personas', 'harbor')), false);

      preflightConflict = false; // a foreign owner can still win after the read-only preflight
      bus.posts.length = 0;
      bus.handlers.get('personaCreatePermanent')({
        id: draft.id, expectedRevision: draft.revision, confirmed: true,
      });
      assert.equal(bus.posts[0].payload.ok, true);
      assert.equal(bus.posts[0].payload.presetRegistered, false);
      assert.match(bus.posts[0].payload.registrationError, /owned by another extension/);
      assert.equal(personaContract.validatePersonaPackage(workspace, 'harbor').valid, true);
      assert.match(bus.posts[1].payload.text, /was not registered/);

      bus.posts.length = 0;
      bus.handlers.get('ready')();
      assert.equal(bus.posts[0].type, 'toast');
      assert.match(bus.posts[0].payload.text, /were not registered/);
    });

    await gate('renderer registers dock and drives workspace messages', () => {
      function makeNode() {
        return {
          dataset: {},
          textContent: '',
          value: '',
          hidden: false,
          disabled: false,
          checked: false,
          children: [],
          listeners: {},
          addEventListener(type, fn) { this.listeners[type] = fn; },
          appendChild(child) { this.children.push(child); return child; },
          replaceChildren(...children) { this.children = children; },
        };
      }
      const nodes = new Map();
      const pane = {
        className: '',
        id: '',
        dataset: {},
        markup: '',
        set innerHTML(value) { this.markup = value; },
        get innerHTML() { return this.markup; },
        querySelector(selector) {
          if (!nodes.has(selector)) {
            nodes.set(selector, makeNode());
          }
          return nodes.get(selector);
        },
      };
      const posts = [];
      const handlers = new Map();
      let registered;
      let rootCreated = false;
      global.document = {
        createElement(tag) {
          if (!rootCreated) {
            assert.equal(tag, 'div');
            rootCreated = true;
            return pane;
          }
          return makeNode();
        },
      };
      global.ApexBus = {
        on(type, fn) { handlers.set(type, fn); },
        post(type, payload) { posts.push({ type, payload }); },
      };
      global.ApexShell = {
        registerDockPane(element, options) { registered = { element, options }; },
      };
      try {
        const renderer = require.resolve('../extensions/personas/renderer');
        delete require.cache[renderer];
        require(renderer);
        assert.equal(registered.element, pane);
        assert.deepEqual(registered.options, { order: 20 });
        assert.match(pane.innerHTML, /PERSONAS/);
        assert.equal(posts[0].type, 'personaWorkspaceGet');

        handlers.get('personaWorkspaceStatus')({
          configured: true,
          workspace: path.join(scratch, 'ui-workspace'),
          foundationReady: false,
          personasReady: true,
          personaCount: 2,
          error: null,
        });
        assert.equal(nodes.get('.personaWorkspaceState').textContent, 'Ready for setup');
        assert.match(nodes.get('.personaWorkspaceChecks').textContent, /2 persona packages/);
        // a workspace change asks for the foundation, the project context
        // (relationship-suggestion input), and the manage list
        assert.equal(posts.at(-1).type, 'personaManageList');
        assert.equal(posts.at(-2).type, 'personaProjectContextGet');
        assert.equal(posts.at(-3).type, 'personaFoundationGet');

        handlers.get('personaFoundationStatus')({
          workspace: path.join(scratch, 'ui-workspace'),
          exists: false,
          content: foundation.DEFAULT_FOUNDATION,
          revision: null,
          error: null,
        });
        assert.equal(nodes.get('.personaFoundationCard').hidden, false);
        assert.equal(nodes.get('.personaFoundationAction').textContent, 'CREATE FOUNDATION');
        nodes.get('.personaFoundationAction').listeners.click();
        assert.equal(posts.at(-1).type, 'personaFoundationCreate');
        assert.equal(posts.at(-1).payload.content, foundation.DEFAULT_FOUNDATION);

        handlers.get('personaFoundationResult')({ ok: false, conflict: true, error: 'conflict' });
        assert.match(nodes.get('.personaFoundationState').textContent, /Not saved/);
        assert.equal(nodes.get('.personaFoundationEditor').value, foundation.DEFAULT_FOUNDATION);
        assert.equal(nodes.get('.personaFoundationConflict').hidden, false);

        nodes.get('.personaFoundationKeepEdit').listeners.click();
        assert.equal(posts.at(-1).type, 'personaFoundationGet');
        handlers.get('personaFoundationStatus')({
          workspace: path.join(scratch, 'ui-workspace'),
          exists: true,
          content: '# Outside edit\n',
          revision: 'fresh-revision',
          error: null,
        });
        assert.equal(nodes.get('.personaFoundationEditor').value, foundation.DEFAULT_FOUNDATION);
        assert.match(nodes.get('.personaFoundationState').textContent, /edit is preserved/);
        assert.equal(nodes.get('.personaFoundationAction').disabled, false);
        nodes.get('.personaFoundationAction').listeners.click();
        assert.equal(posts.at(-1).type, 'personaFoundationSave');
        assert.equal(posts.at(-1).payload.expectedRevision, 'fresh-revision');

        handlers.get('personaDraftList')({ workspace: path.join(scratch, 'ui-workspace'), cards: CARDS, drafts: [], warnings: [], error: null });
        assert.equal(nodes.get('.personaDraftHome').hidden, false);
        assert.equal(nodes.get('.personaDraftCreate').disabled, true);
        nodes.get('.personaImportChoose').listeners.click();
        assert.equal(posts.at(-1).type, 'personaImportChoose');
        handlers.get('personaImportAudit')({
          sourceFolder: path.join(scratch, 'legacy-ui-persona'),
          canonicalFile: path.join(scratch, 'legacy-ui-persona', 'legacy.md'),
          displayName: 'Legacy UI Reviewer',
          description: 'Reviews legacy interfaces.',
          errors: [],
          warnings: [],
          sections: [
            { index: 0, heading: 'Identity', suggestedKey: 'identity' },
            { index: 1, heading: 'Odd Ritual', suggestedKey: null },
          ],
        });
        assert.equal(nodes.get('.personaImportAudit').hidden, false);
        assert.equal(nodes.get('.personaImportName').value, 'Legacy UI Reviewer');
        assert.equal(nodes.get('.personaImportMappings').children.length, 2);
        assert.equal(nodes.get('.personaImportCreate').disabled, false);
        nodes.get('.personaImportMappings').children[1].children[1].value = 'working_method';
        nodes.get('.personaImportCreate').listeners.click();
        assert.equal(posts.at(-1).type, 'personaImportCreateDraft');
        assert.deepEqual(posts.at(-1).payload.mapping, { 0: 'identity', 1: 'working_method' });
        nodes.get('.personaDraftName').value = 'Rowan';
        nodes.get('.personaDraftUseCase').value = 'Review releases independently.';
        nodes.get('.personaDraftName').listeners.input();
        assert.equal(nodes.get('.personaDraftCreate').disabled, false);
        nodes.get('.personaDraftCreate').listeners.click();
        assert.equal(posts.at(-1).type, 'personaDraftCreate');

        const uiDraft = {
          id: '12345678-1234-4123-8123-123456789abc',
          name: 'Rowan',
          useCase: 'Review releases independently.',
          revision: 1,
          currentCard: 0,
          answers: Object.fromEntries(KEYS.map((key) => [key, ''])),
        };
        handlers.get('personaDraftStatus')({ draft: uiDraft, cards: CARDS });
        assert.equal(nodes.get('.personaInterview').hidden, false);
        assert.match(nodes.get('.personaInterviewQuestion').textContent, /beyond the name/);
        assert.match(nodes.get('.personaInterviewExplanation').textContent, /name field identifies/);
        nodes.get('.personaInterviewAnswer').value = 'A stable identity answer.';
        nodes.get('.personaInterviewNext').listeners.click();
        assert.equal(posts.at(-1).type, 'personaDraftSave');
        assert.equal(posts.at(-1).payload.changes.currentCard, 1);
        assert.equal(posts.at(-1).payload.changes.answers.identity, 'A stable identity answer.');
        handlers.get('personaDraftResult')({ ok: false, conflict: true, error: 'stale draft' });
        assert.equal(nodes.get('.personaInterviewAnswer').value, 'A stable identity answer.');
        assert.equal(nodes.get('.personaInterviewDrafts').textContent, 'REOPEN SAVED DRAFT');
        nodes.get('.personaInterviewDrafts').listeners.click();
        assert.equal(posts.at(-1).type, 'personaDraftOpen');
        assert.equal(posts.at(-1).payload.id, uiDraft.id);

        const completedUiDraft = {
          ...uiDraft,
          revision: 5,
          currentCard: 5,
          answers: completeAnswers('UI complete'),
          preview: null,
        };
        handlers.get('personaDraftStatus')({
          draft: completedUiDraft,
          cards: CARDS,
          suggestedPersonaId: 'rowan',
        });
        nodes.get('.personaInterviewAnswer').value = completedUiDraft.answers.action_posture;
        nodes.get('.personaInterviewNext').listeners.click();
        assert.equal(posts.at(-1).type, 'personaDraftSave');
        assert.equal(posts.at(-1).payload.changes.currentCard, 5);

        const savedUiDraft = { ...completedUiDraft, revision: 6 };
        handlers.get('personaDraftStatus')({
          draft: savedUiDraft,
          cards: CARDS,
          suggestedPersonaId: 'rowan',
        });
        assert.equal(nodes.get('.personaPreviewSetup').hidden, false);
        assert.equal(nodes.get('.personaPreviewId').value, 'rowan');
        nodes.get('.personaPreviewMode').value = 'operator';
        nodes.get('.personaPreviewMode').listeners.change();
        for (const category of personaContract.ACTION_CATEGORIES) {
          const select = nodes.get('.personaAction-' + category);
          select.value = 'ask';
          select.listeners.change();
        }
        nodes.get('.personaCollaborationEnabled').checked = true;
        nodes.get('.personaCollaborationEnabled').listeners.change();
        nodes.get('.personaCollaborationAccess').value = 'read-only';
        nodes.get('.personaCollaborationAccess').listeners.change();
        nodes.get('.personaCapabilities').value = 'review code\nrun checks';
        nodes.get('.personaCapabilities').listeners.input();
        nodes.get('.personaAccepts').value = 'review packet';
        nodes.get('.personaAccepts').listeners.input();
        nodes.get('.personaEmits').value = 'findings report';
        nodes.get('.personaEmits').listeners.input();
        assert.equal(nodes.get('.personaPreviewGenerate').disabled, false);
        nodes.get('.personaPreviewGenerate').listeners.click();
        assert.equal(posts.at(-1).type, 'personaPreviewGenerate');
        assert.equal(posts.at(-1).payload.actions.delete_data, 'ask');
        assert.equal(posts.at(-1).payload.collaboration.default_access, 'read-only');

        const uiBundle = previewRenderer.renderBundle(savedUiDraft, {
          ...previewChoices(), collaboration: collaborationChoices(),
        });
        const previewUiDraft = { ...savedUiDraft, revision: 7, preview: uiBundle };
        handlers.get('personaPreviewStatus')({ draft: previewUiDraft, bundle: uiBundle, stale: false });
        assert.equal(nodes.get('.personaPreviewReview').hidden, false);
        assert.match(nodes.get('.personaBlueprintPreview').textContent, /"canonical_hash"/);
        assert.equal(nodes.get('.personaCollaborationPreviewWrap').hidden, false);
        assert.match(nodes.get('.personaCollaborationPreview').textContent, /"read-only"/);
        assert.match(nodes.get('.personaCanonicalPreview').value, /# Rowan/);
        nodes.get('.personaValidatePreview').listeners.click();
        assert.equal(posts.at(-1).type, 'personaPreviewValidate');
        assert.equal(posts.at(-1).payload.id, previewUiDraft.id);
        handlers.get('personaValidationStatus')({
          report: {
            valid: true,
            errors: [],
            warnings: [{
              severity: 'warning',
              code: 'canonical-drift',
              message: 'Manual canonical text differs from its recorded hash.',
              repair: 'accept-canonical',
            }],
            suggestions: [],
          },
        });
        assert.equal(nodes.get('.personaAcceptCanonical').hidden, false);
        const beforeDirtyAccept = posts.length;
        nodes.get('.personaCanonicalPreview').value = uiBundle.canonical + '\nUnsaved edit.';
        nodes.get('.personaCanonicalPreview').listeners.input();
        nodes.get('.personaAcceptCanonical').listeners.click();
        assert.equal(posts.length, beforeDirtyAccept);
        assert.match(nodes.get('.personaPreviewReviewError').textContent, /Save or restore/);
        nodes.get('.personaCanonicalRestore').listeners.click();
        nodes.get('.personaAcceptCanonical').listeners.click();
        assert.equal(posts.at(-1).type, 'personaPreviewAcceptCanonical');
        assert.equal(posts.at(-1).payload.expectedRevision, 7);
        nodes.get('.personaTestPrepare').listeners.click();
        assert.equal(posts.at(-1).type, 'personaTestPrepare');
        handlers.get('personaTestPrepared')({
          draftId: previewUiDraft.id,
          revision: 7,
          usage: { session: { pct: 10 }, weekly: { pct: 35 }, stale: false, asOf: Date.now() },
          cases: [
            { id: 'introduction', title: 'Introduction', prompt: 'Introduce yourself.', expected: 'Match identity.' },
            { id: 'uncertainty', title: 'Uncertainty', prompt: 'Handle it.', expected: 'Follow method.' },
          ],
        });
        assert.match(nodes.get('.personaTestSummary').textContent, /5-hour 10%/);
        assert.equal(nodes.get('.personaTestResults').children.length, 2);
        assert.equal(nodes.get('.personaTestStart').hidden, false);
        nodes.get('.personaTestStart').listeners.click();
        assert.equal(posts.at(-1).type, 'personaTestStart');
        assert.equal(posts.at(-1).payload.approved, true);
        handlers.get('personaTestStatus')({ phase: 'running', index: 0, total: 2 });
        assert.match(nodes.get('.personaTestSummary').textContent, /case 1 of 2/);
        handlers.get('personaTestStatus')({ phase: 'rejected', error: 'Duplicate start rejected.' });
        assert.match(nodes.get('.personaTestSummary').textContent, /TEST CONTINUES/);
        assert.equal(nodes.get('.personaTestStop').hidden, false);
        handlers.get('personaTestCaseResult')({
          caseId: 'introduction', response: 'Observed persona introduction.',
        });
        assert.match(nodes.get('.personaTestResults').children[0].children[3].textContent,
          /Observed persona introduction/);
        nodes.get('.personaTestStop').listeners.click();
        assert.equal(posts.at(-1).type, 'personaTestStop');
        handlers.get('personaTestStatus')({ phase: 'stopped' });
        assert.match(nodes.get('.personaTestSummary').textContent, /No session was saved/);
        handlers.get('personaTestStatus')({ phase: 'complete', total: 2 });
        assert.equal(nodes.get('.personaCreatePermanent').disabled, false);
        const beforeCreateArm = posts.length;
        nodes.get('.personaCreatePermanent').listeners.click();
        assert.equal(posts.length, beforeCreateArm);
        assert.equal(nodes.get('.personaCreatePermanent').textContent, 'CONFIRM PERMANENT CREATION');
        nodes.get('.personaCreatePermanent').listeners.click();
        assert.equal(posts.at(-1).type, 'personaCreatePermanent');
        assert.equal(posts.at(-1).payload.confirmed, true);
        handlers.get('personaCreateResult')({
          ok: true,
          displayName: 'Rowan',
          personaDir: path.join(scratch, 'ui-workspace', 'personas', 'rowan'),
        });
        assert.match(nodes.get('.personaCreateSummary').textContent, /CREATED/);
        assert.equal(nodes.get('.personaCreatePermanent').disabled, true);
        handlers.get('personaCreateResult')({
          ok: true,
          presetRegistered: false,
          registrationError: 'Rowan (owned by another extension)',
        });
        assert.match(nodes.get('.personaCreateSummary').textContent, /was not registered/);
        assert.doesNotMatch(nodes.get('.personaCreateSummary').textContent, /restart/i);
        nodes.get('.personaCanonicalPreview').value = uiBundle.canonical.replace('# Rowan', '# Rowan edited');
        nodes.get('.personaCanonicalPreview').listeners.input();
        assert.equal(nodes.get('.personaCanonicalSave').disabled, false);
        nodes.get('.personaCanonicalRestore').listeners.click();
        assert.equal(nodes.get('.personaCanonicalPreview').value, uiBundle.canonical);
        assert.equal(nodes.get('.personaCanonicalSave').disabled, true);
        nodes.get('.personaCanonicalPreview').value = uiBundle.canonical.replace('# Rowan', '# Rowan edited');
        nodes.get('.personaCanonicalPreview').listeners.input();
        nodes.get('.personaCanonicalSave').listeners.click();
        assert.equal(posts.at(-1).type, 'personaPreviewSaveCanonical');
        assert.equal(posts.at(-1).payload.expectedRevision, 7);

        const manualUiBundle = previewRenderer.withCanonicalEdit(uiBundle,
          uiBundle.canonical.replace('# Rowan', '# Rowan edited'));
        handlers.get('personaPreviewStatus')({
          draft: { ...previewUiDraft, revision: 8, preview: manualUiBundle },
          bundle: manualUiBundle,
          stale: false,
        });
        nodes.get('.personaPreviewRegenerateAll').listeners.click();
        assert.equal(posts.at(-1).type, 'personaPreviewGenerate');
        handlers.get('personaPreviewResult')({
          ok: false,
          needsConfirmation: true,
          error: 'Regeneration replaces manual work.',
        });
        assert.equal(nodes.get('.personaPreviewRegenerateAll').textContent, 'CONFIRM REGENERATE ALL');
        nodes.get('.personaPreviewRegenerateAll').listeners.click();
        assert.equal(posts.at(-1).payload.confirmedOverwrite, true);

        nodes.get('.personaWorkspaceChoose').listeners.click();
        assert.equal(posts.at(-1).type, 'personaWorkspaceChoose');
        assert.equal(nodes.get('.personaWorkspaceChoose').disabled, true);
      } finally {
        delete global.document;
        delete global.ApexBus;
        delete global.ApexShell;
      }
    });

    console.log(`PERSONA EXTENSION: ${passed}/49 passed`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(() => { process.exitCode = 1; });
