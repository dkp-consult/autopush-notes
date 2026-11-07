## 0.1.0 - Inkdrop Git Sync
* Renamed the package to `inkdrop-git-sync`. Old preferences are imported once, legacy commands remain as aliases, and the plugin refuses to run while `autopush-notes` is active
* Added opt-in two-way sync: stable file names, versioned front matter with notebook paths and tag names, three-way comparison, conflict copies resolved by keeping one, and deletions reported but never propagated
* Added deterministic IDs in both directions, so a second Mac, a reinstall or an interrupted import never duplicates notes, and export mode and sync mode share files. Files from Inkdrop carry `inkdrop_id`, so a trashed or not yet downloaded note is never re-imported
* Imported notes follow Inkdrop's note schema. Missing notebooks and tags are created
* Added a preview that compares against the remote branch without creating or writing anything, and is required before a folder's first sync. Also added a status command, a backup of the notes before the first sync, and an interval change that applies immediately
* Fixed: every note is read, not just the first 100 (#5); only managed files are written and none are deleted (#7, #12); `~` is expanded and the stray folder left by older versions is reported (#8); the first push no longer fails on `master`/`main` (#9); Git runs without a shell (#10); errors are shown in Inkdrop (#11, #1); the interval applies without restart (#14); the token is no longer stored in `.git/config` (#6)
* Git: an interrupted cycle resumes, a remote that moved is merged and the push retried, common versions are recorded only after a successful push, credential helpers are bypassed so the token never reaches the keychain, unrelated histories stop with a clear message, and nothing is force-pushed or reset
* A note deleted on both sides is forgotten; an edited conflict copy is archived, never overwritten
* Inkdrop 6 API, checked in a running Inkdrop 6.3.0: the database is read from `inkdrop.localDB` (the plugin crashed on every cycle), pages are read from `rows[].doc` (the plugin saw no notes), and notifications use `addInfo`/`addWarning`/`addError`
* A note changed from Git is dated at import, so it rises in "Date Updated"
* `engines.inkdrop` narrowed to `>=6.0.0 <7`, the versions the data schema was verified against

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
