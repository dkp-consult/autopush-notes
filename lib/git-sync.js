"use babel";

const fs = require("fs");
const path = require("path");
const { GitService } = require("./git-service");
const { InkdropAdapter, allDocuments, localDatabase } = require("./inkdrop-adapter");
const {
  STATE_DIRECTORY,
  SyncEngine,
  WriteJournal,
  assertSafeDirectory,
  readState,
  recordLastCommit,
  resolveWorkspace,
  runExport,
} = require("./sync-engine");

const NAME = "git-sync";
const LEGACY_NAME = "autopush-notes";

function configKey(name, legacy = false) {
  return `${legacy ? LEGACY_NAME : NAME}.${name}`;
}

function summarize(result) {
  return `${result.actions.length} action(s), ${result.conflicts.length} conflict(s), ${result.warnings.length} warning(s)`;
}

module.exports = {
  timer: null,
  running: false,
  previewedFolder: null,
  lastStatus: null,
  lastSuccessAt: null,
  disposables: [],
  owner: false,

  activate() {
    if (global.__inkdropGitSyncBridge) {
      this.notify("Another Git Sync bridge is already active", "error");
      return;
    }
    global.__inkdropGitSyncBridge = true;
    this.owner = true;
    this.migratePreferences();
    this.warnAboutLegacyExportPath();
    const legacyAlias = handler => () => {
      if (!this.legacyPluginActive()) handler();
    };
    this.disposables.push(inkdrop.commands.add(document.body, {
      "git-sync:syncNow": () => this.runSafely(false),
      "git-sync:preview": () => this.runSafely(true),
      "git-sync:status": () => this.showStatus(),
      "git-sync:openConflicts": () => this.openFolder("conflicts"),
      "git-sync:openFolder": () => this.openFolder(),
      "git-sync:toggle": () => this.toggle(),
      // Aliases stay silent while the old package is active, so one command never
      // drives two plugins against the same repository.
      "autopush-notes:exportLocal": legacyAlias(() => this.runSafely(false, { push: false })),
      "autopush-notes:exportAndPush": legacyAlias(() => this.runSafely(false)),
      "autopush-notes:toggle": legacyAlias(() => this.toggle()),
    }));
    if (inkdrop.config.onDidChange) {
      for (const key of ["enabled", "interval"]) {
        this.disposables.push(inkdrop.config.onDidChange(configKey(key), () => this.applySchedule()));
      }
    }
    this.applySchedule();
  },

  deactivate() {
    this.disableTimer();
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") disposable.dispose();
    }
    this.disposables = [];
    if (this.owner) delete global.__inkdropGitSyncBridge;
    this.owner = false;
  },

  get(name) {
    return inkdrop.config.get(configKey(name));
  },

  legacyPluginActive() {
    const packages = global.inkdrop && inkdrop.packages;
    return Boolean(packages && typeof packages.isPackageActive === "function" && packages.isPackageActive(LEGACY_NAME));
  },

  migratePreferences() {
    if (this.get("migrationVersion")) return;
    const mappings = {
      interval: "backupInterval",
      token: "githubToken",
      repository: "githubRepo",
      legacyExportFolder: "localExportPath",
    };
    let migrated = false;
    for (const [next, previous] of Object.entries(mappings)) {
      const legacy = inkdrop.config.get(configKey(previous, true));
      if (legacy !== undefined && legacy !== null && legacy !== "") {
        inkdrop.config.set(configKey(next), legacy);
        migrated = true;
      }
    }
    inkdrop.config.set(configKey("mode"), "export");
    inkdrop.config.set(configKey("enabled"), false);
    inkdrop.config.set(configKey("migrationVersion"), 1);
    if (migrated) {
      this.notify("autopush-notes preferences imported. Scheduling is off: review the settings, run a preview, then enable it.");
    }
  },

  // autopush-notes up to 0.0.4 never expanded "~", so its backups landed in a
  // directory literally named "~" under Inkdrop's working directory. Point the
  // user at it; never move it (its .git/config may hold the token in clear).
  findLegacyStrayExport() {
    const configured = inkdrop.config.get(configKey("localExportPath", true)) || "~/Documents/InkdropNotes";
    if (typeof configured !== "string" || !configured.startsWith("~")) return null;
    const stray = path.resolve(process.cwd(), configured);
    try {
      if (stray === resolveWorkspace(configured)) return null;
    } catch (_error) {
      // Unsupported "~user" syntax: the stray path is still worth checking.
    }
    return fs.existsSync(stray) ? stray : null;
  },

  warnAboutLegacyExportPath() {
    const stray = this.findLegacyStrayExport();
    if (!stray) return;
    this.notify(
      `A previous autopush-notes export was written to ${stray} because "~" was not expanded. ` +
        "Its .git/config may contain your GitHub token in clear text: check its contents, then delete it.",
      "warning",
    );
  },

  toggle() {
    const enabled = !this.get("enabled");
    inkdrop.config.set(configKey("enabled"), enabled);
    this.applySchedule();
    this.notify(`Git Sync scheduling ${enabled ? "enabled" : "disabled"}`);
  },

  applySchedule() {
    if (this.get("enabled")) this.enableTimer();
    else this.disableTimer();
  },

  enableTimer() {
    this.disableTimer();
    const minutes = Math.max(1, Number(this.get("interval")) || 5);
    this.timer = setInterval(() => this.runSafely(false), minutes * 60 * 1000);
  },

  disableTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  // Failures are already reported by runCycle; never leave a rejected promise
  // behind a command or a timer.
  runSafely(dryRun, options) {
    return this.runCycle(dryRun, options).catch(() => null);
  },

  workspaceSetting(mode) {
    if (mode === "sync") return this.get("syncFolder");
    return this.get("legacyExportFolder") || this.get("syncFolder");
  },

  includedBooks() {
    return String(this.get("includedBooks") || "").split(",").map(value => value.trim()).filter(Boolean);
  },

  async runCycle(dryRun, { push = true } = {}) {
    if (this.running) {
      this.notify("A synchronization cycle is already running");
      return this.lastStatus;
    }
    this.running = true;
    let git;
    try {
      if (this.legacyPluginActive()) {
        throw new Error("Disable the autopush-notes package first: both plugins would write to the same repository");
      }
      const mode = this.get("mode") === "sync" ? "sync" : "export";
      const configured = resolveWorkspace(this.workspaceSetting(mode));
      // The preview creates nothing, not even the folder.
      const workspace = assertSafeDirectory(configured, { create: !dryRun });
      const real = folder => (fs.existsSync(folder) ? fs.realpathSync(folder) : folder);
      if (mode === "sync" && this.get("legacyExportFolder")) {
        if (real(resolveWorkspace(this.get("legacyExportFolder"))) === real(workspace)) {
          throw new Error("Sync mode needs a new dedicated folder, not the legacy export folder");
        }
      }
      const firstSync = mode === "sync" && !fs.existsSync(path.join(workspace, STATE_DIRECTORY, "state.json"));
      if (firstSync && !dryRun && this.previewedFolder !== configured) {
        throw new Error("Run Preview Without Writing once before the first synchronization of this folder, and review what it reports");
      }
      const adapter = new InkdropAdapter(localDatabase());
      const inScope = adapter.scope(this.includedBooks());
      const journal = new WriteJournal(workspace);
      git = new GitService({
        workspace,
        repository: this.get("repository"),
        branch: this.get("branch") || "main",
        token: this.get("token") || "",
      });

      const cycle = async () => {
        await git.prepare({ isOwnChange: file => journal.isOwn(file), preview: dryRun });
        if (!dryRun) journal.clear();
        const engine = mode === "sync" ? new SyncEngine({ adapter, workspace, inScope }) : null;
        const result = engine
          ? await engine.run({ dryRun, persist: false, externalFiles: dryRun ? await git.previewFiles() : null })
          : await runExport({ adapter, workspace, dryRun, inScope });
        if (!dryRun) {
          await git.commitAndPush(result.changedFiles, { push });
          journal.clear();
          // Only now are the new common versions confirmed on both sides.
          if (engine) engine.saveState(result);
        }
        return result;
      };

      let result;
      try {
        result = await cycle();
      } catch (error) {
        // The remote moved during the cycle: merge it and compare again, once.
        if (!error.rejected) throw error;
        result = await cycle();
      }
      if (adapter.incomplete) {
        result.warnings.push(`Inkdrop returned ${adapter.incomplete.read} of ${adapter.incomplete.total} notes; missing notes were not synchronized`);
      }
      if (!dryRun && mode === "sync") recordLastCommit(workspace, await git.headCommit());
      if (dryRun && mode === "sync") this.previewedFolder = configured;

      const now = new Date().toISOString();
      this.lastStatus = { ok: !result.conflicts.length && !result.warnings.length, at: now, mode, workspace, ...result };
      if (!dryRun) this.lastSuccessAt = now;
      this.report(result, dryRun);
      return this.lastStatus;
    } catch (error) {
      this.lastStatus = { ok: false, at: new Date().toISOString(), error: error.message };
      this.notify(`Git Sync failed: ${error.message}`, "error");
      throw error;
    } finally {
      if (git) git.dispose();
      this.running = false;
    }
  },

  report(result, dryRun) {
    const lines = [`${dryRun ? "Preview (nothing written)" : "Sync complete"}: ${summarize(result)}`];
    if (dryRun && result.actions.length) {
      const counts = {};
      for (const action of result.actions) counts[action.type] = (counts[action.type] || 0) + 1;
      lines.push(Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(", "));
    }
    for (const conflict of result.conflicts.slice(0, 3)) lines.push(`Conflict (${conflict.reason}): ${conflict.title}`);
    for (const warning of result.warnings.slice(0, 3)) lines.push(warning);
    if (result.backup) lines.push(`Inkdrop notes backed up to ${result.backup}`);
    this.notify(lines.join("\n"), result.conflicts.length || result.warnings.length ? "warning" : "info");
  },

  showStatus() {
    const lines = [this.running ? "A cycle is running." : "Idle."];
    lines.push(`Scheduling: ${this.get("enabled") ? `every ${Math.max(1, Number(this.get("interval")) || 5)} min` : "off"}, mode: ${this.get("mode") || "export"}`);
    lines.push(`Last successful sync: ${this.lastSuccessAt || "none since Inkdrop started"}`);
    const status = this.lastStatus;
    if (status && status.error) lines.push(`Last error: ${status.error}`);
    if (status && !status.error) lines.push(`Last cycle: ${summarize(status)}`);
    try {
      const workspace = resolveWorkspace(this.workspaceSetting(this.get("mode")));
      const state = readState(workspace);
      const open = Object.values(state.conflicts || {});
      if (open.length) lines.push(`Open conflicts: ${open.map(conflict => conflict.title).slice(0, 5).join(", ")}`);
      if (state.lastCommit) lines.push(`Last commit: ${state.lastCommit.slice(0, 10)}`);
    } catch (_error) {
      // No folder configured yet: nothing more to report.
    }
    this.notify(lines.join("\n"), status && !status.ok ? "warning" : "info");
  },

  openFolder(target = "") {
    try {
      const workspace = resolveWorkspace(this.workspaceSetting(this.get("mode")));
      const selected = target === "conflicts" ? path.join(workspace, STATE_DIRECTORY, "conflicts") : workspace;
      fs.mkdirSync(selected, { recursive: true });
      require("electron").shell.openPath(selected);
    } catch (error) {
      this.notify(error.message, "error");
    }
  },

  notify(message, type = "info") {
    // Inkdrop 6: addInfo / addWarning / addError(message, options).
    const method = { info: "addInfo", warning: "addWarning", error: "addError" }[type] || "addInfo";
    const notifications = global.inkdrop && inkdrop.notifications;
    if (notifications && typeof notifications[method] === "function") notifications[method](message, { dismissable: true });
    console[type === "error" ? "error" : "log"](`[${NAME}] ${message}`);
  },
};

module.exports.InkdropAdapter = InkdropAdapter;
module.exports.allDocuments = allDocuments;
