# Guide for agents editing synchronized notes

Notes are UTF-8 Markdown files in `notes/`, one per note. Do not touch anything else the plugin manages, and never edit `.inkdrop-git-sync/` (local, uncommitted state).

## Format

```markdown
---
schema_version: 1
sync_id: "0b6c1f3e-5d2a-4c7e-9f10-2b3c4d5e6f70"
inkdrop_id: "note:zDawhvss"
title: "Meeting notes"
book_path: ["Work", "Meetings"]
tags: ["hermes", "todo"]
status: "active"
created_at: "2026-11-06T09:00:00.000Z"
updated_at: "2026-11-06T09:30:00.000Z"
---
Body in Markdown.
```

- Each front matter value is JSON on one line.
- `schema_version` must be `1`.
- `sync_id` must equal the filename without `.md`. It must be a UUID (versions 1 to 5). Never change or reuse it.
- `inkdrop_id` appears only on notes created in Inkdrop. Keep it when you edit such a note. Never add it, and never copy it into another file.
- `book_path` is required: notebook names from the top level down. Missing notebooks and tags are created in Inkdrop.
- `status` is one of `none`, `active`, `onHold`, `completed`, `dropped`.
- Update `updated_at` when you change a note.

## New notes

Generate a fresh random UUID (for example `uuidgen | tr A-Z a-z`). Name the file `<uuid>.md` and write the same value in `sync_id`. Leave out `inkdrop_id`. The plugin imports the note once and keeps the link.

## Workflow

- Commit before the bridge fetches. Uncommitted changes in the bridge's checkout stop its cycle.
- Push normally. Never force-push or rewrite history on the synchronized branch.
- Serialize writers within one checkout. For concurrent agents, use separate branches and merge through pull requests. Never have several agents write to the same checkout at once.

## Limits

- Deleting a file does not delete the note in Inkdrop: the deletion is reported to the user for manual resolution. Coordinate deletions with a person.
- A malformed file blocks that note only, until it is fixed.
- If a note changed in both Inkdrop and Git, the bridge blocks it and asks the user to choose.
- Attachments and `inkdrop://` links are not portable yet.
