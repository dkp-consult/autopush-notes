const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const plugin = require("./autopush-notes");

const MANIFEST = ".autopush-manifest.json";

// A stand-in for inkdrop.main.dataStore.getLocalDB(). Serves `count` notes and
// records every query, so tests can assert the pagination itself.
function fakeDb(count, { failAtSkip = null, reportedTotal = null } = {}) {
  const notes = Array.from({ length: count }, (_, i) => ({
    _id: `note:${i}`,
    title: `Note ${String(i).padStart(4, "0")}`,
    body: `Body of note ${i}`,
  }));

  const calls = [];

  return {
    calls,
    notes: {
      async all({ limit, skip }) {
        calls.push({ limit, skip });
        if (failAtSkip !== null && skip === failAtSkip) {
          throw new Error("database unavailable");
        }
        return {
          totalRows: reportedTotal === null ? notes.length : reportedTotal,
          docs: notes.slice(skip, skip + limit),
          includeDocs: true,
        };
      },
    },
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopush-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function stubInkdrop(t, { exportPath, db } = {}) {
  const previous = global.inkdrop;
  const notifications = [];
  global.inkdrop = {
    config: {
      get(key) {
        if (key === "autopush-notes.localExportPath") return exportPath;
        return undefined;
      },
    },
    notifications: { add: (n) => notifications.push(n) },
    main: { dataStore: { getLocalDB: () => db } },
  };
  t.after(() => {
    global.inkdrop = previous;
  });
  return notifications;
}

// The stray directory is resolved against the process CWD, so tests move there.
function chdir(t, dir) {
  const previous = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(previous));
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
}

test("fetchAllNotes reads every note past the first page", async () => {
  const db = fakeDb(250);
  const notes = await plugin.fetchAllNotes(db);

  assert.equal(notes.length, 250);
  assert.equal(notes[0]._id, "note:0");
  assert.equal(notes[249]._id, "note:249");
});

test("fetchAllNotes never relies on the database default limit of 20", async () => {
  const db = fakeDb(1200);
  await plugin.fetchAllNotes(db);

  assert.ok(db.calls.length > 1, "expected more than one page");
  assert.ok(
    db.calls.every((call) => typeof call.limit === "number" && call.limit > 20),
    `every call must pass an explicit limit, got ${JSON.stringify(db.calls)}`,
  );
});

test("fetchAllNotes terminates on an exactly-full final page", async () => {
  const db = fakeDb(1000);
  const notes = await plugin.fetchAllNotes(db);

  assert.equal(notes.length, 1000);
  assert.equal(db.calls.length, 3, "expected a final empty page to stop the loop");
});

test("fetchAllNotes handles an empty database", async () => {
  const notes = await plugin.fetchAllNotes(fakeDb(0));
  assert.deepEqual(notes, []);
});

test("fetchAllNotes rejects a read that does not match totalRows", async () => {
  const db = fakeDb(10, { reportedTotal: 250 });

  await assert.rejects(
    () => plugin.fetchAllNotes(db),
    /Incomplete read.*got 10 of 250/,
  );
});

test("fetchAllNotes propagates a failure that happens mid-pagination", async () => {
  const db = fakeDb(1200, { failAtSkip: 500 });

  await assert.rejects(() => plugin.fetchAllNotes(db), /database unavailable/);
});

test("resolveExportPath expands a leading ~ to the home directory", (t) => {
  stubInkdrop(t, { exportPath: "~/Documents/InkdropNotes" });

  assert.equal(
    plugin.resolveExportPath(),
    path.join(os.homedir(), "Documents", "InkdropNotes"),
  );
});

test("resolveExportPath leaves an absolute path untouched", (t) => {
  stubInkdrop(t, { exportPath: "/var/tmp/notes-backup" });

  assert.equal(plugin.resolveExportPath(), "/var/tmp/notes-backup");
});

test("resolveExportPath rejects ~user syntax instead of mishandling it", (t) => {
  stubInkdrop(t, { exportPath: "~someone/notes" });

  assert.throws(() => plugin.resolveExportPath(), /~user/);
});

test("resolveExportPath rejects an unconfigured path", (t) => {
  stubInkdrop(t, { exportPath: "   " });

  assert.throws(() => plugin.resolveExportPath(), /not configured/);
});

test("a stray legacy export directory is reported, never moved", (t) => {
  const root = tempDir(t);
  const legacy = path.join(root, "~", "Documents", "InkdropNotes");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "Old note.md"), "still here");

  chdir(t, root);
  const notifications = stubInkdrop(t, { exportPath: "/var/tmp/notes-backup" });

  plugin.warnAboutLegacyExportPath();

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "warning");
  assert.match(notifications[0].message, /token in cleartext/);
  assert.ok(
    notifications[0].message.includes(legacy),
    "the notification must name the stray directory",
  );
  assert.ok(
    fs.existsSync(path.join(legacy, "Old note.md")),
    "nothing may be moved or deleted",
  );
});

test("no legacy warning when the stray directory is absent", (t) => {
  const root = tempDir(t);
  chdir(t, root);
  const notifications = stubInkdrop(t, { exportPath: "/var/tmp/notes-backup" });

  plugin.warnAboutLegacyExportPath();

  assert.deepEqual(notifications, []);
});

test("cleanup deletes nothing when no manifest exists", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "someone-elses-note.md"), "not ours");
  fs.writeFileSync(path.join(dir, "Kept.md"), "ours");

  plugin.cleanupDeletedNotes(dir, new Set(["Kept.md"]));

  assert.ok(fs.existsSync(path.join(dir, "someone-elses-note.md")));
  assert.ok(fs.existsSync(path.join(dir, "Kept.md")));
  assert.deepEqual(readManifest(dir), ["Kept.md"]);
});

test("cleanup removes a file it wrote once the note is gone", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "Kept.md"), "ours");
  fs.writeFileSync(path.join(dir, "Removed.md"), "ours too");
  fs.writeFileSync(
    path.join(dir, MANIFEST),
    JSON.stringify(["Kept.md", "Removed.md"]),
  );

  plugin.cleanupDeletedNotes(dir, new Set(["Kept.md"]));

  assert.ok(fs.existsSync(path.join(dir, "Kept.md")));
  assert.ok(!fs.existsSync(path.join(dir, "Removed.md")));
});

test("cleanup never deletes markdown it does not own, manifest or not", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "Ours.md"), "ours");
  fs.writeFileSync(path.join(dir, "Obsidian vault note.md"), "theirs");
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(["Ours.md"]));

  plugin.cleanupDeletedNotes(dir, new Set(["Ours.md"]));

  assert.ok(fs.existsSync(path.join(dir, "Obsidian vault note.md")));
});

test("cleanup ignores a manifest entry that would escape the export directory", (t) => {
  const dir = tempDir(t);
  const outside = path.join(dir, "outside.md");
  const inner = path.join(dir, "inner");
  fs.mkdirSync(inner);
  fs.writeFileSync(outside, "must survive");
  fs.writeFileSync(path.join(inner, MANIFEST), JSON.stringify(["../outside.md"]));

  plugin.cleanupDeletedNotes(inner, new Set());

  assert.ok(fs.existsSync(outside), "traversal entry must not be followed");
});

test("cleanup writes a byte-stable manifest across runs", (t) => {
  const dir = tempDir(t);

  plugin.cleanupDeletedNotes(dir, new Set(["b.md", "a.md", "c.md"]));
  const first = fs.readFileSync(path.join(dir, MANIFEST), "utf8");

  // Same notes, different iteration order — the file must not change.
  plugin.cleanupDeletedNotes(dir, new Set(["c.md", "a.md", "b.md"]));
  const second = fs.readFileSync(path.join(dir, MANIFEST), "utf8");

  assert.equal(first, second);
  assert.deepEqual(JSON.parse(first), ["a.md", "b.md", "c.md"]);
});

test("export writes every note of a 250-note vault", async (t) => {
  const dir = tempDir(t);
  stubInkdrop(t, { exportPath: dir, db: fakeDb(250) });

  await plugin.exportNotesLocally();

  const written = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.equal(written.length, 250);
  assert.equal(readManifest(dir).length, 250);
});

test("two consecutive exports leave the directory byte-identical", async (t) => {
  const dir = tempDir(t);
  stubInkdrop(t, { exportPath: dir, db: fakeDb(250) });

  await plugin.exportNotesLocally();
  const first = snapshot(dir);

  await plugin.exportNotesLocally();
  assert.deepEqual(snapshot(dir), first);
});

test("a failed read writes nothing and leaves the backup untouched", async (t) => {
  const dir = tempDir(t);
  stubInkdrop(t, { exportPath: dir, db: fakeDb(1200) });

  await plugin.exportNotesLocally();
  const before = snapshot(dir);

  stubInkdrop(t, { exportPath: dir, db: fakeDb(1200, { failAtSkip: 500 }) });
  await assert.rejects(() => plugin.exportNotesLocally(), /database unavailable/);

  assert.deepEqual(snapshot(dir), before);
});

test("export creates the directory when it does not exist yet", async (t) => {
  const dir = path.join(tempDir(t), "nested", "backup");
  stubInkdrop(t, { exportPath: dir, db: fakeDb(3) });

  await plugin.exportNotesLocally();

  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length, 3);
});

function snapshot(dir) {
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]);
}
