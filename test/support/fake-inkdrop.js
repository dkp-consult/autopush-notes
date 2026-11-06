"use strict";

// Validation rules copied from the note, book and tag JSON schemas shipped in
// Inkdrop 6.3.0 (app.asar). A put that Inkdrop would reject throws here too.
const NOTE_REQUIRED = ["_id", "bookId", "title", "doctype", "body", "updatedAt", "createdAt", "timestamp"];
const STATUSES = ["none", "active", "onHold", "completed", "dropped"];

function validateNote(doc) {
  for (const key of NOTE_REQUIRED) if (doc[key] === undefined) throw new Error(`note: missing ${key}`);
  if (!/^note:/.test(doc._id)) throw new Error("note: bad _id");
  if (!/^(book:|trash$|template$)/.test(doc.bookId)) throw new Error("note: bad bookId");
  if (doc.doctype !== "markdown") throw new Error("note: doctype must be markdown");
  for (const key of ["createdAt", "updatedAt", "timestamp"]) if (typeof doc[key] !== "number") throw new Error(`note: ${key} must be a number`);
  if (doc.status !== undefined && !STATUSES.includes(doc.status)) throw new Error("note: bad status");
  if (doc.tags && (new Set(doc.tags).size !== doc.tags.length || doc.tags.some(tag => !/^tag:/.test(tag)))) throw new Error("note: bad tags");
}

function validateNamed(prefix) {
  return (doc) => {
    for (const key of ["_id", "name", "updatedAt", "createdAt"]) if (doc[key] === undefined) throw new Error(`${prefix}: missing ${key}`);
    if (!doc._id.startsWith(`${prefix}:`)) throw new Error(`${prefix}: bad _id`);
    if (!doc.name || doc.name.length > 64) throw new Error(`${prefix}: bad name`);
  };
}

function collection(docs, validate) {
  const store = new Map(docs.map(doc => [doc._id, { _rev: "1-a", ...doc }]));
  return {
    store,
    async all({ limit = 20, skip = 0 } = {}) {
      const values = [...store.values()];
      return { docs: values.slice(skip, skip + limit), totalRows: values.length, limit, skip };
    },
    async get(id) {
      if (!store.has(id)) { const error = new Error("missing"); error.status = 404; throw error; }
      return { ...store.get(id) };
    },
    async put(doc) {
      validate(doc);
      const current = store.get(doc._id);
      if (current && current._rev !== doc._rev) { const error = new Error("Document update conflict"); error.status = 409; throw error; }
      const rev = `${current ? Number(current._rev.split("-")[0]) + 1 : 1}-r`;
      store.set(doc._id, { ...doc, _rev: rev });
      return { ok: true, id: doc._id, rev };
    },
  };
}

function fakeDb() {
  const books = collection([
    { _id: "book:work", name: "Work", createdAt: 1, updatedAt: 1 },
    { _id: "book:projects", name: "Projects", parentBookId: "book:work", createdAt: 1, updatedAt: 1 },
  ], validateNamed("book"));
  const tags = collection([{ _id: "tag:urgent", name: "urgent", color: "red", createdAt: 1, updatedAt: 1 }], validateNamed("tag"));
  const notes = collection([
    { _id: "note:a", bookId: "book:projects", title: "A", doctype: "markdown", body: "- [x] done\n- [ ] todo", tags: ["tag:urgent"], status: "active", share: "private", pinned: true, createdAt: 1793984742534, updatedAt: 1793985663619, timestamp: 1793985663635 },
    { _id: "note:trashed", bookId: "trash", title: "T", doctype: "markdown", body: "", createdAt: 1, updatedAt: 1, timestamp: 1 },
  ], validateNote);
  return { books, tags, notes };
}

module.exports = { collection, fakeDb, validateNote };
