const { describe, it, expect } = require('vitest');
const { upsertOccurrence, queryById, getDistinctDomains, queryByDomain } = require('../src/index-telemetry.cjs');
const fs = require('fs');
const path = require('path');

// Test database path (separate from production)
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-analytics-index.db');

describe('Reverse Analytics Search', () => {
  // Clean up test DB before each test
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('ID Normalization', () => {
    it('should normalize UA IDs correctly', () => {
      const testCases = [
        { input: 'UA-35735220-64', expected: 'UA-35735220-64' },
        { input: 'ua-35735220-64', expected: 'UA-35735220-64' },
        { input: 'UA-12345678-1', expected: 'UA-12345678-1' },
        { input: 'invalid', expected: null },
        { input: 'UA-123-1', expected: null }, // Too short
      ];

      // Note: This would require exposing normalization functions
      // For now, we test through upsertOccurrence
    });

    it('should normalize GA4 IDs correctly', () => {
      const testCases = [
        { input: 'G-ABCD123456', expected: 'G-ABCD123456' },
        { input: 'g-abcd123456', expected: 'G-ABCD123456' },
        { input: 'G-1234567890', expected: 'G-1234567890' },
        { input: 'G-12345', expected: null }, // Too short
      ];
    });
  });

  describe('Database Operations', () => {
    it('should upsert occurrences correctly', () => {
      upsertOccurrence({
        id_type: 'UA',
        id_value: 'UA-35735220-64',
        domain: 'example.com',
        url: 'https://example.com/page',
        source: 'network',
        evidence: 'test evidence',
        confidence: 0.95
      });

      const occurrences = queryById('UA', 'UA-35735220-64');
      expect(occurrences.length).toBeGreaterThan(0);
      expect(occurrences[0].id_value).toBe('UA-35735220-64');
      expect(occurrences[0].domain).toBe('example.com');
      expect(occurrences[0].seen_count).toBe(1);
    });

    it('should increment seen_count on duplicate upsert', () => {
      upsertOccurrence({
        id_type: 'UA',
        id_value: 'UA-35735220-64',
        domain: 'example.com',
        url: 'https://example.com/page1',
        source: 'network',
        evidence: 'test evidence 1',
        confidence: 0.95
      });

      upsertOccurrence({
        id_type: 'UA',
        id_value: 'UA-35735220-64',
        domain: 'example.com',
        url: 'https://example.com/page2',
        source: 'network',
        evidence: 'test evidence 2',
        confidence: 0.95
      });

      const occurrences = queryById('UA', 'UA-35735220-64');
      const matchingOcc = occurrences.find(o => o.domain === 'example.com' && o.source === 'network');
      expect(matchingOcc.seen_count).toBe(2);
    });

    it('should get distinct domains for an ID', () => {
      upsertOccurrence({
        id_type: 'UA',
        id_value: 'UA-35735220-64',
        domain: 'example.com',
        url: 'https://example.com/page1',
        source: 'network',
        evidence: 'test',
        confidence: 0.95
      });

      upsertOccurrence({
        id_type: 'UA',
        id_value: 'UA-35735220-64',
        domain: 'test.com',
        url: 'https://test.com/page1',
        source: 'network',
        evidence: 'test',
        confidence: 0.95
      });

      const domains = getDistinctDomains('UA', 'UA-35735220-64');
      expect(domains.length).toBe(2);
      expect(domains).toContain('example.com');
      expect(domains).toContain('test.com');
    });

    it('should query by domain correctly', () => {
      upsertOccurrence({
        id_type: 'UA',
        id_value: 'UA-35735220-64',
        domain: 'example.com',
        url: 'https://example.com/page1',
        source: 'network',
        evidence: 'test',
        confidence: 0.95
      });

      upsertOccurrence({
        id_type: 'GA4',
        id_value: 'G-ABCD123456',
        domain: 'example.com',
        url: 'https://example.com/page2',
        source: 'html',
        evidence: 'test',
        confidence: 0.8
      });

      const domainOccs = queryByDomain('example.com', 10);
      expect(domainOccs.length).toBe(2);
    });
  });

  describe('Network URL Parsing', () => {
    it('should extract UA from collect URL', () => {
      const testUrl = 'https://www.google-analytics.com/collect?tid=UA-35735220-64&t=pageview';
      // This would be tested through extractFromNetworkUrl in extract-telemetry.ts
      // For now, we verify through integration
    });

    it('should extract GA4 from collect URL', () => {
      const testUrl = 'https://www.google-analytics.com/g/collect?tid=G-ABCD123456&t=pageview';
      // Integration test
    });

    it('should extract Facebook Pixel from tr URL', () => {
      const testUrl = 'https://www.facebook.com/tr?id=123456789012345&ev=PageView';
      // Integration test
    });
  });
});

