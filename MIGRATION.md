# Migration from autopush-notes

autopush-notes was renamed Inkdrop Git Sync when it became a two-way sync; see [Why the new name](README.md#why-the-new-name). The GitHub repository moved to `dkp-consult/inkdrop-git-sync` (the old URL redirects).

The package is now published as `inkdrop-git-sync`. Inkdrop has no documented way to transfer an installed package to a new name, so the transition is explicit. `autopush-notes` stays in the registry and is not removed automatically.

## What happens on first activation

- The old interval, repository, token and export folder are copied into the new settings, once. The token is never displayed or logged.
- Mode is set to `export` and scheduling is turned off, whatever the old setting was.
- If autopush-notes 0.0.4 or earlier wrote your backup into a folder literally named `~` (it never expanded `~`), a notification gives its location. It is never moved or deleted. Its `.git/config` may hold your GitHub token in clear text: check the folder, then delete it yourself.
- Inkdrop Git Sync refuses to run while `autopush-notes` is active, so two plugins never write to one repository. The legacy commands stay silent in that case.

## Keeping the one-way export

`export` mode writes `notes/<sync-id>.md` into the old export folder, or into the sync folder if none was set. Files written by autopush-notes (named after note titles) are left alone; remove them yourself once you have checked the new files. If that folder's history is unrelated to the remote branch (the old `master`/`main` mismatch), the cycle stops with a clear message. In that case, use a new empty folder.

## Moving to two-way sync

1. Disable `autopush-notes`.
2. Back up your notes (Inkdrop's own backup, or a copy of the data directory). The plugin also saves a JSON copy of your notes before the first sync, in `.inkdrop-git-sync/backups/`.
3. Choose a **new, empty** sync folder. Sync mode refuses the legacy export folder.
4. Review the settings, set the mode to `sync`, and run **Preview Without Writing**. Notes already exported by `export` mode are recognised as matches, not as new notes.
5. Resolve anything listed as a conflict, then run one **Synchronize Now** before enabling the schedule.

## Removing autopush-notes

Once Inkdrop Git Sync has started once (its settings are then imported), remove the old package:

1. Quit Inkdrop.
2. Run `ipm uninstall autopush-notes`.
3. Inkdrop keeps the old package's settings in `config.json`, including the GitHub token in clear text. Remove the `autopush-notes` section from `~/Library/Application Support/inkdrop/config.json` (macOS), or clear the token in the plugin settings before uninstalling.
4. Restart Inkdrop. The old export folder and the backup repository it pushed to are not touched: keep or delete them yourself.
