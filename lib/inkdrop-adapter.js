"use babel";

const crypto = require("crypto");
const { importedNoteId } = require("./sync-engine");

const PAGE_SIZE = 100;
// Pseudo-notebooks: a trashed note leaves the sync scope and is reported as a
// deletion, never exported or re-imported.
const PSEUDO_BOOKS = new Set(["trash", "template"]);
const NAME_MAX_LENGTH = 64;

// Inkdrop 6 answers { rows: [{ doc }], totalRows, cursor }; older releases
// answered { docs }.
function documentsOf(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows.map(row => row.doc || row).filter(Boolean);
  return (result && result.docs) || [];
}

// Inkdrop 6 exposes the local database as inkdrop.localDB; Inkdrop 5 exposed
// it through inkdrop.main.dataStore.getLocalDB().
function localDatabase(host = global.inkdrop) {
  if (host && host.localDB) return host.localDB;
  const store = host && host.main && host.main.dataStore;
  if (store && typeof store.getLocalDB === "function") return store.getLocalDB();
  throw new Error("Inkdrop's local database is not available");
}

// db.notes.all() defaults to limit: 20, so every read pages explicitly until a
// short page. totalRows is compared when present, but only reported: an
// incomplete read can at worst miss an export, never delete anything.
async function allDocuments(collection, { onIncomplete = null } = {}) {
  const documents = [];
  let skip = 0;
  let totalRows = null;
  while (true) {
    const result = await collection.all({ limit: PAGE_SIZE, skip });
    // A plain array means the collection is not paginated (books and tags):
    // it already holds everything, and asking again would loop forever.
    if (Array.isArray(result)) return skip === 0 ? result : documents;
    const page = documentsOf(result);
    if (totalRows === null && result && typeof result.totalRows === "number") totalRows = result.totalRows;
    documents.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += page.length;
  }
  if (onIncomplete && totalRows !== null && documents.length < totalRows) onIncomplete(documents.length, totalRows);
  return documents;
}

function toMilliseconds(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function taskCounts(body) {
  const tasks = body.match(/^\s*[-*+] \[[ xX]\]/gm) || [];
  return {
    numOfTasks: tasks.length,
    numOfCheckedTasks: tasks.filter(task => /\[[xX]\]/.test(task)).length,
  };
}

function isNotFound(error) {
  return error && (error.status === 404 || /missing|not.?found|deleted/i.test(String(error.message || error.reason || error.name)));
}

function assertName(name, kind) {
  if (!name || name.length > NAME_MAX_LENGTH) {
    throw new Error(`${kind} name must be 1 to ${NAME_MAX_LENGTH} characters: ${JSON.stringify(name)}`);
  }
}

// Translates between Inkdrop documents (IDs, millisecond timestamps) and the
// portable note format (notebook path and tag names, ISO dates). Writes follow
// the note schema shipped with Inkdrop 6: doctype "markdown", numeric dates and
// a timestamp, a bookId that must exist.
class InkdropAdapter {
  constructor(db, { now = () => Date.now(), randomId = () => crypto.randomBytes(9).toString("base64url") } = {}) {
    this.db = db;
    this.now = now;
    this.randomId = randomId;
    this.books = null;
    this.tags = null;
    this.incomplete = null;
  }

  async load() {
    if (this.books) return;
    this.books = new Map((await allDocuments(this.db.books)).map(book => [book._id, book]));
    this.tags = new Map((await allDocuments(this.db.tags)).map(tag => [tag._id, tag]));
  }

  bookPath(bookId) {
    const names = [];
    const seen = new Set();
    let current = this.books.get(bookId);
    while (current && !seen.has(current._id)) {
      seen.add(current._id);
      names.unshift(current.name);
      current = current.parentBookId ? this.books.get(current.parentBookId) : null;
    }
    return names;
  }

  findBook(name, parentBookId) {
    for (const book of this.books.values()) {
      if (book.name === name && (book.parentBookId || null) === (parentBookId || null)) return book._id;
    }
    return null;
  }

  findBookId(bookPath) {
    let parent = null;
    for (const name of bookPath) {
      parent = this.findBook(name, parent);
      if (!parent) return null;
    }
    return parent;
  }

  async ensureBookId(bookPath) {
    if (!bookPath.length) throw new Error("book_path is required to place a note in Inkdrop");
    let parent = null;
    for (const name of bookPath) {
      let id = this.findBook(name, parent);
      if (!id) {
        assertName(name, "Notebook");
        const now = this.now();
        const book = { _id: `book:${this.randomId()}`, name, count: 0, createdAt: now, updatedAt: now };
        if (parent) book.parentBookId = parent;
        const response = await this.db.books.put(book);
        this.books.set(book._id, { ...book, _rev: response && response.rev });
        id = book._id;
      }
      parent = id;
    }
    return parent;
  }

  async ensureTagIds(names) {
    const ids = [];
    for (const name of names) {
      let tag = [...this.tags.values()].find(candidate => candidate.name === name);
      if (!tag) {
        assertName(name, "Tag");
        const now = this.now();
        tag = { _id: `tag:${this.randomId()}`, name, color: "default", count: 0, createdAt: now, updatedAt: now };
        const response = await this.db.tags.put(tag);
        this.tags.set(tag._id, { ...tag, _rev: response && response.rev });
      }
      ids.push(tag._id);
    }
    return [...new Set(ids)];
  }

  async listNotes() {
    await this.load();
    const notes = await allDocuments(this.db.notes, {
      onIncomplete: (read, total) => { this.incomplete = { read, total }; },
    });
    return notes
      .filter(note => !PSEUDO_BOOKS.has(note.bookId))
      .map(note => ({ id: note._id, rev: note._rev, ...this.portable(note) }));
  }

  async getOrNull(id) {
    try {
      return await this.db.notes.get(id);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async createNote(syncId, note) {
    await this.load();
    const id = importedNoteId(syncId);
    if (await this.getOrNull(id)) {
      throw new Error(`Inkdrop note ${id} already exists (possibly in the trash); resolve manually`);
    }
    const now = this.now();
    const payload = {
      _id: id,
      doctype: "markdown",
      title: note.title,
      body: note.body,
      bookId: await this.ensureBookId(note.book_path),
      tags: await this.ensureTagIds(note.tags),
      status: note.status,
      share: "private",
      pinned: false,
      ...taskCounts(note.body),
      createdAt: toMilliseconds(note.created_at) || now,
      updatedAt: toMilliseconds(note.updated_at) || now,
      timestamp: now,
    };
    const response = await this.db.notes.put(payload);
    return { id, rev: response && response.rev, note: this.portable(payload) };
  }

  async updateNote(id, note, expectedRevision) {
    await this.load();
    const current = await this.db.notes.get(id);
    if (expectedRevision && current._rev !== expectedRevision) {
      throw new Error("Inkdrop note changed during synchronization; deferred to the next cycle");
    }
    const now = this.now();
    const bookId = note.book_path.length ? await this.ensureBookId(note.book_path) : current.bookId;
    const next = {
      ...current,
      title: note.title,
      body: note.body,
      bookId,
      tags: await this.ensureTagIds(note.tags),
      status: note.status,
      ...taskCounts(note.body),
      // A change arriving from Git is a change made now: it must surface at
      // the top of "Date Updated", whatever date the file carries.
      updatedAt: now,
      timestamp: now,
    };
    const response = await this.db.notes.put(next);
    return { rev: response && response.rev, note: this.portable(next) };
  }

  portable(doc) {
    return {
      title: doc.title,
      body: doc.body,
      book_path: this.bookPath(doc.bookId),
      tags: (doc.tags || []).map(id => (this.tags.get(id) || { name: id }).name),
      status: doc.status || "none",
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
    };
  }

  // Notebooks may be named or given by ID; a notebook includes its descendants.
  scope(includedBooks) {
    const included = new Set(includedBooks.filter(Boolean));
    if (!included.size) return () => true;
    return (note) => {
      if (note.book_path.some(name => included.has(name))) return true;
      for (let length = 1; length <= note.book_path.length; length += 1) {
        const id = this.findBookId(note.book_path.slice(0, length));
        if (id && included.has(id)) return true;
      }
      return false;
    };
  }
}

module.exports = { InkdropAdapter, allDocuments, localDatabase, taskCounts };
