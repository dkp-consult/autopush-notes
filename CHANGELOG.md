## 0.1.0 - Inkdrop Git Sync MVP
* Renamed the technical plugin identity while retaining migration preferences and legacy command aliases
* Added opt-in bidirectional synchronization with stable IDs and versioned front matter
* Added three-way conflict detection and deletion warnings without automatic deletion
* Added pagination, serialized cycles, path validation, safe Git execution, tests, and transition guides

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
