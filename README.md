# Inkdrop Git Sync

Inkdrop Git Sync synchronizes Inkdrop notes with a private Git repository while Inkdrop is running. The Git checkout remains usable by people and agents when Inkdrop is offline; their committed changes are imported on the next active cycle.

The technical package name is `inkdrop-git-sync`. The GitHub repository intentionally remains `dkp-consult/autopush-notes` to preserve its history.

## MVP behavior

- Notes live in `notes/<sync-id>.md`, with a stable UUID independent of title or notebook.
- Versioned front matter contains the title, notebook path, tags, status, and timestamps.
- Local, uncommitted state under `.inkdrop-git-sync/` records Inkdrop mappings and the last common version.
- A change on one side is copied to the other side. Identical changes are accepted.
- Different changes on both sides create two files under `.inkdrop-git-sync/conflicts/` and block that note.
- A missing note or managed file is reported for manual resolution. The MVP never propagates deletions and never silently recreates missing content.
- Files outside the managed UUID filenames are left untouched.

Attachments, image portability, link rewriting, automatic text merging, tombstones, and simultaneous use by multiple Inkdrop bridges are outside this MVP.

## Configuration

In **Preferences → Plugins → Inkdrop Git Sync**, configure the private repository as `owner/repository`, branch, a new dedicated sync folder, GitHub token, and optional comma-separated notebook IDs. Run **Preview Without Writing** first. Review proposed matches and resolve every ambiguity, then select `sync` mode and enable scheduling. The default interval is five minutes.

Commands: `inkdrop-git-sync:syncNow`, `inkdrop-git-sync:preview`, `inkdrop-git-sync:openConflicts`, `inkdrop-git-sync:openFolder`, and `inkdrop-git-sync:toggle`.

Legacy `autopush-notes:*` command aliases remain during the transition. See [MIGRATION.md](MIGRATION.md).

## Development

```sh
npm ci
npm test
npm run check
```

Manual Inkdrop verification is still required before release; see [TESTING.md](TESTING.md). Agents editing synchronized notes must follow [AGENTS_GIT_SYNC.md](AGENTS_GIT_SYNC.md). Do not publish this package from an unreviewed development checkout.

## License

MIT
