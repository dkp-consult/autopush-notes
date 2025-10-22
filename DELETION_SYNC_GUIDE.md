# Note Deletion Sync - Quick Reference Guide

## What's New?

The autopush-notes plugin now automatically syncs note deletions to your GitHub repository. When you delete a note in Inkdrop, it's instantly removed from both your local backup folder and your GitHub repository.

## How It Works

```
You delete a note in Inkdrop
         ↓
Local .md file is removed
         ↓
Git stages the deletion
         ↓
Commit created: "Delete note: [Note Title]"
         ↓
Changes pushed to GitHub
```

## Key Features

✅ **Automatic** - No manual action required  
✅ **Real-time** - Syncs immediately upon deletion  
✅ **Independent** - Works regardless of backup interval  
✅ **Safe** - Validates before syncing  
✅ **Logged** - Creates clear Git commit messages

## Requirements

- Plugin version 0.0.2 or higher
- GitHub token configured
- GitHub repository set up
- Local export path configured
- Git repository initialized (happens automatically on first backup)

## Usage

Simply delete a note in Inkdrop as you normally would. The plugin handles everything else automatically.

### Example Flow

1. You have a note called "Meeting Notes 2024"
2. The backup system has created `Meeting Notes 2024.md` in your local folder and GitHub
3. You delete the note in Inkdrop
4. **Automatically happens:**
   - File removed from local folder
   - Git detects the deletion
   - Commit created: "Delete note: Meeting Notes 2024"
   - Changes pushed to GitHub
5. Done! Your backup is now in sync

## Console Messages

When working correctly, you'll see these console messages:

```
Note deleted: [Note Title]
Local file deleted: [Path/To/File.md]
Syncing deletion to GitHub for: [Note Title]
Note deletion synced to GitHub!
```

## Troubleshooting

### Deletion not syncing to GitHub?

**Check these:**
- Is your GitHub token valid?
- Is the GitHub repository name correct?
- Do you have internet connectivity?
- Is the Git repository initialized? (Run first backup if not)

**View console logs:**
Open Inkdrop DevTools (View → Toggle Developer Tools) and check the Console tab for error messages.

### File still showing in GitHub?

**Try this:**
1. Check your GitHub repository - look for the deletion commit
2. Refresh the GitHub page
3. Verify you're looking at the main branch
4. Check if multiple notes had the same title

### Local file not deleted?

**Possible causes:**
- Note was never backed up (deleted before first backup)
- File permissions issue on local folder
- Note title contains unusual characters

**Solution:**
Check console logs for specific error messages.

## Important Notes

⚠️ **Deletions are permanent** - Once synced to GitHub and pushed, the deletion becomes part of the Git history. The file content is still recoverable from Git history if needed.

💡 **Tip:** You can view deletion history in your GitHub repository's commit log. Each deletion creates a commit with a clear message.

🔄 **Independence:** Deletion sync works independently from the auto-backup interval. Deletions sync immediately, not at the next scheduled backup.

## Configuration

No additional configuration needed! The deletion sync uses your existing plugin settings:

- GitHub Token
- GitHub Repository
- Local Export Path

If these are configured, deletion sync works automatically.

## Git History

Each deletion creates a commit in your repository:

```bash
commit abc123...
Author: Your Name
Date: [timestamp]

    Delete note: Meeting Notes 2024
```

This provides a clear audit trail of when notes were deleted.

## Viewing Deleted Note Content

Even after deletion, you can recover note content from Git history:

```bash
# View commit history
git log --all --full-history -- "Meeting Notes 2024.md"

# View file content from specific commit
git show [commit-hash]:"Meeting Notes 2024.md"
```

Or browse the commit history on GitHub's web interface.

## FAQ

**Q: Can I disable deletion sync but keep auto-backup?**  
A: Not currently. Deletion sync is part of the core synchronization feature.

**Q: What if I delete many notes at once?**  
A: Each deletion creates a separate commit. This provides detailed history but results in multiple commits.

**Q: Does it work with the manual backup command?**  
A: Deletion sync is real-time and independent of manual or automatic backups.

**Q: What happens if GitHub is unreachable when I delete a note?**  
A: The local file is deleted, but the GitHub sync will fail. Check console logs for errors. The deletion will need manual sync via `git push`.

**Q: Can I undo a deletion?**  
A: Deletions in Inkdrop follow Inkdrop's trash system. The backup deletion is immediate but recoverable from Git history.

## Support

- **Issues**: [GitHub Issues](https://github.com/dkp-consult/autopush-notes/issues)
- **Documentation**: See README.md and TESTING.md
- **Implementation Details**: See IMPLEMENTATION_SUMMARY.md

## Version History

- **v0.0.2**: Deletion sync feature added
- **v0.0.1**: Initial release with backup functionality