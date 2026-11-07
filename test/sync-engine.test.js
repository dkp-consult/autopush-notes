const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SyncEngine,
  importedNoteId,
  parseNote,
  readState,
  resolveWorkspace,
  runExport,
  serializeNote,
  stableSyncId,
} = require("../lib/sync-engine");

const EXTERNAL = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

function note(id, title, body, rev = "1-a", extra = {}) {
  return { id, rev, title, body, book_path: ["Book"], tags: ["tag"], status: "none", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...extra };
}

// In-memory stand-in for the Inkdrop adapter. Imported notes take the
// deterministic ID the real adapter uses.
function fixture(notes = [], workspace = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-sync-test-"))) {
  const records = new Map(notes.map(item => [item.id, { ...item }]));
  const adapter = {
    created: [],
    updated: [],
    async listNotes() { return [...records.values()].map(item => ({ ...item })); },
    async createNote(syncId, value) {
      const id = importedNoteId(syncId);
      if (records.has(id)) throw new Error("already exists");
      this.created.push({ id, ...value });
      records.set(id, { id, rev: "1-new", ...value });
      return { id, rev: "1-new" };
    },
    async updateNote(id, value, rev) {
      if (records.get(id).rev !== rev) throw new Error("Inkdrop note changed during synchronization; deferred to the next cycle");
      this.updated.push({ id, ...value });
      records.set(id, { id, rev: `${Number(rev.split("-")[0]) + 1}-x`, ...value });
    },
  };
  const engine = () => new SyncEngine({ adapter, workspace });
  const file = syncId => path.join(workspace, "notes", `${syncId}.md`);
  return { workspace, adapter, records, engine, file, cleanup: () => fs.rmSync(workspace, { recursive: true, force: true }) };
}

function writeExternal(f, syncId, value) {
  fs.mkdirSync(path.join(f.workspace, "notes"), { recursive: true });
  fs.writeFileSync(f.file(syncId), serializeNote(syncId, value));
}

test("exports more than 100 notes with duplicate titles and Unicode, idempotently", async () => {
  const notes = Array.from({ length: 205 }, (_, index) => note(`note:${index}`, "Même titre ✓", `corps ${index} — 日本語`));
  const f = fixture(notes);
  try {
    const first = await f.engine().run();
    assert.equal(first.actions.length, 205);
    assert.equal(fs.readdirSync(path.join(f.workspace, "notes")).length, 205);
    const second = await f.engine().run();
    assert.deepEqual(second.actions, []);
    assert.deepEqual(second.changedFiles, []);
  } finally { f.cleanup(); }
});

test("an Inkdrop note always maps to the same file, whatever the local state", async () => {
  const f = fixture([note("note:abc", "Title", "body")]);
  try {
    await f.engine().run();
    assert.equal(fs.existsSync(f.file(stableSyncId("note:abc"))), true);
  } finally { f.cleanup(); }
});

test("a second bridge with the same Inkdrop notes and a fresh checkout creates no duplicate", async () => {
  // Machine 1: one Inkdrop note, one note written by an agent.
  const machine1 = fixture([note("note:1", "From Inkdrop", "a")]);
  writeExternal(machine1, EXTERNAL[0], note("", "From agent", "b"));
  const machine2Workspace = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-sync-m2-"));
  try {
    await machine1.engine().run();
    assert.equal(machine1.records.size, 2);
    // Machine 2 receives the same Inkdrop documents through Inkdrop's own sync,
    // and a clone of the repository without the local state.
    fs.cpSync(path.join(machine1.workspace, "notes"), path.join(machine2Workspace, "notes"), { recursive: true });
    const machine2 = fixture([...machine1.records.values()], machine2Workspace);
    const result = await machine2.engine().run();
    assert.deepEqual(result.actions.map(action => action.type).sort(), ["match", "match"]);
    assert.equal(machine2.adapter.created.length, 0);
    assert.equal(machine2.records.size, 2);
    assert.equal(fs.readdirSync(path.join(machine2Workspace, "notes")).length, 2);
  } finally {
    machine1.cleanup();
    fs.rmSync(machine2Workspace, { recursive: true, force: true });
  }
});

test("switching from export mode to sync mode recognises every exported note", async () => {
  const f = fixture([note("note:1", "One", "a"), note("note:2", "Two", "b")]);
  try {
    await runExport({ adapter: f.adapter, workspace: f.workspace });
    const result = await f.engine().run();
    assert.deepEqual(result.actions.map(action => action.type), ["match", "match"]);
    assert.equal(f.adapter.created.length, 0);
    assert.equal(f.records.size, 2);
  } finally { f.cleanup(); }
});

test("imports a new external note once, even when the state was lost after the import", async () => {
  const f = fixture();
  try {
    writeExternal(f, EXTERNAL[0], note("", "External", "hello"));
    await f.engine().run();
    assert.equal(f.adapter.created.length, 1);
    await f.engine().run();
    assert.equal(f.adapter.created.length, 1);
    // Inkdrop quit between the import and the state write.
    fs.rmSync(path.join(f.workspace, ".inkdrop-git-sync"), { recursive: true });
    const recovered = await f.engine().run();
    assert.deepEqual(recovered.actions.map(action => action.type), ["match"]);
    assert.equal(f.adapter.created.length, 1);
    assert.equal(f.records.size, 1);
  } finally { f.cleanup(); }
});

test("propagates one-sided edits and keeps the file name when the title changes", async () => {
  const f = fixture([note("note:1", "Before", "base")]);
  const syncId = stableSyncId("note:1");
  try {
    await f.engine().run();
    f.records.set("note:1", note("note:1", "After", "from Inkdrop", "2-a"));
    const exported = await f.engine().run();
    assert.equal(exported.actions[0].type, "export");
    assert.equal(parseNote(fs.readFileSync(f.file(syncId), "utf8")).note.title, "After");
    writeExternal(f, syncId, note("", "After", "from Git"));
    const imported = await f.engine().run();
    assert.equal(imported.actions[0].type, "import-update");
    assert.equal(f.adapter.updated.at(-1).body, "from Git");
    assert.equal(fs.readdirSync(path.join(f.workspace, "notes")).length, 1);
  } finally { f.cleanup(); }
});

test("identical edits on both sides are accepted without conflict", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  const syncId = stableSyncId("note:1");
  try {
    await f.engine().run();
    f.records.set("note:1", note("note:1", "Title", "same edit", "2-a"));
    writeExternal(f, syncId, note("", "Title", "same edit"));
    const result = await f.engine().run();
    assert.deepEqual(result.actions.map(action => action.type), ["match"]);
    assert.deepEqual(result.conflicts, []);
  } finally { f.cleanup(); }
});

test("concurrent edits produce two copies, block the note, and resolve by keeping one copy", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  const syncId = stableSyncId("note:1");
  const copies = path.join(f.workspace, ".inkdrop-git-sync", "conflicts");
  try {
    await f.engine().run();
    f.records.set("note:1", note("note:1", "Title", "ink edit", "2-a"));
    writeExternal(f, syncId, note("", "Title", "git edit"));
    const result = await f.engine().run();
    assert.equal(result.conflicts.length, 1);
    assert.equal(f.adapter.updated.length, 0);
    assert.match(fs.readFileSync(f.file(syncId), "utf8"), /git edit/);
    assert.equal(fs.existsSync(path.join(copies, `${syncId}.inkdrop.md`)), true);
    assert.equal(fs.existsSync(path.join(copies, `${syncId}.git.md`)), true);

    // Still blocked on the next cycle.
    assert.equal((await f.engine().run()).conflicts.length, 1);

    // The user keeps the Inkdrop copy, after editing it by hand.
    const kept = path.join(copies, `${syncId}.inkdrop.md`);
    fs.writeFileSync(kept, fs.readFileSync(kept, "utf8").replace("ink edit", "merged by hand"));
    fs.unlinkSync(path.join(copies, `${syncId}.git.md`));
    const resolved = await f.engine().run();
    assert.deepEqual(resolved.actions.map(action => action.type), ["resolve"]);
    assert.match(fs.readFileSync(f.file(syncId), "utf8"), /merged by hand/);
    assert.equal(f.records.get("note:1").body, "merged by hand");
    assert.equal(fs.existsSync(kept), false);
    assert.deepEqual(readState(f.workspace).conflicts, {});
    assert.deepEqual((await f.engine().run()).actions, []);
  } finally { f.cleanup(); }
});

test("a resolution is refused when a side moved after the conflict was recorded", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  const syncId = stableSyncId("note:1");
  const copies = path.join(f.workspace, ".inkdrop-git-sync", "conflicts");
  try {
    await f.engine().run();
    f.records.set("note:1", note("note:1", "Title", "ink edit", "2-a"));
    writeExternal(f, syncId, note("", "Title", "git edit"));
    await f.engine().run();
    writeExternal(f, syncId, note("", "Title", "newer git edit"));
    fs.unlinkSync(path.join(copies, `${syncId}.git.md`));
    const result = await f.engine().run();
    assert.equal(result.conflicts[0].reason, "changed-since-conflict");
    assert.equal(f.adapter.updated.length, 0);
    assert.match(fs.readFileSync(path.join(copies, `${syncId}.git.md`), "utf8"), /newer git edit/);
  } finally { f.cleanup(); }
});

test("an Inkdrop edit during the cycle defers that note without overwriting it", async () => {
  const f = fixture([note("note:1", "Title", "base"), note("note:2", "Other", "base")]);
  const syncId = stableSyncId("note:1");
  try {
    await f.engine().run();
    writeExternal(f, syncId, note("", "Title", "git edit"));
    writeExternal(f, stableSyncId("note:2"), note("", "Other", "git edit 2"));
    const listNotes = f.adapter.listNotes.bind(f.adapter);
    f.adapter.listNotes = async () => {
      const snapshot = await listNotes();
      f.records.set("note:1", { ...f.records.get("note:1"), body: "typed meanwhile", rev: "5-z" });
      return snapshot;
    };
    const result = await f.engine().run();
    assert.match(result.warnings.join("\n"), /deferred/);
    assert.equal(f.records.get("note:1").body, "typed meanwhile");
    assert.equal(f.records.get("note:2").body, "git edit 2");
    f.adapter.listNotes = listNotes;
    assert.equal((await f.engine().run()).conflicts.length, 1);
  } finally { f.cleanup(); }
});

test("reports deletions and malformed files without deleting, importing, or blocking other notes", async () => {
  const f = fixture([note("note:1", "Title", "base"), note("note:2", "Healthy", "base")]);
  try {
    await f.engine().run();
    fs.unlinkSync(f.file(stableSyncId("note:1")));
    const deletion = await f.engine().run();
    assert.match(deletion.warnings[0], /deleted on the Git side/);
    assert.equal(f.records.has("note:1"), true);
    assert.equal(fs.existsSync(f.file(stableSyncId("note:1"))), false);

    fs.writeFileSync(f.file(EXTERNAL[1]), "bad front matter");
    fs.writeFileSync(path.join(f.workspace, "notes", "README.md"), "foreign");
    f.records.set("note:2", note("note:2", "Healthy", "edited", "2-a"));
    const malformed = await f.engine().run();
    assert.match(malformed.warnings.join("\n"), /malformed/);
    assert.equal(f.adapter.created.length, 0);
    assert.deepEqual(malformed.actions.map(action => action.type), ["export"]);
    assert.equal(fs.readFileSync(path.join(f.workspace, "notes", "README.md"), "utf8"), "foreign");
  } finally { f.cleanup(); }
});

test("preview writes no file, state, backup, or Inkdrop record", async () => {
  const f = fixture([note("note:1", "Title", "body")]);
  try {
    writeExternal(f, EXTERNAL[0], note("", "External", "x"));
    const result = await f.engine().run({ dryRun: true });
    assert.deepEqual(result.actions.map(action => action.type).sort(), ["export", "import"]);
    assert.equal(fs.existsSync(f.file(stableSyncId("note:1"))), false);
    assert.equal(fs.existsSync(path.join(f.workspace, ".inkdrop-git-sync")), false);
    assert.equal(f.adapter.created.length, 0);
  } finally { f.cleanup(); }
});

test("the first real cycle backs up the Inkdrop notes", async () => {
  const f = fixture([note("note:1", "Title", "body")]);
  try {
    const result = await f.engine().run();
    assert.ok(result.backup);
    assert.equal(JSON.parse(fs.readFileSync(result.backup, "utf8"))[0].body, "body");
    assert.equal((await f.engine().run()).backup, undefined);
  } finally { f.cleanup(); }
});

test("notes outside the notebook scope are ignored rather than treated as deleted", async () => {
  const f = fixture([note("note:1", "Outside", "body", "1-a", { book_path: ["Outside"] })]);
  try {
    writeExternal(f, EXTERNAL[0], note("", "Outside too", "x", "1-a", { book_path: ["Outside"] }));
    const engine = new SyncEngine({ adapter: f.adapter, workspace: f.workspace, includedBooks: ["Inside"] });
    const result = await engine.run();
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(f.adapter.created.length, 0);
  } finally { f.cleanup(); }
});

test("export mode reports a vanished note and keeps its file", async () => {
  const f = fixture([note("note:1", "Kept", "a"), note("note:2", "Gone", "b")]);
  try {
    await runExport({ adapter: f.adapter, workspace: f.workspace });
    f.records.delete("note:2");
    const result = await runExport({ adapter: f.adapter, workspace: f.workspace });
    assert.match(result.warnings[0], /Gone/);
    assert.equal(fs.existsSync(f.file(stableSyncId("note:2"))), true);
  } finally { f.cleanup(); }
});

test("resolveWorkspace expands ~, rejects ~user, the root and the home directory", () => {
  assert.equal(resolveWorkspace("~/InkdropGitSync"), path.join(os.homedir(), "InkdropGitSync"));
  assert.throws(() => resolveWorkspace("~someone/notes"), /~user/);
  assert.throws(() => resolveWorkspace("/"), /root/);
  assert.throws(() => resolveWorkspace("~"), /home/);
  assert.throws(() => resolveWorkspace(""), /required/);
});

test("Inkdrop millisecond dates and ISO dates serialise identically", () => {
  const fromInkdrop = serializeNote(EXTERNAL[0], note("", "T", "b", "1", { created_at: 1793984742534, updated_at: 1793984742534 }));
  const fromGit = serializeNote(EXTERNAL[0], note("", "T", "b", "1", { created_at: "2026-11-06T17:05:42.534Z", updated_at: "2026-11-06T17:05:42.534Z" }));
  assert.equal(fromInkdrop, fromGit);
});

test("a file that came from Inkdrop is never re-imported when its note is missing (trash, fresh bridge)", async () => {
  const f = fixture();
  const syncId = stableSyncId("note:trashed");
  try {
    fs.mkdirSync(path.join(f.workspace, "notes"));
    fs.writeFileSync(f.file(syncId), serializeNote(syncId, note("", "Trashed", "x"), "note:trashed"));
    const result = await f.engine().run();
    assert.equal(f.adapter.created.length, 0);
    assert.match(result.warnings[0], /not imported/);
    assert.equal(parseNote(fs.readFileSync(f.file(syncId), "utf8")).origin, "note:trashed");
  } finally { f.cleanup(); }
});

test("exported files record their Inkdrop origin; imported ones do not", async () => {
  const f = fixture([note("note:1", "Mine", "a")]);
  try {
    writeExternal(f, EXTERNAL[0], note("", "Agent", "b"));
    await f.engine().run();
    assert.equal(parseNote(fs.readFileSync(f.file(stableSyncId("note:1")), "utf8")).origin, "note:1");
    assert.equal(parseNote(fs.readFileSync(f.file(EXTERNAL[0]), "utf8")).origin, null);
  } finally { f.cleanup(); }
});

test("a note deleted on both sides is forgotten instead of warning forever", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  try {
    await f.engine().run();
    f.records.delete("note:1");
    fs.unlinkSync(f.file(stableSyncId("note:1")));
    const result = await f.engine().run();
    assert.deepEqual(result.actions.map(action => action.type), ["forget"]);
    const next = await f.engine().run();
    assert.deepEqual(next.warnings, []);
    assert.deepEqual(next.actions, []);
  } finally { f.cleanup(); }
});

test("an edited conflict copy is archived, never overwritten, when a side changes", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  const syncId = stableSyncId("note:1");
  const copies = path.join(f.workspace, ".inkdrop-git-sync", "conflicts");
  try {
    await f.engine().run();
    f.records.set("note:1", note("note:1", "Title", "ink edit", "2-a"));
    writeExternal(f, syncId, note("", "Title", "git edit"));
    await f.engine().run();
    fs.writeFileSync(path.join(copies, `${syncId}.inkdrop.md`), "my half-done merge");
    f.records.set("note:1", note("note:1", "Title", "ink edit 2", "3-a"));
    await f.engine().run();
    const archived = fs.readdirSync(path.join(copies, "archive"));
    assert.equal(archived.length, 1);
    assert.equal(fs.readFileSync(path.join(copies, "archive", archived[0]), "utf8"), "my half-done merge");
  } finally { f.cleanup(); }
});

test("without persist, the state is only saved on request", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  try {
    const engine = f.engine();
    const result = await engine.run({ persist: false });
    assert.deepEqual(readState(f.workspace).notes, {});
    engine.saveState(result);
    assert.equal(Object.keys(readState(f.workspace).notes).length, 1);
  } finally { f.cleanup(); }
});
