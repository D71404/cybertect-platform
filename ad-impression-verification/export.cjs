/**
 * Evidence Pack Export Module
 * Generates ZIP file with all evidence
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Generate evidence pack ZIP file
 * @param {string} runId - Run ID
 * @returns {Promise<string>} - Path to generated ZIP file
 */
async function generateEvidencePack(runId) {
  const runDir = path.join(__dirname, '..', 'runs', 'ad-impression-verification', runId);
  
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runId}`);
  }
  
  const summaryPath = path.join(runDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Summary file not found for run: ${runId}`);
  }
  
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const sequencesPath = path.join(runDir, 'sequences.json');
  const flagsPath = path.join(runDir, 'flags.json');
  const networkPath = path.join(runDir, 'network.json');
  
  // Create ZIP file
  const zipPath = path.join(runDir, `evidence-pack-${runId}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  return new Promise((resolve, reject) => {
    archive.on('error', reject);
    output.on('close', () => resolve(zipPath));
    
    archive.pipe(output);
    
    // Add summary.json
    archive.file(summaryPath, { name: 'summary.json' });
    
    // Add sequences.csv
    if (fs.existsSync(sequencesPath)) {
      const sequences = JSON.parse(fs.readFileSync(sequencesPath, 'utf8'));
      const csv = generateSequencesCSV(sequences);
      archive.append(csv, { name: 'sequences.csv' });
    }
    
    // Add flags.json
    if (fs.existsSync(flagsPath)) {
      archive.file(flagsPath, { name: 'flags.json' });
    }
    
    // Add network.json (HAR-like format)
    if (fs.existsSync(networkPath)) {
      archive.file(networkPath, { name: 'network.json' });
    }
    
    // Add screenshots
    const screenshotFiles = fs.readdirSync(runDir)
      .filter(f => f.endsWith('.png'));
    
    screenshotFiles.forEach(file => {
      archive.file(
        path.join(runDir, file),
        { name: `screenshots/${file}` }
      );
    });
    
    // Add README.txt
    const readme = generateReadme(summary);
    archive.append(readme, { name: 'README.txt' });
    
    archive.finalize();
  });
}

/**
 * Generate CSV from sequences
 */
function generateSequencesCSV(sequences) {
  const headers = [
    'Timestamp',
    'Type',
    'Vendor',
    'Creative ID',
    'Placement',
    'URL',
    'Status',
    'Frame URL',
    'Page URL',
    'Confidence',
    'Percent In View',
    'Duration (ms)'
  ];
  
  const rows = sequences.map(seq => [
    new Date(seq.ts).toISOString(),
    seq.type,
    seq.vendor,
    seq.creativeId || '',
    seq.placement || '',
    seq.requestUrl || '',
    seq.status || '',
    seq.frameUrl || '',
    seq.pageUrl || '',
    seq.confidence || '',
    seq.percentInView || '',
    seq.duration || ''
  ]);
  
  return [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
}

/**
 * Generate README.txt
 */
function generateReadme(summary) {
  return `
Ad Impression Verification Evidence Pack
========================================

Generated: ${new Date().toISOString()}
Run ID: ${summary.runId}
URL: ${summary.url}
Campaign Label: ${summary.campaignLabel || 'N/A'}

Summary
-------
Total Impressions Detected: ${summary.summary.totalImpressions}
Viewable Impressions Verified: ${summary.summary.viewableImpressions}
Clicks Detected: ${summary.summary.clicks}
Discrepancy: ${summary.summary.discrepancyPercent}%
Flags: ${summary.summary.flagsCount}

Files Included
--------------
- summary.json: Complete scan results and metadata
- sequences.csv: Timeline of all detected beacons (impressions, clicks, viewability)
- flags.json: Campaigns/placements flagged for viewability discrepancies
- network.json: Network request log (HAR-like format)
- screenshots/: Page screenshots captured during scan
- README.txt: This file

How to Interpret
----------------
1. Review sequences.csv to see the chronological order of impression → viewability → click events
2. Check flags.json for placements where verified viewability falls behind impressions
3. Compare detected impressions against your ad-server/DSP delivery totals
4. Use screenshots to verify visual state at key moments

Viewability Rule Applied
------------------------
${summary.viewabilityRule || '50%/1s'} (${summary.viewabilityRule === '50%/1s' ? '50% visible for 1 second' : 'Custom rule'})

Discrepancy Threshold
---------------------
${summary.discrepancyThreshold}%

Reconciliation
--------------
${summary.reconciliation ? `
Verified Viewability Rate: ${summary.reconciliation.verifiedViewabilityRate}%
Detected vs Ad-server: ${summary.reconciliation.discrepancyVsAdserver !== null ? summary.reconciliation.discrepancyVsAdserver + '%' : 'N/A'}
Detected vs DSP: ${summary.reconciliation.discrepancyVsDSP !== null ? summary.reconciliation.discrepancyVsDSP + '%' : 'N/A'}
` : 'No delivery totals provided for reconciliation'}

For questions or support, contact Cybertect support.
`.trim();
}

module.exports = {
  generateEvidencePack
};

