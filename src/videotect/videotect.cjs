// CommonJS wrapper for Videotect TypeScript modules
// Uses ts-node to load TypeScript files

// Register ts-node to handle .ts files
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    esModuleInterop: true,
    allowSyntheticDefaultImports: true
  }
});

try {
  const normalizeModule = require('./normalize.ts');
  const csvParserModule = require('./csv-parser.ts');
  const scoringModule = require('./scoring.ts');
  const aggregateModule = require('./aggregate.ts');
  const dbModule = require('../db/videotect.ts');

  module.exports = {
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
} catch (error) {
  console.error('Error loading Videotect modules:', error);
  // Fallback: export empty object to prevent server crash
  module.exports = {
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
}

