"use babel";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

function sanitize(value, secrets) {
  let text = String(value || "");
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text.replace(/https:\/\/[^@\s]+@/g, "https://[REDACTED]@");
}

class GitService {
  constructor({ workspace, repository, branch = "main", token = "" }) {
    this.workspace = workspace;
    this.repository = repository;
    this.branch = branch || "main";
    this.token = token || "";
    this.askPassPath = null;
  }

  remoteUrl() {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repository || "")) {
      throw new Error("Repository must use the owner/repository format");
    }
    return `https://github.com/${this.repository}.git`;
  }

  environment() {
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    if (!this.token) return environment;
    if (!this.askPassPath) {
      this.askPassPath = path.join(os.tmpdir(), `inkdrop-git-sync-askpass-${process.pid}`);
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

  async run(args, { allowFailure = false } = {}) {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: this.workspace, env: this.environment() }, (error, stdout, stderr) => {
        const result = { stdout: stdout.trim(), stderr: sanitize(stderr, [this.token]), code: error ? error.code : 0 };
        if (error && !allowFailure) {
          const failure = new Error(result.stderr || sanitize(error.message, [this.token]));
          failure.code = error.code;
          reject(failure);
        } else resolve(result);
      });
    });
  }

  async prepare() {
    const desiredRemote = this.remoteUrl();
    if (!/^[A-Za-z0-9._/-]+$/.test(this.branch) || this.branch.startsWith("-") || this.branch.includes("..")) {
      throw new Error("Invalid Git branch name");
    }
    fs.mkdirSync(this.workspace, { recursive: true });
    const gitDirectory = path.join(this.workspace, ".git");
    if (!fs.existsSync(gitDirectory)) await this.run(["init", "-b", this.branch]);
    const remote = await this.run(["remote", "get-url", "origin"], { allowFailure: true });
    if (remote.code) await this.run(["remote", "add", "origin", desiredRemote]);
    else if (remote.stdout !== desiredRemote) await this.run(["remote", "set-url", "origin", desiredRemote]);

    const excludePath = path.join(gitDirectory, "info", "exclude");
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const exclude = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
    if (!exclude.split(/\r?\n/).includes(".inkdrop-git-sync/")) {
      fs.appendFileSync(excludePath, `${exclude.endsWith("\n") || !exclude ? "" : "\n"}.inkdrop-git-sync/\n`);
    }

    const dirty = await this.run(["status", "--porcelain", "--", "notes"]);
    if (dirty.stdout) throw new Error("The notes folder contains uncommitted changes; commit or discard them before syncing");
    const fetchResult = await this.run(["fetch", "origin", this.branch], { allowFailure: true });
    if (fetchResult.code && !/couldn't find remote ref/i.test(fetchResult.stderr)) {
      throw new Error(fetchResult.stderr || "Unable to fetch the remote branch");
    }
    const remoteBranch = await this.run(["rev-parse", "--verify", `origin/${this.branch}`], { allowFailure: true });
    const head = await this.run(["rev-parse", "--verify", "HEAD"], { allowFailure: true });
    if (!remoteBranch.code && head.code) {
      await this.run(["checkout", "-B", this.branch, `origin/${this.branch}`]);
    } else if (!remoteBranch.code && !head.code) {
      const base = await this.run(["merge-base", "HEAD", `origin/${this.branch}`], { allowFailure: true });
      if (!base.code && base.stdout !== remoteBranch.stdout) await this.run(["merge", "--ff-only", `origin/${this.branch}`]);
    }
  }

  async commitAndPush(changedFiles) {
    if (changedFiles.length) {
      await this.run(["add", "--", ...changedFiles]);
      const staged = await this.run(["diff", "--cached", "--quiet"], { allowFailure: true });
      if (staged.code) {
        const name = await this.run(["config", "user.name"], { allowFailure: true });
        const email = await this.run(["config", "user.email"], { allowFailure: true });
        if (name.code) await this.run(["config", "user.name", "Inkdrop Git Sync"]);
        if (email.code) await this.run(["config", "user.email", "inkdrop-git-sync@localhost"]);
        await this.run(["commit", "-m", "Sync Inkdrop notes"]);
      }
    }
    const ahead = await this.run(["rev-list", "--count", `origin/${this.branch}..HEAD`], { allowFailure: true });
    if (ahead.code || Number(ahead.stdout) > 0) await this.run(["push", "origin", `HEAD:${this.branch}`]);
  }

  dispose() {
    if (this.askPassPath && fs.existsSync(this.askPassPath)) fs.unlinkSync(this.askPassPath);
    this.askPassPath = null;
  }
}

module.exports = { GitService, sanitize };
