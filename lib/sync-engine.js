"use babel";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 1;
const SYNC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function fingerprint(note) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(note))).digest("hex");
}

function normalizeNote(note) {
  return {
    title: String(note.title || "Untitled"),
    body: String(note.body || ""),
    book_path: Array.isArray(note.book_path) ? note.book_path.map(String) : [],
    tags: Array.isArray(note.tags) ? [...new Set(note.tags.map(String))].sort() : [],
    status: String(note.status || "none"),
    created_at: note.created_at ? String(note.created_at) : "",
    updated_at: note.updated_at ? String(note.updated_at) : "",
  };
}

function serializeNote(syncId, note) {
  const normalized = normalizeNote(note);
  const fields = {
    schema_version: SCHEMA_VERSION,
    sync_id: syncId,
    title: normalized.title,
    book_path: normalized.book_path,
    tags: normalized.tags,
    status: normalized.status,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
  };
  const header = Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${header}\n---\n${normalized.body}`;
}

function parseNote(source, filename = "note") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${filename}: missing or malformed front matter`);
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${filename}: malformed front matter line`);
    const key = line.slice(0, separator).trim();
    try {
      metadata[key] = JSON.parse(line.slice(separator + 1).trim());
    } catch (_error) {
      throw new Error(`${filename}: invalid value for ${key}`);
    }
  }
  if (metadata.schema_version !== SCHEMA_VERSION) {
    throw new Error(`${filename}: unsupported schema_version`);
  }
  if (!SYNC_ID_PATTERN.test(metadata.sync_id || "")) {
    throw new Error(`${filename}: invalid sync_id`);
  }
  return {
    syncId: metadata.sync_id,
    note: normalizeNote({ ...metadata, body: match[2] }),
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function resolveWorkspace(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) throw new Error("A sync folder is required");
  const expanded = inputPath.startsWith("~")
    ? path.join(require("os").homedir(), inputPath.slice(1))
    : inputPath;
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) throw new Error("The filesystem root cannot be used as a sync folder");
  return resolved;
}

function assertSafeDirectory(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  const realWorkspace = fs.realpathSync(workspace);
  const stat = fs.lstatSync(workspace);
  if (stat.isSymbolicLink()) throw new Error("The sync folder cannot be a symbolic link");
  for (const child of ["notes", ".inkdrop-git-sync"]) {
    const candidate = path.join(realWorkspace, child);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`${child} cannot be a symbolic link`);
    }
    if (!isInside(realWorkspace, candidate)) throw new Error("Unsafe sync path");
  }
  return realWorkspace;
}

function readState(workspace) {
  const statePath = path.join(workspace, ".inkdrop-git-sync", "state.json");
  if (!fs.existsSync(statePath)) return { version: 1, mappings: {}, notes: {}, lastCommit: null };
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state.version !== 1 || !state.mappings || !state.notes) throw new Error("Unsupported local sync state");
  return state;
}

function writeState(workspace, state) {
  const directory = path.join(workspace, ".inkdrop-git-sync");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "state.json");
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

function readExternalNotes(workspace) {
  const notesDirectory = path.join(workspace, "notes");
  fs.mkdirSync(notesDirectory, { recursive: true });
  const notes = new Map();
  const malformed = [];
  for (const entry of fs.readdirSync(notesDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filenameId = entry.name.slice(0, -3);
    if (!SYNC_ID_PATTERN.test(filenameId)) continue;
    try {
      const parsed = parseNote(fs.readFileSync(path.join(notesDirectory, entry.name), "utf8"), entry.name);
      if (parsed.syncId !== filenameId) throw new Error(`${entry.name}: filename and sync_id differ`);
      if (notes.has(parsed.syncId)) throw new Error(`${entry.name}: duplicate sync_id`);
      notes.set(parsed.syncId, parsed.note);
    } catch (error) {
      malformed.push(error.message);
    }
  }
  return { notes, malformed };
}

class SyncEngine {
  constructor({ adapter, workspace, includedBooks = [], uuid = () => crypto.randomUUID() }) {
    this.adapter = adapter;
    this.workspace = assertSafeDirectory(resolveWorkspace(workspace));
    this.includedBooks = includedBooks;
    this.uuid = uuid;
  }

  async run({ dryRun = false } = {}) {
    const state = readState(this.workspace);
    const inkdropNotes = await this.adapter.listNotes();
    const external = readExternalNotes(this.workspace);
    const result = { dryRun, actions: [], conflicts: [], warnings: [...external.malformed], changedFiles: [] };
    if (external.malformed.length) return result;

    const inkBySyncId = new Map();
    const inkById = new Map(inkdropNotes.map(note => [note.id, note]));
    for (const [syncId, inkdropId] of Object.entries(state.mappings)) {
      if (inkById.has(inkdropId)) inkBySyncId.set(syncId, inkById.get(inkdropId));
    }
    for (const note of inkdropNotes) {
      if ([...inkBySyncId.values()].includes(note)) continue;
      let syncId = this.uuid();
      while (external.notes.has(syncId) || inkBySyncId.has(syncId)) syncId = this.uuid();
      inkBySyncId.set(syncId, note);
    }

    const allIds = new Set([...Object.keys(state.notes), ...inkBySyncId.keys(), ...external.notes.keys()]);
    for (const syncId of allIds) {
      const inkRecord = inkBySyncId.get(syncId);
      const ink = inkRecord ? normalizeNote(inkRecord) : null;
      const git = external.notes.get(syncId) || null;
      const common = state.notes[syncId] ? state.notes[syncId].common : null;
      if (this.includedBooks.length) {
        const candidate = ink || git || common;
        if (!candidate || !candidate.book_path.some(book => this.includedBooks.includes(book))) continue;
      }

      if (!common) {
        if (ink && !git) {
          result.actions.push({ type: "export", syncId, title: ink.title });
          if (!dryRun) this.writeManagedFile(syncId, ink, result);
          if (!dryRun) this.confirm(state, syncId, inkRecord.id, ink);
        } else if (!ink && git) {
          result.actions.push({ type: "import", syncId, title: git.title });
          if (!dryRun) {
            const created = await this.adapter.createNote(git);
            this.confirm(state, syncId, created.id, git);
          }
        } else if (ink && git && fingerprint(ink) === fingerprint(git)) {
          result.actions.push({ type: "match", syncId, title: ink.title });
          if (!dryRun) this.confirm(state, syncId, inkRecord.id, ink);
        } else if (ink && git) {
          this.addConflict(result, syncId, "initial-ambiguity", ink, git, dryRun);
        }
        continue;
      }

      if (!ink || !git) {
        result.warnings.push(`${syncId}: deletion detected; manual resolution required`);
        continue;
      }
      const inkChanged = fingerprint(ink) !== fingerprint(common);
      const gitChanged = fingerprint(git) !== fingerprint(common);
      if (!inkChanged && !gitChanged) continue;
      if (inkChanged && gitChanged && fingerprint(ink) !== fingerprint(git)) {
        this.addConflict(result, syncId, "concurrent-edit", ink, git, dryRun);
      } else if (inkChanged && !gitChanged) {
        result.actions.push({ type: "export", syncId, title: ink.title });
        if (!dryRun) {
          this.writeManagedFile(syncId, ink, result);
          this.confirm(state, syncId, inkRecord.id, ink);
        }
      } else if (!inkChanged && gitChanged) {
        result.actions.push({ type: "import-update", syncId, title: git.title });
        if (!dryRun) {
          await this.adapter.updateNote(inkRecord.id, git, inkRecord.rev);
          this.confirm(state, syncId, inkRecord.id, git);
        }
      } else {
        result.actions.push({ type: "match", syncId, title: ink.title });
        if (!dryRun) this.confirm(state, syncId, inkRecord.id, ink);
      }
    }

    if (!dryRun) writeState(this.workspace, state);
    return result;
  }

  confirm(state, syncId, inkdropId, note) {
    state.mappings[syncId] = inkdropId;
    state.notes[syncId] = { common: normalizeNote(note), fingerprint: fingerprint(normalizeNote(note)) };
  }

  writeManagedFile(syncId, note, result) {
    const relative = path.join("notes", `${syncId}.md`);
    fs.writeFileSync(path.join(this.workspace, relative), serializeNote(syncId, note), "utf8");
    result.changedFiles.push(relative);
  }

  addConflict(result, syncId, reason, ink, git, dryRun) {
    result.conflicts.push({ syncId, reason, title: ink.title || git.title });
    if (dryRun) return;
    const directory = path.join(this.workspace, ".inkdrop-git-sync", "conflicts");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${syncId}.inkdrop.md`), serializeNote(syncId, ink), "utf8");
    fs.writeFileSync(path.join(directory, `${syncId}.git.md`), serializeNote(syncId, git), "utf8");
  }
}

module.exports = {
  SyncEngine,
  assertSafeDirectory,
  fingerprint,
  normalizeNote,
  parseNote,
  readState,
  resolveWorkspace,
  serializeNote,
};
