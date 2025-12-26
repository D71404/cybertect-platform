/**
 * Tests for Evidence Pack Parser
 */

const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const fs = require('fs');
const path = require('path');
const { 
  groupEndpoints, 
  countDuplicateUrls,
  buildCaseBrief,
  calculateFingerprint
} = require('../ai-validation/parser/evidence-pack-parser.cjs');

describe('Evidence Pack Parser', () => {
  describe('groupEndpoints', () => {
    it('should group network events by base endpoint', () => {
      const networkEvents = [
        { url: 'https://example.com/api/data?id=1' },
        { url: 'https://example.com/api/data?id=2' },
        { url: 'https://example.com/api/other?token=abc' },
        { url: 'https://other.com/test' }
      ];

      const result = groupEndpoints(networkEvents);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ endpoint: 'example.com/api/data', count: 2 });
      expect(result[1].count).toBe(1);
    });

    it('should handle empty array', () => {
      const result = groupEndpoints([]);
      expect(result).toEqual([]);
    });

    it('should handle null input', () => {
      const result = groupEndpoints(null);
      expect(result).toEqual([]);
    });

    it('should sort by count descending', () => {
      const networkEvents = [
        { url: 'https://a.com/path' },
        { url: 'https://b.com/path' },
        { url: 'https://b.com/path' },
        { url: 'https://c.com/path' },
        { url: 'https://c.com/path' },
        { url: 'https://c.com/path' }
      ];

      const result = groupEndpoints(networkEvents);

      expect(result[0].endpoint).toBe('c.com/path');
      expect(result[0].count).toBe(3);
      expect(result[1].endpoint).toBe('b.com/path');
      expect(result[1].count).toBe(2);
      expect(result[2].endpoint).toBe('a.com/path');
      expect(result[2].count).toBe(1);
    });
  });

  describe('countDuplicateUrls', () => {
    it('should count exact duplicate URLs', () => {
      const networkEvents = [
        { url: 'https://example.com/api/data?id=1' },
        { url: 'https://example.com/api/data?id=1' },
        { url: 'https://example.com/api/data?id=1' },
        { url: 'https://example.com/api/other' }
      ];

      const result = countDuplicateUrls(networkEvents);
      expect(result).toBe(2); // 3 instances = 2 duplicates
    });

    it('should return 0 for no duplicates', () => {
      const networkEvents = [
        { url: 'https://example.com/api/1' },
        { url: 'https://example.com/api/2' },
        { url: 'https://example.com/api/3' }
      ];

      const result = countDuplicateUrls(networkEvents);
      expect(result).toBe(0);
    });

    it('should handle empty array', () => {
      const result = countDuplicateUrls([]);
      expect(result).toBe(0);
    });

    it('should count multiple duplicate groups', () => {
      const networkEvents = [
        { url: 'https://a.com' },
        { url: 'https://a.com' },
        { url: 'https://b.com' },
        { url: 'https://b.com' },
        { url: 'https://b.com' }
      ];

      const result = countDuplicateUrls(networkEvents);
      expect(result).toBe(3); // 1 duplicate of a.com + 2 duplicates of b.com
    });
  });

  describe('calculateFingerprint', () => {
    it('should generate consistent SHA256 hash', () => {
      const data = 'test data';
      const fingerprint1 = calculateFingerprint(data);
      const fingerprint2 = calculateFingerprint(data);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different hashes for different data', () => {
      const fingerprint1 = calculateFingerprint('data1');
      const fingerprint2 = calculateFingerprint('data2');

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('should handle Buffer input', () => {
      const buffer = Buffer.from('test data');
      const fingerprint = calculateFingerprint(buffer);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('buildCaseBrief', () => {
    let tempDir;

    beforeEach(() => {
      // Create temp directory for test files
      tempDir = path.join(__dirname, 'temp-test-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should build case brief from summary and network files', () => {
      // Create test files
      const summary = {
        url: 'https://example.com',
        scanTimestamp: '2024-01-01T00:00:00Z',
        summary: {
          totalEvents: 100,
          diagnostic: {
            tagLibraryLoads: 10,
            idSyncCount: 50
          }
        }
      };

      const network = [
        { url: 'https://example.com/api/1', timestamp: 1000 },
        { url: 'https://example.com/api/1', timestamp: 2000 }
      ];

      fs.writeFileSync(path.join(tempDir, 'summary.json'), JSON.stringify(summary));
      fs.writeFileSync(path.join(tempDir, 'network.json'), JSON.stringify(network));

      const caseBrief = buildCaseBrief(tempDir);

      expect(caseBrief.site).toBe('https://example.com');
      expect(caseBrief.total_events).toBe(100);
      expect(caseBrief.tag_library_loads).toBe(10);
      expect(caseBrief.exact_duplicate_urls_count).toBe(1);
      expect(caseBrief.endpoints).toHaveLength(1);
    });

    it('should add limitations for missing files', () => {
      // Create only summary, no network or sequences
      const summary = {
        url: 'https://example.com',
        scanTimestamp: '2024-01-01T00:00:00Z'
      };

      fs.writeFileSync(path.join(tempDir, 'summary.json'), JSON.stringify(summary));

      const caseBrief = buildCaseBrief(tempDir);

      expect(caseBrief.limitations).toContain('Missing network.json - duplicate URL detection limited');
      expect(caseBrief.limitations).toContain('Missing sequences.json - event sequence analysis unavailable');
    });

    it('should extract analytics IDs from network events', () => {
      const network = [
        { url: 'https://analytics.google.com/collect?id=G-ABCDEFGHIJ' },
        { url: 'https://analytics.google.com/collect?id=UA-12345678-1' }
      ];

      fs.writeFileSync(path.join(tempDir, 'network.json'), JSON.stringify(network));

      const caseBrief = buildCaseBrief(tempDir);

      expect(caseBrief.analytics_ids).toContain('G-ABCDEFGHIJ');
      expect(caseBrief.analytics_ids).toContain('UA-12345678-1');
    });

    it('should extract ad client IDs from network events', () => {
      const network = [
        { url: 'https://pagead2.googlesyndication.com/pagead/ads?client=ca-pub-1234567890123456' }
      ];

      fs.writeFileSync(path.join(tempDir, 'network.json'), JSON.stringify(network));

      const caseBrief = buildCaseBrief(tempDir);

      expect(caseBrief.ad_client_ids).toContain('ca-pub-1234567890123456');
    });
  });
});

