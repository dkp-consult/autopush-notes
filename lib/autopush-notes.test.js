const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const plugin = require("./autopush-notes");

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
