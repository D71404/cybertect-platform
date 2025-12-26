// CommonJS wrapper for Videotect TypeScript modules
// Uses dynamic import() to load ES modules

const path = require('path');
const { pathToFileURL } = require('url');

let modules = null;
let loadingPromise = null;

// Async function to load all TypeScript modules using dynamic import
async function loadModules() {
  if (modules) return modules;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const baseDir = __dirname;
      
      // Convert file paths to file:// URLs for dynamic import
      const normalizeUrl = pathToFileURL(path.join(baseDir, 'normalize.ts')).href;
      const csvParserUrl = pathToFileURL(path.join(baseDir, 'csv-parser.ts')).href;
      const scoringUrl = pathToFileURL(path.join(baseDir, 'scoring.ts')).href;
      const aggregateUrl = pathToFileURL(path.join(baseDir, 'aggregate.ts')).href;
      const dbUrl = pathToFileURL(path.join(baseDir, '../db/videotect.ts')).href;

      // Dynamic imports work with ES modules via file:// URLs
      const [normalizeModule, csvParserModule, scoringModule, aggregateModule, dbModule] = await Promise.all([
        import(normalizeUrl),
        import(csvParserUrl),
        import(scoringUrl),
        import(aggregateUrl),
        import(dbUrl)
      ]);

      modules = {
        normalizeYouTubeUrl: normalizeModule.normalizeYouTubeUrl,
        parsePlacementCSV: csvParserModule.parsePlacementCSV,
        scorePlacement: scoringModule.scorePlacement,
        aggregateRows: aggregateModule.aggregateRows,
        scoreAggregatedItems: aggregateModule.scoreAggregatedItems,
        createImport: dbModule.createImport,
        createItem: dbModule.createItem,
        updateItemStatus: dbModule.updateItemStatus,
        queryItems: dbModule.queryItems,
        getItem: dbModule.getItem,
        getItemsForExport: dbModule.getItemsForExport
      };

      console.log('✅ Videotect modules loaded successfully');
      return modules;
    } catch (error) {
      console.error('❌ Error loading Videotect modules:', error.message);
      console.error(error.stack);
      // Return fallback functions
      modules = {
        normalizeYouTubeUrl: () => ({ type: 'other', canonicalUrl: '', originalUrl: '' }),
        parsePlacementCSV: () => [],
        scorePlacement: () => ({ score: 0, reasons: [] }),
        aggregateRows: () => new Map(),
        scoreAggregatedItems: () => new Map(),
        createImport: () => 0,
        createItem: () => 0,
        updateItemStatus: () => {},
        queryItems: () => [],
        getItem: () => null,
        getItemsForExport: () => []
      };
      return modules;
    }
  })();

  return loadingPromise;
}

// TEMPORARILY DISABLED: Start loading immediately
// loadModules();  // This was hanging on server startup

// Export synchronous wrapper functions that use cached modules
module.exports = {
  // Ensure modules are loaded before using them
  ensureLoaded: loadModules,
  
  // Synchronous wrappers (will throw if modules not loaded yet)
  normalizeYouTubeUrl: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.normalizeYouTubeUrl(...args);
  },
  parsePlacementCSV: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.parsePlacementCSV(...args);
  },
  scorePlacement: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.scorePlacement(...args);
  },
  aggregateRows: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.aggregateRows(...args);
  },
  scoreAggregatedItems: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.scoreAggregatedItems(...args);
  },
  createImport: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.createImport(...args);
  },
  createItem: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.createItem(...args);
  },
  updateItemStatus: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.updateItemStatus(...args);
  },
  queryItems: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.queryItems(...args);
  },
  getItem: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.getItem(...args);
  },
  getItemsForExport: (...args) => {
    if (!modules) throw new Error('Videotect modules not loaded yet. Call ensureLoaded() first.');
    return modules.getItemsForExport(...args);
  }
};
