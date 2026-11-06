"use babel";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { GitService } = require("./git-service");
const { SyncEngine, assertSafeDirectory, resolveWorkspace, serializeNote } = require("./sync-engine");

const NAME = "inkdrop-git-sync";
const LEGACY_NAME = "autopush-notes";
const PAGE_SIZE = 100;

function configKey(name, legacy = false) {
  return `${legacy ? LEGACY_NAME : NAME}.${name}`;
}

function stableSyncId(value) {
  const bytes = Buffer.from(crypto.createHash("sha256").update(String(value)).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function allDocuments(collection) {
  const documents = [];
  let skip = 0;
  while (true) {
    const result = await collection.all({ limit: PAGE_SIZE, skip });
    const page = Array.isArray(result) ? result : result.docs || [];
    documents.push(...page);
    if (page.length < PAGE_SIZE) return documents;
    skip += page.length;
  }
}

class InkdropAdapter {
  constructor(db, includedBooks = []) {
    this.db = db;
    this.includedBooks = includedBooks.filter(Boolean);
  }

  async listNotes() {
    const notes = await allDocuments(this.db.notes);
    return notes.map((note) => ({
      id: note._id || note.id,
      rev: note._rev || note.rev,
      title: note.title,
      body: note.body,
      book_path: note.bookId ? [note.bookId] : [],
      tags: Array.isArray(note.tags) ? note.tags : [],
      status: note.status || "none",
      created_at: note.createdAt || note.created_at || "",
      updated_at: note.updatedAt || note.updated_at || "",
    }));
  }

  async createNote(note) {
    const now = new Date().toISOString();
    const payload = {
      _id: `note:${crypto.randomUUID()}`,
      doctype: "note",
      title: note.title,
      body: note.body,
      bookId: note.book_path[0] || undefined,
      tags: note.tags,
      status: note.status,
      createdAt: note.created_at || now,
      updatedAt: note.updated_at || now,
    };
    const response = await this.db.notes.put(payload);
    return { id: response.id || payload._id, rev: response.rev };
  }

  async updateNote(id, note, expectedRevision) {
    const current = await this.db.notes.get(id);
    if (expectedRevision && current._rev !== expectedRevision) {
      throw new Error(`${id}: Inkdrop note changed during synchronization; deferred`);
    }
    await this.db.notes.put({
      ...current,
      title: note.title,
      body: note.body,
      bookId: note.book_path[0] || current.bookId,
      tags: note.tags,
      status: note.status,
      updatedAt: note.updated_at || new Date().toISOString(),
    });
  }
}

module.exports = {
  interval: null,
  running: false,
  lastStatus: null,
  commandDisposable: null,

  activate() {
    if (global.__inkdropGitSyncBridge) {
      this.notify("Another Inkdrop Git Sync bridge is already active", "error");
      return;
    }
    global.__inkdropGitSyncBridge = true;
    this.migratePreferences();
    this.commandDisposable = inkdrop.commands.add(document.body, {
      "inkdrop-git-sync:syncNow": () => this.runCycle(false),
      "inkdrop-git-sync:preview": () => this.runCycle(true),
      "inkdrop-git-sync:openConflicts": () => this.openFolder("conflicts"),
      "inkdrop-git-sync:openFolder": () => this.openFolder(),
      "inkdrop-git-sync:toggle": () => this.toggle(),
      "autopush-notes:exportLocal": () => this.runCycle(true),
      "autopush-notes:exportAndPush": () => this.runCycle(false),
      "autopush-notes:toggle": () => this.toggle(),
    });
    if (this.get("enabled")) this.enableTimer();
  },

  deactivate() {
    this.disableTimer();
    if (this.commandDisposable && typeof this.commandDisposable.dispose === "function") this.commandDisposable.dispose();
    this.commandDisposable = null;
    delete global.__inkdropGitSyncBridge;
  },

  get(name) {
    return inkdrop.config.get(configKey(name));
  },

  migratePreferences() {
    if (this.get("migrationVersion")) return;
    const mappings = {
      enabled: "autoBackupEnabled",
      interval: "backupInterval",
      token: "githubToken",
      repository: "githubRepo",
      legacyExportFolder: "localExportPath",
    };
    for (const [next, previous] of Object.entries(mappings)) {
      const legacy = inkdrop.config.get(configKey(previous, true));
      if (legacy !== undefined && legacy !== null && legacy !== "") {
        inkdrop.config.set(configKey(next), legacy);
      }
    }
    inkdrop.config.set(configKey("mode"), "export");
    inkdrop.config.set(configKey("enabled"), false);
    inkdrop.config.set(configKey("migrationVersion"), 1);
    this.notify("Preferences migrated. Review the new sync folder before enabling bidirectional sync.");
  },

  toggle() {
    const enabled = !this.get("enabled");
    inkdrop.config.set(configKey("enabled"), enabled);
    if (enabled) this.enableTimer();
    else this.disableTimer();
    this.notify(`Inkdrop Git Sync ${enabled ? "enabled" : "disabled"}`);
  },

  enableTimer() {
    this.disableTimer();
    const minutes = Math.max(1, Number(this.get("interval")) || 5);
    this.interval = setInterval(() => this.runCycle(false), minutes * 60 * 1000);
  },

  disableTimer() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  },

  async runCycle(dryRun) {
    if (this.running) {
      this.notify("A synchronization cycle is already running");
      return this.lastStatus;
    }
    this.running = true;
    let git;
    try {
      const mode = this.get("mode") || "export";
      const folderSetting = mode === "sync" ? this.get("syncFolder") : this.get("legacyExportFolder");
      const workspace = assertSafeDirectory(resolveWorkspace(folderSetting));
      const includedBooks = String(this.get("includedBooks") || "").split(",").map((value) => value.trim()).filter(Boolean);
      const adapter = new InkdropAdapter(inkdrop.main.dataStore.getLocalDB(), includedBooks);
      git = new GitService({
        workspace,
        repository: this.get("repository"),
        branch: this.get("branch") || "main",
        token: this.get("token") || "",
      });
      await git.prepare();
      const result = mode === "sync"
        ? await new SyncEngine({ adapter, workspace, includedBooks }).run({ dryRun })
        : await this.runExport(adapter, workspace, dryRun, includedBooks);
      if (!dryRun) {
        await git.commitAndPush(result.changedFiles);
      }
      this.lastStatus = {
        ok: !result.conflicts.length && !result.warnings.length,
        at: new Date().toISOString(),
        ...result,
      };
      const summary = `${result.actions.length} action(s), ${result.conflicts.length} conflict(s), ${result.warnings.length} warning(s)`;
      this.notify(`${dryRun ? "Preview" : "Sync"} complete: ${summary}`, result.conflicts.length ? "warning" : "info");
      return this.lastStatus;
    } catch (error) {
      this.lastStatus = { ok: false, at: new Date().toISOString(), error: error.message };
      this.notify(`Inkdrop Git Sync failed: ${error.message}`, "error");
      throw error;
    } finally {
      if (git) git.dispose();
      this.running = false;
    }
  },

  async runExport(adapter, workspace, dryRun, includedBooks = []) {
    const result = { dryRun, actions: [], conflicts: [], warnings: [], changedFiles: [] };
    const notesDirectory = path.join(workspace, "notes");
    if (!dryRun) fs.mkdirSync(notesDirectory, { recursive: true });
    for (const note of await adapter.listNotes()) {
      if (includedBooks.length && !note.book_path.some(book => includedBooks.includes(book))) continue;
      const syncId = stableSyncId(note.id);
      const relative = path.join("notes", `${syncId}.md`);
      const target = path.join(workspace, relative);
      const content = serializeNote(syncId, note);
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
        result.actions.push({ type: "export", syncId, title: note.title });
        if (!dryRun) {
          fs.writeFileSync(target, content, "utf8");
          result.changedFiles.push(relative);
        }
      }
    }
    return result;
  },

  openFolder(target = "") {
    try {
      const workspace = resolveWorkspace(this.get("syncFolder"));
      const selected = target === "conflicts" ? path.join(workspace, ".inkdrop-git-sync", "conflicts") : workspace;
      fs.mkdirSync(selected, { recursive: true });
      require("electron").shell.openPath(selected);
    } catch (error) {
      this.notify(error.message, "error");
    }
  },

  notify(message, type = "info") {
    if (inkdrop.notifications) inkdrop.notifications.add({ message, type, dismissable: true });
    console[type === "error" ? "error" : "log"](`[${NAME}] ${message}`);
  },
};

module.exports.InkdropAdapter = InkdropAdapter;
module.exports.allDocuments = allDocuments;
