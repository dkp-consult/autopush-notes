# Testing Guide for Note Deletion Sync Feature

## Overview
This document describes how to test the new note deletion synchronization feature in the autopush-notes plugin.

## Prerequisites
- Inkdrop installed and running
- autopush-notes plugin installed and configured
- GitHub repository set up
- Local export path configured
- Auto backup enabled

## Test Scenarios

### Test 1: Single Note Deletion
**Objective**: Verify that deleting a single note removes it from local storage and GitHub.

**Steps**:
1. Create a test note in Inkdrop (e.g., "Test Note for Deletion")
2. Wait for the automatic backup to complete (or manually trigger backup)
3. Verify the note exists in your local export folder as `Test Note for Deletion.md`
4. Verify the note exists in your GitHub repository
5. Delete the note in Inkdrop
6. Check your local export folder - the file should be removed
7. Check your GitHub repository - a new commit should appear with message "Delete note: Test Note for Deletion"
8. Verify the file is no longer in the repository

**Expected Result**: 
- Local file deleted immediately
- GitHub commit created with deletion
- File no longer appears in GitHub repository

### Test 2: Multiple Note Deletions
**Objective**: Verify that deleting multiple notes in sequence works correctly.

**Steps**:
1. Create 3 test notes (e.g., "Delete Test 1", "Delete Test 2", "Delete Test 3")
2. Wait for automatic backup or trigger manual backup
3. Verify all 3 notes exist locally and on GitHub
4. Delete all 3 notes one by one
5. Check that each deletion is synced properly

**Expected Result**:
- All 3 files deleted locally
- Multiple commits created (one per deletion)
- All files removed from GitHub

### Test 3: Delete Note Before Initial Backup
**Objective**: Verify behavior when deleting a note that hasn't been backed up yet.

**Steps**:
1. Disable auto backup temporarily
2. Create a new note
3. Delete the note before any backup occurs
4. Re-enable auto backup

**Expected Result**:
- No errors should occur
- Plugin should handle gracefully (note never existed in backup)

### Test 4: Delete Note with Special Characters
**Objective**: Verify that notes with special characters in titles are deleted correctly.

**Steps**:
1. Create a note with special characters (e.g., "Test: Note? With* Special| Characters")
2. Wait for backup to complete
3. Verify the sanitized filename exists locally (e.g., "Test- Note- With- Special- Characters.md")
4. Delete the note in Inkdrop
5. Verify the correct file is deleted

**Expected Result**:
- Correct sanitized file is identified and deleted
- Deletion synced to GitHub successfully

### Test 5: Git Repository Not Initialized
**Objective**: Verify behavior when git repository hasn't been set up yet.

**Steps**:
1. Configure a new local export path (empty folder)
2. Create and delete a note
3. Check console logs

**Expected Result**:
- Local file deleted (or not created if deleted before backup)
- Console log: "Git repository not initialized, skipping deletion sync"
- No errors thrown

## Monitoring and Debugging

### Console Logs to Watch
The following console logs indicate proper functioning:

```
Note deleted: [Note Title]
Local file deleted: [File Path]
Syncing deletion to GitHub for: [Note Title]
Note deletion synced to GitHub!
```

### Error Scenarios
Watch for these potential errors:

1. **GitHub token missing**: "GitHub token or repository not configured!"
2. **File not found**: Local file might not exist (note was never backed up)
3. **Git errors**: Check git repository state and permissions

## Verification Checklist

After running tests, verify:

- [ ] Local files are deleted when notes are deleted
- [ ] GitHub commits are created for deletions
- [ ] No orphaned files remain in local folder
- [ ] No orphaned files remain in GitHub repository
- [ ] Console logs show successful operations
- [ ] No error messages appear
- [ ] Plugin continues to work for new note additions
- [ ] Auto backup still functions normally

## Troubleshooting

### Issue: Local file not deleted
**Solution**: Check console logs for errors. Verify file permissions on local export folder.

### Issue: Deletion not syncing to GitHub
**Solution**: 
- Verify git repository is initialized
- Check GitHub token validity
- Verify network connectivity
- Check console for git command errors

### Issue: Wrong file deleted
**Solution**: Check note title sanitization logic. Verify special characters are handled correctly.

## Notes

- The deletion sync happens in real-time when a note is deleted
- Deletions are independent of the automatic backup interval
- If auto backup is disabled, deletions will still be synced
- The plugin uses `git add -A` to ensure deletions are staged properly