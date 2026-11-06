const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SyncEngine, parseNote, readState, serializeNote } = require("../lib/sync-engine");

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function note(id, title, body, rev = "1-a") {
  return { id, rev, title, body, book_path: ["book"], tags: ["tag"], status: "none", created_at: "2026-01-01", updated_at: "2026-01-01" };
}

function fixture(notes = []) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-sync-test-"));
  const records = new Map(notes.map(item => [item.id, { ...item }]));
  const adapter = {
    created: [],
    updated: [],
    async listNotes() { return [...records.values()].map(item => ({ ...item })); },
    async createNote(value) {
      const id = `note:created-${this.created.length + 1}`;
      this.created.push({ id, ...value });
      records.set(id, { id, rev: "1-new", ...value });
      return { id, rev: "1-new" };
    },
    async updateNote(id, value, rev) {
      assert.equal(records.get(id).rev, rev);
      this.updated.push({ id, ...value });
      records.set(id, { id, rev: "2-next", ...value });
    },
  };
  return { workspace, adapter, records, cleanup: () => fs.rmSync(workspace, { recursive: true, force: true }) };
}

test("exports more than 100 notes with stable IDs and is idempotent", async () => {
  const notes = Array.from({ length: 205 }, (_, index) => note(`note:${index}`, "Same title", `body ${index}`));
  const f = fixture(notes);
  let index = 0;
  const uuid = () => `${String(++index).padStart(8, "0")}-0000-4000-8000-000000000000`;
  try {
    const first = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, uuid }).run();
    assert.equal(first.actions.length, 205);
    assert.equal(fs.readdirSync(path.join(f.workspace, "notes")).length, 205);
    const second = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, uuid }).run();
    assert.deepEqual(second.actions, []);
  } finally { f.cleanup(); }
});

test("imports a new external note once", async () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.workspace, "notes"));
    fs.writeFileSync(path.join(f.workspace, "notes", `${IDS[0]}.md`), serializeNote(IDS[0], note("unused", "External", "hello")));
    await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.equal(f.adapter.created.length, 1);
    await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.equal(f.adapter.created.length, 1);
  } finally { f.cleanup(); }
});

test("propagates one-sided edits and preserves renamed note identity", async () => {
  const f = fixture([note("note:1", "Before", "base")]);
  try {
    await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, uuid: () => IDS[0] }).run();
    f.records.set("note:1", note("note:1", "After", "from Inkdrop", "2-a"));
    const exported = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.equal(exported.actions[0].type, "export");
    assert.equal(parseNote(fs.readFileSync(path.join(f.workspace, "notes", `${IDS[0]}.md`), "utf8")).note.title, "After");
    const external = note("unused", "After", "from Git");
    fs.writeFileSync(path.join(f.workspace, "notes", `${IDS[0]}.md`), serializeNote(IDS[0], external));
    const imported = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.equal(imported.actions[0].type, "import-update");
    assert.equal(f.adapter.updated.at(-1).body, "from Git");
  } finally { f.cleanup(); }
});

test("keeps both concurrent edits as conflict copies", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  try {
    await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, uuid: () => IDS[0] }).run();
    f.records.set("note:1", note("note:1", "Title", "ink edit", "2-a"));
    fs.writeFileSync(path.join(f.workspace, "notes", `${IDS[0]}.md`), serializeNote(IDS[0], note("unused", "Title", "git edit")));
    const result = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.equal(result.conflicts.length, 1);
    assert.equal(f.adapter.updated.length, 0);
    assert.equal(fs.existsSync(path.join(f.workspace, ".inkdrop-git-sync", "conflicts", `${IDS[0]}.inkdrop.md`)), true);
    assert.equal(fs.existsSync(path.join(f.workspace, ".inkdrop-git-sync", "conflicts", `${IDS[0]}.git.md`)), true);
  } finally { f.cleanup(); }
});

test("reports deletions and malformed files without deleting or importing", async () => {
  const f = fixture([note("note:1", "Title", "base")]);
  try {
    await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, uuid: () => IDS[0] }).run();
    fs.unlinkSync(path.join(f.workspace, "notes", `${IDS[0]}.md`));
    const deletion = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.match(deletion.warnings[0], /deletion detected/);
    assert.equal(f.records.has("note:1"), true);
    fs.writeFileSync(path.join(f.workspace, "notes", `${IDS[1]}.md`), "bad front matter");
    const malformed = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace }).run();
    assert.match(malformed.warnings[0], /malformed/);
    assert.equal(f.adapter.created.length, 0);
  } finally { f.cleanup(); }
});

test("preview does not write files, state, or Inkdrop records", async () => {
  const f = fixture([note("note:1", "Title", "body")]);
  try {
    const result = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, uuid: () => IDS[0] }).run({ dryRun: true });
    assert.equal(result.actions.length, 1);
    assert.equal(fs.existsSync(path.join(f.workspace, "notes", `${IDS[0]}.md`)), false);
    assert.deepEqual(readState(f.workspace).mappings, {});
  } finally { f.cleanup(); }
});

test("notes outside notebook scope are ignored rather than treated as deleted", async () => {
  const f = fixture([note("note:1", "Outside", "body")]);
  f.records.get("note:1").book_path = ["outside"];
  try {
    const result = await new SyncEngine({ adapter: f.adapter, workspace: f.workspace, includedBooks: ["inside"], uuid: () => IDS[0] }).run();
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(fs.readdirSync(path.join(f.workspace, "notes")).length, 0);
  } finally { f.cleanup(); }
});
