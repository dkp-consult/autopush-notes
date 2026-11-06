const assert = require("node:assert/strict");
const test = require("node:test");

global.document = { body: {} };
global.inkdrop = { config: { get() {}, set() {} }, commands: { add() {} }, notifications: {} };
const plugin = require("../lib/inkdrop-git-sync");

test("paginates the complete Inkdrop note collection", async () => {
  const source = Array.from({ length: 251 }, (_, index) => ({ _id: `note:${index}` }));
  const calls = [];
  const collection = { async all({ limit, skip }) { calls.push({ limit, skip }); return { docs: source.slice(skip, skip + limit) }; } };
  const result = await plugin.allDocuments(collection);
  assert.equal(result.length, 251);
  assert.deepEqual(calls.map(call => call.skip), [0, 100, 200]);
});

test("migration copies legacy preferences once, disables scheduling, and retains export mode", () => {
  const values = new Map([
    ["autopush-notes.autoBackupEnabled", true],
    ["autopush-notes.backupInterval", 15],
    ["autopush-notes.githubToken", "secret"],
    ["autopush-notes.githubRepo", "owner/notes"],
    ["autopush-notes.localExportPath", "/tmp/old-export"],
  ]);
  const writes = [];
  global.inkdrop.config = {
    get: key => values.get(key),
    set: (key, value) => { values.set(key, value); writes.push([key, value]); },
  };
  global.inkdrop.notifications = { add() {} };
  plugin.migratePreferences();
  assert.equal(values.get("inkdrop-git-sync.mode"), "export");
  assert.equal(values.get("inkdrop-git-sync.enabled"), false);
  assert.equal(values.get("inkdrop-git-sync.interval"), 15);
  assert.equal(values.get("inkdrop-git-sync.repository"), "owner/notes");
  assert.equal(values.get("inkdrop-git-sync.legacyExportFolder"), "/tmp/old-export");
  const count = writes.length;
  plugin.migratePreferences();
  assert.equal(writes.length, count);
});
