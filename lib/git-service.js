"use babel";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");

const NOTES = "notes";

function sanitize(value, secrets) {
  let text = String(value || "");
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text.replace(/https:\/\/[^@\s/]+@/g, "https://[REDACTED]@");
}

class GitService {
  constructor({ workspace, repository, branch = "main", token = "" }) {
    this.workspace = workspace;
    this.repository = repository;
    this.branch = branch || "main";
    this.token = token || "";
    this.askPassPath = null;
    this.previewDirectory = null;
  }

  remoteUrl() {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repository || "")) {
      throw new Error("Repository must use the owner/repository format");
    }
    return `https://github.com/${this.repository}.git`;
  }

  // The token never reaches the remote URL or the command line: Git asks for it
  // through GIT_ASKPASS, which reads it from this process's environment. It is
  // read from the settings on every cycle, so a renewed token applies at once.
  environment() {
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    if (!this.token) return environment;
    if (!this.askPassPath) {
      this.askPassPath = path.join(os.tmpdir(), `inkdrop-git-sync-askpass-${crypto.randomBytes(8).toString("hex")}`);
      fs.writeFileSync(
        this.askPassPath,
        "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' x-access-token ;; *) printf '%s\\n' \"$INKDROP_GIT_SYNC_TOKEN\" ;; esac\n",
        { mode: 0o700 },
      );
    }
    environment.GIT_ASKPASS = this.askPassPath;
    environment.INKDROP_GIT_SYNC_TOKEN = this.token;
    return environment;
  }

  // With a configured token, credential helpers are switched off: otherwise Git
  // would copy the token into the macOS keychain and later prefer that stale
  // copy (or the user's own GitHub login) over a renewed token.
  gitArguments(args) {
    return this.token ? ["-c", "credential.helper=", ...args] : args;
  }

  async run(args, { allowFailure = false, raw = false, cwd = this.workspace } = {}) {
    return new Promise((resolve, reject) => {
      execFile("git", this.gitArguments(args), { cwd, env: this.environment(), maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        const text = String(stdout);
        const result = {
          // Porcelain output starts with a significant space: never trim it.
          stdout: sanitize(raw ? text : text.trim(), [this.token]),
          stderr: sanitize(stderr, [this.token]),
          code: error ? error.code || 1 : 0,
        };
        if (error && !allowFailure) {
          const failure = new Error(result.stderr.trim() || sanitize(error.message, [this.token]));
          failure.code = result.code;
          reject(failure);
        } else resolve(result);
      });
    });
  }

  async ensureIdentity() {
    const name = await this.run(["config", "user.name"], { allowFailure: true });
    const email = await this.run(["config", "user.email"], { allowFailure: true });
    if (name.code) await this.run(["config", "user.name", "Inkdrop Git Sync"]);
    if (email.code) await this.run(["config", "user.email", "inkdrop-git-sync@localhost"]);
  }

  async ref(name) {
    const result = await this.run(["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { allowFailure: true });
    return result.code ? null : result.stdout;
  }

  async headCommit() {
    return this.ref("HEAD");
  }

  // Uncommitted entries under notes/, split into the plugin's own interrupted
  // writes and anything else.
  async pendingChanges(isOwnChange) {
    const status = await this.run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", NOTES], { raw: true });
    const own = [];
    const foreign = [];
    const entries = status.stdout.split("\0").filter(Boolean);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const code = entry.slice(0, 2);
      const file = entry.slice(3);
      if (code[0] === "R" || code[0] === "C") index += 1;
      if (!code.includes("D") && isOwnChange(file)) own.push(file);
      else foreign.push(file);
    }
    return { own, foreign };
  }

  validateBranch() {
    if (!/^[A-Za-z0-9._/-]+$/.test(this.branch) || this.branch.startsWith("-") || this.branch.includes("..")) {
      throw new Error("Invalid Git branch name");
    }
  }

  async assertNoForeignChanges(isOwnChange) {
    const pending = await this.pendingChanges(isOwnChange);
    if (pending.foreign.length) {
      const sample = pending.foreign.slice(0, 3).join(", ");
      throw new Error(`The notes folder contains uncommitted changes the plugin did not make (${sample}); commit or discard them before syncing`);
    }
    return pending;
  }

  async fetchInto(cwd, url) {
    const fetchResult = await this.run(
      ["fetch", url, `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`],
      { allowFailure: true, cwd },
    );
    if (fetchResult.code && !/couldn't find remote ref/i.test(fetchResult.stderr)) {
      throw new Error(fetchResult.stderr.trim() || "Unable to fetch the remote branch");
    }
  }

  // Preview: fetch only, and never into a folder that is not a repository yet
  // (a throwaway repository is used instead). Configuration, working tree,
  // index and history stay untouched.
  async preparePreview({ isOwnChange = () => false } = {}) {
    const desiredRemote = this.remoteUrl();
    this.validateBranch();
    if (fs.existsSync(path.join(this.workspace, ".git"))) {
      await this.assertNoForeignChanges(isOwnChange);
      await this.fetchInto(this.workspace, desiredRemote);
      return;
    }
    this.previewDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-sync-preview-"));
    await this.run(["init", "-q"], { cwd: this.previewDirectory });
    await this.fetchInto(this.previewDirectory, desiredRemote);
  }

  // Brings the workspace level with the remote branch.
  async prepare({ isOwnChange = () => false, preview = false } = {}) {
    if (preview) return this.preparePreview({ isOwnChange });
    const desiredRemote = this.remoteUrl();
    this.validateBranch();
    fs.mkdirSync(this.workspace, { recursive: true });
    const gitDirectory = path.join(this.workspace, ".git");
    if (!fs.existsSync(gitDirectory)) await this.run(["init", "-b", this.branch]);
    const remote = await this.run(["remote", "get-url", "origin"], { allowFailure: true });
    // Also replaces a legacy remote that embedded the token in its URL.
    if (remote.code) await this.run(["remote", "add", "origin", desiredRemote]);
    else if (remote.stdout !== desiredRemote) await this.run(["remote", "set-url", "origin", desiredRemote]);

    const excludePath = path.join(gitDirectory, "info", "exclude");
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const exclude = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
    if (!exclude.split(/\r?\n/).includes(".inkdrop-git-sync/")) {
      fs.appendFileSync(excludePath, `${exclude.endsWith("\n") || !exclude ? "" : "\n"}.inkdrop-git-sync/\n`);
    }

    const pending = await this.assertNoForeignChanges(isOwnChange);
    if (pending.own.length) {
      // Files written by an interrupted cycle: commit them before integrating
      // the remote so a merge never meets a dirty working tree.
      await this.commit(pending.own, "Sync Inkdrop notes (resumed)");
    }

    const fetchResult = await this.run(["fetch", "origin", this.branch], { allowFailure: true });
    if (fetchResult.code && !/couldn't find remote ref/i.test(fetchResult.stderr)) {
      throw new Error(fetchResult.stderr.trim() || "Unable to fetch the remote branch");
    }
    await this.integrate();
  }

  async integrate() {
    const remoteRef = `origin/${this.branch}`;
    const remote = await this.ref(remoteRef);
    const head = await this.headCommit();
    if (!remote) return;
    if (!head) {
      await this.run(["checkout", "-B", this.branch, remoteRef]);
      return;
    }
    const base = await this.run(["merge-base", "HEAD", remoteRef], { allowFailure: true });
    if (base.code) {
      throw new Error(
        `The sync folder and ${remoteRef} have unrelated histories. Use a new empty sync folder, or a repository branch this folder came from.`,
      );
    }
    if (base.stdout === remote) return;
    if (base.stdout === head) {
      await this.run(["merge", "--ff-only", remoteRef]);
      return;
    }
    // Both sides moved: a regular merge, never a reset or a forced push. Where
    // both touched the same lines the remote version wins in the file; the
    // local version is still in Inkdrop, so the engine's three-way comparison
    // turns the clash into a per-note conflict instead of a stuck merge.
    await this.ensureIdentity();
    const merge = await this.run(["merge", "--no-edit", "-X", "theirs", remoteRef], { allowFailure: true });
    if (merge.code) {
      await this.run(["merge", "--abort"], { allowFailure: true });
      throw new Error(`Local and remote changes touch the same files and cannot be merged automatically; resolve the merge in ${this.workspace}`);
    }
  }

  async commit(files, message) {
    if (!files.length) return false;
    await this.run(["add", "--", ...files]);
    const staged = await this.run(["diff", "--cached", "--quiet"], { allowFailure: true });
    if (!staged.code) return false;
    await this.ensureIdentity();
    await this.run(["commit", "-m", message]);
    return true;
  }

  // Pushes whenever the branch is ahead, even with nothing new to commit, so a
  // commit left behind by an earlier failed push still goes out.
  async commitAndPush(changedFiles, { push = true } = {}) {
    const committed = await this.commit(changedFiles, "Sync Inkdrop notes");
    if (!push || !(await this.headCommit())) return { committed, pushed: false };
    const ahead = await this.run(["rev-list", "--count", `origin/${this.branch}..HEAD`], { allowFailure: true });
    if (!ahead.code && Number(ahead.stdout) === 0) return { committed, pushed: false };
    const result = await this.run(["push", "origin", `HEAD:${this.branch}`], { allowFailure: true });
    if (result.code) {
      const failure = new Error(result.stderr.trim() || "Push failed");
      failure.rejected = /rejected|non-fast-forward|fetch first/i.test(result.stderr);
      throw failure;
    }
    return { committed, pushed: true };
  }

  // Files under notes/ as the next merge would produce them, for the preview.
  // Null when the working tree already is that state (no remote branch, or a
  // local history that is ahead or diverged).
  async previewFiles() {
    const remoteRef = `origin/${this.branch}`;
    const cwd = this.previewDirectory || this.workspace;
    const remoteCommit = await this.run(["rev-parse", "--verify", "--quiet", `${remoteRef}^{commit}`], { allowFailure: true, cwd });
    if (remoteCommit.code) return null;
    const head = this.previewDirectory ? null : await this.headCommit();
    if (head) {
      const base = await this.run(["merge-base", "HEAD", remoteRef], { allowFailure: true });
      if (base.code || base.stdout !== head) return null;
    }
    const listing = await this.run(["ls-tree", "-z", `${remoteRef}:${NOTES}`], { allowFailure: true, cwd });
    if (listing.code) return new Map();
    const blobs = listing.stdout.split("\0").filter(Boolean).map((line) => {
      const [meta, name] = line.split("\t");
      const [, type, object] = meta.split(" ");
      return { type, object, name };
    }).filter(entry => entry.type === "blob" && entry.name.endsWith(".md"));
    const contents = await this.readBlobs(blobs.map(blob => blob.object), cwd);
    return new Map(blobs.map((blob, index) => [blob.name, contents[index]]));
  }

  readBlobs(objects, cwd) {
    if (!objects.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["cat-file", "--batch"], { cwd, env: this.environment() });
      const chunks = [];
      child.stdout.on("data", chunk => chunks.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code) return reject(new Error("Unable to read the remote notes"));
        const output = Buffer.concat(chunks);
        const contents = [];
        let offset = 0;
        for (let index = 0; index < objects.length; index += 1) {
          const headerEnd = output.indexOf(10, offset);
          const size = Number(output.subarray(offset, headerEnd).toString().split(" ")[2]);
          contents.push(output.subarray(headerEnd + 1, headerEnd + 1 + size).toString("utf8"));
          offset = headerEnd + 1 + size + 1;
        }
        resolve(contents);
      });
      child.stdin.end(`${objects.join("\n")}\n`);
    });
  }

  dispose() {
    if (this.askPassPath && fs.existsSync(this.askPassPath)) fs.unlinkSync(this.askPassPath);
    this.askPassPath = null;
    if (this.previewDirectory) fs.rmSync(this.previewDirectory, { recursive: true, force: true });
    this.previewDirectory = null;
  }
}

module.exports = { GitService, sanitize };
