---
name: Troubleshoot Missing UI Changes
overview: Diagnose and fix why the refresh button and evidence pack download button are not visible in the browser, covering server restart, browser cache, and code verification.
todos: []
---

# Troubleshoot Missing UI Changes

## Problem

The refresh button and evidence pack download button are implemented in the code but not visible in the browser.

## Root Cause Analysis

The buttons are conditionally rendered: `{globalHistory.length > 0 && (...)}` (line 207 in `src/components/LandingPage.jsx`). They only appear after at least one domain has been scanned.

However, if scans have been performed and buttons still don't appear, likely causes are:

1. **Browser cache** - Old JavaScript bundle being served
2. **Dev server not running** - Vite dev server not started or crashed
3. **Hot reload failure** - Changes not being picked up by Vite
4. **Build issues** - JavaScript compilation errors preventing updates

## Troubleshooting Steps

### Step 1: Verify Code is Saved

- Confirm `src/components/LandingPage.jsx` contains:
  - `RefreshCw` import (line 2)
  - `handleClearHistory` function (lines 12-18)
  - `handleDownloadEvidencePack` function (lines 20-52)
  - Button components (lines 209-234)
- Confirm `server.cjs` contains `/api/scans/evidence-pack` endpoint (line 263)

### Step 2: Check Dev Servers Status

- Verify Express server is running on port 3000: `curl http://localhost:3000/api/health`
- Verify Vite dev server is running on port 5173: `curl http://localhost:5173`
- Check for any error messages in server console output

### Step 3: Restart Dev Servers

- Stop both servers (Ctrl+C in each terminal)
- Clear any build cache: `rm -rf node_modules/.vite .vite dist`
- Restart Express: `npm run start:server`
- Restart Vite: `npm run start:dev`
- Wait for both to fully start (check for "ready" messages)

### Step 4: Clear Browser Cache

- Open browser DevTools (F12)
- Right-click refresh button → "Empty Cache and Hard Reload"
- Or manually clear cache: Settings → Clear browsing data → Cached images and files
- Try incognito/private window to rule out extensions

### Step 5: Verify Button Visibility Condition

- Perform a test scan (enter a URL and click "Start Forensic Scan")
- After scan completes, check if `globalHistory` has items
- Open browser console and check: `document.querySelector('[title="Clear scanned domains"]')`
- If null, buttons aren't rendering (check React DevTools for component state)

### Step 6: Check for JavaScript Errors

- Open browser console (F12)
- Look for:
  - Import errors (missing `RefreshCw`, `Loader2` from lucide-react)
  - Runtime errors in `LandingPage.jsx`
  - Network errors when calling `/api/scans/evidence-pack`
- Check Network tab for failed requests

### Step 7: Verify React Component Rendering

- Install React DevTools browser extension
- Inspect `LandingPage` component
- Check `globalHistory` state value
- Verify `downloadingEvidence` state exists
- Confirm button components are in the component tree

## Files to Check

- `src/components/LandingPage.jsx` - Button implementation
- `server.cjs` - Evidence pack endpoint
- Browser console - Runtime errors
- Network tab - API call failures

## Expected Behavior

After completing a scan:

1. Buttons should appear below the scan button
2. "Clear History" button (gray) with refresh icon
3. "Evidence Pack" button (purple) with download icon
4. Both buttons visible when `globalHistory.length > 0`

## Quick Fix Commands

```bash
# Kill any processes on ports 3000 and 5173
lsof -ti:3000,5173 | xargs kill -9

# Clear Vite cache
rm -rf node_modules/.vite .vite

# Restart servers
npm run start:server &  # Background
npm run start:dev       # Foreground
```

## Alternative: Force Visibility (Debug)

If buttons still don't appear, temporarily remove the conditional to test:

- Change line 207 from `{globalHistory.length > 0 && (` to `{true && (`
- This makes buttons always visible for debugging
- Revert after confirming they render correctly