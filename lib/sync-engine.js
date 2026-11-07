"use babel";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCHEMA_VERSION = 1;
const SYNC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ["none", "active", "onHold", "completed", "dropped"];
const STATE_DIRECTORY = ".inkdrop-git-sync";
const NOTES_DIRECTORY = "notes";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest();
}

// A note that originates in Inkdrop gets a sync ID derived from its Inkdrop ID,
// so every bridge (a second Mac, a reinstall, a lost local state) computes the
// same file for the same note instead of inventing a new one.
function stableSyncId(inkdropId) {
  const bytes = Buffer.from(sha256(String(inkdropId)).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The reverse direction: a note imported from Git gets an Inkdrop ID derived
// from its sync ID. An import interrupted before the state is saved, or the
// same import seen from another bridge through Inkdrop's own sync, then lands
// on the same Inkdrop document instead of a duplicate.
function importedNoteId(syncId) {
  return `note:gs${sha256(`inkdrop-git-sync:${syncId}`).toString("base64url").slice(0, 16)}`;
}

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
  if (!note) return null;
  return sha256(JSON.stringify(stable(note))).toString("hex");
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return "";
  const time = typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function normalizeNote(note) {
  const status = String(note.status || "none");
  return {
    title: String(note.title || "Untitled"),
    body: String(note.body || ""),
    book_path: Array.isArray(note.book_path) ? note.book_path.map(String).filter(Boolean) : [],
    tags: Array.isArray(note.tags) ? [...new Set(note.tags.map(String).filter(Boolean))].sort() : [],
    status: STATUSES.includes(status) ? status : "none",
    created_at: normalizeDate(note.created_at),
    updated_at: normalizeDate(note.updated_at),
  };
}

// `origin` is the Inkdrop ID of a note that was created in Inkdrop. It tells
// every bridge that this file must never be imported as a new note: if that
// Inkdrop note is missing locally it was trashed, deleted, or not downloaded by
// Inkdrop's own sync yet.
function originFor(syncId, inkdropId) {
  return inkdropId && stableSyncId(inkdropId) === syncId ? inkdropId : null;
}

function serializeNote(syncId, note, origin = null) {
  const normalized = normalizeNote(note);
  const fields = {
    schema_version: SCHEMA_VERSION,
    sync_id: syncId,
    ...(origin ? { inkdrop_id: origin } : {}),
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
    origin: typeof metadata.inkdrop_id === "string" ? originFor(metadata.sync_id, metadata.inkdrop_id) : null,
    note: normalizeNote({ ...metadata, body: match[2] }),
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveWorkspace(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) throw new Error("A sync folder is required");
  const trimmed = inputPath.trim();
  let expanded = trimmed;
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    expanded = path.join(os.homedir(), trimmed.slice(1));
  } else if (trimmed.startsWith("~")) {
    // "~user" needs a passwd lookup; refuse rather than guess.
    throw new Error(`Unsupported "~user" syntax in ${trimmed}; use an absolute path`);
  }
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) throw new Error("The filesystem root cannot be used as a sync folder");
  if (resolved === path.resolve(os.homedir())) throw new Error("The home directory cannot be used as a sync folder");
  return resolved;
}

function assertSafeDirectory(workspace, { create = true } = {}) {
  if (!create && !fs.existsSync(workspace)) return workspace;
  fs.mkdirSync(workspace, { recursive: true });
  const stat = fs.lstatSync(workspace);
  if (stat.isSymbolicLink()) throw new Error("The sync folder cannot be a symbolic link");
  const realWorkspace = fs.realpathSync(workspace);
  for (const child of [NOTES_DIRECTORY, STATE_DIRECTORY]) {
    const candidate = path.join(realWorkspace, child);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`${child} cannot be a symbolic link`);
    }
    if (!isInside(realWorkspace, candidate)) throw new Error("Unsafe sync path");
  }
  return realWorkspace;
}

function statePath(workspace) {
  return path.join(workspace, STATE_DIRECTORY, "state.json");
}

function readState(workspace) {
  const target = statePath(workspace);
  if (!fs.existsSync(target)) return { version: 1, mappings: {}, notes: {}, conflicts: {}, lastCommit: null };
  const state = JSON.parse(fs.readFileSync(target, "utf8"));
  if (state.version !== 1 || !state.mappings || !state.notes) throw new Error("Unsupported local sync state");
  if (!state.conflicts) state.conflicts = {};
  return state;
}

function writeState(workspace, state) {
  const directory = path.join(workspace, STATE_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  const target = statePath(workspace);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

function recordLastCommit(workspace, commit) {
  if (!commit || !fs.existsSync(statePath(workspace))) return;
  const state = readState(workspace);
  state.lastCommit = commit;
  writeState(workspace, state);
}

// Records every managed file the plugin writes until it is committed. After an
// interruption (Inkdrop quit mid-cycle), uncommitted files that still match the
// journal are the plugin's own and can be committed; anything else in notes/ is
// an external change and stops the cycle.
class WriteJournal {
  constructor(workspace) {
    this.workspace = workspace;
    this.file = path.join(workspace, STATE_DIRECTORY, "pending-writes.log");
  }

  record(relative, content) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${relative}\t${sha256(content).toString("hex")}\n`);
  }

  isOwn(relative) {
    if (!fs.existsSync(this.file)) return false;
    let hash = null;
    for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
      const [entry, value] = line.split("\t");
      if (entry === relative && value) hash = value;
    }
    const target = path.join(this.workspace, relative);
    if (!hash || !fs.existsSync(target)) return false;
    return sha256(fs.readFileSync(target)).toString("hex") === hash;
  }

  clear() {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }
}

// `files`, when given, maps a filename in notes/ to its content. The preview uses
// it to compare against the remote branch without touching the working tree.
function readExternalNotes(workspace, files = null) {
  const notesDirectory = path.join(workspace, NOTES_DIRECTORY);
  let sources = files;
  if (!sources) {
    sources = new Map();
    if (fs.existsSync(notesDirectory)) {
      for (const entry of fs.readdirSync(notesDirectory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          sources.set(entry.name, () => fs.readFileSync(path.join(notesDirectory, entry.name), "utf8"));
        }
      }
    }
  }
  const notes = new Map();
  const origins = new Map();
  const blocked = new Map();
  for (const [name, source] of sources) {
    if (!name.endsWith(".md")) continue;
    const filenameId = name.slice(0, -3);
    if (!SYNC_ID_PATTERN.test(filenameId)) continue;
    try {
      const parsed = parseNote(typeof source === "function" ? source() : source, name);
      if (parsed.syncId !== filenameId) throw new Error(`${name}: filename and sync_id differ`);
      notes.set(parsed.syncId, parsed.note);
      if (parsed.origin) origins.set(parsed.syncId, parsed.origin);
    } catch (error) {
      blocked.set(filenameId, error.message);
    }
  }
  return { notes, origins, blocked };
}

function defaultScope(includedBooks) {
  return (note) => !includedBooks.length || note.book_path.some(book => includedBooks.includes(book));
}

function conflictCopyPaths(workspace, syncId) {
  const directory = path.join(workspace, STATE_DIRECTORY, "conflicts");
  return {
    directory,
    inkdrop: path.join(directory, `${syncId}.inkdrop.md`),
    git: path.join(directory, `${syncId}.git.md`),
  };
}

class SyncEngine {
  constructor({ adapter, workspace, includedBooks = [], inScope = null }) {
    this.adapter = adapter;
    this.workspace = assertSafeDirectory(resolveWorkspace(workspace), { create: false });
    this.inScope = inScope || defaultScope(includedBooks);
    this.journal = new WriteJournal(this.workspace);
  }

  // `persist: false` leaves the state to the caller, which saves it with
  // saveState() only once the commit is pushed: until then the common version
  // must stay the one both sides last agreed on.
  async run({ dryRun = false, externalFiles = null, persist = true } = {}) {
    const hadState = fs.existsSync(statePath(this.workspace));
    const state = readState(this.workspace);
    const inkdropNotes = await this.adapter.listNotes();
    const external = readExternalNotes(this.workspace, externalFiles);
    const result = { dryRun, actions: [], conflicts: [], warnings: [], changedFiles: [] };
    for (const message of external.blocked.values()) {
      result.warnings.push(`${message}; this note is blocked until the file is fixed`);
    }

    if (!dryRun && !hadState && inkdropNotes.length) this.backup(inkdropNotes, result);

    const knownSyncIds = [...external.notes.keys(), ...external.blocked.keys(), ...Object.keys(state.notes)];
    const importedIds = new Map(knownSyncIds.map(syncId => [importedNoteId(syncId), syncId]));
    const mappedInkdropIds = new Map(Object.entries(state.mappings).map(([syncId, inkdropId]) => [inkdropId, syncId]));
    const inkBySyncId = new Map();
    for (const note of inkdropNotes) {
      const syncId = mappedInkdropIds.get(note.id) || importedIds.get(note.id) || stableSyncId(note.id);
      if (inkBySyncId.has(syncId)) {
        result.warnings.push(`${syncId}: several Inkdrop notes claim this sync ID; resolve manually`);
        external.blocked.set(syncId, "duplicate");
        continue;
      }
      inkBySyncId.set(syncId, note);
    }

    const allIds = [...new Set([...Object.keys(state.notes), ...inkBySyncId.keys(), ...external.notes.keys()])].sort();
    for (const syncId of allIds) {
      if (external.blocked.has(syncId)) continue;
      const inkRecord = inkBySyncId.get(syncId) || null;
      const ink = inkRecord ? normalizeNote(inkRecord) : null;
      const git = external.notes.get(syncId) || null;
      const common = state.notes[syncId] ? state.notes[syncId].common : null;
      if (!this.inScope(ink || git || common)) continue;
      try {
        await this.reconcile({ syncId, inkRecord, ink, git, origin: external.origins.get(syncId) || null, common, state, result, dryRun });
      } catch (error) {
        // One note failing (revision changed, invalid notebook…) defers that note
        // only; its common state is untouched so the next cycle retries it.
        result.warnings.push(`${syncId}: ${error.message}`);
      }
    }

    Object.defineProperty(result, "state", { value: state, enumerable: false });
    if (!dryRun && persist) writeState(this.workspace, state);
    return result;
  }

  saveState(result) {
    if (!result.dryRun && result.state) writeState(this.workspace, result.state);
  }

  async reconcile({ syncId, inkRecord, ink, git, origin, common, state, result, dryRun }) {
    const recorded = state.conflicts[syncId];
    if (recorded) {
      const resolution = this.readResolution(syncId);
      if (resolution === false) {
        result.warnings.push(`${syncId}: the remaining conflict copy is malformed; fix it or restore both copies`);
        return;
      }
      if (resolution) {
        if (fingerprint(ink) !== recorded.ink || fingerprint(git) !== recorded.git) {
          // A side moved after the copies were written: the kept copy is stale.
          this.addConflict(result, state, syncId, "changed-since-conflict", ink, git, dryRun, true);
          return;
        }
        result.actions.push({ type: "resolve", syncId, title: resolution.title });
        if (!dryRun) await this.apply(syncId, resolution, inkRecord, ink, git, state, result);
        return;
      }
    }

    if (!common) {
      if (ink && !git) {
        result.actions.push({ type: "export", syncId, title: ink.title });
        if (!dryRun) {
          this.writeManagedFile(syncId, ink, result, inkRecord.id);
          this.confirm(state, syncId, inkRecord.id, ink);
        }
      } else if (!ink && git && origin) {
        result.warnings.push(`${syncId} (${git.title}): Inkdrop note ${origin} is not in this Inkdrop (trashed, deleted, or not downloaded yet); not imported`);
      } else if (!ink && git) {
        result.actions.push({ type: "import", syncId, title: git.title });
        if (!dryRun) {
          const created = await this.adapter.createNote(syncId, git);
          this.settle(syncId, created, git, state, result);
        }
      } else if (ink && git && fingerprint(ink) === fingerprint(git)) {
        result.actions.push({ type: "match", syncId, title: ink.title });
        if (!dryRun) this.confirm(state, syncId, inkRecord.id, ink);
      } else if (ink && git) {
        this.addConflict(result, state, syncId, "initial-ambiguity", ink, git, dryRun);
      }
      return;
    }

    if (!ink && !git) {
      // Deleted on both sides: the deletion is settled, stop tracking it.
      result.actions.push({ type: "forget", syncId, title: common.title });
      if (!dryRun) {
        delete state.notes[syncId];
        delete state.mappings[syncId];
        delete state.conflicts[syncId];
      }
      return;
    }
    if (!ink || !git) {
      result.warnings.push(`${syncId} (${common.title}): deleted on the ${ink ? "Git" : "Inkdrop"} side; manual resolution required`);
      return;
    }
    const inkChanged = fingerprint(ink) !== fingerprint(common);
    const gitChanged = fingerprint(git) !== fingerprint(common);
    if (!inkChanged && !gitChanged) return;
    if (inkChanged && gitChanged && fingerprint(ink) !== fingerprint(git)) {
      this.addConflict(result, state, syncId, "concurrent-edit", ink, git, dryRun);
    } else if (inkChanged && !gitChanged) {
      result.actions.push({ type: "export", syncId, title: ink.title });
      if (!dryRun) {
        this.writeManagedFile(syncId, ink, result, inkRecord.id);
        this.confirm(state, syncId, inkRecord.id, ink);
      }
    } else if (!inkChanged && gitChanged) {
      result.actions.push({ type: "import-update", syncId, title: git.title });
      if (!dryRun) {
        const updated = await this.adapter.updateNote(inkRecord.id, git, inkRecord.rev);
        this.settle(syncId, { id: inkRecord.id, ...updated }, git, state, result);
      }
    } else {
      result.actions.push({ type: "match", syncId, title: ink.title });
      if (!dryRun) this.confirm(state, syncId, inkRecord.id, ink);
    }
  }

  // Applies the version the user kept in the conflicts folder to both sides.
  async apply(syncId, note, inkRecord, ink, git, state, result) {
    let written = { id: inkRecord && inkRecord.id };
    if (!inkRecord) written = await this.adapter.createNote(syncId, note);
    else if (fingerprint(ink) !== fingerprint(note)) written = { id: inkRecord.id, ...(await this.adapter.updateNote(inkRecord.id, note, inkRecord.rev)) };
    this.settle(syncId, written, git, state, result, note);
  }

  // After a write to Inkdrop, records what Inkdrop actually stored (it fills in
  // missing dates, for instance) and brings the file level with it in the same
  // cycle, so the next cycle does not see a change and bounce it back.
  settle(syncId, written, git, state, result, intended = git) {
    const stored = written && written.note ? normalizeNote(written.note) : normalizeNote(intended);
    if (fingerprint(git) !== fingerprint(stored)) this.writeManagedFile(syncId, stored, result, written.id);
    this.confirm(state, syncId, written.id, stored);
  }

  // The kept note when exactly one copy remains, null while the conflict is
  // still open, false when the remaining copy cannot be parsed.
  readResolution(syncId) {
    const copies = conflictCopyPaths(this.workspace, syncId);
    const remaining = [copies.inkdrop, copies.git].filter(file => fs.existsSync(file));
    if (remaining.length !== 1) return null;
    try {
      const parsed = parseNote(fs.readFileSync(remaining[0], "utf8"), path.basename(remaining[0]));
      return parsed.syncId === syncId ? parsed.note : false;
    } catch (_error) {
      return false;
    }
  }

  confirm(state, syncId, inkdropId, note) {
    const common = normalizeNote(note);
    state.mappings[syncId] = inkdropId;
    state.notes[syncId] = { common, fingerprint: fingerprint(common) };
    if (state.conflicts[syncId]) {
      delete state.conflicts[syncId];
      const copies = conflictCopyPaths(this.workspace, syncId);
      for (const file of [copies.inkdrop, copies.git]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  writeManagedFile(syncId, note, result, inkdropId = null) {
    const relative = `${NOTES_DIRECTORY}/${syncId}.md`;
    const content = serializeNote(syncId, note, originFor(syncId, inkdropId));
    fs.mkdirSync(path.join(this.workspace, NOTES_DIRECTORY), { recursive: true });
    this.journal.record(relative, content);
    fs.writeFileSync(path.join(this.workspace, relative), content, "utf8");
    result.changedFiles.push(relative);
  }

  addConflict(result, state, syncId, reason, ink, git, dryRun, force = false) {
    result.conflicts.push({ syncId, reason, title: (ink || git).title });
    if (dryRun) return;
    const fingerprints = { ink: fingerprint(ink), git: fingerprint(git) };
    const previous = state.conflicts[syncId];
    const copies = conflictCopyPaths(this.workspace, syncId);
    const unchanged = previous && previous.ink === fingerprints.ink && previous.git === fingerprints.git;
    // Leave the copies alone while neither side moves: the user may be editing one.
    if (force || !unchanged || !fs.existsSync(copies.inkdrop) || !fs.existsSync(copies.git)) {
      fs.mkdirSync(copies.directory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      for (const [file, note] of [[copies.inkdrop, ink], [copies.git, git]]) {
        if (!note) continue;
        const content = serializeNote(syncId, note);
        // A copy the user may have edited is archived, never overwritten.
        if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== content) {
          const archive = path.join(copies.directory, "archive");
          fs.mkdirSync(archive, { recursive: true });
          fs.renameSync(file, path.join(archive, `${path.basename(file, ".md")}.${stamp}.md`));
        }
        fs.writeFileSync(file, content, "utf8");
      }
    }
    state.conflicts[syncId] = { reason, title: (ink || git).title, ...fingerprints };
  }

  backup(inkdropNotes, result) {
    const directory = path.join(this.workspace, STATE_DIRECTORY, "backups");
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `inkdrop-notes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(target, `${JSON.stringify(inkdropNotes, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    result.backup = target;
  }
}

// One-way export kept for existing installations. Same file format and the same
// stable IDs as sync mode, so switching modes later recognises every note.
async function runExport({ adapter, workspace, dryRun = false, includedBooks = [], inScope = null }) {
  const scope = inScope || defaultScope(includedBooks);
  const journal = new WriteJournal(workspace);
  const result = { dryRun, actions: [], conflicts: [], warnings: [], changedFiles: [] };
  const exported = new Set();
  for (const record of await adapter.listNotes()) {
    const note = normalizeNote(record);
    if (!scope(note)) continue;
    const syncId = stableSyncId(record.id);
    exported.add(syncId);
    const relative = `${NOTES_DIRECTORY}/${syncId}.md`;
    const target = path.join(workspace, relative);
    const content = serializeNote(syncId, note, record.id);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      result.actions.push({ type: "export", syncId, title: note.title });
      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        journal.record(relative, content);
        fs.writeFileSync(target, content, "utf8");
        result.changedFiles.push(relative);
      }
    }
  }
  // Deletions are reported, never propagated.
  for (const [syncId, note] of readExternalNotes(workspace).notes) {
    if (!exported.has(syncId) && scope(note)) {
      result.warnings.push(`${syncId} (${note.title}): no matching Inkdrop note; the file is kept`);
    }
  }
  return result;
}

module.exports = {
  NOTES_DIRECTORY,
  STATE_DIRECTORY,
  SyncEngine,
  WriteJournal,
  assertSafeDirectory,
  fingerprint,
  importedNoteId,
  normalizeNote,
  parseNote,
  readExternalNotes,
  readState,
  recordLastCommit,
  resolveWorkspace,
  runExport,
  serializeNote,
  stableSyncId,
  writeState,
};
