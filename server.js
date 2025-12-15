const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { scanWebsite } = require('./scanner');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' directory

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
          results.push(result);
        }
      } catch (error) {
        console.error(`Error scanning ${url}:`, error);
        results.push({
          url: url,
          error: error.message || 'Scan failed',
          scanTimestamp: new Date().toISOString()
        });
      }
    }
    
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

// Get latest results
app.get('/api/results', (req, res) => {
  try {
    if (fs.existsSync('scan_results_ultimate.json')) {
      const data = JSON.parse(fs.readFileSync('scan_results_ultimate.json', 'utf8'));
      res.json({
        success: true,
        data: data
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'No scan results found. Run a scan first.'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 DeDuper.io Fraud Scanner API running on http://localhost:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /api/scan - Scan a website`);
  console.log(`   GET  /api/results - Get latest scan results`);
  console.log(`   GET  /api/screenshot - Get screenshot`);
  console.log(`   GET  /api/health - Health check\n`);
});

// Error handling for server startup
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use.`);
    console.error(`   Please either:`);
    console.error(`   1. Stop the process using port ${PORT}`);
    console.error(`   2. Set a different port: PORT=3001 node server.js`);
    console.error(`   3. Kill the process: lsof -ti:${PORT} | xargs kill\n`);
  } else {
    console.error(`\n❌ Server error:`, error.message);
    console.error(`   Full error:`, error);
  }
  process.exit(1);
});
// Endpoint to find connected domains
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



// Graceful shutdown
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

