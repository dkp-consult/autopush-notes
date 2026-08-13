## Unreleased
* Fixed: every note is now exported. Reads were capped at 100 notes, and the cleanup then deleted the backup files of everything past that limit (#5)
* Fixed: cleanup only removes files the plugin itself wrote, tracked in `.autopush-manifest.json`. Pointing the export at a directory holding your own markdown no longer deletes it (#7)
* Fixed: `~` in the export path is expanded. Notes previously landed in a directory literally named `~` under Inkdrop's working directory (#8)
* Added: `npm test` runs a test suite covering pagination, path resolution and cleanup ownership. No new dependency — it uses Node's built-in test runner

**Upgrading:** if you kept the default export path, your old backup is still in that stray `~` directory and the plugin now writes to `$HOME/Documents/InkdropNotes` instead. A notification points you to the old location on startup. Nothing is moved or deleted automatically — that directory's `.git/config` holds your GitHub token in cleartext, so review it before removing it. The first push to an already-populated repository from the new directory will be rejected for unrelated histories (#9).

## 0.0.4 - Inkdrop 6 Compatibility
* Fixed: `engines.inkdrop` widened to `>=5.3.1 <7` — the plugin could not be installed on Inkdrop 6, and Inkdrop 5 remains supported
* Fixed: `repository.type` set to `git` with the `.git` suffix in the URL
* Added: `files` allowlist so the published package only ships the relevant sources
* Changed: `readme.md` renamed to `README.md`

## 0.0.3 - Maintenance
* Changed: version bump, no functional change

## 0.0.2 - Note Deletion Sync
* Added: Automatic synchronization of note deletions to GitHub
* Added: Real-time tracking of deleted notes
* Added: Local file cleanup when notes are deleted
* Improved: Git operations now handle both additions and deletions

## 0.0.1 - First Release
* Initial release
