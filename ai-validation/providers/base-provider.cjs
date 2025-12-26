/**
 * Base Provider Interface
 * Abstract base class for AI validation providers
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const crypto = require('crypto');

// Load AI validation schema
const aiValidationSchema = require('../schemas/ai_validation.schema.json');

/**
 * Base AI Provider class
 * All providers must extend this and implement validateCase()
 */
class BaseProvider {
  constructor(providerName, modelName) {
    this.providerName = providerName;
    this.modelName = modelName;
    
    // Initialize JSON schema validator
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.validator = this.ajv.compile(aiValidationSchema);
  }
  
  /**
   * Validate case - must be implemented by subclasses
   * @param {object} caseBrief - Canonical case brief
   * @param {string} templateId - Validation template ID
   * @param {string} systemPrompt - Template system prompt
   * @param {string} promptVersion - Template prompt version
   * @returns {Promise<object>} - AI validation result
   */
  async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
    throw new Error('validateCase() must be implemented by provider subclass');
  }
  
  /**
   * Build user prompt from case brief
   * @param {object} caseBrief - Canonical case brief
   * @returns {string} - Formatted user prompt
   */
  buildUserPrompt(caseBrief) {
    return `Analyze this CaseBrief and return ONLY valid JSON:

${JSON.stringify(caseBrief, null, 2)}

Remember:
- Return ONLY JSON, no markdown, no code blocks
- Follow the exact schema structure
- Cite specific evidence from the CaseBrief above
- Do NOT make up data`;
  }
  
  /**
   * Parse and clean AI response
   * @param {string} responseText - Raw AI response
   * @returns {object} - Parsed JSON object
   */
  parseResponse(responseText) {
    // Remove markdown code blocks if present
    let cleaned = responseText.trim();
    
    // Remove ```json ... ``` blocks
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    // Parse JSON
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }
  
  /**
   * Validate response against schema
   * @param {object} response - Parsed response object
   * @returns {boolean} - True if valid
   * @throws {Error} - If validation fails
   */
  validateResponse(response) {
    const valid = this.validator(response);
    
    if (!valid) {
      const errors = this.validator.errors
        .map(err => `${err.instancePath} ${err.message}`)
        .join(', ');
      throw new Error(`Schema validation failed: ${errors}`);
    }
    
    return true;
  }
  
  /**
   * Inject metadata into AI response
   * @param {object} response - AI response object
   * @param {object} caseBrief - Original case brief
   * @param {string} promptVersion - Prompt version
   * @returns {object} - Response with injected metadata
   */
  injectMetadata(response, caseBrief, promptVersion) {
    // Inject model_used
    response.model_used = {
      provider: this.providerName,
      model: this.modelName,
      run_at: new Date().toISOString()
    };
    
    // Inject prompt_version
    response.prompt_version = promptVersion;
    
    // Inject input_fingerprint from case brief
    response.input_fingerprint = caseBrief.input_fingerprint;
    
    // Calculate and inject output_fingerprint
    const outputJson = JSON.stringify({
      verdict: response.verdict,
      findings: response.findings,
      duplicates: response.duplicates,
      limitations: response.limitations
    });
    response.output_fingerprint = crypto.createHash('sha256').update(outputJson).digest('hex');
    
    return response;
  }
  
  /**
   * Process and validate AI response with retry logic
   * @param {object} caseBrief - Canonical case brief
   * @param {string} systemPrompt - System prompt
   * @param {string} promptVersion - Prompt version
   * @param {Function} apiCall - Function that calls the AI API
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<object>} - Validated AI response
   */
  async processWithRetry(caseBrief, systemPrompt, promptVersion, apiCall, maxRetries = 1) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Call AI API
        const responseText = await apiCall();
        
        // Parse response
        const parsed = this.parseResponse(responseText);
        
        // Inject metadata
        const enriched = this.injectMetadata(parsed, caseBrief, promptVersion);
        
        // Validate against schema
        this.validateResponse(enriched);
        
        // Success!
        return enriched;
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries) {
          console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
        }
      }
    }
    
    // All attempts failed
    throw new Error(`AI validation failed after ${maxRetries + 1} attempts: ${lastError.message}`);
  }
}

module.exports = BaseProvider;

