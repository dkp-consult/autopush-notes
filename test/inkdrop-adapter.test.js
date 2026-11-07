const assert = require("node:assert/strict");
const test = require("node:test");

const { InkdropAdapter, allDocuments, taskCounts } = require("../lib/inkdrop-adapter");
const { importedNoteId } = require("../lib/sync-engine");

const { fakeDb } = require("./support/fake-inkdrop");

let counter = 0;
const options = { now: () => 1800000000000, randomId: () => `id${++counter}` };

test("pages through a collection larger than the default limit", async () => {
  const source = Array.from({ length: 251 }, (_, index) => ({ _id: `note:${index}` }));
  const calls = [];
  const result = await allDocuments({ async all({ limit, skip }) { calls.push(skip); return { docs: source.slice(skip, skip + limit) }; } });
  assert.equal(result.length, 251);
  assert.deepEqual(calls, [0, 100, 200]);
});

test("reads a non-paginated collection once, however large", async () => {
  const books = Array.from({ length: 150 }, (_, index) => ({ _id: `book:${index}` }));
  let calls = 0;
  const result = await allDocuments({ async all() { calls += 1; return books; } });
  assert.equal(result.length, 150);
  assert.equal(calls, 1);
});

test("reports an incomplete read instead of trusting it", async () => {
  let reported = null;
  await allDocuments({ async all() { return { docs: [{ _id: "note:1" }], totalRows: 3 }; } }, { onIncomplete: (read, total) => { reported = [read, total]; } });
  assert.deepEqual(reported, [1, 3]);
});

test("lists notes with notebook paths, tag names and ISO-convertible dates, skipping the trash", async () => {
  const adapter = new InkdropAdapter(fakeDb(), options);
  const notes = await adapter.listNotes();
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].book_path, ["Work", "Projects"]);
  assert.deepEqual(notes[0].tags, ["urgent"]);
  assert.equal(notes[0].created_at, 1793984742534);
  assert.equal(notes[0].rev, "1-a");
});

test("creates an imported note Inkdrop accepts, with notebooks and tags created on demand", async () => {
  const db = fakeDb();
  const adapter = new InkdropAdapter(db, options);
  const syncId = "11111111-1111-4111-8111-111111111111";
  const created = await adapter.createNote(syncId, {
    title: "From agent", body: "- [ ] one", book_path: ["Work", "Agents"], tags: ["urgent", "hermes"],
    status: "onHold", created_at: "2026-11-06T17:05:42.534Z", updated_at: "",
  });
  assert.equal(created.id, importedNoteId(syncId));
  const stored = db.notes.store.get(created.id);
  assert.equal(stored.doctype, "markdown");
  assert.equal(stored.createdAt, Date.parse("2026-11-06T17:05:42.534Z"));
  assert.equal(stored.updatedAt, 1800000000000);
  assert.equal(stored.numOfTasks, 1);
  const agents = [...db.books.store.values()].find(book => book.name === "Agents");
  assert.equal(agents.parentBookId, "book:work");
  assert.equal(stored.bookId, agents._id);
  assert.equal(stored.tags[0], "tag:urgent");
  assert.equal(db.tags.store.get(stored.tags[1]).name, "hermes");
  // A second import of the same sync ID never creates a second document.
  await assert.rejects(adapter.createNote(syncId, { title: "x", body: "", book_path: ["Work"], tags: [], status: "none" }), /already exists/);
});

test("refuses to import a note without a notebook", async () => {
  const adapter = new InkdropAdapter(fakeDb(), options);
  await assert.rejects(
    adapter.createNote("22222222-2222-4222-8222-222222222222", { title: "x", body: "", book_path: [], tags: [], status: "none" }),
    /book_path is required/,
  );
});

test("updates a note in place, preserving unsupported fields and checking the revision", async () => {
  const db = fakeDb();
  const adapter = new InkdropAdapter(db, options);
  await adapter.updateNote("note:a", { title: "A2", body: "new", book_path: ["Work"], tags: [], status: "completed", updated_at: "" }, "1-a");
  const stored = db.notes.store.get("note:a");
  assert.equal(stored.title, "A2");
  assert.equal(stored.bookId, "book:work");
  assert.equal(stored.pinned, true);
  assert.equal(stored.numOfTasks, 0);
  assert.equal(typeof stored.updatedAt, "number");
  await assert.rejects(
    adapter.updateNote("note:a", { title: "A3", body: "", book_path: [], tags: [], status: "none" }, "1-a"),
    /changed during synchronization/,
  );
});

test("notebook scope accepts names or IDs and includes sub-notebooks", async () => {
  const adapter = new InkdropAdapter(fakeDb(), options);
  await adapter.listNotes();
  const byId = adapter.scope(["book:work"]);
  const byName = adapter.scope(["Projects"]);
  assert.equal(byId({ book_path: ["Work", "Projects"] }), true);
  assert.equal(byName({ book_path: ["Work", "Projects"] }), true);
  assert.equal(adapter.scope(["Personal"])({ book_path: ["Work"] }), false);
  assert.equal(adapter.scope([])({ book_path: [] }), true);
});

test("counts Markdown tasks", () => {
  assert.deepEqual(taskCounts("- [ ] a\n* [x] b\n  - [X] c\ntext [ ]"), { numOfTasks: 3, numOfCheckedTasks: 2 });
});
