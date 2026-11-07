const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");

const { fakeDb } = require("./support/fake-inkdrop");
const { GitService } = require("../lib/git-service");
const { serializeNote, stableSyncId, importedNoteId } = require("../lib/sync-engine");

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", args, { cwd })).stdout.trim();

// A minimal Inkdrop host: config with change listeners, commands, notifications,
// packages, and the local database.
function host({ config = {}, db = fakeDb(), activePackages = [] } = {}) {
  const values = new Map(Object.entries(config));
  const listeners = new Map();
  const notifications = [];
  const disposed = [];
  global.document = { body: {} };
  global.inkdrop = {
    config: {
      get: key => values.get(key),
      set: (key, value) => {
        values.set(key, value);
        for (const listener of listeners.get(key) || []) listener({ newValue: value });
      },
      onDidChange: (key, listener) => {
        listeners.set(key, [...(listeners.get(key) || []), listener]);
        return { dispose: () => disposed.push(key) };
      },
    },
    commands: { add: (_target, commands) => { global.inkdrop.registered = commands; return { dispose: () => disposed.push("commands") }; } },
    // Same methods as Inkdrop 6.3.0's NotificationManager.
    notifications: Object.fromEntries(["info", "warning", "error"].map(type => [
      `add${type[0].toUpperCase()}${type.slice(1)}`,
      (message, options) => {
        if (typeof message !== "string") throw new Error("Notification must be created with string message");
        notifications.push({ type, message, ...options });
      },
    ])),
    packages: { isPackageActive: name => activePackages.includes(name) },
    localDB: db,
  };
  return { values, notifications, disposed, db };
}

function freshPlugin() {
  delete require.cache[require.resolve("../lib/inkdrop-git-sync")];
  delete global.__inkdropGitSyncBridge;
  return require("../lib/inkdrop-git-sync");
}

async function remote() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-sync-plugin-"));
  const bare = path.join(root, "remote.git");
  await exec("git", ["init", "--bare", "--initial-branch=main", bare]);
  const original = GitService.prototype.remoteUrl;
  GitService.prototype.remoteUrl = () => bare;
  const agent = async (file, content) => {
    const clone = path.join(root, `agent-${Math.random()}`);
    await exec("git", ["clone", "-q", bare, clone]);
    await git(clone, "config", "user.name", "Agent");
    await git(clone, "config", "user.email", "agent@example.invalid");
    await git(clone, "checkout", "-q", "-B", "main");
    fs.mkdirSync(path.join(clone, "notes"), { recursive: true });
    fs.writeFileSync(path.join(clone, "notes", file), content);
    await git(clone, "add", ".");
    await git(clone, "commit", "-q", "-m", "agent");
    await git(clone, "push", "-q", "origin", "HEAD:main");
  };
  return {
    root, bare, agent,
    folder: name => path.join(root, name),
    cleanup: () => { GitService.prototype.remoteUrl = original; fs.rmSync(root, { recursive: true, force: true }); },
  };
}

const settings = (folder, extra = {}) => ({
  "inkdrop-git-sync.migrationVersion": 1,
  "inkdrop-git-sync.repository": "owner/notes",
  "inkdrop-git-sync.branch": "main",
  "inkdrop-git-sync.syncFolder": folder,
  ...extra,
});

test("migration copies legacy preferences once, keeps export mode and scheduling off", () => {
  const h = host({ config: {
    "autopush-notes.autoBackupEnabled": true,
    "autopush-notes.backupInterval": 15,
    "autopush-notes.githubToken": "secret",
    "autopush-notes.githubRepo": "owner/notes",
    "autopush-notes.localExportPath": "/tmp/old-export",
  } });
  const plugin = freshPlugin();
  plugin.migratePreferences();
  assert.equal(h.values.get("inkdrop-git-sync.mode"), "export");
  assert.equal(h.values.get("inkdrop-git-sync.enabled"), false);
  assert.equal(h.values.get("inkdrop-git-sync.interval"), 15);
  assert.equal(h.values.get("inkdrop-git-sync.repository"), "owner/notes");
  assert.equal(h.values.get("inkdrop-git-sync.legacyExportFolder"), "/tmp/old-export");
  assert.equal(h.notifications.some(n => n.message.includes("secret")), false);
  const before = [...h.values.entries()];
  plugin.migratePreferences();
  assert.deepEqual([...h.values.entries()], before);
});

test("a fresh install works with default settings in export mode", async () => {
  const r = await remote();
  const h = host({ config: settings(r.folder("sync"), { "inkdrop-git-sync.mode": "export" }) });
  const plugin = freshPlugin();
  try {
    const status = await plugin.runCycle(false);
    assert.equal(status.actions.length, 1);
    const files = await git(r.bare, "ls-tree", "-r", "--name-only", "main");
    assert.equal(files, `notes/${stableSyncId("note:a")}.md`);
    assert.equal(h.notifications.at(-1).type, "info");
  } finally { r.cleanup(); }
});

test("a full sync cycle imports an agent note Inkdrop accepts, then goes quiet", async () => {
  const r = await remote();
  const h = host({ config: settings(r.folder("sync"), { "inkdrop-git-sync.mode": "sync" }) });
  const plugin = freshPlugin();
  const syncId = "11111111-1111-4111-8111-111111111111";
  try {
    await r.agent(`${syncId}.md`, serializeNote(syncId, { title: "From Hermes", body: "hello", book_path: ["Work", "Agents"], tags: ["hermes"], status: "active" }));
    await assert.rejects(plugin.runCycle(false), /Run Preview Without Writing/);
    await plugin.runCycle(true);
    const first = await plugin.runCycle(false);
    assert.deepEqual(first.actions.map(a => a.type).sort(), ["export", "import"]);
    const imported = h.db.notes.store.get(importedNoteId(syncId));
    assert.equal(imported.doctype, "markdown");
    assert.equal(imported.title, "From Hermes");
    const commits = await git(r.bare, "rev-list", "--count", "main");
    const second = await plugin.runCycle(false);
    assert.deepEqual(second.actions, []);
    assert.equal(await git(r.bare, "rev-list", "--count", "main"), commits);
    assert.equal(h.db.notes.store.size, 3);
  } finally { r.cleanup(); }
});

test("a push rejected because an agent pushed meanwhile is merged and retried", async () => {
  const r = await remote();
  host({ config: settings(r.folder("sync"), { "inkdrop-git-sync.mode": "sync" }) });
  const plugin = freshPlugin();
  const original = GitService.prototype.commitAndPush;
  let raced = false;
  GitService.prototype.commitAndPush = async function (...args) {
    if (!raced) { raced = true; await r.agent("33333333-3333-4333-8333-333333333333.md", serializeNote("33333333-3333-4333-8333-333333333333", { title: "Race", body: "", book_path: ["Work"] })); }
    return original.apply(this, args);
  };
  try {
    await r.agent("22222222-2222-4222-8222-222222222222.md", serializeNote("22222222-2222-4222-8222-222222222222", { title: "Seed", body: "", book_path: ["Work"] }));
    await plugin.runCycle(true);
    const status = await plugin.runCycle(false);
    assert.equal(status.ok, true);
    const files = (await git(r.bare, "ls-tree", "-r", "--name-only", "main")).split("\n");
    assert.equal(files.length, 3);
  } finally { GitService.prototype.commitAndPush = original; r.cleanup(); }
});

test("preview reports the remote's notes without writing anything", async () => {
  const r = await remote();
  const h = host({ config: settings(r.folder("sync"), { "inkdrop-git-sync.mode": "sync" }) });
  const plugin = freshPlugin();
  const syncId = "11111111-1111-4111-8111-111111111111";
  try {
    await r.agent(`${syncId}.md`, serializeNote(syncId, { title: "Remote", body: "", book_path: ["Work"] }));
    const status = await plugin.runCycle(true);
    assert.deepEqual(status.actions.map(a => a.type).sort(), ["export", "import"]);
    assert.equal(fs.existsSync(r.folder("sync")), false);
    assert.equal(h.db.notes.store.size, 2);
  } finally { r.cleanup(); }
});

test("refuses to run while autopush-notes is active", async () => {
  const r = await remote();
  host({ config: settings(r.folder("sync")), activePackages: ["autopush-notes"] });
  const plugin = freshPlugin();
  try {
    await assert.rejects(plugin.runCycle(false), /Disable the autopush-notes package/);
    assert.equal(fs.existsSync(r.folder("sync")), false);
  } finally { r.cleanup(); }
});

test("sync mode refuses the legacy export folder", async () => {
  const r = await remote();
  host({ config: settings(r.folder("legacy"), { "inkdrop-git-sync.mode": "sync", "inkdrop-git-sync.legacyExportFolder": r.folder("legacy") }) });
  const plugin = freshPlugin();
  try {
    await assert.rejects(plugin.runCycle(false), /new dedicated folder/);
  } finally { r.cleanup(); }
});

test("scheduling follows settings live, with a single timer, and deactivation releases everything", () => {
  const h = host({ config: { "inkdrop-git-sync.migrationVersion": 1, "inkdrop-git-sync.enabled": true, "inkdrop-git-sync.interval": 5 } });
  const plugin = freshPlugin();
  const timers = [];
  const realSet = global.setInterval;
  const realClear = global.clearInterval;
  global.setInterval = (fn, ms) => { const timer = { ms, cleared: false }; timers.push(timer); return timer; };
  global.clearInterval = timer => { if (timer) timer.cleared = true; };
  try {
    plugin.activate();
    assert.equal(timers.filter(t => !t.cleared).length, 1);
    inkdrop.config.set("inkdrop-git-sync.interval", 10);
    const live = timers.filter(t => !t.cleared);
    assert.equal(live.length, 1);
    assert.equal(live[0].ms, 10 * 60 * 1000);
    plugin.activate();
    assert.equal(timers.filter(t => !t.cleared).length, 1);
    plugin.toggle();
    assert.equal(timers.filter(t => !t.cleared).length, 0);
    plugin.deactivate();
    assert.ok(h.disposed.includes("commands"));
    assert.equal(global.__inkdropGitSyncBridge, undefined);
  } finally {
    global.setInterval = realSet;
    global.clearInterval = realClear;
  }
});

test("points at the stray ~ directory left by autopush-notes 0.0.4 without moving it", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-cwd-"));
  const previous = process.cwd();
  try {
    fs.mkdirSync(path.join(cwd, "~", "Documents", "InkdropNotes"), { recursive: true });
    process.chdir(cwd);
    const h = host({ config: { "autopush-notes.localExportPath": "~/Documents/InkdropNotes" } });
    const plugin = freshPlugin();
    plugin.warnAboutLegacyExportPath();
    assert.match(h.notifications[0].message, /InkdropNotes/);
    assert.equal(fs.existsSync(path.join(cwd, "~", "Documents", "InkdropNotes")), true);
  } finally {
    process.chdir(previous);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("a failed push followed by an agent edit of the same note becomes a conflict, not a stuck merge", async () => {
  const r = await remote();
  const h = host({ config: settings(r.folder("sync"), { "inkdrop-git-sync.mode": "sync" }) });
  const plugin = freshPlugin();
  const syncId = stableSyncId("note:a");
  const original = GitService.prototype.commitAndPush;
  try {
    await plugin.runCycle(true);
    await plugin.runCycle(false);
    const stored = h.db.notes.store.get("note:a");
    h.db.notes.store.set("note:a", { ...stored, body: "mac edit", _rev: "9-mac" });
    // The commit is made but the push fails (offline).
    GitService.prototype.commitAndPush = async function (files) {
      await original.call(this, files, { push: false });
      throw new Error("Could not resolve host: github.com");
    };
    await assert.rejects(plugin.runCycle(false), /resolve host/);
    GitService.prototype.commitAndPush = original;
    await r.agent(`${syncId}.md`, serializeNote(syncId, { title: "A", body: "agent edit", book_path: ["Work", "Projects"], tags: ["urgent"], status: "active", created_at: 1793984742534, updated_at: 1793985663619 }, "note:a"));
    const status = await plugin.runCycle(false);
    assert.equal(status.conflicts.length, 1);
    assert.equal(h.db.notes.store.get("note:a").body, "mac edit");
    const copies = path.join(r.folder("sync"), ".inkdrop-git-sync", "conflicts");
    assert.match(fs.readFileSync(path.join(copies, `${syncId}.git.md`), "utf8"), /agent edit/);
    assert.match(fs.readFileSync(path.join(copies, `${syncId}.inkdrop.md`), "utf8"), /mac edit/);
  } finally { GitService.prototype.commitAndPush = original; r.cleanup(); }
});
