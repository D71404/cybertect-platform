/**
 * Mock Server for AI Validation Testing
 * This is a lightweight server that provides:
 * - Static file serving (public directory)
 * - Mock AI validation API endpoint
 * - Scan history endpoint
 * 
 * Use this for testing AI Validation without full scanner dependencies
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Load scan history if it exists
let scanHistory = [];
const SCAN_HISTORY_FILE = path.join(__dirname, 'scan_history.json.backup');
if (fs.existsSync(SCAN_HISTORY_FILE)) {
  try {
    const data = fs.readFileSync(SCAN_HISTORY_FILE, 'utf8');
    scanHistory = JSON.parse(data);
    console.log(`📚 Loaded ${scanHistory.length} scan results from history`);
  } catch (err) {
    console.warn('⚠️  Could not load scan history:', err.message);
  }
}

// Mock AI Validation endpoint
app.post('/api/ai-validation/run', async (req, res) => {
  const { caseBrief, provider, template } = req.body;
  
  if (!caseBrief || !provider) {
    return res.status(400).json({ error: 'caseBrief and provider are required' });
  }
  
  console.log(`🧪 Mock AI validation: provider=${provider}, template=${template}`);
  
  // Simulate API delay (500-1500ms)
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  
  // Analyze the case brief to generate realistic responses
  const hasMultipleGA4 = (caseBrief.ga4_ids && caseBrief.ga4_ids.length > 1);
  const hasFlags = (caseBrief.flags && caseBrief.flags.length > 0);
  const highEventCount = (caseBrief.total_events && caseBrief.total_events > 100);
  
  // Determine verdict based on evidence
  let verdict = 'PASS';
  let confidence = 75 + Math.floor(Math.random() * 20);
  let rationale = 'Analysis shows normal publisher behavior with no significant fraud indicators detected.';
  
  if (hasFlags && highEventCount) {
    verdict = 'FAIL';
    confidence = 85 + Math.floor(Math.random() * 10);
    rationale = 'Multiple fraud indicators detected including suspicious event patterns and inflated metrics. The combination of high event volume with detected flags suggests systematic ad fraud that warrants immediate investigation.';
  } else if (hasFlags || hasMultipleGA4) {
    verdict = 'WARN';
    confidence = 65 + Math.floor(Math.random() * 15);
    rationale = 'Some suspicious patterns detected that warrant further investigation. While not conclusive evidence of fraud, these signals suggest potential quality issues that should be monitored.';
  }
  
  // Generate findings
  const findings = [];
  
  if (hasMultipleGA4) {
    findings.push({
      title: 'Multiple GA4 Properties Detected',
      mechanism: 'Tag Management Irregularity',
      evidence: {
        counts: { ga4_properties: caseBrief.ga4_ids.length },
        examples: caseBrief.ga4_ids.slice(0, 3)
      },
      risk: 'MEDIUM',
      recommended_next_steps: [
        'Verify business justification for multiple tracking IDs',
        'Check for unauthorized tag injection',
        'Review tag management policies'
      ]
    });
  }
  
  if (hasFlags) {
    caseBrief.flags.forEach((flag, idx) => {
      if (idx < 2) {
        findings.push({
          title: flag,
          mechanism: 'Automated Detection',
          evidence: {
            counts: { occurrences: 1 },
            examples: [`Detected via forensic scan on ${caseBrief.site}`]
          },
          risk: highEventCount ? 'HIGH' : 'MEDIUM',
          recommended_next_steps: [
            'Manual verification recommended',
            'Compare with historical baselines',
            'Check for legitimate edge cases'
          ]
        });
      }
    });
  }
  
  if (findings.length === 0) {
    findings.push({
      title: 'No Significant Issues Detected',
      mechanism: 'Comprehensive Analysis',
      evidence: {
        counts: { total_checks: 12 },
        examples: ['All standard fraud indicators within normal ranges']
      },
      risk: 'LOW',
      recommended_next_steps: [
        'Continue regular monitoring',
        'Maintain current quality standards'
      ]
    });
  }
  
  // Generate fingerprints
  const inputFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(caseBrief))
    .digest('hex')
    .substring(0, 16);
  
  const outputData = { verdict, confidence, findings };
  const outputFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(outputData))
    .digest('hex')
    .substring(0, 16);
  
  // Return mock AI validation result
  res.json({
    success: true,
    result: {
      verdict: {
        label: verdict,
        confidence: confidence,
        rationale: rationale
      },
      findings: findings,
      duplicates: {
        exact_url_duplicates: Math.floor(Math.random() * 5),
        top_endpoints: [
          { endpoint: 'google-analytics.com/collect', count: Math.floor(Math.random() * 20) + 5 },
          { endpoint: 'doubleclick.net/impression', count: Math.floor(Math.random() * 15) + 3 }
        ]
      },
      limitations: ['Mock mode - simulated AI analysis for testing purposes'],
      model_used: {
        provider: `${provider} (Mock)`,
        model: 'mock-1.0',
        run_at: new Date().toISOString()
      },
      prompt_version: template || '1.0',
      input_fingerprint: inputFingerprint,
      output_fingerprint: outputFingerprint
    }
  });
});

// Scan history endpoint
app.get('/api/results', (req, res) => {
  res.json(scanHistory.slice(0, 100)); // Return first 100 results
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'mock',
    timestamp: new Date().toISOString(),
    features: ['ai-validation-mock', 'static-files']
  });
});

// AI Validation providers endpoint
app.get('/api/ai-validation/providers', (req, res) => {
  res.json({
    success: true,
    providers: [
      { id: 'openai', name: 'OpenAI ChatGPT (Mock Mode)', defaultModel: 'gpt-4o-mock', mock: true },
      { id: 'gemini', name: 'Google Gemini (Mock Mode)', defaultModel: 'gemini-2.0-mock', mock: true },
      { id: 'perplexity', name: 'Perplexity (Mock Mode)', defaultModel: 'sonar-mock', mock: true }
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🧪 Mock Server running on http://localhost:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /api/ai-validation/run - Mock AI validation`);
  console.log(`   GET  /api/ai-validation/providers - List providers (mock mode)`);
  console.log(`   GET  /api/results - Scan history`);
  console.log(`   GET  /api/health - Health check`);
  console.log(`\n💡 This is a lightweight mock server for testing AI Validation`);
  console.log(`   To use the full scanner, debug server.cjs startup issues\n`);
});

module.exports = app;

