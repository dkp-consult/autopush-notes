const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");
const { GitService, sanitize } = require("../lib/git-service");
const exec = promisify(execFile);

const git = async (cwd, ...args) => (await exec("git", args, { cwd })).stdout.trim();

// A bare "remote" plus helpers. remoteUrl is pointed at the bare repository so
// nothing touches the network.
async function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-service-"));
  const bare = path.join(root, "remote.git");
  await exec("git", ["init", "--bare", "--initial-branch=main", bare]);
  const service = (workspace = path.join(root, "work"), token = "") => {
    const instance = new GitService({ workspace, repository: "owner/repository", branch: "main", token });
    instance.remoteUrl = () => bare;
    return instance;
  };
  // Simulates an agent working in its own clone (the VPS checkout).
  const agent = async (file, content) => {
    const clone = path.join(root, `agent-${Date.now()}-${Math.random()}`);
    await exec("git", ["clone", "-q", bare, clone]);
    await git(clone, "config", "user.name", "Agent");
    await git(clone, "config", "user.email", "agent@example.invalid");
    await git(clone, "checkout", "-q", "-B", "main");
    fs.mkdirSync(path.join(clone, "notes"), { recursive: true });
    fs.writeFileSync(path.join(clone, "notes", file), content);
    await git(clone, "add", ".");
    await git(clone, "commit", "-q", "-m", "agent");
    await git(clone, "push", "-q", "origin", "HEAD:main");
  };
  const write = (workspace, file, content) => {
    fs.mkdirSync(path.join(workspace, "notes"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "notes", file), content);
    return `notes/${file}`;
  };
  return { root, bare, service, agent, write, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("redacts tokens and credentials from Git errors", () => {
  const token = "ghp_top_secret";
  const output = sanitize(`fatal https://${token}@github.com failed: ${token}`, [token]);
  assert.equal(output.includes(token), false);
  assert.match(output, /REDACTED/);
});

test("two cycles without changes create no second commit", async () => {
  const s = await sandbox();
  const service = s.service();
  try {
    await service.prepare();
    await service.commitAndPush([s.write(path.join(s.root, "work"), "managed.md", "content")]);
    await service.prepare();
    await service.commitAndPush([]);
    assert.equal(await git(s.bare, "rev-list", "--count", "main"), "1");
  } finally { service.dispose(); s.cleanup(); }
});

test("initializes a dedicated folder from an existing remote branch", async () => {
  const s = await sandbox();
  const service = s.service();
  try {
    await s.agent("existing.md", "existing");
    await service.prepare();
    assert.equal(fs.readFileSync(path.join(s.root, "work", "notes", "existing.md"), "utf8"), "existing");
  } finally { service.dispose(); s.cleanup(); }
});

test("pushes a commit left behind by a failed push, even with nothing new", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "work");
  const service = s.service(workspace);
  try {
    await service.prepare();
    await service.commit([s.write(workspace, "a.md", "a")], "offline commit");
    await service.commitAndPush([]);
    assert.equal(await git(s.bare, "rev-list", "--count", "main"), "1");
  } finally { service.dispose(); s.cleanup(); }
});

test("merges a remote that moved instead of failing or forcing", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "work");
  const service = s.service(workspace);
  try {
    await service.prepare();
    await service.commitAndPush([s.write(workspace, "a.md", "a")]);
    await s.agent("b.md", "from agent");
    // Local commit made before seeing the agent's push.
    await service.commit([s.write(workspace, "c.md", "c")], "local");
    await assert.rejects(service.commitAndPush([]), error => error.rejected === true);
    await service.prepare();
    await service.commitAndPush([]);
    const files = await git(s.bare, "ls-tree", "-r", "--name-only", "main");
    assert.deepEqual(files.split("\n").sort(), ["notes/a.md", "notes/b.md", "notes/c.md"]);
  } finally { service.dispose(); s.cleanup(); }
});

test("refuses unrelated histories with an actionable message", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "work");
  try {
    await s.agent("remote.md", "remote");
    fs.mkdirSync(workspace);
    await git(workspace, "init", "-q", "-b", "main");
    await git(workspace, "config", "user.name", "Old");
    await git(workspace, "config", "user.email", "old@example.invalid");
    fs.writeFileSync(path.join(workspace, "old.md"), "old");
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-q", "-m", "old");
    const service = s.service(workspace);
    await assert.rejects(service.prepare(), /unrelated histories/);
    service.dispose();
  } finally { s.cleanup(); }
});

test("commits the plugin's own interrupted writes but stops on foreign changes", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "work");
  const service = s.service(workspace);
  try {
    await service.prepare();
    await service.commitAndPush([s.write(workspace, "a.md", "a")]);
    const own = s.write(workspace, "own.md", "written by an interrupted cycle");
    await service.prepare({ isOwnChange: file => file === own });
    assert.equal(await git(workspace, "status", "--porcelain"), "");
    // A tracked file modified by an interrupted cycle (" M" in porcelain output).
    const modified = s.write(workspace, "a.md", "updated by an interrupted cycle");
    await service.prepare({ isOwnChange: file => file === modified });
    assert.equal(await git(workspace, "status", "--porcelain"), "");
    s.write(workspace, "a.md", "edited by hand");
    await assert.rejects(service.prepare({ isOwnChange: () => false }), /uncommitted changes the plugin did not make/);
  } finally { service.dispose(); s.cleanup(); }
});

test("preview reads the remote notes without touching the working tree", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "work");
  const service = s.service(workspace);
  try {
    await service.prepare();
    await service.commitAndPush([s.write(workspace, "a.md", "a")]);
    await s.agent("b.md", "from agent ✓");
    await service.prepare({ preview: true });
    const files = await service.previewFiles();
    assert.equal(files.get("b.md"), "from agent ✓");
    assert.equal(files.get("a.md"), "a");
    assert.equal(fs.existsSync(path.join(workspace, "notes", "b.md")), false);
  } finally { service.dispose(); s.cleanup(); }
});

test("never stores the token in the remote URL and replaces a legacy URL that held it", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "work");
  const token = "ghp_legacy_secret_value";
  try {
    fs.mkdirSync(workspace);
    await git(workspace, "init", "-q", "-b", "main");
    await git(workspace, "remote", "add", "origin", `https://${token}@github.com/owner/repository.git`);
    const service = s.service(workspace, token);
    await service.prepare();
    const config = fs.readFileSync(path.join(workspace, ".git", "config"), "utf8");
    assert.equal(config.includes(token), false);
    const askPass = service.askPassPath;
    assert.equal(fs.readFileSync(askPass, "utf8").includes(token), false);
    service.dispose();
    assert.equal(fs.existsSync(askPass), false);
  } finally { s.cleanup(); }
});

test("credential helpers are bypassed when a token is configured", () => {
  const withToken = new GitService({ workspace: "/tmp", repository: "o/r", token: "t" });
  const withoutToken = new GitService({ workspace: "/tmp", repository: "o/r" });
  assert.deepEqual(withToken.gitArguments(["fetch"]), ["-c", "credential.helper=", "fetch"]);
  assert.deepEqual(withoutToken.gitArguments(["fetch"]), ["fetch"]);
});

test("preview of a folder that is not a repository yet leaves it untouched", async () => {
  const s = await sandbox();
  const workspace = path.join(s.root, "fresh");
  const service = s.service(workspace);
  try {
    await s.agent("b.md", "remote");
    await service.prepare({ preview: true });
    assert.equal((await service.previewFiles()).get("b.md"), "remote");
    assert.equal(fs.existsSync(workspace), false);
    const temporary = service.previewDirectory;
    service.dispose();
    assert.equal(fs.existsSync(temporary), false);
  } finally { s.cleanup(); }
});
