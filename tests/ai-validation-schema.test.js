/**
 * Tests for AI Validation Schema
 */

const { describe, it, expect } = require('vitest');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const aiValidationSchema = require('../ai-validation/schemas/ai_validation.schema.json');
const caseBriefSchema = require('../ai-validation/schemas/case_brief.schema.json');

describe('AI Validation Schema', () => {
  let ajv;
  let validateAI;
  let validateCaseBrief;

  beforeEach(() => {
    ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validateAI = ajv.compile(aiValidationSchema);
    validateCaseBrief = ajv.compile(caseBriefSchema);
  });

  describe('Valid AI Validation Result', () => {
    it('should validate a complete valid result', () => {
      const validResult = {
        verdict: {
          label: 'FAIL',
          confidence: 85,
          rationale: 'Multiple offscreen iframes detected with significant impression gap'
        },
        findings: [
          {
            title: 'Offscreen Ad Iframes',
            mechanism: 'Ad iframes positioned outside viewport to inflate impressions',
            evidence: {
              counts: { offscreen: 5, tiny: 2 },
              examples: [
                { iframeId: 'ad-frame-1', rect: { x: -1000, y: 0, width: 300, height: 250 } }
              ]
            },
            risk: 'HIGH',
            recommended_next_steps: ['Investigate ad stack configuration', 'Review viewability metrics']
          }
        ],
        duplicates: {
          exact_url_duplicates: 42,
          top_endpoints: [
            { endpoint: 'example.com/api/beacon', count: 15 }
          ]
        },
        limitations: ['Missing CMS monitor data'],
        model_used: {
          provider: 'OpenAI',
          model: 'gpt-4o',
          run_at: '2024-01-01T00:00:00Z'
        },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      const valid = validateAI(validResult);
      expect(valid).toBe(true);
      expect(validateAI.errors).toBeNull();
    });

    it('should validate PASS verdict', () => {
      const result = {
        verdict: { label: 'PASS', confidence: 20, rationale: 'No significant issues found' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'Gemini', model: 'gemini-2.0-flash-exp', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      expect(validateAI(result)).toBe(true);
    });

    it('should validate WARN verdict', () => {
      const result = {
        verdict: { label: 'WARN', confidence: 55, rationale: 'Some suspicious patterns detected' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'Perplexity', model: 'llama-3.1-sonar-large-128k-online', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      expect(validateAI(result)).toBe(true);
    });
  });

  describe('Invalid AI Validation Result', () => {
    it('should reject invalid verdict label', () => {
      const result = {
        verdict: { label: 'INVALID', confidence: 50, rationale: 'Test' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'OpenAI', model: 'gpt-4o', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      expect(validateAI(result)).toBe(false);
    });

    it('should reject confidence out of range', () => {
      const result = {
        verdict: { label: 'PASS', confidence: 150, rationale: 'Test' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'OpenAI', model: 'gpt-4o', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      expect(validateAI(result)).toBe(false);
    });

    it('should reject invalid fingerprint format', () => {
      const result = {
        verdict: { label: 'PASS', confidence: 50, rationale: 'Test' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'OpenAI', model: 'gpt-4o', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'invalid',
        output_fingerprint: 'b'.repeat(64)
      };

      expect(validateAI(result)).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = {
        verdict: { label: 'PASS', confidence: 50, rationale: 'Test' },
        findings: []
        // Missing duplicates, limitations, model_used, etc.
      };

      expect(validateAI(result)).toBe(false);
    });

    it('should reject invalid risk level', () => {
      const result = {
        verdict: { label: 'FAIL', confidence: 85, rationale: 'Test' },
        findings: [
          {
            title: 'Test',
            mechanism: 'Test',
            evidence: { counts: {}, examples: [] },
            risk: 'CRITICAL', // Invalid
            recommended_next_steps: []
          }
        ],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'OpenAI', model: 'gpt-4o', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      expect(validateAI(result)).toBe(false);
    });
  });

  describe('Case Brief Schema', () => {
    it('should validate a complete case brief', () => {
      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: 100,
        endpoints: [
          { endpoint: 'example.com/api', count: 50 }
        ],
        exact_duplicate_urls_count: 10,
        iframe_anomalies: {
          offscreen: [],
          tiny: [],
          hidden: []
        },
        gpt_events: {
          slotRender: 5,
          viewable: 3
        },
        impression_beacons: {
          count: 20,
          key_endpoints: ['example.com/beacon']
        },
        id_sync: {
          count: 30,
          counterparties: [
            { domain: 'sync.example.com', count: 15 }
          ]
        },
        tag_library_loads: 10,
        analytics_ids: ['G-ABCDEFGHIJ'],
        ad_client_ids: ['ca-pub-1234567890123456'],
        limitations: []
      };

      expect(validateCaseBrief(caseBrief)).toBe(true);
    });

    it('should validate minimal case brief', () => {
      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: 100
      };

      expect(validateCaseBrief(caseBrief)).toBe(true);
    });

    it('should reject missing required fields', () => {
      const caseBrief = {
        site: 'https://example.com'
        // Missing timestamp, scan_window, total_events
      };

      expect(validateCaseBrief(caseBrief)).toBe(false);
    });

    it('should reject negative total_events', () => {
      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: -5
      };

      expect(validateCaseBrief(caseBrief)).toBe(false);
    });
  });
});

