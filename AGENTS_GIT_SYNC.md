# Guide for agents editing synchronized notes

Managed notes are UTF-8 Markdown under `notes/`. The filename and `sync_id` must be the same UUID. Preserve front matter and `schema_version: 1`. Titles may change; filenames must not.

Use a fresh UUID for each new note. Never copy a `sync_id` or edit `.inkdrop-git-sync/`, which is local uncommitted state.

Commit changes before the bridge fetches them. Serialize writers in one checkout. For concurrent agents, use separate branches and pull requests.

The MVP does not propagate deletions. Coordinate deletions manually. Attachments and rewritten Inkdrop links are not portable in this version.
