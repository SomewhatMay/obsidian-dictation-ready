const { test, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// --- mocked "obsidian" module ---
const notices = [];
class Plugin {
  constructor(app) { this.app = app; this.commands = []; this.events = []; }
  addCommand(c) { this.commands.push(c); }
  registerEvent(ref) { this.events.push(ref); }
}
class MarkdownView {}
const obsidian = {
  Plugin, MarkdownView, Platform: { isDesktopApp: false },
  Notice: class { constructor(msg) { notices.push(msg); } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === "obsidian" ? obsidian : origLoad.call(this, req, ...rest); };
const DictationReady = require(path.join(__dirname, "..", "main.js"));
const fmt = { YYYYMMDDHHmm: "202611091230", "YYYY-MM-DD HH:mm": "2026-11-09 12:30" };
globalThis.window = { moment: () => ({ format: (f) => fmt[f] }) };

// --- fakes ---
function makeApp({ gvs = makeGvs(), file, files = ["Dictation"] } = {}) {
  const handlers = {};
  let layoutCb = null;
  const view = Object.assign(new MarkdownView(), { file, saved: 0, save: async () => { view.saved++; } });
  const fm = {};
  const app = {
    fm, view, calls: [],
    metadataCache: {
      on(name, cb) { (handlers[name] ||= []).push(cb); return { name, cb }; },
      // Fires "changed" for a file at path p whose parsed frontmatter has the given status.
      change(p, status) {
        const cache = { frontmatter: { status } };
        (handlers.changed || []).forEach((cb) => cb({ ...dictFile(p), extension: path.extname(p).slice(1) }, "", cache));
      },
    },
    workspace: {
      onLayoutReady(cb) { layoutCb = cb; },
      layoutReady() { layoutCb && layoutCb(); },
      getActiveViewOfType(cls) { return file && view instanceof cls ? view : null; },
      getLeaf(newLeaf) { return { openFile: async (f) => { app.calls.push(["open", newLeaf, f.path]); } }; },
    },
    vault: {
      files: new Map(files.map((p) => [p, ""])),
      getAbstractFileByPath(p) { return app.vault.files.has(p) ? { path: p } : null; },
      async createFolder(p) { app.calls.push(["mkdir", p]); app.vault.files.set(p, ""); },
      async create(p, data) { app.vault.files.set(p, data); return { path: p }; },
    },
    fileManager: {
      async processFrontMatter(f, fn) {
        assert.equal(view.saved, 1, "save must happen before processFrontMatter");
        app.calls.push("fm"); fn(fm);
      },
    },
    commands: { executeCommandById(id) { app.calls.push(id); return true; } },
    plugins: { plugins: gvs ? { "git-vault-sync": gvs } : {} },
  };
  return app;
}
// outcomes: per-call "ok" | "fail" | "auth" | "noop"; after the list runs out, "ok".
function makeGvs(outcomes = []) {
  const gvs = {
    syncing: false, conflictActive: false, args: [], settings: { lastSyncAt: 0 }, lastSyncError: false, lastError: null,
    async sync(a) {
      gvs.args.push(a);
      const o = outcomes.shift() ?? "ok";
      if (o === "noop") return;
      gvs.lastSyncError = false;
      if (o === "ok") gvs.settings.lastSyncAt = Date.now() + gvs.args.length;
      else {
        gvs.lastSyncError = true;
        gvs.lastError = o === "auth"
          ? { message: "Auth failed", detail: "HTTP 401", when: Date.now() }
          : { message: "Network error", detail: "", when: Date.now() };
      }
    },
  };
  return gvs;
}
const dictFile = (p = "Dictation/2026-11-09 1200.md") => ({
  path: p, basename: path.basename(p, ".md"), parent: { path: path.dirname(p) },
});
const flush = () => new Promise((r) => setImmediate(r));
async function advance(ms) {
  for (let t = 0; t < ms; t += 100) { await flush(); mock.timers.tick(100); }
  await flush();
}
function load(app, desktop) {
  obsidian.Platform.isDesktopApp = desktop;
  const plugin = new DictationReady(app);
  plugin.onload();
  return plugin;
}

beforeEach(() => { notices.length = 0; mock.timers.enable({ apis: ["setTimeout"] }); });
afterEach(() => mock.timers.reset());

// --- mobile ---
test("mobile: command shape", () => {
  const plugin = load(makeApp(), false);
  assert.deepEqual(plugin.commands.map((c) => c.id), ["mark-ready-and-sync", "new-dictation-note"]);
  for (const c of plugin.commands) assert.ok(c.icon && typeof c.callback === "function" && !c.checkCallback);
});

const rootFile = { path: "x.md", basename: "x", parent: { path: "/" } };
for (const [label, file] of [["vault root", rootFile], ["Notes/x.md", dictFile("Notes/x.md")],
  ["Dictation/sub/x.md", dictFile("Dictation/sub/x.md")], ["Dictation/Completed/x.md", dictFile("Dictation/Completed/x.md")],
  ["no active file", undefined]]) {
  test(`mobile: mark ready on ${label} -> notice only`, async () => {
    const gvs = makeGvs();
    const app = makeApp({ gvs, file });
    await load(app, false).markReady();
    await advance(30000);
    assert.equal(app.view.saved, 0);
    assert.deepEqual(app.fm, {});
    assert.deepEqual(app.calls, []); // no processFrontMatter, no executeCommandById
    assert.deepEqual(gvs.args, []);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /Dictation\//);
  });
}

test("mobile: save -> status ready -> sync once", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400);
  await run;
  assert.equal(app.view.saved, 1);
  assert.equal(app.fm.status, "ready");
  assert.deepEqual(gvs.args, [true]);
  assert.deepEqual(notices, ["Ready: 2026-11-09 1200 — synced"]);
});

test("mobile: missing git-vault-sync -> fallback notice, still marked ready", async () => {
  const app = makeApp({ gvs: null, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400);
  await run;
  assert.equal(app.fm.status, "ready");
  assert.deepEqual(notices, ["Marked ready; will sync on next auto-sync"]);
});

test("mobile: conflict -> notice, no sync", async () => {
  const gvs = Object.assign(makeGvs(), { conflictActive: true });
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400);
  await run;
  assert.equal(app.fm.status, "ready");
  assert.deepEqual(gvs.args, []);
  assert.match(notices[0], /conflict/);
});

test("mobile: waits while syncing, then syncs", async () => {
  const gvs = Object.assign(makeGvs(), { syncing: true });
  const app = makeApp({ gvs, file: dictFile() });
  let done = false;
  load(app, false).markReady().then(() => { done = true; });
  await advance(400 + 2000);
  assert.deepEqual(gvs.args, []);
  assert.equal(done, false);
  gvs.syncing = false;
  await advance(200);
  assert.equal(done, true);
  assert.deepEqual(gvs.args, [true]);
});

test("mobile: 30 s timeout -> fallback notice", async () => {
  const gvs = Object.assign(makeGvs(), { syncing: true });
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400 + 30200);
  await run;
  assert.deepEqual(gvs.args, []);
  assert.deepEqual(notices, ["Marked ready; will sync on next auto-sync"]);
});

test("mobile: sync() not a function -> executeCommandById", async () => {
  const app = makeApp({ gvs: { syncing: false, conflictActive: false }, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400);
  await run;
  assert.deepEqual(app.calls, ["fm", "git-vault-sync:sync"]);
});

// --- retry ---
async function markReadyWith(outcomes) {
  const gvs = makeGvs(outcomes);
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400 + 4 * 5000);
  await run;
  return { gvs, app };
}

test("mobile: fail, fail, success -> 3 silent syncs, retry notices, synced", async () => {
  const { gvs } = await markReadyWith(["fail", "fail"]);
  assert.deepEqual(gvs.args, [true, true, true]);
  assert.deepEqual(notices, ["Sync failed — retrying (1/3)…", "Sync failed — retrying (2/3)…", "Ready: 2026-11-09 1200 — synced"]);
});

test("mobile: retries are 5 s apart", async () => {
  const gvs = makeGvs(["fail"]);
  const app = makeApp({ gvs, file: dictFile() });
  load(app, false).markReady();
  await advance(400 + 4900);
  assert.equal(gvs.args.length, 1);
  await advance(200);
  assert.equal(gvs.args.length, 2);
});

test("mobile: retry re-waits while syncing", async () => {
  const gvs = makeGvs(["fail"]);
  const app = makeApp({ gvs, file: dictFile() });
  load(app, false).markReady();
  await advance(400);
  gvs.syncing = true;
  await advance(8000);
  assert.equal(gvs.args.length, 1);
  gvs.syncing = false;
  await advance(200);
  assert.equal(gvs.args.length, 2);
});

test("mobile: auth error -> no retry, final notice", async () => {
  const { gvs } = await markReadyWith(["auth"]);
  assert.deepEqual(gvs.args, [true]);
  assert.deepEqual(notices, ["Sync failed: Auth failed — will retry on next auto-sync"]);
});

test("mobile: 4 failures -> gives up with final notice", async () => {
  const { gvs, app } = await markReadyWith(["fail", "fail", "fail", "fail", "ok"]);
  assert.deepEqual(gvs.args, [true, true, true, true]);
  assert.equal(app.fm.status, "ready");
  assert.deepEqual(notices, [
    "Sync failed — retrying (1/3)…", "Sync failed — retrying (2/3)…", "Sync failed — retrying (3/3)…",
    "Sync failed: Network error — will retry on next auto-sync",
  ]);
});

test("mobile: no-op sync -> skipped, no retry, fallback notice", async () => {
  const gvs = makeGvs(["noop"]);
  gvs.lastSyncError = true; // stale error from an earlier run must not count
  gvs.lastError = { message: "old", detail: "", when: Date.now() - 60000 };
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400 + 20000);
  await run;
  assert.deepEqual(gvs.args, [true]);
  assert.deepEqual(notices, ["Marked ready; will sync on next auto-sync"]);
});

test("mobile: conflict raised by sync() -> conflict notice, no retry", async () => {
  const gvs = makeGvs();
  gvs.sync = async (a) => { gvs.args.push(a); gvs.conflictActive = true; };
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400 + 20000);
  await run;
  assert.deepEqual(gvs.args, [true]);
  assert.match(notices[0], /conflict/);
});

// --- new note ---
test("new note: creates Dictation/<stamp>.md with frontmatter and opens it", async () => {
  const app = makeApp();
  await load(app, false).newNote();
  assert.equal(app.vault.files.get("Dictation/202611091230.md"), '---\nstatus: drafting\ncreated: "2026-11-09 12:30"\n---\n\n');
  assert.deepEqual(app.calls, [["open", false, "Dictation/202611091230.md"]]);
  assert.deepEqual(notices, []);
});

test("new note: name collisions get -2, -3", async () => {
  const app = makeApp({ files: ["Dictation", "Dictation/202611091230.md", "Dictation/202611091230-2.md"] });
  await load(app, false).newNote();
  assert.ok(app.vault.files.has("Dictation/202611091230-3.md"));
  assert.deepEqual(app.calls, [["open", false, "Dictation/202611091230-3.md"]]);
});

test("new note: creates Dictation/ when missing", async () => {
  const app = makeApp({ files: [] });
  await load(app, false).newNote();
  assert.deepEqual(app.calls, [["mkdir", "Dictation"], ["open", false, "Dictation/202611091230.md"]]);
});

test("mobile: does not register desktop listeners", () => {
  const app = makeApp();
  const plugin = load(app, false);
  app.workspace.layoutReady();
  assert.equal(plugin.events.length, 0);
});

// --- desktop ---
for (const status of ["done", "failed"]) {
  test(`desktop: ${status} note in Dictation/ -> one silent sync ~2 s later`, async () => {
    const gvs = makeGvs();
    const app = makeApp({ gvs });
    const plugin = load(app, true);
    app.workspace.layoutReady();
    assert.equal(plugin.events.length, 1);
    app.metadataCache.change("Dictation/x.md", status);
    await advance(500);
    app.metadataCache.change("Dictation/x.md", status);
    await advance(1900);
    assert.deepEqual(gvs.args, []);
    await advance(200);
    assert.deepEqual(gvs.args, [true]);
    await advance(5000);
    assert.deepEqual(gvs.args, [true]);
    assert.deepEqual(notices, []);
  });
}

test("desktop: ignores other statuses, other folders and events before layout-ready", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs });
  load(app, true);
  app.metadataCache.change("Dictation/early.md", "done");
  app.workspace.layoutReady();
  for (const status of ["ready", "processing", "drafting", undefined]) app.metadataCache.change("Dictation/x.md", status);
  app.metadataCache.change("Dictation/Completed/x.md", "done");
  app.metadataCache.change("Notes/y.md", "done");
  app.metadataCache.change("Dictation/x.canvas", "done");
  await advance(5000);
  assert.deepEqual(gvs.args, []);
});

test("desktop: waits while syncing", async () => {
  const gvs = Object.assign(makeGvs(), { syncing: true });
  const app = makeApp({ gvs });
  load(app, true);
  app.workspace.layoutReady();
  app.metadataCache.change("Dictation/x.md", "done");
  await advance(6000);
  assert.deepEqual(gvs.args, []);
  gvs.syncing = false;
  await advance(200);
  assert.deepEqual(gvs.args, [true]);
});

test("desktop: retry is silent (console only)", async () => {
  const gvs = makeGvs(["fail", "fail"]);
  const app = makeApp({ gvs });
  load(app, true);
  app.workspace.layoutReady();
  const log = mock.method(console, "log", () => {});
  app.metadataCache.change("Dictation/x.md", "done");
  await advance(2000 + 3 * 5000);
  log.mock.restore();
  assert.deepEqual(gvs.args, [true, true, true]);
  assert.deepEqual(notices, []);
  assert.equal(log.mock.callCount(), 2);
});

test("desktop: unload clears the pending timer", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs });
  const plugin = load(app, true);
  app.workspace.layoutReady();
  app.metadataCache.change("Dictation/x.md", "done");
  plugin.onunload();
  await advance(5000);
  assert.deepEqual(gvs.args, []);
});
