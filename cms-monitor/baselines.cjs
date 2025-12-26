/**
 * CMS Monitor - Baseline Management
 * Handles saving and loading baseline snapshots
 */

const fs = require('fs');
const path = require('path');

const BASELINES_DIR = path.join(__dirname, '..', 'data', 'cms-monitor', 'baselines');

/**
 * Ensure baselines directory exists
 */
function ensureBaselinesDir() {
  if (!fs.existsSync(BASELINES_DIR)) {
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
  }
}

/**
 * Generate baseline filename
 */
function getBaselineFilename(publisher, environment, releaseLabel) {
  const safePublisher = publisher.replace(/[^a-z0-9]/gi, '_');
  const safeEnv = environment.replace(/[^a-z0-9]/gi, '_');
  const safeRelease = releaseLabel.replace(/[^a-z0-9]/gi, '_');
  return `${safePublisher}_${safeEnv}_${safeRelease}.json`;
}

/**
 * Save baseline
 */
function saveBaseline(publisher, environment, releaseLabel, scanResult) {
  ensureBaselinesDir();
  
  const filename = getBaselineFilename(publisher, environment, releaseLabel);
  const filepath = path.join(BASELINES_DIR, filename);
  
  const baseline = {
    publisher,
    environment,
    releaseLabel,
    createdAt: new Date().toISOString(),
    buildLabel: scanResult.buildLabel,
    baseUrl: scanResult.baseUrl,
    pageResults: scanResult.pageResults,
    summary: scanResult.summary
  };
  
  fs.writeFileSync(filepath, JSON.stringify(baseline, null, 2));
  
  return {
    filename,
    filepath,
    baseline
  };
}

/**
 * Load baseline
 */
function loadBaseline(publisher, environment, releaseLabel) {
  ensureBaselinesDir();
  
  const filename = getBaselineFilename(publisher, environment, releaseLabel);
  const filepath = path.join(BASELINES_DIR, filename);
  
  if (!fs.existsSync(filepath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error(`Error loading baseline ${filename}:`, e.message);
    return null;
  }
}

/**
 * List all baselines
 */
function listBaselines() {
  ensureBaselinesDir();
  
  const files = fs.readdirSync(BASELINES_DIR).filter(f => f.endsWith('.json'));
  
  return files.map(filename => {
    try {
      const filepath = path.join(BASELINES_DIR, filename);
      const data = fs.readFileSync(filepath, 'utf8');
      const baseline = JSON.parse(data);
      return {
        filename,
        publisher: baseline.publisher,
        environment: baseline.environment,
        releaseLabel: baseline.releaseLabel,
        createdAt: baseline.createdAt,
        buildLabel: baseline.buildLabel,
        baseUrl: baseline.baseUrl
      };
    } catch (e) {
      return null;
    }
  }).filter(b => b !== null);
}

/**
 * Find baseline by publisher/environment (latest)
 */
function findLatestBaseline(publisher, environment) {
  const baselines = listBaselines().filter(b => 
    b.publisher === publisher && b.environment === environment
  );
  
  if (baselines.length === 0) return null;
  
  // Sort by createdAt descending
  baselines.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  const latest = baselines[0];
  return loadBaseline(latest.publisher, latest.environment, latest.releaseLabel);
}

module.exports = {
  saveBaseline,
  loadBaseline,
  listBaselines,
  findLatestBaseline
};

