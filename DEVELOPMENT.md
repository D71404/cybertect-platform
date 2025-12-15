# Development Workflow Guide

## Overview

This guide outlines best practices for developing this application, especially when working with AI assistance. Following these practices will help prevent lost changes, conflicts, and confusion.

## Core Principles

### 1. One Change Per Conversation

**❌ Bad Approach:**
```
"Add login form, fix dashboard bug, update styling, and add user profile"
```

**✅ Good Approach:**
```
"Add login form" → review → commit → "Fix dashboard bug" → review → commit
```

**Why?**
- AI can focus on one task at a time
- Easier to review and verify changes
- If something breaks, you know exactly what caused it
- Changes are atomic and can be rolled back individually

### 2. Commit Frequently

After each completed feature or fix:

```bash
git add .
git commit -m "Add login form component"
```

**Benefits:**
- Create save points you can return to
- See history of what changed and when
- Easy rollback if something breaks
- Clear progress tracking

### 3. Review Before Moving Forward

Before asking for the next change:
1. ✅ Review the code changes
2. ✅ Test the feature if possible
3. ✅ Commit if it works
4. ✅ Then ask for the next feature

### 4. Use Descriptive Commit Messages

**Good commit messages:**
- `"Add user authentication with JWT"`
- `"Fix dashboard data loading bug"`
- `"Update Scanner component styling"`

**Bad commit messages:**
- `"changes"`
- `"fix"`
- `"update"`

## Workflow Steps

### Starting a New Feature

1. **Make ONE request**
   ```
   "Add a button to export scan results as CSV"
   ```

2. **Wait for implementation**
   - AI will make the changes
   - Review the diff/changes

3. **Test the change**
   - Run the app if possible
   - Verify it works as expected

4. **Commit if successful**
   ```bash
   git add .
   git commit -m "Add CSV export button to scan results"
   ```

5. **Move to next feature**
   - Only after committing the previous change

### When Something Goes Wrong

1. **Check what changed**
   ```bash
   git status
   git diff
   ```

2. **Review recent commits**
   ```bash
   git log --oneline -5
   ```

3. **Rollback if needed**
   ```bash
   git reset --hard HEAD~1  # Undo last commit
   # OR
   git checkout -- <file>    # Undo changes to specific file
   ```

4. **Fix and try again**
   - Make a new, focused request
   - Test incrementally

## Working with AI Assistance

### Best Practices

1. **Be specific and focused**
   - One feature/change per request
   - Include context if needed
   - Mention related files if relevant

2. **Provide feedback**
   - If something doesn't work, say so
   - Reference specific files or line numbers
   - Show error messages if any

3. **Break down complex features**
   - Instead of: "Build a complete user dashboard"
   - Try: "Add user profile section" → then "Add settings panel" → then "Add activity log"

### Common Pitfalls to Avoid

1. **Multiple requests at once**
   - Leads to conflicts
   - Hard to track what changed
   - Difficult to debug issues

2. **Skipping commits**
   - No way to rollback
   - Can't see progress
   - Risk of losing work

3. **Not reviewing changes**
   - May miss bugs
   - Changes might not match expectations
   - Hard to catch issues early

## Git Commands Reference

### Daily Use

```bash
# Check what changed
git status

# See detailed changes
git diff

# Stage all changes
git add .

# Commit changes
git commit -m "Descriptive message"

# View commit history
git log --oneline -10

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo changes to a file
git checkout -- <filename>
```

### Branching (Optional but Recommended)

```bash
# Create a branch for a feature
git checkout -b feature/login-form

# Switch back to main
git checkout main

# Merge feature branch
git merge feature/login-form

# Delete branch after merging
git branch -d feature/login-form
```

## Project Structure

### Key Files

- `server.js` - Main Express server (port 3000)
- `src/App.jsx` - Main React application
- `src/components/` - React components
- `index.html` - Vite entry point
- `vite.config.js` - Vite configuration

### Duplicate Files (See FILE_STRUCTURE.md)

- `server/index.js` - Fragment, not actively used
- `public/index.html` - Legacy standalone HTML

## Troubleshooting

### "Changes never appeared"

1. Check git status: `git status`
2. Check git diff: `git diff`
3. Verify file was actually edited
4. Check if file is in `.gitignore`

### "Going backwards with changes"

1. View commit history: `git log --oneline`
2. Check what changed: `git diff HEAD~1`
3. Rollback if needed: `git reset --hard <commit-hash>`

### "Conflicting changes"

1. Check git status for conflicts
2. Review both versions
3. Manually resolve or ask for clarification
4. Commit resolution

## Quick Reference Checklist

Before asking for a new feature:
- [ ] Previous feature is committed
- [ ] Previous feature is tested (if possible)
- [ ] Ready to focus on ONE new thing

After receiving changes:
- [ ] Review the changes
- [ ] Test if possible
- [ ] Commit with descriptive message
- [ ] Then ask for next feature

## Example Session

```
You: "Add a loading spinner to the Scanner component"

[AI makes changes]

You: [Review changes] ✅ Looks good!

You: git add . && git commit -m "Add loading spinner to Scanner"

You: "Now add error handling for failed scans"

[AI makes changes]

You: [Review changes] ✅ Looks good!

You: git add . && git commit -m "Add error handling for failed scans"
```

This approach ensures:
- ✅ Clear progress tracking
- ✅ Easy rollback if needed
- ✅ No lost changes
- ✅ Better AI assistance (focused requests)
