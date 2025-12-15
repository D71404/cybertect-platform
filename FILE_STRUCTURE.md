# File Structure Documentation

## Duplicate Files Analysis

### Server Files

#### `server.js` (ACTIVE - Root level)
- **Status**: ✅ **PRIMARY/ACTIVE**
- **Purpose**: Main Express server with all API endpoints
- **Port**: 3000 (default)
- **Endpoints**:
  - `POST /api/scan` - Main scanning endpoint
  - `GET /api/results` - Get latest scan results
  - `GET /api/screenshot` - Get screenshot
  - `GET /api/health` - Health check
  - `POST /api/network-scan` - Network scan endpoint
- **Used by**: Scanner.jsx (references port 3000)

#### `server/index.js` (FRAGMENT - Incomplete)
- **Status**: ⚠️ **FRAGMENT/INCOMPLETE**
- **Purpose**: Contains only the `/api/network-scan` endpoint fragment
- **Issue**: This is incomplete code - missing Express app setup, imports, etc.
- **Note**: The `/api/network-scan` endpoint is already implemented in `server.js` (lines 152-165)
- **Recommendation**: This file appears to be leftover code from development. Consider removing it or merging if needed.

**Action Required**: 
- `server/index.js` contains duplicate/incomplete code
- The endpoint it defines is already in `server.js`
- Scanner.jsx references `server/index.js` but should use `server.js` instead

### HTML Entry Points

#### `index.html` (ACTIVE - Root level)
- **Status**: ✅ **PRIMARY/ACTIVE**
- **Purpose**: Vite entry point for React application
- **Used by**: Vite dev server (`vite.config.js` references `./index.html`)
- **Content**: Minimal HTML with React root div

#### `public/index.html` (LEGACY - Standalone)
- **Status**: ⚠️ **LEGACY/STANDALONE**
- **Purpose**: Large standalone HTML file (1600+ lines) with embedded styles and scripts
- **Note**: This appears to be an older version or different implementation
- **Recommendation**: If not actively used, consider archiving or removing

**Action Required**:
- Verify if `public/index.html` is served by Express static middleware
- If not needed, consider removing to avoid confusion

## Recommendations

1. **Consolidate server files**: Use `server.js` as the single server file. Remove or archive `server/index.js` if not needed.

2. **Update references**: 
   - Scanner.jsx line 77 references `server/index.js` - should reference `server.js`
   - Dashboard.jsx line 77 references `server/index.js` on port 3001 - verify correct port

3. **Clarify HTML files**: Determine if `public/index.html` is needed. If it's legacy, remove it or document its purpose.

4. **Port consistency**: Ensure all components reference the same port (3000 for server.js)
