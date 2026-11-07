# Inkdrop Git Sync

Inkdrop Git Sync keeps Inkdrop notes and a private Git repository in step while Inkdrop is running. People and agents can work in a clone of the repository while the Mac is off; their committed changes reach Inkdrop on the next active cycle. Inkdrop's own cloud sync is unaffected.

## Why the new name

This plugin used to be called **autopush-notes**. That name described what it did then: export notes and push them to GitHub, one way, as a backup. It now keeps Inkdrop and a Git repository in step **in both directions**, so changes made in Git (by you or by an agent) come back into Inkdrop. "autopush" no longer described it, so it became **Inkdrop Git Sync**:

- package: `inkdrop-git-sync` (replaces `autopush-notes`, which is no longer developed);
- repository: [`dkp-consult/inkdrop-git-sync`](https://github.com/dkp-consult/inkdrop-git-sync), renamed from `dkp-consult/autopush-notes` with its full history (GitHub redirects the old URL);
- commands: `inkdrop-git-sync:*` (the old `autopush-notes:*` commands remain as aliases).

Coming from autopush-notes? Your settings are imported automatically; see [MIGRATION.md](MIGRATION.md).

## How it works

- Each note is one file, `notes/<sync-id>.md`. The name never changes, whatever happens to the title or notebook.
- Front matter holds `schema_version`, `sync_id`, `inkdrop_id` (only for notes created in Inkdrop), `title`, `book_path` (notebook names, parent first), `tags` (tag names), `status`, `created_at` and `updated_at` (ISO 8601). The body follows.
- Sync IDs are deterministic. A note created in Inkdrop always maps to the same file, and a note imported from Git always maps to the same Inkdrop document. A second Mac, a reinstall, or a lost local state therefore never duplicates notes.
- A file carrying an `inkdrop_id` is never imported as a new note. If that Inkdrop note is missing (trashed, deleted, or not downloaded yet by Inkdrop's own sync), the file is reported and left alone.
- Each cycle compares three versions of every note: the last common one, Inkdrop's, and Git's.
  - Changed on one side: copied to the other.
  - Changed identically on both: accepted.
  - Changed differently on both: the note is blocked and two copies are written to `.inkdrop-git-sync/conflicts/`. Nothing is chosen automatically.
- A note that disappears on one side is reported, never deleted on the other or silently recreated. To settle it, delete it on the other side too (it is then forgotten), or restore it.
- Missing notebooks and tags named in a Git note are created in Inkdrop. Fields the format does not carry (pinned, share…) are preserved.
- If an Inkdrop note is edited during a cycle, that note is deferred to the next one.
- Local state lives in `.inkdrop-git-sync/` (never committed): last common versions, mappings, open conflicts, a backup of the Inkdrop notes taken before the first sync, and a journal used to resume an interrupted cycle.
- Git is driven through `execFile`, never a shell. The token is handed to Git through `GIT_ASKPASS`, with credential helpers bypassed, and never written to the remote URL, the repository, the keychain or the logs.
- A remote that moved is merged; nothing is ever force-pushed or reset. Common versions are recorded only once the push succeeds, so a failed push followed by an agent edit becomes a per-note conflict.

Out of scope for now: attachments and images, rewriting `inkdrop://` links, automatic text merging, propagating deletions, and several Inkdrop bridges at once.

## Setup

1. If `autopush-notes` is installed, uninstall it once its settings have been imported (see [MIGRATION.md](MIGRATION.md)).
2. In **Preferences → Plugins → Inkdrop Git Sync**, set:
   - the private repository (`owner/repository`), branch and GitHub token;
   - a **new, dedicated** sync folder (default `~/InkdropGitSync`);
   - optionally, the notebooks to include (names or IDs, comma-separated; sub-notebooks included).
3. Set the mode to `sync`, then run **Plugins → Inkdrop Git Sync → Preview Without Writing**. It lists what a cycle would do against the remote branch, without creating or changing anything: not the folder, not the notes, not Inkdrop. The first synchronization of a folder is refused until a preview has run in the current Inkdrop session.
4. Run **Synchronize Now** once, check the result, then **Enable / Disable Schedule**. The default interval is 5 minutes; changes to the interval apply immediately.

`export` mode remains for existing installations: one-way, Inkdrop to Git, same file format. Switching to `sync` later recognises every exported note.

## Resolving a conflict

**Open Conflicts** shows `<sync-id>.inkdrop.md` and `<sync-id>.git.md`. Delete the copy you do not want; optionally edit the one you keep first. On the next cycle the kept copy is written to both sides. If either side changed again in the meantime, nothing is applied and the copies are refreshed; a copy you had edited is moved to `conflicts/archive/`, never overwritten.

## Commands

| Command | Menu |
|---|---|
| `inkdrop-git-sync:syncNow` (`ctrl-alt-s`) | Synchronize Now |
| `inkdrop-git-sync:preview` (`ctrl-alt-v`) | Preview Without Writing |
| `inkdrop-git-sync:status` | Show Status: running cycle, last success, last error, open conflicts |
| `inkdrop-git-sync:openConflicts` (`ctrl-alt-c`) | Open Conflicts |
| `inkdrop-git-sync:openFolder` | Open Sync Folder |
| `inkdrop-git-sync:toggle` | Enable / Disable Schedule |

The legacy `autopush-notes:*` commands remain as aliases while the old package is inactive.

Agents writing to the repository must follow [AGENTS_GIT_SYNC.md](AGENTS_GIT_SYNC.md).

## Development

```sh
npm ci
npm test
npm run check
```

Tests run on Node's built-in runner, without dependencies. The fake Inkdrop database applies the note, notebook and tag schemas shipped with Inkdrop 6.3. Manual checks in Inkdrop are still required before a release; see [TESTING.md](TESTING.md).

## License

MIT
