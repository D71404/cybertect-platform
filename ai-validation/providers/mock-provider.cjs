/**
 * Mock AI Provider
 * Returns realistic mock responses for testing without API keys
 */

const BaseProvider = require('./base-provider.cjs');
const crypto = require('crypto');

class MockProvider extends BaseProvider {
  constructor(providerName = 'MockAI', model = 'mock-1.0') {
    super(providerName, model);
  }
  
  /**
   * Validate case using mock AI responses
   * @param {object} caseBrief - Canonical case brief
   * @param {string} templateId - Validation template ID
   * @param {string} systemPrompt - Template system prompt
   * @param {string} promptVersion - Template prompt version
   * @returns {Promise<object>} - AI validation result
   */
  async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
    // Simulate API delay (500-1500ms)
    await this.sleep(500 + Math.random() * 1000);
    
    // Analyze the case brief to generate realistic responses
    const hasMultipleGA4 = (caseBrief.ga4_ids && caseBrief.ga4_ids.length > 1);
    const hasFlags = (caseBrief.flags && caseBrief.flags.length > 0);
    const highEventCount = (caseBrief.total_events && caseBrief.total_events > 100);
    
    // Determine verdict based on evidence
    let verdict = 'PASS';
    let confidence = 85;
    let rationale = 'Analysis shows normal publisher behavior with no significant fraud indicators.';
    
    if (hasFlags && highEventCount) {
      verdict = 'FAIL';
      confidence = 92;
      rationale = 'Multiple fraud indicators detected including suspicious event patterns and inflated metrics. The combination of high event volume with detected flags suggests systematic ad fraud.';
    } else if (hasFlags || hasMultipleGA4) {
      verdict = 'WARN';
      confidence = 78;
      rationale = 'Some suspicious patterns detected that warrant further investigation. While not conclusive evidence of fraud, these signals suggest potential quality issues.';
    }
    
    // Generate findings based on case brief
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
        if (idx < 2) { // Limit to 2 findings
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
    
    if (highEventCount && !hasFlags) {
      findings.push({
        title: 'High Telemetry Volume',
        mechanism: 'Event Rate Analysis',
        evidence: {
          counts: { total_events: caseBrief.total_events },
          examples: [`${caseBrief.total_events} events in ${caseBrief.scan_window || '30s'}`]
        },
        risk: 'LOW',
        recommended_next_steps: [
          'Verify normal for site traffic volume',
          'Check for event duplication',
          'Review measurement implementation'
        ]
      });
    }
    
    // Generate duplicates section
    const duplicates = {
      exact_url_duplicates: Math.floor(Math.random() * 5),
      top_endpoints: [
        { endpoint: 'google-analytics.com/collect', count: Math.floor(Math.random() * 20) + 5 },
        { endpoint: 'doubleclick.net/impression', count: Math.floor(Math.random() * 15) + 3 }
      ]
    };
    
    // Build limitations
    const limitations = [];
    if (!caseBrief.total_events || caseBrief.total_events === 0) {
      limitations.push('Limited telemetry data available for analysis');
    }
    if (!caseBrief.ga4_ids || caseBrief.ga4_ids.length === 0) {
      limitations.push('No GA4 tracking detected; analysis based on available signals only');
    }
    
    // Generate fingerprints
    const inputFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify(caseBrief))
      .digest('hex')
      .substring(0, 16);
    
    const outputData = { verdict, confidence, findings, duplicates };
    const outputFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify(outputData))
      .digest('hex')
      .substring(0, 16);
    
    // Return AI validation result
    return {
      verdict: {
        label: verdict,
        confidence: confidence,
        rationale: rationale
      },
      findings: findings.length > 0 ? findings : [{
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
      }],
      duplicates: duplicates,
      limitations: limitations,
      model_used: {
        provider: this.providerName,
        model: this.model,
        run_at: new Date().toISOString()
      },
      prompt_version: promptVersion || '1.0',
      input_fingerprint: inputFingerprint,
      output_fingerprint: outputFingerprint
    };
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MockProvider;




