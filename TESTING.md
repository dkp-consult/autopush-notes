# Validation guide

Run `npm ci`, `npm test`, and `npm run check`. Automated tests do not replace validation against Inkdrop `>=5.3.1 <7`.

## Manual Inkdrop checks before release

Use a copy of the notes and a disposable private GitHub repository. Keep `autopush-notes` disabled.

1. Confirm the renamed preferences, commands, menus, and shortcuts load.
2. Sync more than 100 notes with duplicate titles, Unicode, tags, statuses, and several notebooks.
3. Rename a note and confirm its UUID filename stays unchanged.
4. Verify Inkdrop-to-Git and committed Git-to-Inkdrop edits.
5. Import an external note once across two cycles and an Inkdrop restart.
6. Make concurrent edits and confirm two conflict copies appear without overwriting either side.
7. Delete a note and a managed file separately; confirm only warnings appear and no deletion propagates.
8. Confirm malformed managed files block safely and foreign files remain untouched.
9. Edit during import and confirm revision checking defers the write.
10. Test network loss, push rejection, restart, and token rotation without loss, duplication, or secret leakage.
11. Change the interval and reactivate; confirm one timer and one bridge.
12. Restrict notebook IDs and confirm out-of-scope notes are not treated as deleted.

Run `ipm publish --dry-run` only as separate release validation. Do not run `ipm publish` for this change.
