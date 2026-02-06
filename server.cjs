const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const OpenAI = require('openai');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// --- SUPABASE SETUP ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });
  console.log('✅ Supabase Client Initialized in Server');
} else {
  console.warn('⚠️ Supabase credentials missing. Scans will not be saved.');
}

// --- MODULE LOADING ---
let scanWebsite, scanInjectedTelemetry, diagnoseAnalytics, scanAdImpressions, generateEvidencePack;
function loadScannerModules() {
  if (!scanWebsite) {
    try {
        ({ scanWebsite } = require('./scanner.cjs'));
        ({ scanInjectedTelemetry } = require('./injected-telemetry-scanner.cjs'));
        ({ diagnoseAnalytics } = require('./diagnosis.cjs'));
        ({ scanAdImpressions } = require('./ad-impression-verification/scanner.cjs'));
    } catch (e) {
        console.warn("⚠️ Scanner modules missing. Ensure files exist.", e.message);
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' })); 
app.use(express.static('public')); 

const upload = multer({ storage: multer.memoryStorage() });

// --- HELPER FUNCTIONS ---
async function saveAnalyticsEntries(scanId, findings) {
  if (!supabase || !findings || findings.length === 0) return;
  const entries = findings.map(f => ({
      scan_id: scanId,
      tracker_type: f.type || 'unknown',
      tracker_id: f.id || 'N/A',
      status: f.status || 'unknown',
      details: f.issue || f.message || 'No specific issues found',
      detected_at: new Date().toISOString()
  }));
  await supabase.from('analytics_entries').insert(entries);
}

async function saveVendorRisks(scanId, flags) {
  if (!supabase || !flags || flags.length === 0) return;
  const risks = flags.map(flag => ({
      scan_id: scanId,
      vendor_domain: flag.domain || 'unknown',
      risk_level: 'high',
      violation_type: flag.type || 'policy_violation',
      evidence_payload: flag.details || {},
      detected_at: new Date().toISOString()
  }));
  await supabase.from('vendor_risks').insert(risks);
}

// --- 🤖 AI PRODUCTION ENGINE (OpenAI) ---
async function performAIAnalysis(jobId, evidenceData) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing OPENAI_API_KEY environment variable.');
  }

  const openai = new OpenAI({ apiKey });

  const systemPrompt = `You are a Senior Ad-Tech Forensic Analyst. Your job is to analyze ad-technology scan evidence and produce a concise, actionable forensic report.

Analyze the provided evidence JSON for:
1. **Tag Inventory Abnormalities** – Look for too many pixels, duplicate IDs, multiple GTM containers, conflicting analytics implementations, or unusual tag density.
2. **High Risk Score Indicators** – Interpret risk_score, fraudWarnings, and verdict fields. Flag anything that suggests inflation, stacking, pixel stuffing, or measurement fraud.
3. **Discrepancies in findings_summary** – Identify inconsistencies, contradictions, or patterns that indicate wasted ad spend, inflated metrics, or compliance issues.

Respond with a structured report in markdown. Include:
- **Executive Summary** (2–3 sentences)
- **Key Findings** (bulleted list of anomalies)
- **Risk Assessment** (High/Medium/Low with rationale)
- **Recommendations** (actionable next steps)`;

  const userMessage = `Analyze this ad-tech forensic scan evidence:\n\n${JSON.stringify(evidenceData, null, 2)}`;

  console.log(`🤖 AI Production analysis started for Job: ${jobId}`);

  let model = 'gpt-4o';
  let response;
  try {
    response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });
  } catch (err) {
    if (err?.status === 404 || err?.code === 'model_not_found') {
      model = 'gpt-3.5-turbo';
      console.warn(`⚠️ gpt-4o not available, falling back to ${model}`);
      response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      });
    } else {
      throw err;
    }
  }

  const content = response?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty response');
  }

  return content;
}

async function processAIJob(jobId, evidenceData) {
    if (!supabase) return;
    try {
        await supabase.from('ai_jobs').update({ status: 'processing' }).eq('id', jobId);
        const result = await performAIAnalysis(jobId, evidenceData);
        await supabase.from('ai_jobs').update({ status: 'completed', ai_response: result, completed_at: new Date().toISOString() }).eq('id', jobId);
        console.log(`✅ AI Job ${jobId} finished.`);
    } catch (error) {
        console.error(`❌ AI Job ${jobId} failed:`, error.message);
        await supabase.from('ai_jobs').update({ status: 'failed', ai_response: `Error: ${error.message}` }).eq('id', jobId);
    }
}

// --- ENDPOINTS ---
app.get('/', (req, res) => res.json({ message: 'Cybertect API', endpoints: ['/api/scan', '/api/ai-validation/run'] }));

app.post('/api/scan', async (req, res) => {
  try {
    loadScannerModules(); 
    const { urls } = req.body;
    if (!urls || !urls.length) return res.status(400).json({ error: 'URLs required' });

    console.log(`\n🔍 Starting scan for ${urls.length} URL(s)`);
    const results = [];
    
    for (const url of urls) {
      try {
        console.log(`Scanning: ${url}`);
        const result = await scanWebsite(url);
        
        if (result && supabase) {
             const risk = (result.fraudWarnings?.length > 0) ? 100 : 0;
             const { data: scanData, error } = await supabase.from('scans').insert({
               url: url, status: 'completed', risk_score: risk, metadata: result, findings_summary: result.findings || []
             }).select().single();

             if (scanData) {
                console.log('💾 Scan saved with ID:', scanData.id);
                
                // CRITICAL FIX: Send the REAL DB ID back to the client!
                result.id = scanData.id; 

                const inventory = result.tagInventory || {};
                const analyticsFindings = [];
                const addFinding = (type, id) => analyticsFindings.push({ type, id, status: 'detected' });
                (inventory.analyticsIds || []).forEach(id => addFinding('GA4', id));
                (inventory.gtmContainers || []).forEach(id => addFinding('GTM', id));
                (inventory.facebookPixels || []).forEach(id => addFinding('FB Pixel', id));
                await saveAnalyticsEntries(scanData.id, analyticsFindings);
             }
             results.push(result);
        }
      } catch (e) {
        console.error(`Scan failed for ${url}:`, e);
        if(supabase) await supabase.from('scans').insert({ url, status: 'failed', metadata: { error: e.message }});
        results.push({ url, error: e.message });
      }
    }
    res.json({ results });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/ai-validation/run', async (req, res) => {
    try {
        const { scanId, evidenceData } = req.body;
        console.log("🤖 Received AI Request for scanId:", scanId);

        if (!supabase) return res.status(503).json({ error: "Database not connected" });

        // CRITICAL FIX: Sanitize the ID. If it's not a real UUID, set it to NULL.
        let validScanId = scanId;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (validScanId && !uuidRegex.test(validScanId)) {
            console.warn(`⚠️ Received invalid UUID '${validScanId}'. Storing AI Job without linking to scans table.`);
            validScanId = null;
        }

        // Create Ticket
        const { data: jobData, error } = await supabase.from('ai_jobs').insert({
            scan_id: validScanId,
            status: 'pending',
            provider: 'cybertect-ai-v1',
            prompt_snapshot: 'Analyze this scan...'
        }).select().single();

        if (error) throw error;

        res.json({ success: true, jobId: jobData.id, status: 'pending' });
        processAIJob(jobData.id, evidenceData || {});

    } catch (error) {
        console.error("AI Dispatch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/ai-validation/status/:jobId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: "No DB" });
    const { data, error } = await supabase.from('ai_jobs').select('*').eq('id', req.params.jobId).single();
    if (error) return res.status(404).json({ error: "Job not found" });
    res.json(data);
});

app.get('/api/results', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data } = await supabase.from('scans').select('*').order('created_at', { ascending: false }).limit(20);
    res.json(data?.map(r => r.metadata) || []);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', db: !!supabase }));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Cybertect API running on http://localhost:${PORT}`);
    console.log(`💾 Database: ${supabase ? 'Connected' : 'Missing Credentials'}`);
  });
}
module.exports = app;