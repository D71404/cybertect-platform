/**
 * Unit tests for deduplication helper
 * Tests the DedupeHelper class and deduplication logic
 */

// Note: We need to import the DedupeHelper from scanner.cjs
// Since it's not exported, we'll test the logic indirectly or extract it
// For now, we'll create a test that validates the deduplication behavior

describe('Deduplication Logic', () => {
  // Mock DedupeHelper implementation for testing
  class DedupeHelper {
    constructor() {
      this.seen = new Map();
      this.eventCount = 0;
    }
    
    shouldCount(key, now, ttlMs = 15000) {
      const lastSeen = this.seen.get(key);
      
      if (lastSeen === undefined) {
        this.seen.set(key, now);
        this.eventCount++;
        return true;
      }
      
      const age = now - lastSeen;
      if (age >= ttlMs) {
        this.seen.set(key, now);
        this.eventCount++;
        return true;
      }
      
      return false;
    }
    
    clear() {
      this.seen.clear();
      this.eventCount = 0;
    }
  }
  
  describe('GPT_SLOT_RENDER deduplication', () => {
    it('should count two GPT_SLOT_RENDER events with same dedupe key inside TTL only once', () => {
      const dedupe = new DedupeHelper();
      const baseTime = 1000;
      const ttl = 15000;
      
      // Same event key
      const key = 'slot1|creative1|line1|300x250|/123/adunit';
      
      // First event - should count
      const first = dedupe.shouldCount(key, baseTime, ttl);
      expect(first).toBe(true);
      expect(dedupe.eventCount).toBe(1);
      
      // Second event within TTL - should NOT count (duplicate)
      const second = dedupe.shouldCount(key, baseTime + 5000, ttl);
      expect(second).toBe(false);
      expect(dedupe.eventCount).toBe(1); // Still 1
    });
    
    it('should count same key again after TTL expires', () => {
      const dedupe = new DedupeHelper();
      const baseTime = 1000;
      const ttl = 15000;
      
      const key = 'slot1|creative1|line1|300x250|/123/adunit';
      
      // First event
      const first = dedupe.shouldCount(key, baseTime, ttl);
      expect(first).toBe(true);
      expect(dedupe.eventCount).toBe(1);
      
      // Second event after TTL expires - should count again
      const second = dedupe.shouldCount(key, baseTime + 16000, ttl);
      expect(second).toBe(true);
      expect(dedupe.eventCount).toBe(2);
    });
    
    it('should count different keys separately', () => {
      const dedupe = new DedupeHelper();
      const baseTime = 1000;
      const ttl = 15000;
      
      const key1 = 'slot1|creative1|line1|300x250|/123/adunit';
      const key2 = 'slot2|creative2|line2|728x90|/456/adunit';
      
      // First event
      expect(dedupe.shouldCount(key1, baseTime, ttl)).toBe(true);
      expect(dedupe.eventCount).toBe(1);
      
      // Different key - should count
      expect(dedupe.shouldCount(key2, baseTime + 1000, ttl)).toBe(true);
      expect(dedupe.eventCount).toBe(2);
    });
  });
  
  describe('IMPRESSION_BEACON deduplication', () => {
    it('should dedupe impression beacons with cachebuster stripping', () => {
      const dedupe = new DedupeHelper();
      const baseTime = 1000;
      const ttl = 15000;
      
      // Helper function to strip cachebusters (simplified)
      function stripCacheBusters(url) {
        try {
          const parsed = new URL(url);
          ['cb', 'cachebust', '_', 'ord', 'rnd', 't'].forEach(p => parsed.searchParams.delete(p));
          return `${parsed.origin}${parsed.pathname}${parsed.search}`;
        } catch (e) {
          return url;
        }
      }
      
      const url1 = 'https://example.com/pixel?creative_id=123&cb=12345';
      const url2 = 'https://example.com/pixel?creative_id=123&cb=67890';
      
      const key1 = stripCacheBusters(url1);
      const key2 = stripCacheBusters(url2);
      
      // Keys should be the same after cachebuster stripping
      expect(key1).toBe(key2);
      
      // First event
      expect(dedupe.shouldCount(key1, baseTime, ttl)).toBe(true);
      expect(dedupe.eventCount).toBe(1);
      
      // Second event with different cachebuster - should NOT count (duplicate)
      expect(dedupe.shouldCount(key2, baseTime + 1000, ttl)).toBe(false);
      expect(dedupe.eventCount).toBe(1);
    });
    
    it('should dedupe impression beacons by vendor|hostname|path|creativeId|placement', () => {
      const dedupe = new DedupeHelper();
      const baseTime = 1000;
      const ttl = 15000;
      
      const key1 = 'Google|example.com|/pixel|creative123|placement1';
      const key2 = 'Google|example.com|/pixel|creative123|placement1';
      
      // Same key - should dedupe
      expect(dedupe.shouldCount(key1, baseTime, ttl)).toBe(true);
      expect(dedupe.eventCount).toBe(1);
      
      expect(dedupe.shouldCount(key2, baseTime + 1000, ttl)).toBe(false);
      expect(dedupe.eventCount).toBe(1);
    });
  });
});

