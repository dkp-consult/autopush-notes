# Validation guide

```sh
npm ci
npm test
npm run check
```

The automated suite covers the engine, the Git service against local bare repositories, the Inkdrop adapter against a database that applies Inkdrop 6.3's note, notebook and tag schemas, and the plugin end to end. It does not replace a run inside Inkdrop.

## Isolated Inkdrop for testing

Inkdrop can run a second, local-only instance that never touches your account or your notes: a demo account, a separate data directory, no cloud sync.

```sh
DIR=$(mktemp -d)
mkdir -p "$DIR/userdata/packages"
ln -s "$PWD" "$DIR/userdata/packages/git-sync"
INKDROP_TEST_MODE=1 INKDROP_USER_DATA_PATH="$DIR/userdata" INKDROP_HOME="$DIR/home" \
  /Applications/Inkdrop.app/Contents/MacOS/Inkdrop --remote-debugging-port=9333
```

Point the sync folder inside `$DIR`. Do not call the guest-login IPC: the instance is already logged in as the demo account, and logging in again unloads its database. Quitting it and deleting `$DIR` removes everything.

## Manual checks in Inkdrop before release

Use a **copy** of your notes (a separate Inkdrop account or data directory) and a disposable private GitHub repository. Keep `autopush-notes` disabled.

1. The plugin loads; settings, menus, the status command and shortcuts appear.
2. Synchronize Now on a new folder is refused until a preview has run. Preview on a vault of more than 100 notes, with duplicate titles, Unicode, tags, statuses and nested notebooks: it creates nothing, not even the folder. No `Inkdrop returned N of M notes` warning appears.
3. First sync: every note gets one file, a backup appears in `.inkdrop-git-sync/backups/`, and the push succeeds.
4. Rename a note: same file, new title.
5. Edit in Inkdrop: the change reaches GitHub. Commit an edit from another clone: it reaches Inkdrop.
6. Add a new file from another clone, with a new notebook and tag: imported once, notebook and tag created, the note opens and edits normally. Restart Inkdrop: no duplicate.
7. Two cycles with no change: no new commit.
8. Concurrent edits: two copies in the conflicts folder, neither side overwritten. Delete one copy: the kept version reaches both sides.
9. Delete a note in Inkdrop, and a file in Git: warnings only, nothing deleted. Delete the other side too: the warning disappears. Trash a note and sync into a fresh folder: the note is reported, not re-imported.
10. A malformed file blocks only that note. Files with other names in `notes/` are untouched.
11. Push from another clone while a cycle runs: the cycle merges and succeeds, with no force push. Go offline, edit a note in Inkdrop, sync (the push fails), edit the same note from another clone, go back online: you get a conflict, and neither edit is lost.
12. Network off: clear error. Network back: the next cycle catches up.
13. Quit Inkdrop during a cycle and restart: the next cycle resumes without duplicates.
14. Change the token: the next cycle uses it. The token is absent from `.git/config`, the macOS keychain (`security find-internet-password -s github.com`) and the developer console.
15. Change the interval and toggle the schedule: there is only ever one timer.
16. Restrict to one notebook: notes outside it are neither exported nor reported as deleted.
17. Second Mac with the same Inkdrop account and a fresh sync folder: the first cycle reports matches only, with no imports.

## Publishing

`ipm publish` publishes the version in `package.json` as is. Run `ipm publish --dry-run` first. It has been reported as not fully dry, so run it from a clean `main` only.
