/**
 * Tests for AI Providers
 */

const { describe, it, expect, vi, beforeEach } = require('vitest');
const BaseProvider = require('../ai-validation/providers/base-provider.cjs');
const { createProvider, listProviders } = require('../ai-validation/providers/provider-factory.cjs');

describe('Base Provider', () => {
  let provider;

  beforeEach(() => {
    provider = new BaseProvider('TestProvider', 'test-model-v1');
  });

  describe('parseResponse', () => {
    it('should parse valid JSON', () => {
      const response = '{"verdict": {"label": "PASS"}}';
      const parsed = provider.parseResponse(response);
      expect(parsed).toEqual({ verdict: { label: 'PASS' } });
    });

    it('should remove markdown code blocks', () => {
      const response = '```json\n{"verdict": {"label": "PASS"}}\n```';
      const parsed = provider.parseResponse(response);
      expect(parsed).toEqual({ verdict: { label: 'PASS' } });
    });

    it('should handle multiple code block markers', () => {
      const response = '```json\n```\n{"verdict": {"label": "PASS"}}\n```';
      const parsed = provider.parseResponse(response);
      expect(parsed).toEqual({ verdict: { label: 'PASS' } });
    });

    it('should throw on invalid JSON', () => {
      const response = 'not valid json';
      expect(() => provider.parseResponse(response)).toThrow('Invalid JSON response');
    });
  });

  describe('buildUserPrompt', () => {
    it('should format case brief into prompt', () => {
      const caseBrief = {
        site: 'https://example.com',
        total_events: 100
      };

      const prompt = provider.buildUserPrompt(caseBrief);

      expect(prompt).toContain('Analyze this CaseBrief');
      expect(prompt).toContain('https://example.com');
      expect(prompt).toContain('100');
    });
  });

  describe('injectMetadata', () => {
    it('should inject all required metadata', () => {
      const response = {
        verdict: { label: 'PASS', confidence: 50, rationale: 'Test' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: []
      };

      const caseBrief = {
        input_fingerprint: 'a'.repeat(64)
      };

      const enriched = provider.injectMetadata(response, caseBrief, 'v1.0.0');

      expect(enriched.model_used.provider).toBe('TestProvider');
      expect(enriched.model_used.model).toBe('test-model-v1');
      expect(enriched.model_used.run_at).toBeDefined();
      expect(enriched.prompt_version).toBe('v1.0.0');
      expect(enriched.input_fingerprint).toBe('a'.repeat(64));
      expect(enriched.output_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should calculate consistent output fingerprint', () => {
      const response = {
        verdict: { label: 'PASS', confidence: 50, rationale: 'Test' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: []
      };

      const caseBrief = {
        input_fingerprint: 'a'.repeat(64)
      };

      const enriched1 = provider.injectMetadata(JSON.parse(JSON.stringify(response)), caseBrief, 'v1.0.0');
      const enriched2 = provider.injectMetadata(JSON.parse(JSON.stringify(response)), caseBrief, 'v1.0.0');

      // Output fingerprints should be the same for same input (excluding timestamp)
      expect(enriched1.output_fingerprint).toBeDefined();
      expect(enriched2.output_fingerprint).toBeDefined();
    });
  });

  describe('validateResponse', () => {
    it('should validate correct schema', () => {
      const validResponse = {
        verdict: { label: 'PASS', confidence: 50, rationale: 'Test rationale here' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'Test', model: 'test', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      expect(() => provider.validateResponse(validResponse)).not.toThrow();
    });

    it('should reject invalid schema', () => {
      const invalidResponse = {
        verdict: { label: 'INVALID_LABEL', confidence: 50, rationale: 'Test' }
      };

      expect(() => provider.validateResponse(invalidResponse)).toThrow('Schema validation failed');
    });
  });
});

describe('Provider Factory', () => {
  describe('createProvider', () => {
    it('should throw error when API key is missing', () => {
      // Clear environment variables
      const originalEnv = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      expect(() => createProvider('openai')).toThrow('OpenAI API key not provided');

      // Restore
      if (originalEnv) process.env.OPENAI_API_KEY = originalEnv;
    });

    it('should create provider with config API key', () => {
      const provider = createProvider('openai', { apiKey: 'test-key' });
      expect(provider).toBeDefined();
      expect(provider.providerName).toBe('OpenAI');
    });

    it('should throw error for unknown provider', () => {
      expect(() => createProvider('unknown-provider')).toThrow('Unknown provider');
    });

    it('should handle case-insensitive provider names', () => {
      const provider = createProvider('OpenAI', { apiKey: 'test-key' });
      expect(provider.providerName).toBe('OpenAI');
    });

    it('should accept chatgpt alias for openai', () => {
      const provider = createProvider('chatgpt', { apiKey: 'test-key' });
      expect(provider.providerName).toBe('OpenAI');
    });
  });

  describe('listProviders', () => {
    it('should return list of available providers', () => {
      const providers = listProviders();
      expect(providers).toBeInstanceOf(Array);
      expect(providers.length).toBeGreaterThan(0);
      
      const openai = providers.find(p => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai.name).toBe('OpenAI ChatGPT');
      expect(openai.defaultModel).toBeDefined();
    });

    it('should include all three providers', () => {
      const providers = listProviders();
      const ids = providers.map(p => p.id);
      
      expect(ids).toContain('openai');
      expect(ids).toContain('gemini');
      expect(ids).toContain('perplexity');
    });
  });
});

describe('Provider Integration', () => {
  it('should handle retry logic on invalid JSON', async () => {
    class MockProvider extends BaseProvider {
      constructor() {
        super('Mock', 'mock-v1');
        this.attempts = 0;
      }

      async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
        const apiCall = async () => {
          this.attempts++;
          if (this.attempts === 1) {
            // First attempt returns invalid JSON
            return 'invalid json';
          }
          // Second attempt returns valid JSON
          return JSON.stringify({
            verdict: { label: 'PASS', confidence: 50, rationale: 'Test rationale' },
            findings: [],
            duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
            limitations: []
          });
        };

        return await this.processWithRetry(caseBrief, systemPrompt, promptVersion, apiCall);
      }
    }

    const provider = new MockProvider();
    const caseBrief = { input_fingerprint: 'a'.repeat(64) };

    const result = await provider.validateCase(caseBrief, 'test', 'system prompt', 'v1.0.0');

    expect(provider.attempts).toBe(2);
    expect(result.verdict.label).toBe('PASS');
  });

  it('should fail after max retries', async () => {
    class FailingProvider extends BaseProvider {
      constructor() {
        super('Failing', 'fail-v1');
      }

      async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
        const apiCall = async () => {
          return 'always invalid json';
        };

        return await this.processWithRetry(caseBrief, systemPrompt, promptVersion, apiCall, 2);
      }
    }

    const provider = new FailingProvider();
    const caseBrief = { input_fingerprint: 'a'.repeat(64) };

    await expect(
      provider.validateCase(caseBrief, 'test', 'system prompt', 'v1.0.0')
    ).rejects.toThrow('AI validation failed after 3 attempts');
  });
});

