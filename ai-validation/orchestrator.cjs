/**
 * AI Validation Orchestrator
 * Main entry point for AI validation workflow
 */

const fs = require('fs');
const path = require('path');
const { parseEvidencePack } = require('./parser/evidence-pack-parser.cjs');
const { getTemplate } = require('./templates/registry.cjs');
const { createProvider } = require('./providers/provider-factory.cjs');
const { generateEvidencePDF } = require('./pdf/generator.cjs');

/**
 * Run AI validation workflow
 * @param {object} options - Validation options
 * @param {Buffer} options.zipBuffer - Evidence pack ZIP buffer
 * @param {string} options.uploadId - Unique upload identifier
 * @param {string} options.provider - Provider name (openai, gemini, perplexity)
 * @param {string} options.template - Template ID
 * @param {object} options.findingsJson - Optional findings JSON
 * @param {boolean} options.redactionMode - Enable URL redaction
 * @returns {Promise<object>} - Result with paths and metadata
 */
async function runValidation(options) {
  const {
    zipBuffer,
    uploadId,
    provider,
    template,
    findingsJson = null,
    redactionMode = false
  } = options;
  
  console.log(`[AI Validation] Starting validation for upload ${uploadId}`);
  console.log(`[AI Validation] Provider: ${provider}, Template: ${template}`);
  
  // Create run directory
  const runDir = path.join(__dirname, '..', 'runs', 'ai-validation', uploadId);
  fs.mkdirSync(runDir, { recursive: true });
  
  try {
    // Step 1: Parse evidence pack
    console.log('[AI Validation] Parsing evidence pack...');
    const { caseBrief, extractDir, fingerprint } = parseEvidencePack(
      zipBuffer,
      uploadId,
      { findingsJson }
    );
    
    // Apply redaction if enabled
    if (redactionMode) {
      console.log('[AI Validation] Applying redaction mode...');
      redactCaseBrief(caseBrief);
    }
    
    // Save case brief
    const caseBriefPath = path.join(runDir, 'case_brief.json');
    fs.writeFileSync(caseBriefPath, JSON.stringify(caseBrief, null, 2));
    console.log(`[AI Validation] Case brief saved: ${caseBriefPath}`);
    
    // Step 2: Get validation template
    const templateObj = getTemplate(template);
    if (!templateObj) {
      throw new Error(`Invalid template: ${template}`);
    }
    
    // Step 3: Create AI provider
    console.log('[AI Validation] Initializing AI provider...');
    const aiProvider = createProvider(provider);
    
    // Step 4: Run AI validation
    console.log('[AI Validation] Running AI validation...');
    const aiValidation = await aiProvider.validateCase(
      caseBrief,
      template,
      templateObj.systemPrompt,
      templateObj.promptVersion
    );
    
    // Save AI validation result
    const aiValidationPath = path.join(runDir, 'ai_validation.json');
    fs.writeFileSync(aiValidationPath, JSON.stringify(aiValidation, null, 2));
    console.log(`[AI Validation] AI validation saved: ${aiValidationPath}`);
    
    // Step 5: Generate PDF
    console.log('[AI Validation] Generating PDF evidence summary...');
    const pdfPath = path.join(runDir, 'evidence_summary.pdf');
    await generateEvidencePDF(aiValidation, caseBrief, pdfPath);
    console.log(`[AI Validation] PDF generated: ${pdfPath}`);
    
    // Step 6: Save metadata
    const metadata = {
      uploadId,
      runId: uploadId,
      provider,
      template,
      redactionMode,
      timestamp: new Date().toISOString(),
      verdict: aiValidation.verdict.label,
      confidence: aiValidation.verdict.confidence,
      findingsCount: aiValidation.findings.length,
      inputFingerprint: fingerprint,
      outputFingerprint: aiValidation.output_fingerprint,
      files: {
        caseBrief: 'case_brief.json',
        aiValidation: 'ai_validation.json',
        pdf: 'evidence_summary.pdf'
      }
    };
    
    const metadataPath = path.join(runDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`[AI Validation] Metadata saved: ${metadataPath}`);
    
    console.log('[AI Validation] Validation complete!');
    
    return {
      success: true,
      runId: uploadId,
      metadata,
      paths: {
        caseBrief: caseBriefPath,
        aiValidation: aiValidationPath,
        pdf: pdfPath,
        metadata: metadataPath
      }
    };
    
  } catch (error) {
    console.error('[AI Validation] Error:', error);
    
    // Save error metadata
    const errorMetadata = {
      uploadId,
      runId: uploadId,
      provider,
      template,
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack
    };
    
    const errorPath = path.join(runDir, 'error.json');
    fs.writeFileSync(errorPath, JSON.stringify(errorMetadata, null, 2));
    
    throw error;
  }
}

/**
 * Apply redaction to case brief
 * Removes query strings and tokens from URLs
 * @param {object} caseBrief - Case brief to redact (modified in place)
 */
function redactCaseBrief(caseBrief) {
  // Allowlist of safe query parameters
  const allowlist = ['id', 'type', 'format', 'v', 'version'];
  
  /**
   * Redact URL by removing query parameters not in allowlist
   * @param {string} url - URL to redact
   * @returns {string} - Redacted URL
   */
  function redactUrl(url) {
    try {
      const urlObj = new URL(url);
      const params = new URLSearchParams(urlObj.search);
      const redactedParams = new URLSearchParams();
      
      for (const [key, value] of params) {
        if (allowlist.includes(key.toLowerCase())) {
          redactedParams.set(key, value);
        } else {
          redactedParams.set(key, '[REDACTED]');
        }
      }
      
      urlObj.search = redactedParams.toString();
      return urlObj.toString();
    } catch (error) {
      // If URL parsing fails, return as-is
      return url;
    }
  }
  
  // Redact endpoints
  if (caseBrief.endpoints && Array.isArray(caseBrief.endpoints)) {
    caseBrief.endpoints.forEach(ep => {
      if (ep.endpoint) {
        ep.endpoint = redactUrl(ep.endpoint);
      }
    });
  }
  
  // Redact impression beacon endpoints
  if (caseBrief.impression_beacons && caseBrief.impression_beacons.key_endpoints) {
    caseBrief.impression_beacons.key_endpoints = caseBrief.impression_beacons.key_endpoints.map(redactUrl);
  }
  
  // Redact iframe URLs
  if (caseBrief.iframe_anomalies) {
    ['offscreen', 'tiny', 'hidden'].forEach(category => {
      if (caseBrief.iframe_anomalies[category] && Array.isArray(caseBrief.iframe_anomalies[category])) {
        caseBrief.iframe_anomalies[category].forEach(iframe => {
          if (iframe.iframeId) {
            iframe.iframeId = redactUrl(iframe.iframeId);
          }
        });
      }
    });
  }
  
  // Add redaction notice to limitations
  if (!caseBrief.limitations) {
    caseBrief.limitations = [];
  }
  caseBrief.limitations.push('Redaction mode enabled - query parameters filtered');
}

/**
 * Get validation result by run ID
 * @param {string} runId - Run identifier
 * @returns {object} - Validation result with metadata and file paths
 */
function getValidationResult(runId) {
  const runDir = path.join(__dirname, '..', 'runs', 'ai-validation', runId);
  
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run not found: ${runId}`);
  }
  
  const metadataPath = path.join(runDir, 'metadata.json');
  const errorPath = path.join(runDir, 'error.json');
  
  // Check for error
  if (fs.existsSync(errorPath)) {
    const errorData = JSON.parse(fs.readFileSync(errorPath, 'utf8'));
    return {
      success: false,
      runId,
      error: errorData.error,
      timestamp: errorData.timestamp
    };
  }
  
  // Load metadata
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata not found for run: ${runId}`);
  }
  
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  
  return {
    success: true,
    runId,
    metadata,
    paths: {
      caseBrief: path.join(runDir, 'case_brief.json'),
      aiValidation: path.join(runDir, 'ai_validation.json'),
      pdf: path.join(runDir, 'evidence_summary.pdf'),
      metadata: metadataPath
    }
  };
}

module.exports = {
  runValidation,
  getValidationResult
};

