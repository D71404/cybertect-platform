/**
 * CMS Monitor - Evidence Pack Generator
 * Creates downloadable evidence bundles with JSON, HTML reports, and screenshots
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Generate HTML report
 */
function generateHTMLReport(scanResult, baselineDiff = null) {
  const { summary, pageResults, duplicates, unauthorized, injectedScripts } = scanResult;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CMS Output Monitor Report - ${scanResult.scanId}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 { color: #2563EB; border-bottom: 2px solid #2563EB; padding-bottom: 10px; }
        h2 { color: #1E40AF; margin-top: 30px; }
        .summary { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .summary-item { padding: 10px; background: #F3F4F6; border-radius: 4px; }
        .summary-item strong { display: block; color: #1F2937; margin-bottom: 5px; }
        .summary-item span { color: #6B7280; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; background: white; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th { background: #2563EB; color: white; padding: 12px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #E5E7EB; }
        tr:hover { background: #F9FAFB; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
        .badge-error { background: #FEE2E2; color: #991B1B; }
        .badge-warning { background: #FEF3C7; color: #92400E; }
        .badge-success { background: #D1FAE5; color: #065F46; }
        .diff-added { background: #D1FAE5; }
        .diff-removed { background: #FEE2E2; }
        .diff-changed { background: #FEF3C7; }
        pre { background: #1F2937; color: #F9FAFB; padding: 15px; border-radius: 4px; overflow-x: auto; }
        .page-section { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <h1>CMS Output Monitor Report</h1>
    
    <div class="summary">
        <h2>Scan Summary</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <strong>Scan ID</strong>
                <span>${scanResult.scanId}</span>
            </div>
            <div class="summary-item">
                <strong>Build Label</strong>
                <span>${scanResult.buildLabel || 'N/A'}</span>
            </div>
            <div class="summary-item">
                <strong>Base URL</strong>
                <span>${scanResult.baseUrl}</span>
            </div>
            <div class="summary-item">
                <strong>Pages Scanned</strong>
                <span>${summary.totalPages}</span>
            </div>
            <div class="summary-item">
                <strong>Total Scripts</strong>
                <span>${summary.totalScripts}</span>
            </div>
            <div class="summary-item">
                <strong>Total Pixels</strong>
                <span>${summary.totalPixels}</span>
            </div>
            <div class="summary-item">
                <strong>Duplicate IDs</strong>
                <span class="badge badge-warning">${summary.duplicateIdsCount}</span>
            </div>
            <div class="summary-item">
                <strong>Unauthorized Partners</strong>
                <span class="badge badge-error">${summary.unauthorizedCount}</span>
            </div>
            <div class="summary-item">
                <strong>Injected Scripts</strong>
                <span class="badge badge-error">${summary.injectedScriptsCount}</span>
            </div>
        </div>
    </div>
    
    ${baselineDiff ? `
    <div class="page-section">
        <h2>Baseline Comparison</h2>
        <p><strong>Baseline:</strong> ${baselineDiff.baselineLabel || 'Unknown'}</p>
        <p><strong>New Scripts:</strong> <span class="badge badge-warning">${baselineDiff.newScripts?.length || 0}</span></p>
        <p><strong>Removed Scripts:</strong> <span class="badge badge-warning">${baselineDiff.removedScripts?.length || 0}</span></p>
        <p><strong>Changed Scripts:</strong> <span class="badge badge-warning">${baselineDiff.changedScripts?.length || 0}</span></p>
    </div>
    ` : ''}
    
    ${injectedScripts.length > 0 ? `
    <div class="page-section">
        <h2>Injected/Unknown Scripts</h2>
        <table>
            <thead>
                <tr>
                    <th>Page</th>
                    <th>Type</th>
                    <th>Source/Hash</th>
                    <th>Reason</th>
                    <th>Macros</th>
                </tr>
            </thead>
            <tbody>
                ${injectedScripts.map(script => `
                <tr>
                    <td>${script.page}</td>
                    <td>${script.type}</td>
                    <td><code>${(script.src || script.hash || 'N/A').substring(0, 60)}</code></td>
                    <td>${script.reason}</td>
                    <td>${script.macros?.join(', ') || 'None'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}
    
    ${Object.keys(duplicates.duplicateIds).length > 0 ? `
    <div class="page-section">
        <h2>Duplicate Analytics Tags</h2>
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Count</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(duplicates.duplicateIds).map(([id, count]) => `
                <tr>
                    <td><code>${id}</code></td>
                    <td><span class="badge badge-warning">${count}</span></td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}
    
    ${unauthorized.length > 0 ? `
    <div class="page-section">
        <h2>Unauthorized Macros/Partners</h2>
        <table>
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Domain</th>
                    <th>Page</th>
                    <th>Reason</th>
                </tr>
            </thead>
            <tbody>
                ${unauthorized.map(item => `
                <tr>
                    <td>${item.type}</td>
                    <td><code>${item.domain}</code></td>
                    <td>${item.page}</td>
                    <td>${item.reason}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}
    
    <div class="page-section">
        <h2>Widget Attribution Map</h2>
        ${pageResults.map(pageResult => `
        <h3>${pageResult.url}</h3>
        ${Object.keys(pageResult.widgetMap || {}).length > 0 ? `
        <table>
            <thead>
                <tr>
                    <th>Widget</th>
                    <th>Attribute</th>
                    <th>Scripts</th>
                    <th>Pixels</th>
                    <th>Measurement IDs</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(pageResult.widgetMap).map(([key, widget]) => `
                <tr>
                    <td><code>${widget.widget}</code></td>
                    <td>${widget.attribute}</td>
                    <td>${widget.scripts.length}</td>
                    <td>${widget.pixels.length}</td>
                    <td>
                        ${Object.entries(widget.measurementIds).filter(([type, ids]) => ids.length > 0).map(([type, ids]) => 
                            `<span class="badge badge-success">${type}: ${ids.length}</span>`
                        ).join(' ')}
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p>No widget attribution found.</p>'}
        `).join('')}
    </div>
    
    <div class="page-section">
        <h2>Page Details</h2>
        ${pageResults.map((pageResult, idx) => `
        <h3>Page ${idx + 1}: ${pageResult.url}</h3>
        <p><strong>Scripts:</strong> ${pageResult.scripts?.length || 0}</p>
        <p><strong>Pixels:</strong> ${pageResult.pixels?.length || 0}</p>
        <p><strong>Network Requests:</strong> ${pageResult.networkRequests?.length || 0}</p>
        <details>
            <summary>Measurement IDs</summary>
            <pre>${JSON.stringify(pageResult.measurementIds, null, 2)}</pre>
        </details>
        `).join('')}
    </div>
    
    <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #E5E7EB; color: #6B7280; text-align: center;">
        <p>Generated by CMS Output Monitor at ${new Date(scanResult.scanTimestamp).toLocaleString()}</p>
    </footer>
</body>
</html>`;
}

/**
 * Diff current scan vs baseline
 */
function diffBaseline(currentScan, baseline) {
  if (!baseline) return null;
  
  const currentScripts = new Map();
  const baselineScripts = new Map();
  
  // Index current scripts by hash/src
  currentScan.pageResults.forEach(pageResult => {
    (pageResult.scripts || []).forEach(script => {
      const key = script.hash || script.src;
      if (key) {
        currentScripts.set(key, script);
      }
    });
  });
  
  // Index baseline scripts
  (baseline.pageResults || []).forEach(pageResult => {
    (pageResult.scripts || []).forEach(script => {
      const key = script.hash || script.src;
      if (key) {
        baselineScripts.set(key, script);
      }
    });
  });
  
  const newScripts = [];
  const removedScripts = [];
  const changedScripts = [];
  
  // Find new scripts
  currentScripts.forEach((script, key) => {
    if (!baselineScripts.has(key)) {
      newScripts.push(script);
    } else {
      // Check if content changed (for inline scripts)
      const baselineScript = baselineScripts.get(key);
      if (script.type === 'inline' && baselineScript.type === 'inline' && script.hash !== baselineScript.hash) {
        changedScripts.push({
          current: script,
          baseline: baselineScript
        });
      }
    }
  });
  
  // Find removed scripts
  baselineScripts.forEach((script, key) => {
    if (!currentScripts.has(key)) {
      removedScripts.push(script);
    }
  });
  
  return {
    baselineLabel: baseline.buildLabel || 'Unknown',
    newScripts,
    removedScripts,
    changedScripts
  };
}

/**
 * Generate evidence pack ZIP file
 */
async function generateEvidencePack(scanResult, baselineDiff = null) {
  const scanId = scanResult.scanId;
  const outputDir = path.join(__dirname, '..', 'data', 'cms-monitor', 'evidence', scanId);
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write summary.json
  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    scanId: scanResult.scanId,
    scanTimestamp: scanResult.scanTimestamp,
    buildLabel: scanResult.buildLabel,
    baseUrl: scanResult.baseUrl,
    summary: scanResult.summary
  }, null, 2));
  
  // Write page results
  const pagesDir = path.join(outputDir, 'pages');
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }
  
  scanResult.pageResults.forEach((pageResult, idx) => {
    const slug = pageResult.url.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const pagePath = path.join(pagesDir, `${slug}.json`);
    fs.writeFileSync(pagePath, JSON.stringify(pageResult, null, 2));
  });
  
  // Write diff.json if baseline exists
  if (baselineDiff) {
    const diffPath = path.join(outputDir, 'diff.json');
    fs.writeFileSync(diffPath, JSON.stringify(baselineDiff, null, 2));
  }
  
  // Copy screenshots
  const screenshotsDir = path.join(outputDir, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  
  scanResult.screenshots.forEach((screenshotPath, idx) => {
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const destPath = path.join(screenshotsDir, `screenshot-${idx}.png`);
      try {
        fs.copyFileSync(screenshotPath, destPath);
      } catch (e) {
        console.warn(`Failed to copy screenshot ${screenshotPath}:`, e.message);
      }
    }
  });
  
  // Generate HTML report
  const htmlReport = generateHTMLReport(scanResult, baselineDiff);
  const reportPath = path.join(outputDir, 'report.html');
  fs.writeFileSync(reportPath, htmlReport);
  
  // Create ZIP file
  const zipPath = path.join(outputDir, `evidence-pack-${scanId}.zip`);
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      resolve(zipPath);
    });
    
    archive.on('error', (err) => {
      reject(err);
    });
    
    archive.pipe(output);
    archive.file(summaryPath, { name: 'summary.json' });
    
    // Add page results
    scanResult.pageResults.forEach((pageResult, idx) => {
      const slug = pageResult.url.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const pagePath = path.join(pagesDir, `${slug}.json`);
      if (fs.existsSync(pagePath)) {
        archive.file(pagePath, { name: `pages/${slug}.json` });
      }
    });
    
    // Add diff if exists
    if (baselineDiff) {
      const diffPath = path.join(outputDir, 'diff.json');
      if (fs.existsSync(diffPath)) {
        archive.file(diffPath, { name: 'diff.json' });
      }
    }
    
    // Add screenshots
    scanResult.screenshots.forEach((screenshotPath, idx) => {
      if (fs.existsSync(screenshotPath)) {
        archive.file(screenshotPath, { name: `screenshots/screenshot-${idx}.png` });
      }
    });
    
    // Add HTML report
    archive.file(reportPath, { name: 'report.html' });
    
    archive.finalize();
  });
}

module.exports = {
  generateEvidencePack,
  generateHTMLReport,
  diffBaseline
};

