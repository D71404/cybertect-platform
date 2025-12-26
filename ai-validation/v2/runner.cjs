const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const { BASE_PROMPT } = require('./prompt-template.cjs');
const { createJob, updateJob, getJob } = require('./job-store.cjs');
const resultSchema = require('../schemas/ai_validation_v2.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateResult = ajv.compile(resultSchema);

const RUNS_DIR = path.join(process.cwd(), 'runs', 'ai-validation-v2');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getJobDir(jobId) {
  const dir = path.join(RUNS_DIR, jobId);
  ensureDir(dir);
  return dir;
}

function buildJobId() {
  const rand = crypto.randomBytes(4).toString('hex');
  return `ai-val-${Date.now()}-${rand}`;
}

function persistJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeEvidencePack(evidencePack) {
  if (!evidencePack) throw new Error('evidencePack missing');
  const now = new Date().toISOString();
  return {
    version: evidencePack.version || '1.0',
    createdAt: evidencePack.createdAt || now,
    target: evidencePack.target || { url: '', domain: '' },
    findings: Array.isArray(evidencePack.findings) ? evidencePack.findings : [],
    telemetry: evidencePack.telemetry || {},
    artifacts: Array.isArray(evidencePack.artifacts) ? evidencePack.artifacts : []
  };
}

function buildMockResult(evidencePack) {
  const artifacts = evidencePack.artifacts || [];
  const keyFindings = (evidencePack.findings || []).slice(0, 3).map((f, idx) => ({
    title: f.type || `Finding ${idx + 1}`,
    detail: f.description || 'No description provided',
    confidence: f.severity === 'high' ? 0.9 : f.severity === 'med' ? 0.6 : 0.3,
    evidence_refs: (f.evidence || []).map((_, evIdx) => `finding:${idx}-${evIdx}`)
  }));

  const duplicateCount = (evidencePack.telemetry?.duplicates || 0);
  const verdict = keyFindings.length > 0 ? 'likely_inflation' : 'needs_more_data';

  return {
    verdict,
    confidence: verdict === 'likely_inflation' ? 0.7 : 0.4,
    key_findings: keyFindings,
    duplicate_assessment: {
      has_duplicates: duplicateCount > 0,
      likely_tool_error: duplicateCount > 10,
      notes: duplicateCount > 0 ? `Detected ${duplicateCount} duplicates` : 'No duplicate signals detected'
    },
    inflation_signals: keyFindings.map(f => ({
      signal: f.title,
      strength: f.confidence >= 0.8 ? 'strong' : f.confidence >= 0.5 ? 'moderate' : 'weak',
      evidence_refs: f.evidence_refs
    })),
    recommended_actions: ['Review flagged placements', 'Compare against ad-server delivery', 'Capture fresh run if needed'],
    missing_data_requests: []
  };
}

async function callChatGPT(model, systemPrompt, userPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key missing');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload, null, 2) }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const content = response?.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from provider');
  }
  return content;
}

function parseResult(rawText) {
  const cleaned = rawText.trim().replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

function assertSchema(result) {
  const valid = validateResult(result);
  if (!valid) {
    const message = validateResult.errors?.map(err => `${err.instancePath || '/'} ${err.message}`).join('; ');
    throw new Error(`Validation failed: ${message}`);
  }
  return result;
}

async function executeJob(jobId) {
  const job = getJob(jobId);
  if (!job) {
    return;
  }
  const jobDir = getJobDir(jobId);
  try {
    const evidencePack = JSON.parse(fs.readFileSync(job.evidenceRef, 'utf8'));
    const normalizedEvidence = normalizeEvidencePack(evidencePack);

    let rawResult;
    const mockMode = process.env.AI_VALIDATION_MOCK_MODE === 'true' || !process.env.OPENAI_API_KEY;

    if (mockMode || job.provider !== 'chatgpt') {
      rawResult = buildMockResult(normalizedEvidence);
    } else {
      const systemPrompt = BASE_PROMPT + (job.promptNotes ? `\nUser focus:\n${job.promptNotes}` : '');
      const responseText = await callChatGPT(job.model, systemPrompt, {
        evidencePack: normalizedEvidence,
        promptNotes: job.promptNotes || null
      });
      rawResult = parseResult(responseText);
    }

    const validated = assertSchema(rawResult);

    // Enrich with metadata even in mock mode
    const enriched = {
      ...validated,
      model_used: {
        provider: mockMode ? 'mock' : (job.provider || 'chatgpt'),
        model: mockMode ? 'mock-v2' : (job.model || 'gpt-4o'),
        run_at: new Date().toISOString()
      },
      telemetry_summary: {
        findings: normalizedEvidence.findings?.length || 0,
        artifacts: normalizedEvidence.artifacts?.length || 0,
        duplicates: normalizedEvidence.telemetry?.duplicates || 0,
        target: normalizedEvidence.target || {}
      }
    };

    persistJson(path.join(jobDir, 'validation_result.json'), enriched);

    const pdfPath = path.join(jobDir, 'validation_report.pdf');
    await generatePdf(enriched, normalizedEvidence, pdfPath);

    updateJob(jobId, {
      status: 'done',
      resultJson: JSON.stringify({
        result: enriched,
        pdfPath
      })
    });
  } catch (error) {
    console.error('[AI Validation] Job failed', jobId, error.message);
    updateJob(jobId, {
      status: 'failed',
      resultJson: JSON.stringify({ error: error.message })
    });
  }
}

async function generatePdf(result, evidencePack, destPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(destPath);

    doc.pipe(stream);

    doc.fontSize(18).text('AI Validation Report', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Verdict: ${result.verdict}`);
    doc.text(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    doc.text(`Target: ${evidencePack.target?.domain || evidencePack.target?.url || 'Unknown'}`);
    doc.text(`Created: ${evidencePack.createdAt}`);
    doc.moveDown();

    doc.fontSize(14).text('Key Findings');
    doc.moveDown(0.25);
    (result.key_findings || []).forEach((finding, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${finding.title} (${Math.round(finding.confidence * 100)}%)`);
      doc.fontSize(11).text(finding.detail, { indent: 12 });
      if (finding.evidence_refs?.length) {
        doc.fontSize(10).text(`Evidence: ${finding.evidence_refs.join(', ')}`, { indent: 12 });
      }
      doc.moveDown(0.25);
    });

    doc.moveDown();
    doc.fontSize(14).text('Telemetry Summary');
    const tel = result.telemetry_summary || {};
    doc.fontSize(12).text(`Findings: ${tel.findings ?? '—'}`);
    doc.fontSize(12).text(`Artifacts: ${tel.artifacts ?? '—'}`);
    doc.fontSize(12).text(`Duplicates: ${tel.duplicates ?? '—'}`);
    doc.fontSize(12).text(`Target: ${tel.target?.domain || tel.target?.url || '—'}`);

    doc.moveDown();
    doc.fontSize(14).text('Recommended Actions');
    (result.recommended_actions || []).forEach((a, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${a}`, { indent: 12 });
    });

    if (result.missing_data_requests?.length) {
      doc.moveDown();
      doc.fontSize(14).text('Missing Data Requests');
      result.missing_data_requests.forEach((req, idx) => {
        doc.fontSize(12).text(`${idx + 1}. ${req}`, { indent: 12 });
      });
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function queueJob(payload) {
  const jobId = buildJobId();
  const jobDir = getJobDir(jobId);
  const evidencePath = path.join(jobDir, 'evidence_pack.json');
  const normalizedEvidence = normalizeEvidencePack(payload.evidencePack);
  persistJson(evidencePath, normalizedEvidence);

  const job = createJob({
    id: jobId,
    userId: payload.userId || null,
    toolId: payload.toolId,
    scanId: payload.scanId,
    provider: payload.provider,
    model: payload.model,
    promptNotes: payload.promptNotes,
    evidenceRef: evidencePath,
    status: 'running'
  });

  setImmediate(() => executeJob(jobId));
  return job;
}

module.exports = {
  queueJob,
  getJob,
  executeJob,
};

