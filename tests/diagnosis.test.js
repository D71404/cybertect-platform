const { describe, it, expect } = require('vitest');
const fs = require('fs');
const path = require('path');

// Import the diagnosis module functions
const {
  normalizeGa4Id,
  normalizeUaId,
  normalizeGtmId,
  normalizeGoogleAdsId,
  normalizeFbPixelId,
  extractIdsFromText,
  detectCollisions,
  detectDrift,
  detectRogueIds,
  generateChecklist
} = require('../diagnosis.cjs');

describe('Analytics Integrity Diagnosis - ID Extractors', () => {
  describe('GA4 ID Extraction', () => {
    it('should extract valid GA4 IDs', () => {
      const text = 'gtag("config", "G-ABCD123456");';
      const ids = extractIdsFromText(text, 'inline');
      expect(ids.GA4.size).toBeGreaterThan(0);
      expect(Array.from(ids.GA4)).toContain('G-ABCD123456');
    });

    it('should normalize GA4 IDs correctly', () => {
      expect(normalizeGa4Id('G-ABCD123456')).toBe('G-ABCD123456'); // Exactly 10 chars
      expect(normalizeGa4Id('g-abcd123456')).toBe('G-ABCD123456');
      expect(normalizeGa4Id('G-THUMBNAILS')).toBeNull(); // Invalid format (9 chars)
      expect(normalizeGa4Id('G-STANDALONE')).toBeNull(); // Invalid format (9 chars)
      expect(normalizeGa4Id('G-PROGRESS')).toBeNull(); // Invalid format (8 chars)
      expect(normalizeGa4Id('G-TRACKING')).toBeNull(); // Invalid format (8 chars)
      expect(normalizeGa4Id('G-ABCD')).toBeNull(); // Too short (4 chars)
      expect(normalizeGa4Id('G-ABCD1234567')).toBeNull(); // Too long (11 chars)
    });
  });

  describe('UA ID Extraction', () => {
    it('should extract valid UA IDs', () => {
      const text = 'UA-12345678-1';
      const ids = extractIdsFromText(text, 'inline');
      expect(ids.UA.size).toBeGreaterThan(0);
      expect(Array.from(ids.UA)).toContain('UA-12345678-1');
    });

    it('should normalize UA IDs correctly', () => {
      expect(normalizeUaId('UA-12345678-1')).toBe('UA-12345678-1');
      expect(normalizeUaId('ua-12345678-1')).toBe('UA-12345678-1');
      expect(normalizeUaId('UA-123-1')).toBeNull(); // Too short
    });
  });

  describe('GTM ID Extraction', () => {
    it('should extract valid GTM IDs', () => {
      const text = 'GTM-ABC123';
      const ids = extractIdsFromText(text, 'inline');
      expect(ids.GTM.size).toBeGreaterThan(0);
      expect(Array.from(ids.GTM)).toContain('GTM-ABC123');
    });

    it('should normalize GTM IDs correctly', () => {
      expect(normalizeGtmId('GTM-ABC123')).toBe('GTM-ABC123');
      expect(normalizeGtmId('gtm-abc123')).toBe('GTM-ABC123');
    });
  });

  describe('Google Ads ID Extraction', () => {
    it('should extract valid Google Ads IDs', () => {
      const text = 'AW-123456';
      const ids = extractIdsFromText(text, 'inline');
      expect(ids.GOOGLE_ADS.size).toBeGreaterThan(0);
      expect(Array.from(ids.GOOGLE_ADS)).toContain('AW-123456');
    });

    it('should normalize Google Ads IDs correctly', () => {
      expect(normalizeGoogleAdsId('AW-123456')).toBe('AW-123456');
      expect(normalizeGoogleAdsId('aw-123456')).toBe('AW-123456');
      expect(normalizeGoogleAdsId('AW-12345')).toBeNull(); // Too short
    });
  });

  describe('Facebook Pixel ID Extraction', () => {
    it('should extract Facebook Pixel IDs from fbq calls', () => {
      const text = "fbq('init', '123456789012345');";
      const ids = extractIdsFromText(text, 'inline');
      expect(ids.FACEBOOK_PIXEL.size).toBeGreaterThan(0);
      expect(Array.from(ids.FACEBOOK_PIXEL)).toContain('123456789012345');
    });

    it('should extract Facebook Pixel IDs from URLs', () => {
      const text = 'https://www.facebook.com/tr?id=123456789012345';
      const ids = extractIdsFromText(text, 'network');
      expect(ids.FACEBOOK_PIXEL.size).toBeGreaterThan(0);
    });

    it('should normalize Facebook Pixel IDs correctly', () => {
      expect(normalizeFbPixelId('123456789012345')).toBe('123456789012345');
      expect(normalizeFbPixelId('12345')).toBeNull(); // Too short
      expect(normalizeFbPixelId('abc123')).toBeNull(); // Not numeric
    });
  });
});

describe('Analytics Integrity Diagnosis - Collision Detection', () => {
  it('should detect duplicate IDs on same page', () => {
    const inventory = {
      GA4: {
        ids: ['G-ABCD123456'],
        byPage: {
          'https://example.com': ['G-ABCD123456', 'G-ABCD123456']
        },
        occurrences: {}
      }
    };

    const findings = detectCollisions(inventory);
    const duplicateFindings = findings.filter(f => f.type === 'duplicate' && f.vendor === 'GA4');
    expect(duplicateFindings.length).toBeGreaterThan(0);
  });

  it('should detect multiple IDs of same vendor on same page', () => {
    const inventory = {
      GA4: {
        ids: ['G-ABCD123456', 'G-XYZ987654'],
        byPage: {
          'https://example.com': ['G-ABCD123456', 'G-XYZ987654']
        },
        occurrences: {}
      }
    };

    const findings = detectCollisions(inventory);
    const collisionFindings = findings.filter(f => f.type === 'collision' && f.vendor === 'GA4');
    expect(collisionFindings.length).toBeGreaterThan(0);
  });

  it('should detect cross-network collisions', () => {
    const inventory = {
      GA4: { ids: ['G-ABCD123456'], byPage: {}, occurrences: {} },
      UA: { ids: ['UA-12345678-1'], byPage: {}, occurrences: {} },
      GTM: { ids: ['GTM-ABC123'], byPage: {}, occurrences: {} },
      GOOGLE_ADS: { ids: ['AW-123456'], byPage: {}, occurrences: {} },
      FACEBOOK_PIXEL: { ids: ['123456789'], byPage: {}, occurrences: {} }
    };

    const findings = detectCollisions(inventory);
    const crossNetworkFindings = findings.filter(f => f.vendor === 'MULTIPLE');
    expect(crossNetworkFindings.length).toBeGreaterThan(0);
  });
});

describe('Analytics Integrity Diagnosis - Drift Detection', () => {
  it('should detect missing IDs across pages', () => {
    const pagesData = [
      {
        url: 'https://example.com',
        inventory: {
          GA4: { ids: ['G-ABCD123456'], byPage: {}, occurrences: {} }
        }
      },
      {
        url: 'https://example.com/page2',
        inventory: {
          GA4: { ids: [], byPage: {}, occurrences: {} }
        }
      }
    ];

    const drift = detectDrift(pagesData);
    // Should have expected IDs
    expect(drift.expected.GA4).toContain('G-ABCD123456');
    // Should detect missing on page2
    const page2Delta = drift.pageDeltas.find(d => d.page === 'https://example.com/page2');
    expect(page2Delta).toBeTruthy();
    expect(page2Delta.missing.GA4).toContain('G-ABCD123456');
  });

  it('should detect extra IDs on specific pages', () => {
    const pagesData = [
      {
        url: 'https://example.com',
        inventory: {
          GA4: { ids: ['G-ABCD123456'], byPage: {}, occurrences: {} }
        }
      },
      {
        url: 'https://example.com/page2',
        inventory: {
          GA4: { ids: ['G-ABCD123456', 'G-XYZ987654'], byPage: {}, occurrences: {} }
        }
      }
    ];

    const drift = detectDrift(pagesData);
    const page2Delta = drift.pageDeltas.find(d => d.page === 'https://example.com/page2');
    expect(page2Delta).toBeTruthy();
    expect(page2Delta.extra.GA4).toContain('G-XYZ987654');
  });
});

describe('Analytics Integrity Diagnosis - Integration Test', () => {
  it('should process a simple HTML fixture with multiple tags', () => {
    // Create a test HTML fixture
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <script>
          gtag('config', 'G-ABCD123456');
          gtag('config', 'G-ABCD123456'); // Duplicate
          gtag('config', 'G-XYZ987654'); // Collision
        </script>
        <script src="https://www.googletagmanager.com/gtag/js?id=G-ABCD123456"></script>
        <script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>
        <script>
          fbq('init', '123456789012345');
        </script>
      </head>
      <body>
        <script>
          var s_account = "test-suite-id";
        </script>
      </body>
      </html>
    `;

    // Test ID extraction
    const ids = extractIdsFromText(testHtml, 'inline');
    
    // Should extract GA4 IDs
    expect(ids.GA4.size).toBeGreaterThanOrEqual(2);
    expect(Array.from(ids.GA4)).toContain('G-ABCD123456');
    expect(Array.from(ids.GA4)).toContain('G-XYZ987654');
    
    // Should extract GTM ID
    expect(ids.GTM.size).toBeGreaterThan(0);
    expect(Array.from(ids.GTM)).toContain('GTM-ABC123');
    
    // Should extract Facebook Pixel ID
    expect(ids.FACEBOOK_PIXEL.size).toBeGreaterThan(0);
    expect(Array.from(ids.FACEBOOK_PIXEL)).toContain('123456789012345');
    
    // Should extract Adobe Analytics ID
    expect(ids.ADOBE_ANALYTICS.size).toBeGreaterThan(0);
    expect(Array.from(ids.ADOBE_ANALYTICS)).toContain('test-suite-id');
  });

  it('should generate checklist from findings', () => {
    const findings = [
      {
        severity: 'high',
        type: 'duplicate',
        vendor: 'GA4',
        title: 'Duplicate GA4 ID',
        details: 'ID appears twice',
        evidence: { page: 'https://example.com', ids: ['G-ABCD123456'], samples: [] }
      },
      {
        severity: 'medium',
        type: 'rogue',
        vendor: 'FACEBOOK_PIXEL',
        title: 'Rogue Facebook Pixel',
        details: 'ID appears on only one page',
        evidence: { page: 'https://example.com', ids: ['123456789'], samples: [] }
      }
    ];

    const drift = { pageDeltas: [] };
    const checklist = generateChecklist(findings, drift);
    
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.some(item => item.action.includes('duplicate'))).toBe(true);
    expect(checklist.some(item => item.action.includes('Rogue'))).toBe(true);
  });
});

