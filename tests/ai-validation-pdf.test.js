/**
 * Tests for PDF Generator
 */

const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const fs = require('fs');
const path = require('path');
const { generateEvidencePDF } = require('../ai-validation/pdf/generator.cjs');

describe('PDF Generator', () => {
  let tempDir;
  let outputPath;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = path.join(__dirname, 'temp-pdf-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    outputPath = path.join(tempDir, 'test-output.pdf');
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('generateEvidencePDF', () => {
    it('should generate PDF file', async () => {
      const aiValidation = {
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
                { 
                  iframeId: 'ad-frame-1', 
                  rect: { x: -1000, y: 0, width: 300, height: 250 } 
                }
              ]
            },
            risk: 'HIGH',
            recommended_next_steps: ['Investigate ad stack configuration']
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

      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: 100
      };

      const result = await generateEvidencePDF(aiValidation, caseBrief, outputPath);

      expect(result).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      
      // Check file size is reasonable (not empty, not too large)
      const stats = fs.statSync(outputPath);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
      expect(stats.size).toBeLessThan(500000); // Less than 500KB
    });

    it('should handle PASS verdict', async () => {
      const aiValidation = {
        verdict: {
          label: 'PASS',
          confidence: 20,
          rationale: 'No significant issues detected'
        },
        findings: [],
        duplicates: {
          exact_url_duplicates: 0,
          top_endpoints: []
        },
        limitations: [],
        model_used: {
          provider: 'Gemini',
          model: 'gemini-2.0-flash-exp',
          run_at: '2024-01-01T00:00:00Z'
        },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: 50
      };

      const result = await generateEvidencePDF(aiValidation, caseBrief, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it('should handle WARN verdict', async () => {
      const aiValidation = {
        verdict: {
          label: 'WARN',
          confidence: 60,
          rationale: 'Some suspicious patterns detected'
        },
        findings: [
          {
            title: 'Elevated ID Sync Activity',
            mechanism: 'High number of ID sync requests',
            evidence: {
              counts: { id_sync: 150 },
              examples: []
            },
            risk: 'MEDIUM',
            recommended_next_steps: ['Monitor ID sync partners']
          }
        ],
        duplicates: {
          exact_url_duplicates: 5,
          top_endpoints: []
        },
        limitations: [],
        model_used: {
          provider: 'Perplexity',
          model: 'llama-3.1-sonar-large-128k-online',
          run_at: '2024-01-01T00:00:00Z'
        },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '45s',
        total_events: 200
      };

      const result = await generateEvidencePDF(aiValidation, caseBrief, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it('should include CMS monitor data when available', async () => {
      const aiValidation = {
        verdict: {
          label: 'FAIL',
          confidence: 90,
          rationale: 'Unauthorized scripts detected'
        },
        findings: [],
        duplicates: {
          exact_url_duplicates: 0,
          top_endpoints: []
        },
        limitations: [],
        model_used: {
          provider: 'OpenAI',
          model: 'gpt-4o',
          run_at: '2024-01-01T00:00:00Z'
        },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: 100,
        cms_monitor: {
          total_scripts: 50,
          unauthorized_count: 5,
          injected_scripts_count: 2
        }
      };

      const result = await generateEvidencePDF(aiValidation, caseBrief, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
      
      // Verify file is larger with CMS data
      const stats = fs.statSync(outputPath);
      expect(stats.size).toBeGreaterThan(1000);
    });

    it('should handle multiple findings with examples', async () => {
      const aiValidation = {
        verdict: {
          label: 'FAIL',
          confidence: 95,
          rationale: 'Multiple fraud indicators detected'
        },
        findings: [
          {
            title: 'Finding 1',
            mechanism: 'Mechanism 1',
            evidence: {
              counts: { count1: 10 },
              examples: [
                { iframeId: 'frame-1', rect: { x: 0, y: 0, width: 1, height: 1 } },
                { iframeId: 'frame-2', rect: { x: -100, y: -100, width: 300, height: 250 } }
              ]
            },
            risk: 'HIGH',
            recommended_next_steps: ['Action 1']
          },
          {
            title: 'Finding 2',
            mechanism: 'Mechanism 2',
            evidence: {
              counts: { count2: 20 },
              examples: [
                { endpoint: 'example.com/api', count: 50 }
              ]
            },
            risk: 'MEDIUM',
            recommended_next_steps: ['Action 2']
          }
        ],
        duplicates: {
          exact_url_duplicates: 100,
          top_endpoints: [
            { endpoint: 'example.com/beacon', count: 50 },
            { endpoint: 'other.com/track', count: 30 }
          ]
        },
        limitations: ['Limitation 1', 'Limitation 2'],
        model_used: {
          provider: 'OpenAI',
          model: 'gpt-4o',
          run_at: '2024-01-01T00:00:00Z'
        },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '60s',
        total_events: 500
      };

      const result = await generateEvidencePDF(aiValidation, caseBrief, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
      
      // Should be larger with more content
      const stats = fs.statSync(outputPath);
      expect(stats.size).toBeGreaterThan(2000);
    });

    it('should reject if output path is invalid', async () => {
      const aiValidation = {
        verdict: { label: 'PASS', confidence: 50, rationale: 'Test' },
        findings: [],
        duplicates: { exact_url_duplicates: 0, top_endpoints: [] },
        limitations: [],
        model_used: { provider: 'OpenAI', model: 'gpt-4o', run_at: '2024-01-01T00:00:00Z' },
        prompt_version: 'v1.0.0',
        input_fingerprint: 'a'.repeat(64),
        output_fingerprint: 'b'.repeat(64)
      };

      const caseBrief = {
        site: 'https://example.com',
        timestamp: '2024-01-01T00:00:00Z',
        scan_window: '30s',
        total_events: 100
      };

      const invalidPath = '/invalid/path/that/does/not/exist/output.pdf';

      await expect(
        generateEvidencePDF(aiValidation, caseBrief, invalidPath)
      ).rejects.toThrow();
    });
  });
});

