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

// --- fakes ---
function makeApp({ gvs = makeGvs(), file } = {}) {
  const handlers = {};
  let layoutCb = null;
  const view = Object.assign(new MarkdownView(), { file, saved: 0, save: async () => { view.saved++; } });
  const fm = {};
  const app = {
    fm, view, calls: [],
    vault: {
      on(name, cb) { (handlers[name] ||= []).push(cb); return { name, cb }; },
      trigger(name, p) { (handlers[name] || []).forEach((cb) => cb({ path: p })); },
    },
    workspace: {
      onLayoutReady(cb) { layoutCb = cb; },
      layoutReady() { layoutCb && layoutCb(); },
      getActiveViewOfType(cls) { return file && view instanceof cls ? view : null; },
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
function makeGvs() {
  const gvs = { syncing: false, conflictActive: false, args: [], async sync(a) { gvs.args.push(a); } };
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
  const [c] = plugin.commands;
  assert.equal(c.id, "mark-ready-and-sync");
  assert.ok(c.icon && typeof c.callback === "function" && !c.checkCallback);
});

test("mobile: refuses notes outside Dictation/", async () => {
  const app = makeApp({ file: dictFile("Notes/x.md") });
  await load(app, false).markReady();
  assert.equal(app.view.saved, 0);
  assert.deepEqual(app.calls, []);
  assert.match(notices[0], /Dictation\//);
});

test("mobile: refuses nested Dictation/Completed/ notes", async () => {
  const app = makeApp({ file: dictFile("Dictation/Completed/x.md") });
  await load(app, false).markReady();
  assert.equal(app.view.saved, 0);
});

test("mobile: save -> status ready -> sync once", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs, file: dictFile() });
  const run = load(app, false).markReady();
  await advance(400);
  await run;
  assert.equal(app.view.saved, 1);
  assert.equal(app.fm.status, "ready");
  assert.deepEqual(gvs.args, [false]);
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
  assert.deepEqual(gvs.args, [false]);
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

test("mobile: does not register desktop listeners", () => {
  const app = makeApp();
  const plugin = load(app, false);
  app.workspace.layoutReady();
  assert.equal(plugin.events.length, 0);
});

// --- desktop ---
test("desktop: create+modify in Completed/ -> one silent sync ~2 s later", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs });
  const plugin = load(app, true);
  app.workspace.layoutReady();
  assert.equal(plugin.events.length, 2);
  app.vault.trigger("create", "Dictation/Completed/x.md");
  await advance(500);
  app.vault.trigger("modify", "Dictation/Completed/x.md");
  await advance(1900);
  assert.deepEqual(gvs.args, []);
  await advance(200);
  assert.deepEqual(gvs.args, [true]);
  await advance(5000);
  assert.deepEqual(gvs.args, [true]);
  assert.deepEqual(notices, []);
});

test("desktop: ignores events before layout-ready and outside Completed/", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs });
  load(app, true);
  app.vault.trigger("create", "Dictation/Completed/early.md");
  app.workspace.layoutReady();
  app.vault.trigger("create", "Dictation/x.md");
  app.vault.trigger("modify", "Notes/y.md");
  app.vault.trigger("create", "Dictation/CompletedX.md");
  await advance(5000);
  assert.deepEqual(gvs.args, []);
});

test("desktop: waits while syncing", async () => {
  const gvs = Object.assign(makeGvs(), { syncing: true });
  const app = makeApp({ gvs });
  load(app, true);
  app.workspace.layoutReady();
  app.vault.trigger("create", "Dictation/Completed/x.md");
  await advance(6000);
  assert.deepEqual(gvs.args, []);
  gvs.syncing = false;
  await advance(200);
  assert.deepEqual(gvs.args, [true]);
});

test("desktop: unload clears the pending timer", async () => {
  const gvs = makeGvs();
  const app = makeApp({ gvs });
  const plugin = load(app, true);
  app.workspace.layoutReady();
  app.vault.trigger("create", "Dictation/Completed/x.md");
  plugin.onunload();
  await advance(5000);
  assert.deepEqual(gvs.args, []);
});
