const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");
const { GitService, sanitize } = require("../lib/git-service");
const exec = promisify(execFile);

test("redacts tokens and credentials from Git errors", () => {
  const token = "ghp_top_secret";
  const output = sanitize(`fatal https://${token}@github.com failed: ${token}`, [token]);
  assert.equal(output.includes(token), false);
  assert.match(output, /REDACTED/);
});

test("commits and pushes managed files without creating duplicate commits", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-service-"));
  const bare = path.join(root, "remote.git");
  const workspace = path.join(root, "work");
  await exec("git", ["init", "--bare", "--initial-branch=main", bare]);
  const service = new GitService({ workspace, repository: "owner/repository", branch: "main" });
  service.remoteUrl = () => bare;
  try {
    await service.prepare();
    fs.mkdirSync(path.join(workspace, "notes"));
    fs.writeFileSync(path.join(workspace, "notes", "managed.md"), "content");
    await service.commitAndPush([path.join("notes", "managed.md")]);
    const firstCount = Number((await exec("git", ["rev-list", "--count", "HEAD"], { cwd: workspace })).stdout.trim());
    await service.prepare();
    await service.commitAndPush([]);
    const secondCount = Number((await exec("git", ["rev-list", "--count", "HEAD"], { cwd: workspace })).stdout.trim());
    assert.equal(firstCount, 1);
    assert.equal(secondCount, 1);
  } finally {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("initializes a dedicated folder from an existing remote branch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkdrop-git-existing-"));
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const workspace = path.join(root, "work");
  await exec("git", ["init", "--bare", "--initial-branch=main", bare]);
  await exec("git", ["init", "--initial-branch=main", seed]);
  await exec("git", ["config", "user.name", "Test"], { cwd: seed });
  await exec("git", ["config", "user.email", "test@example.invalid"], { cwd: seed });
  fs.mkdirSync(path.join(seed, "notes"));
  fs.writeFileSync(path.join(seed, "notes", "existing.md"), "existing");
  await exec("git", ["add", "notes/existing.md"], { cwd: seed });
  await exec("git", ["commit", "-m", "seed"], { cwd: seed });
  await exec("git", ["remote", "add", "origin", bare], { cwd: seed });
  await exec("git", ["push", "origin", "main"], { cwd: seed });
  const service = new GitService({ workspace, repository: "owner/repository", branch: "main" });
  service.remoteUrl = () => bare;
  try {
    await service.prepare();
    assert.equal(fs.readFileSync(path.join(workspace, "notes", "existing.md"), "utf8"), "existing");
  } finally {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
