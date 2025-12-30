const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { classifyGa4Id } = require('./src/ga4-classifier.cjs');

// Lazy-load scanner modules to avoid Playwright initialization hanging server startup
let scanWebsite, scanInjectedTelemetry, diagnoseAnalytics, scanAdImpressions, generateEvidencePack;
let scanCMSOutput, generateCMSEvidencePack, diffBaseline;
let saveBaseline, loadBaseline, listBaselines, findLatestBaseline;

function loadScannerModules() {
  if (!scanWebsite) {
    ({ scanWebsite } = require('./scanner.cjs'));
    ({ scanInjectedTelemetry } = require('./injected-telemetry-scanner.cjs'));
    ({ diagnoseAnalytics } = require('./diagnosis.cjs'));
    ({ scanAdImpressions } = require('./ad-impression-verification/scanner.cjs'));
    ({ generateEvidencePack } = require('./ad-impression-verification/export.cjs'));
    ({ scanCMSOutput } = require('./cms-monitor/scanner.cjs'));
    ({ generateEvidencePack: generateCMSEvidencePack, diffBaseline } = require('./cms-monitor/export.cjs'));
    ({ saveBaseline, loadBaseline, listBaselines, findLatestBaseline } = require('./cms-monitor/baselines.cjs'));
    console.log('✅ Scanner modules loaded');
  }
}

// Mock videotect to avoid loading issues
const videotect = { 
  ensureLoaded: () => Promise.resolve(), 
  normalizeYouTubeUrl: () => ({}), 
  parsePlacementCSV: () => [], 
  createImport: () => 0, 
  createItem: () => 0, 
  updateItemStatus: () => {}, 
  queryItems: () => [], 
  getItem: () => null, 
  getItemsForExport: () => [] 
};

const app = express();
// Default backend port; can be overridden via PORT env var
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' directory

// Multer configuration for file uploads (10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// File path for storing scan history
const SCAN_HISTORY_FILE = 'scan_history.json';

// Load scan history from file on startup
let scanHistory = [];
function loadScanHistory() {
  try {
    if (fs.existsSync(SCAN_HISTORY_FILE)) {
      const data = fs.readFileSync(SCAN_HISTORY_FILE, 'utf8');
      scanHistory = JSON.parse(data);
      console.log(`📚 Loaded ${scanHistory.length} scan result(s) from history`);
    }
  } catch (error) {
    console.warn('⚠️ Could not load scan history:', error.message);
    scanHistory = [];
  }
}

// Save scan history to file
function saveScanHistory() {
  try {
    fs.writeFileSync(SCAN_HISTORY_FILE, JSON.stringify(scanHistory, null, 2));
  } catch (error) {
    console.error('❌ Could not save scan history:', error.message);
  }
}

// Load history on startup
loadScanHistory();

/**
 * Transform scan result to flatten metrics for UI compatibility
 * Extracts nested metrics to top-level properties and calculates derived fields
 */
function transformScanResult(result) {
  // If result has an error, return as-is
  if (result.error) {
    return result;
  }

  // Create transformed result with all original fields
  const transformed = { ...result };

  // Extract metrics to top-level for backward compatibility
  if (result.metrics) {
    // Flatten pageViewCount
    transformed.pageViewCount = result.metrics.pageViewCount || 0;
    
    // Map adRequestCount to networkEventsCount
    transformed.networkEventsCount = result.metrics.adRequestCount || 0;
    
    // Calculate sessionInflation (true if more than 1 pageview detected)
    transformed.sessionInflation = (result.metrics.pageViewCount || 0) > 1;
    
    // Debug logging
    console.log(`[Transform] pageViewCount: ${result.metrics.pageViewCount} -> ${transformed.pageViewCount}`);
    console.log(`[Transform] networkEventsCount: ${result.metrics.adRequestCount} -> ${transformed.networkEventsCount}`);
    
    // Also preserve metrics object for components that might use it
    transformed.metrics = result.metrics;
  } else {
    // If no metrics object, set defaults
    transformed.pageViewCount = result.pageViewCount || 0;
    transformed.networkEventsCount = result.networkEventsCount || 0;
    transformed.sessionInflation = (result.pageViewCount || 0) > 1;
  }

  // Extract analyticsIds from tagInventory if present
  if (result.tagInventory && result.tagInventory.analyticsIds) {
    transformed.analyticsIds = result.tagInventory.analyticsIds;
  }

  // Extract googleAdsIds from tagInventory if present
  if (result.tagInventory && result.tagInventory.googleAdsIds) {
    transformed.googleAdsIds = result.tagInventory.googleAdsIds;
  }
  
  // Preserve hitsById and pageviewsPerNavigation for UI
  if (result.hitsById) {
    transformed.hitsById = result.hitsById;
  }
  if (result.pageviewsPerNavigation !== undefined) {
    transformed.pageviewsPerNavigation = result.pageviewsPerNavigation;
  }
  
  // Replace pageViewCount with pageviewsPerNavigation if available
  if (result.pageviewsPerNavigation !== undefined && result.pageviewsPerNavigation > 0) {
    transformed.pageViewCount = result.pageviewsPerNavigation;
    if (transformed.metrics) {
      transformed.metrics.pageViewCount = result.pageviewsPerNavigation;
    }
  }

  return transformed;
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'DeDuper.io Fraud Scanner API',
    endpoints: {
      scan: 'POST /api/scan',
      results: 'GET /api/results',
      screenshot: 'GET /api/screenshot'
    }
  });
});

// Scan endpoint
app.post('/api/scan', async (req, res) => {
  try {
    loadScannerModules(); // Lazy-load scanner modules on first use
    
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'URLs array is required' });
    }

    // Validate URL format for each URL
    const validatedUrls = [];
    for (const url of urls) {
      try {
        new URL(url);
        validatedUrls.push(url);
      } catch (e) {
        console.warn(`Invalid URL skipped: ${url}`);
      }
    }

    if (validatedUrls.length === 0) {
      return res.status(400).json({ error: 'No valid URLs provided' });
    }

    console.log(`\n🔍 Starting scan for ${validatedUrls.length} URL(s)`);
    
    // Process all URLs sequentially (to avoid overwhelming the system)
    const results = [];
    for (const url of validatedUrls) {
      try {
        console.log(`Scanning: ${url}`);
        const result = await scanWebsite(url);
        if (result) {
          // Transform result to flatten metrics for UI compatibility
          const transformedResult = transformScanResult(result);
          results.push(transformedResult);
          
          // Add to scan history (deduplicate by URL)
          const existingIndex = scanHistory.findIndex(r => r.url === transformedResult.url);
          if (existingIndex >= 0) {
            scanHistory[existingIndex] = transformedResult;
          } else {
            scanHistory.push(transformedResult);
          }
        }
      } catch (error) {
        console.error(`Error scanning ${url}:`, error);
        const errorResult = {
          url: url,
          error: error.message || 'Scan failed',
          scanTimestamp: new Date().toISOString()
        };
        results.push(errorResult);
        
        // Add error result to history
        const existingIndex = scanHistory.findIndex(r => r.url === url);
        if (existingIndex >= 0) {
          scanHistory[existingIndex] = errorResult;
        } else {
          scanHistory.push(errorResult);
        }
      }
    }
    
    // Save updated history
    saveScanHistory();
    
    // Return results in the format Scanner.jsx expects
    res.json({
      results: results
    });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during scanning',
      results: []
    });
  }
});

// Get all scan results (for reverse analytics search)
app.get('/api/results', (req, res) => {
  try {
    // Return array of all scan results
    // This is used by the reverse analytics search page
    if (scanHistory.length === 0) {
      // Fallback: try to load from legacy file format
      if (fs.existsSync('scan_results_ultimate.json')) {
        const data = JSON.parse(fs.readFileSync('scan_results_ultimate.json', 'utf8'));
        // If it's an array, return it; if it's an object, wrap it in an array
        const results = Array.isArray(data) ? data : [data];
        res.json(results);
        return;
      }
      res.json([]);
      return;
    }
    res.json(scanHistory);
  } catch (error) {
    console.error('Error loading scan results:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// Get screenshot
app.get('/api/screenshot', (req, res) => {
  const screenshotPath = path.join(__dirname, 'evidence_ultimate.png');
  
  if (fs.existsSync(screenshotPath)) {
    res.sendFile(screenshotPath);
  } else {
    res.status(404).json({
      success: false,
      error: 'Screenshot not found. Run a scan first.'
    });
  }
});

// Generate evidence pack for all scans
app.post('/api/scans/evidence-pack', async (req, res) => {
  try {
    if (scanHistory.length === 0) {
      return res.status(400).json({ error: 'No scan results available' });
    }

    // Generate CSV content (same format as Save Report button)
    const headers = ["Domain", "Risk", "Fraud", "IDs", "Views", "Waste"];
    const csvRows = scanHistory.map(r => {
      try {
        const host = new URL(r.url).hostname;
        const risk = r.fraudWarnings && r.fraudWarnings.length > 0 ? "High" : "Low";
        const fraud = (r.fraudWarnings || []).map(f => f.type).join("; ");
        const ids = (r.analyticsIds || []).join("; ");
        const waste = Math.max(1, Math.round((r.networkEventsCount || 0) / 50)) + "x";
        return [host, risk, fraud, ids, r.pageViewCount || 0, waste];
      } catch (e) {
        return [r.url || 'Unknown', 'Error', '', '', '', ''];
      }
    });
    const csvContent = [headers, ...csvRows].map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Generate README content
    const readmeContent = `
Scan Evidence Pack
==================

Generated: ${new Date().toISOString()}
Total Scans: ${scanHistory.length}

Summary
-------
This evidence pack contains all scan results from the forensic scanner.

Files Included
--------------
- scan-results.json: Complete scan results in JSON format
- scan-results.csv: Summary report in CSV format (Domain, Risk, Fraud, IDs, Views, Waste)
- screenshots/: Page screenshots captured during scans (if available)
- README.txt: This file

How to Interpret
----------------
1. Review scan-results.csv for a quick overview of all scanned domains
2. Check scan-results.json for detailed analysis including:
   - Analytics IDs detected
   - Fraud warnings and risk levels
   - Network event counts
   - Page view counts
   - Tag parity information
3. Use screenshots to verify visual state of scanned pages

Risk Levels
-----------
- High: Fraud warnings detected (e.g., inflated page views, ad churning)
- Low: No fraud warnings detected

Waste Calculation
-----------------
Waste factor is calculated as: networkEventsCount / 50
Higher waste factors indicate excessive network activity relative to page views.

For questions or support, contact Cybertect support.
`.trim();

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="scan-evidence-pack-${new Date().toISOString().slice(0,10)}.zip"`);
    
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create evidence pack' });
      }
    });

    archive.pipe(res);

    // Add scan results JSON
    archive.append(JSON.stringify(scanHistory, null, 2), { name: 'scan-results.json' });

    // Add CSV
    archive.append(csvContent, { name: 'scan-results.csv' });

    // Add README
    archive.append(readmeContent, { name: 'README.txt' });

    // Add screenshots if available
    const screenshotPath = path.join(__dirname, 'evidence_ultimate.png');
    if (fs.existsSync(screenshotPath)) {
      archive.file(screenshotPath, { name: 'screenshots/evidence_ultimate.png' });
    }

    // Finalize archive
    await archive.finalize();

  } catch (error) {
    console.error('Evidence pack generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || 'An error occurred during evidence pack generation'
      });
    }
  }
});

// AI Validation endpoints (v1 legacy + v2 shared validator)
const { runValidation, getValidationResult } = require('./ai-validation/orchestrator.cjs');
const { listTemplates } = require('./ai-validation/templates/registry.cjs');
const { listProviders } = require('./ai-validation/providers/provider-factory.cjs');
const { queueJob: queueAiJob, getJob: getAiJob } = require('./ai-validation/v2/runner.cjs');
const {
  listAggregates: listAffectedVendors,
  updateVerdict: updateAffectedVendorsVerdict,
  getVerdict: getAffectedVendorsVerdict
} = require('./src/db/affected-ad-vendors.cjs');
const { buildEvidencePayload } = require('./ad-impression-verification/affected-vendors.cjs');

// Upload evidence pack for AI validation
app.post('/api/ai-validation/upload', upload.single('evidencePack'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No evidence pack uploaded' });
    }
    
    // Generate upload ID
    const uploadId = `ai-validation-${Date.now()}`;
    
    // Store the file buffer temporarily
    const uploadDir = path.join(__dirname, 'runs', 'ai-validation', uploadId);
    fs.mkdirSync(uploadDir, { recursive: true });
    
    const uploadPath = path.join(uploadDir, 'upload.zip');
    fs.writeFileSync(uploadPath, req.file.buffer);
    
    res.json({
      success: true,
      uploadId,
      filename: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run AI validation
app.post('/api/ai-validation/run', async (req, res) => {
  try {
    const { uploadId, caseBrief, provider, template, redaction, redactionMode, findingsJson } = req.body;
    
    if (!provider || !template) {
      return res.status(400).json({ 
        error: 'Missing required fields: provider, template' 
      });
    }
    
    // Support both uploadId (ZIP file) and caseBrief (direct JSON) modes
    let zipBuffer = null;
    let runId = uploadId;
    
    if (uploadId) {
      // Mode 1: Load from uploaded ZIP
      const uploadPath = path.join(__dirname, 'runs', 'ai-validation', uploadId, 'upload.zip');
      
      if (!fs.existsSync(uploadPath)) {
        return res.status(404).json({ error: 'Upload not found' });
      }
      
      zipBuffer = fs.readFileSync(uploadPath);
    } else if (caseBrief) {
      // Mode 2: Use caseBrief directly (no ZIP)
      runId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } else {
      return res.status(400).json({ 
        error: 'Either uploadId or caseBrief must be provided' 
      });
    }
    
    // Run validation
    if (zipBuffer) {
      // ZIP mode - async response
      res.json({
        success: true,
        runId: runId,
        status: 'processing',
        message: 'AI validation started'
      });
      
      // Run validation in background
      runValidation({
        zipBuffer,
        uploadId: runId,
        provider,
        template,
        findingsJson: findingsJson ? JSON.parse(findingsJson) : null,
        redactionMode: redaction === true || redaction === 'true' || redactionMode === true || redactionMode === 'true'
      }).catch(error => {
        console.error('Validation error:', error);
      });
    } else {
      // CaseBrief mode - synchronous response with result
      const providerFactory = require('./ai-validation/providers/provider-factory.cjs');
      const Ajv = require('ajv');
      const addFormats = require('ajv-formats');
      const aiValidationSchema = require('./ai-validation/schemas/ai_validation.schema.json');
      
      try {
        const providerInstance = providerFactory.createProvider(provider);
        const templateModule = require('./ai-validation/templates/registry.cjs').getTemplate(template);
        
        // Run validation (await result)
        const result = await providerInstance.validateCase(caseBrief, templateModule);
        
        // Validate against schema
        const ajv = new Ajv({ allErrors: true });
        addFormats(ajv);
        const validate = ajv.compile(aiValidationSchema);
        const valid = validate(result);
        
        if (!valid) {
          console.warn('AI validation schema validation failed:', validate.errors);
        }
        
        // Save result
        const runDir = path.join(__dirname, 'runs', 'ai-validation', runId);
        if (!fs.existsSync(runDir)) {
          fs.mkdirSync(runDir, { recursive: true });
        }
        
        fs.writeFileSync(
          path.join(runDir, 'ai_validation.json'),
          JSON.stringify(result, null, 2)
        );
        
        fs.writeFileSync(
          path.join(runDir, 'status.json'),
          JSON.stringify({ status: 'completed', timestamp: new Date().toISOString() }, null, 2)
        );
        
        // Return result immediately
        res.json({
          success: true,
          runId: runId,
          status: 'completed',
          result: result
        });
        
      } catch (error) {
        console.error('CaseBrief validation error:', error);
        const runDir = path.join(__dirname, 'runs', 'ai-validation', runId);
        if (!fs.existsSync(runDir)) {
          fs.mkdirSync(runDir, { recursive: true });
        }
        fs.writeFileSync(
          path.join(runDir, 'status.json'),
          JSON.stringify({ status: 'error', error: error.message, timestamp: new Date().toISOString() }, null, 2)
        );
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
    
  } catch (error) {
    console.error('Run validation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get validation result
app.get('/api/ai-validation/result/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    
    const result = getValidationResult(runId);
    
    if (!result.success) {
      return res.status(500).json(result);
    }
    
    // Return metadata and file paths
    res.json({
      success: true,
      runId,
      metadata: result.metadata,
      files: {
        aiValidation: `/api/ai-validation/download/${runId}/ai_validation.json`,
        pdf: `/api/ai-validation/download/${runId}/evidence_summary.pdf`,
        caseBrief: `/api/ai-validation/download/${runId}/case_brief.json`
      }
    });
  } catch (error) {
    console.error('Get result error:', error);
    res.status(404).json({ error: error.message });
  }
});

// Download validation files
app.get('/api/ai-validation/download/:runId/:filename', (req, res) => {
  try {
    const { runId, filename } = req.params;
    
    // Validate filename to prevent directory traversal
    const allowedFiles = ['ai_validation.json', 'evidence_summary.pdf', 'case_brief.json', 'metadata.json'];
    if (!allowedFiles.includes(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filePath = path.join(__dirname, 'runs', 'ai-validation', runId, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List available templates
app.get('/api/ai-validation/templates', (req, res) => {
  try {
    const templates = listTemplates();
    res.json({ success: true, templates });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List available providers
app.get('/api/ai-validation/providers', (req, res) => {
  try {
    const providers = listProviders();
    res.json({ success: true, providers });
  } catch (error) {
    console.error('List providers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI Validation v2 (standardized payload)
app.post('/api/ai/validate', (req, res) => {
  try {
    const { toolId, scanId, provider = 'chatgpt', model, promptNotes, evidencePack } = req.body || {};
    if (!toolId || !scanId || !evidencePack) {
      return res.status(400).json({ error: 'toolId, scanId and evidencePack are required' });
    }
    if (!['chatgpt', 'gemini', 'perplexity', 'openai'].includes(String(provider).toLowerCase())) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }

    const job = queueAiJob({
      toolId,
      scanId,
      provider: 'chatgpt', // normalize to chatgpt for now
      model: model || 'gpt-4o',
      promptNotes,
      evidencePack
    });

    // basic analytics hooks
    console.log('[analytics] ai_validate_clicked', { toolId, scanId });

    res.status(202).json({
      jobId: job.id,
      status: job.status
    });
  } catch (error) {
    console.error('AI validate error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ai/validate/:jobId', (req, res) => {
  try {
    const job = getAiJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    let parsedResult = null;
    if (job.resultJson) {
      try {
        parsedResult = JSON.parse(job.resultJson);
      } catch (e) {
        parsedResult = { error: 'Failed to parse result' };
      }
    }
    const response = {
      jobId: job.id,
      status: job.status,
      toolId: job.toolId,
      scanId: job.scanId,
      provider: job.provider,
      model: job.model,
      promptNotes: job.promptNotes,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: parsedResult?.result || null,
      pdfUrl: parsedResult?.pdfPath ? `/api/ai/validate/${job.id}/pdf` : null,
      error: parsedResult?.error
    };
    res.json(response);
  } catch (error) {
    console.error('Get AI validate job error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/validate/:jobId/pdf', (req, res) => {
  try {
    const job = getAiJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (job.status !== 'done') {
      return res.status(409).json({ error: 'Job not complete' });
    }
    const parsed = job.resultJson ? JSON.parse(job.resultJson) : null;
    const pdfPath = parsed?.pdfPath;
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF not available' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="validation-${job.id}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (error) {
    console.error('Serve AI validation PDF error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server (async to await videotect module loading)
(async () => {
  // Ensure Videotect modules are loaded before accepting requests
  // TEMPORARILY COMMENTED OUT: await videotect.ensureLoaded();
  videotect.ensureLoaded().catch(err => console.log('Videotect loading in background:', err.message));
  
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 DeDuper.io Fraud Scanner API running on http://localhost:${PORT}`);
    console.log(`📡 Endpoints:`);
    console.log(`   POST /api/scan - Scan a website`);
    console.log(`   POST /api/injected-telemetry-scan - Scan for injected telemetry`);
    console.log(`   POST /api/diagnose - Analytics Integrity Diagnosis`);
    console.log(`   POST /api/ad-impression-verification/scan - Ad Impression Verification scan`);
    console.log(`   GET  /api/ad-impression-verification/export - Export evidence pack`);
    console.log(`   POST /api/ai-validation/upload - Upload evidence pack for AI validation`);
    console.log(`   POST /api/ai-validation/run - Run AI validation`);
  console.log(`   GET  /api/ai-validation/result/:runId - Get validation result`);
  console.log(`   POST /api/cms-monitor/run - CMS Output Monitor scan`);
  console.log(`   GET  /api/cms-monitor/baselines - List baselines`);
  console.log(`   POST /api/cms-monitor/baselines/save - Save baseline`);
  console.log(`   GET  /api/cms-monitor/evidence/:scanId - Download evidence pack`);
  console.log(`   POST /api/videotect/import - Import CSV file`);
  console.log(`   POST /api/videotect/manual - Analyze pasted URLs`);
  console.log(`   GET  /api/videotect/items - Query items`);
  console.log(`   PATCH /api/videotect/items/:id - Update item status`);
  console.log(`   GET  /api/videotect/export - Export exclusions CSV`);
  console.log(`   GET  /api/results - Get latest scan results`);
  console.log(`   GET  /api/screenshot - Get screenshot`);
  console.log(`   POST /api/scans/evidence-pack - Generate evidence pack ZIP`);
  console.log(`   GET  /api/health - Health check\n`);
  });

  // Error handling for server startup
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: Port ${PORT} is already in use.`);
      console.error(`   Please either:`);
      console.error(`   1. Stop the process using port ${PORT}`);
      console.error(`   2. Set a different port: PORT=${Number(PORT) + 1} node server.js`);
      console.error(`   3. Kill the process: lsof -ti:${PORT} | xargs kill\n`);
    } else {
      console.error(`\n❌ Server error:`, error.message);
      console.error(`   Full error:`, error);
    }
    process.exit(1);
  });

  // Graceful shutdown handlers
  process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT received, shutting down gracefully...');
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });
})(); // End of async IIFE for server startup

// Endpoint to find connected domains (legacy - uses external API)
app.post('/api/network-scan', async (req, res) => {
  const { analyticsId } = req.body;
  if (!analyticsId) return res.status(400).json({ error: 'No ID provided' });

  try {
    const response = await axios.get(`https://api.hackertarget.com/analyticslookup/?q=${analyticsId}`);
    const sites = response.data.split('\n').filter(site => site && site.trim().length > 0);
    res.json({ network: sites, count: sites.length });
  } catch (error) {
    console.error('Network scan failed:', error.message);
    res.json({ network: [], count: 0 });
  }
});

// Test endpoint to verify module loading
app.get('/api/reverse-search-test', (req, res) => {
  try {
    const indexModule = require('./src/index-telemetry.cjs');
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(__dirname, 'data', 'analytics-index.db');
    
    res.json({ 
      success: true, 
      moduleLoaded: true,
      functions: Object.keys(indexModule),
      dbPath: dbPath,
      dbExists: fs.existsSync(dbPath)
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack,
      __dirname: __dirname
    });
  }
});

// Reverse Analytics Search endpoint - queries our global index
app.get('/api/reverse-search', async (req, res) => {
  try {
    const { type, id } = req.query;

    if (!type || !id) {
      return res.status(400).json({
        error: 'Missing required parameters: type and id are required',
        query: { type, id }
      });
    }

    // Try to require the module with better error handling
    let queryById, getDistinctDomains, queryByDomain;
    try {
      const indexModule = require('./src/index-telemetry.cjs');
      queryById = indexModule.queryById;
      getDistinctDomains = indexModule.getDistinctDomains;
      queryByDomain = indexModule.queryByDomain;
      
      if (!queryById || !getDistinctDomains || !queryByDomain) {
        throw new Error('Required functions not exported from index-telemetry module');
      }
    } catch (requireError) {
      console.error('Failed to require index-telemetry module:', requireError);
      return res.status(500).json({
        error: 'Database module not available',
        details: requireError.message,
        stack: process.env.NODE_ENV === 'development' ? requireError.stack : undefined,
        query: { type, id }
      });
    }

    // Normalize inputs
    const idType = normalizeIdType(type);
    const normalizedId = normalizeId(idType, id.trim());

    if (!normalizedId) {
      return res.status(400).json({
        error: `Invalid ${idType} ID format: ${id}`,
        query: { type: idType, id }
      });
    }

    // Query database with error handling
    let occurrences, distinctDomains;
    try {
      occurrences = queryById(idType, normalizedId);
      distinctDomains = getDistinctDomains(idType, normalizedId);
    } catch (dbError) {
      console.error('Database query error:', dbError);
      return res.status(500).json({
        error: 'Database query failed',
        details: dbError.message,
        stack: process.env.NODE_ENV === 'development' ? dbError.stack : undefined,
        query: { type: idType, id: normalizedId }
      });
    }

    // Group by domain
    const domainMap = new Map();
    for (const occ of occurrences) {
      if (!domainMap.has(occ.domain)) {
        domainMap.set(occ.domain, {
          domain: occ.domain,
          last_seen_at: occ.last_seen_at,
          sources: new Set(),
          sample_urls: [],
          evidence_samples: [],
          seen_count: 0
        });
      }
      const domainData = domainMap.get(occ.domain);
      domainData.sources.add(occ.source);
      domainData.seen_count = Math.max(domainData.seen_count, occ.seen_count);
      if (occ.last_seen_at > domainData.last_seen_at) {
        domainData.last_seen_at = occ.last_seen_at;
      }
      if (domainData.sample_urls.length < 3) {
        domainData.sample_urls.push(occ.url);
      }
      if (domainData.evidence_samples.length < 2) {
        domainData.evidence_samples.push(occ.evidence);
      }
    }

    // Get "also seen IDs" for each domain (other IDs found on same domain)
    const results = Array.from(domainMap.values()).map(domainData => {
      let alsoSeenIds = [];
      try {
        const domainOccurrences = queryByDomain(domainData.domain, 5);
        alsoSeenIds = domainOccurrences
          .filter(occ => !(occ.id_type === idType && occ.id_value === normalizedId))
          .slice(0, 5)
          .map(occ => ({
            id_type: occ.id_type,
            id_value: occ.id_value
          }));
      } catch (e) {
        console.warn('Error fetching also_seen_ids for domain:', domainData.domain, e.message);
      }

      return {
        domain: domainData.domain,
        last_seen_at: domainData.last_seen_at,
        sources: Array.from(domainData.sources),
        sample_urls: domainData.sample_urls,
        evidence_samples: domainData.evidence_samples,
        also_seen_ids: alsoSeenIds
      };
    });

    // Sort by last_seen_at descending
    results.sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));

    res.json({
      query: {
        id_type: idType,
        id_value: normalizedId
      },
      hits: distinctDomains.length,
      classification: idType === 'GA4' ? classifyGa4Id(normalizedId, distinctDomains.length) : null,
      results: results
    });
  } catch (error) {
    console.error('Reverse search error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during reverse search',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      query: { type: req.query.type, id: req.query.id }
    });
  }
});

function normalizeIdType(type) {
  const upper = String(type).toUpperCase();
  const validTypes = ['UA', 'GA4', 'GTM', 'FBP', 'AW', 'OTHER'];
  if (validTypes.includes(upper)) {
    return upper;
  }
  // Map common aliases
  if (upper === 'GA' || upper === 'GOOGLE_ANALYTICS') return 'GA4';
  if (upper === 'FACEBOOK' || upper === 'FB') return 'FBP';
  if (upper === 'GOOGLE_ADS' || upper === 'ADS') return 'AW';
  return 'OTHER';
}

function normalizeId(idType, id) {
  if (!id) return null;
  const upper = id.toUpperCase().trim();

  switch (idType) {
    case 'UA':
      return /^UA-\d{8,10}-\d{1,2}$/.test(upper) ? upper : null;
    case 'GA4':
      return /^G-[A-Z0-9]{10}$/.test(upper) ? upper : null;
    case 'GTM':
      return /^GTM-[A-Z0-9]{4,10}$/.test(upper) ? upper : null;
    case 'FBP':
      return /^\d{8,18}$/.test(id.trim()) ? id.trim() : null;
    case 'AW':
      return /^AW-\d{6,}$/.test(upper) ? upper : null;
    default:
      return upper;
  }
}

// Injected Telemetry Monitor endpoint
app.post('/api/injected-telemetry-scan', async (req, res) => {
  try {
    loadScannerModules();
    const { url, maxWaitMs } = req.body;
    
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ 
        error: 'URL is required',
        url: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        findings: [],
        summary: {}
      });
    }

    console.log(`\n🔍 Starting injected telemetry scan for: ${url}`);
    
    const options = {};
    if (maxWaitMs && typeof maxWaitMs === 'number') {
      options.maxWaitMs = maxWaitMs;
    }

    const result = await scanInjectedTelemetry(url, options);
    
    console.log(`✅ Scan completed: ${result.summary.totalTelemetry} findings, ${result.summary.injectedTelemetry} injected`);
    
    res.json(result);
  } catch (error) {
    console.error('Injected telemetry scan error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during scanning',
      url: req.body.url || null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      findings: [],
      summary: {}
    });
  }
});

// Analytics Integrity Diagnosis endpoint
app.post('/api/diagnose', async (req, res) => {
  try {
    loadScannerModules();
    const { url, options} = req.body;
    
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ 
        error: 'URL is required',
        url: null,
        scannedAt: new Date().toISOString(),
        pagesScanned: [],
        inventory: {},
        findings: [],
        drift: {},
        telemetryReplay: { enabled: false, steps: [] },
        checklist: [],
        artifacts: {}
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid URL format',
        url: url,
        scannedAt: new Date().toISOString(),
        pagesScanned: [],
        inventory: {},
        findings: [],
        drift: {},
        telemetryReplay: { enabled: false, steps: [] },
        checklist: [],
        artifacts: {}
      });
    }

    console.log(`\n🔍 Starting Analytics Integrity Diagnosis for: ${url}`);
    
    const diagnosisOptions = {
      maxPages: options?.maxPages || 5,
      includeTelemetryReplay: options?.includeTelemetryReplay !== false,
      pageSampleStrategy: options?.pageSampleStrategy || 'sitemap',
      timeoutMs: options?.timeoutMs || 30000
    };

    const result = await diagnoseAnalytics(url, diagnosisOptions);
    
    console.log(`✅ Diagnosis complete: ${result.findings.length} findings, ${result.checklist.length} checklist items`);
    
    res.json(result);
  } catch (error) {
    console.error('Analytics Integrity Diagnosis error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during diagnosis',
      url: req.body.url || null,
      scannedAt: new Date().toISOString(),
      pagesScanned: [],
      inventory: {},
      findings: [],
      drift: {},
      telemetryReplay: { enabled: false, steps: [] },
      checklist: [],
      artifacts: {}
    });
  }
});

// Ad Impression Verification endpoints
app.post('/api/ad-impression-verification/scan', async (req, res) => {
  try {
    const { url, viewabilityRule, discrepancyThreshold, deliveryTotals, campaignLabel } = req.body;
    
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ 
        error: 'URL is required',
        runId: null,
        summary: null,
        sequences: [],
        flags: [],
        artifacts: null
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid URL format',
        runId: null,
        summary: null,
        sequences: [],
        flags: [],
        artifacts: null
      });
    }

    console.log(`\n🔍 Starting Ad Impression Verification scan for: ${url}`);
    
    const result = await scanAdImpressions({
      url,
      viewabilityRule: viewabilityRule || '50%/1s',
      discrepancyThreshold: discrepancyThreshold || 10,
      deliveryTotals: deliveryTotals || null,
      campaignLabel: campaignLabel || null
    });
    
    console.log(`✅ Ad Impression Verification scan complete: ${result.summary.totalImpressions} impressions, ${result.summary.viewableImpressions} viewable, ${result.summary.flagsCount} flags`);
    
    res.json({
      runId: result.runId,
      summary: result.summary,
      sequences: result.sequences,
      flags: result.flags,
      reconciliation: result.reconciliation,
      artifacts: {
        runId: result.runId,
        screenshots: result.summary.sequencesCount > 0 ? ['initial_load.png', 'after_scroll.png', 'final_state.png'] : []
      }
    });
  } catch (error) {
    console.error('Ad Impression Verification scan error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during scanning',
      runId: null,
      summary: null,
      sequences: [],
      flags: [],
      artifacts: null
    });
  }
});

app.get('/api/ad-impression-verification/export', async (req, res) => {
  try {
    const { runId } = req.query;
    
    if (!runId || typeof runId !== 'string') {
      return res.status(400).json({ error: 'runId query parameter is required' });
    }

    console.log(`\n📦 Generating evidence pack for run: ${runId}`);
    
    const { zipPath, filename } = await generateEvidencePack(runId);
    
    console.log(`✅ Evidence pack generated: ${zipPath}`);
    
    res.download(zipPath, filename, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send evidence pack' });
        }
      }
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during export'
    });
  }
});

function mapAiVerdict(result) {
  if (!result) return null;
  const verdictText = (result.verdict || '').toLowerCase();
  let ai_verdict_status = 'suspect';
  if (verdictText.includes('pass') || verdictText.includes('clean')) {
    ai_verdict_status = 'pass';
  } else if (verdictText.includes('fail') || verdictText.includes('inflation') || verdictText.includes('high')) {
    ai_verdict_status = 'fail';
  }

  const rationale =
    (result.key_findings || [])
      .map((f) => `${f.title || 'Finding'}: ${f.detail || ''}`.trim())
      .filter(Boolean)
      .join(' | ') || result.duplicate_assessment?.notes || null;

  const modelMeta = result.model_used || {};
  return {
    ai_verdict_status,
    ai_rationale: rationale,
    ai_validator_model: modelMeta.model || modelMeta.provider || null,
    ai_verdict_at: modelMeta.run_at || new Date().toISOString()
  };
}

app.get('/api/scans/:scanId/publishers/:publisherId/affected-vendors', (req, res) => {
  try {
    const { scanId, publisherId } = req.params;
    const { sortBy, direction } = req.query;
    if (!scanId || !publisherId) {
      return res.status(400).json({ error: 'scanId and publisherId are required' });
    }

    let rows = listAffectedVendors(scanId, publisherId, sortBy, direction);
    let verdict = getAffectedVendorsVerdict(scanId, publisherId);

    // If verdict pending but job is complete, refresh from AI job store
    if (verdict?.ai_job_id && (!verdict.ai_verdict_status || verdict.ai_verdict_status === 'pending')) {
      const job = getAiJob(verdict.ai_job_id);
      if (job && job.status === 'done' && job.resultJson) {
        try {
          const parsed = JSON.parse(job.resultJson);
          const result = parsed?.result || null;
          const mapped = mapAiVerdict(result);
          if (mapped) {
            updateAffectedVendorsVerdict(scanId, publisherId, { ...mapped, ai_job_id: verdict.ai_job_id });
            verdict = { ...verdict, ...mapped };
            // reload rows to return updated verdict fields
            rows = listAffectedVendors(scanId, publisherId, sortBy, direction);
          }
        } catch (e) {
          console.warn('Failed to parse AI verdict for affected vendors', e.message);
        }
      }
    }

    res.json({
      scanId,
      publisherId,
      rows,
      verdict
    });
  } catch (error) {
    console.error('Affected vendors fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scans/:scanId/publishers/:publisherId/affected-vendors/ai-validate', (req, res) => {
  try {
    const { scanId, publisherId } = req.params;
    const { provider = 'chatgpt', model = 'gpt-4o', promptNotes } = req.body || {};
    if (!scanId || !publisherId) {
      return res.status(400).json({ error: 'scanId and publisherId are required' });
    }
    const rows = listAffectedVendors(scanId, publisherId, 'impressions', 'DESC');
    if (!rows.length) {
      return res.status(404).json({ error: 'No affected ad vendors found for this scan/publisher' });
    }

    const evidencePayload = buildEvidencePayload(scanId, publisherId, rows);
    const job = queueAiJob({
      toolId: 'affected_ad_vendors_hosts',
      scanId,
      provider,
      model,
      promptNotes,
      evidencePack: {
        version: '1.0',
        createdAt: new Date().toISOString(),
        target: { domain: publisherId },
        findings: [],
        telemetry: {
          evidence_type: evidencePayload.evidence_type,
          semantics: evidencePayload.semantics,
          payload: evidencePayload
        },
        artifacts: []
      }
    });

    updateAffectedVendorsVerdict(scanId, publisherId, {
      ai_verdict_status: 'pending',
      ai_rationale: null,
      ai_validator_model: model,
      ai_verdict_at: null,
      ai_job_id: job.id
    });

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      provider,
      model
    });
  } catch (error) {
    console.error('AI validation (affected vendors) error:', error);
    res.status(500).json({ error: error.message });
  }
});

// CMS Output Monitor endpoints
app.post('/api/cms-monitor/run', async (req, res) => {
  try {
    const {
      baseUrl,
      buildLabel,
      authHeader = null,
      authCookie = null,
      crawlDepth = 1,
      samplePages = [],
      allowedPartners = [],
      publisher = 'default',
      environment = 'prod'
    } = req.body;
    
    if (!baseUrl || typeof baseUrl !== 'string') {
      return res.status(400).json({
        error: 'baseUrl is required',
        scanId: null,
        summary: null
      });
    }
    
    // Validate URL format
    try {
      new URL(baseUrl);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid baseUrl format',
        scanId: null,
        summary: null
      });
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.cjs:1044',message:'CMS scan request received',data:{baseUrl,crawlDepth,hasSamplePages:samplePages.length>0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    
    console.log(`\n🔍 Starting CMS Output Monitor scan for: ${baseUrl}`);
    console.log(`📋 Options:`, { buildLabel, crawlDepth, samplePagesCount: samplePages.length, allowedPartnersCount: allowedPartners.length });
    
    let scanResult;
    try {
      scanResult = await scanCMSOutput({
        baseUrl,
        buildLabel,
        authHeader,
        authCookie,
        crawlDepth: parseInt(crawlDepth) || 1,
        samplePages: Array.isArray(samplePages) ? samplePages : [],
        allowedPartners: Array.isArray(allowedPartners) ? allowedPartners : [],
        timeout: 30000
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.cjs:1065',message:'Scan completed successfully',data:{scanId:scanResult?.scanId,hasSummary:!!scanResult?.summary},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      
      console.log(`✅ scanCMSOutput completed successfully. Scan ID: ${scanResult.scanId}`);
    } catch (scanError) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.cjs:1073',message:'Scan failed with error',data:{errorMessage:scanError.message,errorName:scanError.name,isPlaywrightError:scanError.message?.includes('browser')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1,H2,H5'})}).catch(()=>{});
      // #endregion
      
      console.error('❌ scanCMSOutput failed:', scanError);
      console.error('Error stack:', scanError.stack);
      throw scanError; // Re-throw to be caught by outer catch
    }
    
    // Validate scanResult structure
    if (!scanResult || !scanResult.scanId) {
      throw new Error('scanCMSOutput returned invalid result: missing scanId');
    }
    if (!scanResult.summary) {
      console.warn('⚠️ scanResult missing summary, creating default');
      scanResult.summary = {
        totalPages: scanResult.pagesScanned?.length || 0,
        totalScripts: 0,
        totalPixels: 0,
        duplicateIdsCount: 0,
        duplicateScriptsCount: 0,
        unauthorizedCount: 0,
        injectedScriptsCount: 0
      };
    }
    
    // Load baseline for comparison
    let baseline = null;
    let baselineDiff = null;
    try {
      baseline = findLatestBaseline(publisher, environment);
      if (baseline) {
        baselineDiff = diffBaseline(scanResult, baseline);
        console.log(`📊 Baseline comparison completed`);
      } else {
        console.log(`ℹ️ No baseline found for publisher=${publisher}, environment=${environment}`);
      }
    } catch (baselineError) {
      console.warn('⚠️ Baseline comparison failed:', baselineError.message);
      // Continue without baseline
    }
    
    // Store scan result temporarily (in production, use a database)
    try {
      const scanStoragePath = path.join(__dirname, 'data', 'cms-monitor', 'scans', `${scanResult.scanId}.json`);
      const scanStorageDir = path.dirname(scanStoragePath);
      if (!fs.existsSync(scanStorageDir)) {
        fs.mkdirSync(scanStorageDir, { recursive: true });
      }
      fs.writeFileSync(scanStoragePath, JSON.stringify({ scanResult, baselineDiff }, null, 2));
      console.log(`💾 Scan result saved to: ${scanStoragePath}`);
    } catch (storageError) {
      console.warn('⚠️ Failed to save scan result:', storageError.message);
      // Continue even if storage fails
    }
    
    console.log(`✅ CMS Output Monitor scan complete: ${scanResult.summary.totalPages} pages, ${scanResult.summary.duplicateIdsCount} duplicate IDs, ${scanResult.summary.unauthorizedCount} unauthorized`);
    
    // Prepare response with all required fields
    const response = {
      scanId: scanResult.scanId,
      scanTimestamp: scanResult.scanTimestamp || new Date().toISOString(),
      buildLabel: scanResult.buildLabel || null,
      summary: scanResult.summary,
      duplicates: scanResult.duplicates || { duplicateIds: {}, duplicateScripts: {}, duplicateLibraries: {} },
      unauthorized: scanResult.unauthorized || [],
      injectedScripts: scanResult.injectedScripts || [],
      baselineDiff: baselineDiff,
      pagesScanned: scanResult.pagesScanned || []
    };
    
    console.log(`📤 Sending response with scanId: ${response.scanId}`);
    res.json(response);
  } catch (error) {
    console.error('❌ CMS Output Monitor scan error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Send detailed error response
    res.status(500).json({
      error: error.message || 'An error occurred during scanning',
      errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      scanId: null,
      summary: null
    });
  }
});

app.get('/api/cms-monitor/baselines', (req, res) => {
  try {
    const baselines = listBaselines();
    res.json({ baselines });
  } catch (error) {
    console.error('Error listing baselines:', error);
    res.status(500).json({
      error: error.message || 'An error occurred listing baselines',
      baselines: []
    });
  }
});

app.post('/api/cms-monitor/baselines/save', async (req, res) => {
  try {
    const {
      publisher,
      environment,
      releaseLabel,
      scanId
    } = req.body;
    
    if (!publisher || !environment || !releaseLabel || !scanId) {
      return res.status(400).json({
        error: 'publisher, environment, releaseLabel, and scanId are required'
      });
    }
    
    // Load scan result
    const scanStoragePath = path.join(__dirname, 'data', 'cms-monitor', 'scans', `${scanId}.json`);
    if (!fs.existsSync(scanStoragePath)) {
      return res.status(404).json({
        error: `Scan ${scanId} not found`
      });
    }
    
    const scanData = JSON.parse(fs.readFileSync(scanStoragePath, 'utf8'));
    const scanResult = scanData.scanResult;
    
    // Save baseline
    const saved = saveBaseline(publisher, environment, releaseLabel, scanResult);
    
    console.log(`✅ Baseline saved: ${saved.filename}`);
    
    res.json({
      success: true,
      filename: saved.filename,
      baseline: saved.baseline
    });
  } catch (error) {
    console.error('Error saving baseline:', error);
    res.status(500).json({
      error: error.message || 'An error occurred saving baseline'
    });
  }
});

app.get('/api/cms-monitor/evidence/:scanId', async (req, res) => {
  try {
    const { scanId } = req.params;
    
    if (!scanId || typeof scanId !== 'string') {
      return res.status(400).json({ error: 'scanId parameter is required' });
    }
    
    // Load scan result
    const scanStoragePath = path.join(__dirname, 'data', 'cms-monitor', 'scans', `${scanId}.json`);
    if (!fs.existsSync(scanStoragePath)) {
      return res.status(404).json({ error: `Scan ${scanId} not found` });
    }
    
    const scanData = JSON.parse(fs.readFileSync(scanStoragePath, 'utf8'));
    const { scanResult, baselineDiff } = scanData;
    
    console.log(`\n📦 Generating evidence pack for scan: ${scanId}`);
    
    const zipPath = await generateCMSEvidencePack(scanResult, baselineDiff);
    
    console.log(`✅ Evidence pack generated: ${zipPath}`);
    
    res.download(zipPath, `cms-monitor-evidence-${scanId}.zip`, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send evidence pack' });
        }
      }
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during export'
    });
  }
});

// Catch-all route: serve React app for all non-API routes
// This enables client-side routing (SPA behavior)
app.get('*', (req, res) => {
  // Skip API routes - they should have been handled above
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // Serve index.html for all other routes (React will handle routing)
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Fallback: try public/index.html if root index.html doesn't exist
    const publicIndexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(publicIndexPath)) {
      res.sendFile(publicIndexPath);
    } else {
      res.status(404).send('index.html not found');
    }
  }
});

// Videotect endpoints
app.post('/api/videotect/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvText = req.file.buffer.toString('utf8');
    const rows = videotect.parsePlacementCSV(csvText);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid rows found in CSV' });
    }

    if (rows.length > 100000) {
      return res.status(400).json({ error: 'CSV has too many rows (max 100,000)' });
    }

    // Aggregate rows by canonical URL
    const aggregated = videotect.aggregateRows(rows);
    const scored = videotect.scoreAggregatedItems(aggregated);

    // Create import record
    const importId = videotect.createImport({
      filename: req.file.originalname || 'upload.csv',
      row_count: rows.length
    });

    // Store items in database
    let channelsCount = 0;
    let videosCount = 0;
    let flaggedCount = 0;
    let totalCostFlagged = 0;

    for (const [key, item] of scored.entries()) {
      videotect.createItem({
        import_id: importId,
        type: item.type,
        canonical_url: item.canonicalUrl,
        original_url: item.originalUrl,
        score: item.score,
        reasons: item.reasons,
        metrics: item.metrics,
        aggregated_from_count: item.aggregatedFromCount
      });

      if (item.type === 'channel') channelsCount++;
      if (item.type === 'video') videosCount++;
      if (item.score >= 70) {
        flaggedCount++;
        if (item.metrics.cost) {
          totalCostFlagged += item.metrics.cost;
        }
      }
    }

    res.json({
      success: true,
      importId,
      summary: {
        rowsProcessed: rows.length,
        channelsFound: channelsCount,
        videosFound: videosCount,
        flaggedCount,
        totalCostFlagged: totalCostFlagged.toFixed(2)
      }
    });
  } catch (error) {
    console.error('Videotect import error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during import'
    });
  }
});

app.post('/api/videotect/manual', async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'URLs array is required' });
    }

    const items = [];
    for (const url of urls) {
      if (!url || typeof url !== 'string') continue;

      const normalized = videotect.normalizeYouTubeUrl(url.trim());
      if (normalized.type === 'other') continue;

      // Score with pattern-only (no metrics)
      const scoringResult = videotect.scorePlacement(normalized.canonicalUrl, {}, []);

      const itemId = videotect.createItem({
        import_id: null,
        type: normalized.type,
        canonical_url: normalized.canonicalUrl,
        original_url: normalized.originalUrl,
        score: scoringResult.score,
        reasons: scoringResult.reasons,
        metrics: {},
        aggregated_from_count: 1
      });

      items.push({
        id: itemId,
        type: normalized.type,
        canonicalUrl: normalized.canonicalUrl,
        score: scoringResult.score,
        reasons: scoringResult.reasons
      });
    }

    res.json({
      success: true,
      itemsCreated: items.length,
      items
    });
  } catch (error) {
    console.error('Videotect manual error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during manual analysis'
    });
  }
});

app.get('/api/videotect/items', async (req, res) => {
  try {
    const importId = req.query.importId ? parseInt(req.query.importId) : undefined;
    const status = req.query.status;
    const minScore = req.query.minScore ? parseInt(req.query.minScore) : undefined;
    const type = req.query.type;
    const q = req.query.q;
    const sort = req.query.sort || 'score_desc';
    const limit = req.query.limit ? parseInt(req.query.limit) : 1000;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;

    const items = videotect.queryItems({
      importId,
      status,
      minScore,
      type,
      q,
      sort,
      limit,
      offset
    });

    res.json({
      success: true,
      items,
      count: items.length
    });
  } catch (error) {
    console.error('Videotect query error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during query'
    });
  }
});

app.patch('/api/videotect/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!status || !['new', 'reviewed', 'excluded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: new, reviewed, or excluded' });
    }

    videotect.updateItemStatus({ id, status });

    res.json({
      success: true,
      id,
      status
    });
  } catch (error) {
    console.error('Videotect update error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during update'
    });
  }
});

app.get('/api/videotect/export', async (req, res) => {
  try {
    const type = req.query.type; // 'channel' or 'video'
    const minScore = req.query.minScore ? parseInt(req.query.minScore) : 70;

    if (!type || !['channel', 'video'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "channel" or "video"' });
    }

    const urls = videotect.getItemsForExport(type, minScore);

    // Generate CSV
    const csv = ['Placement', ...urls].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="videotect-${type}-exclusions-${minScore}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Videotect export error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during export'
    });
  }
});

// Export app for reuse (tests or alternate servers)
module.exports = app;
