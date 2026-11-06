# Migration from autopush-notes

The package identity changes from `autopush-notes` to `inkdrop-git-sync`. Inkdrop does not document automatic transfer of installed package identity, so this is an explicit transition.

On first activation, the plugin copies the old interval, repository, token, and export-folder preferences into the new namespace. It disables scheduled execution, retains `export` mode, and records migration once. The token is never logged or placed in the remote URL.

Before bidirectional sync, disable the old plugin, back up the notes, choose a new empty sync folder, review configuration, run **Preview Without Writing**, resolve ambiguities, select `sync` mode, and run one manual cycle before enabling scheduling.

Legacy commands remain aliases. The old package is not removed automatically, and the GitHub repository is not renamed.
