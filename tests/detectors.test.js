/**
 * Unit tests for ad impression verification detectors
 * Tests the new classifyRequest() function and event taxonomy
 */

const { classifyRequest } = require('../ad-impression-verification/detectors.cjs');

describe('classifyRequest', () => {
  describe('TAG_LIBRARY classification', () => {
    it('should classify gpt.js script as TAG_LIBRARY (not click/impression)', () => {
      const result = classifyRequest({
        url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
        hostname: 'securepubads.g.doubleclick.net',
        path: '/tag/js/gpt.js',
        method: 'GET',
        resourceType: 'script'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
      expect(result.type).not.toBe('CLICK_REDIRECT');
      expect(result.type).not.toBe('IMPRESSION_BEACON');
      expect(result.vendor).toBe('Google');
      expect(result.confidence).toBeGreaterThan(0.9);
    });
    
    it('should classify pubads_impl.js as TAG_LIBRARY', () => {
      const result = classifyRequest({
        url: 'https://example.com/pubads_impl.js',
        hostname: 'example.com',
        path: '/pubads_impl.js',
        method: 'GET',
        resourceType: 'script'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
    });
    
    it('should classify teads tag.js as TAG_LIBRARY', () => {
      const result = classifyRequest({
        url: 'https://static.teads.tv/analytics/tag.js',
        hostname: 'static.teads.tv',
        path: '/analytics/tag.js',
        method: 'GET',
        resourceType: 'script'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
      expect(result.vendor).toBe('Teads');
    });
  });
  
  describe('ID_SYNC classification', () => {
    it('should classify cm.g.doubleclick.net/pixel as ID_SYNC', () => {
      const result = classifyRequest({
        url: 'https://cm.g.doubleclick.net/pixel?google_nid=123',
        hostname: 'cm.g.doubleclick.net',
        path: '/pixel',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('ID_SYNC');
      expect(result.vendor).toBe('Google');
    });
    
    it('should classify pixel.rubiconproject.com/sync.php as ID_SYNC', () => {
      const result = classifyRequest({
        url: 'https://pixel.rubiconproject.com/sync.php?r=123',
        hostname: 'pixel.rubiconproject.com',
        path: '/sync.php',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('ID_SYNC');
      expect(result.vendor).toBe('Rubicon');
    });
    
    it('should classify URLs with idsync pattern as ID_SYNC', () => {
      const result = classifyRequest({
        url: 'https://pixel.tapad.com/idsync?r=123',
        hostname: 'pixel.tapad.com',
        path: '/idsync',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('ID_SYNC');
    });
    
    it('should NOT classify script resourceType as ID_SYNC (must be TAG_LIBRARY)', () => {
      const result = classifyRequest({
        url: 'https://cm.g.doubleclick.net/pixel?google_nid=123',
        hostname: 'cm.g.doubleclick.net',
        path: '/pixel',
        method: 'GET',
        resourceType: 'script'
      });
      
      // Should be TAG_LIBRARY because resourceType is script
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
      expect(result.type).not.toBe('ID_SYNC');
    });
    
    it('should NOT classify normal impression beacon as ID_SYNC', () => {
      const result = classifyRequest({
        url: 'https://example.com/track/imp?creative_id=123',
        hostname: 'example.com',
        path: '/track/imp',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('IMPRESSION_BEACON');
      expect(result.type).not.toBe('ID_SYNC');
    });
  });
  
  describe('GAM_AD_REQUEST classification', () => {
    it('should classify /gampad/ads as GAM_AD_REQUEST', () => {
      const result = classifyRequest({
        url: 'https://securepubads.g.doubleclick.net/gampad/ads?iu=/123&sz=300x250',
        hostname: 'securepubads.g.doubleclick.net',
        path: '/gampad/ads',
        method: 'GET',
        resourceType: 'xhr'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('GAM_AD_REQUEST');
      expect(result.vendor).toBe('Google');
    });
  });
  
  describe('AD_REQUEST classification', () => {
    it('should classify /bid requests as AD_REQUEST (not GAM)', () => {
      const result = classifyRequest({
        url: 'https://example.com/bid?auction_id=123',
        hostname: 'example.com',
        path: '/bid',
        method: 'GET',
        resourceType: 'xhr'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('AD_REQUEST');
      expect(result.type).not.toBe('GAM_AD_REQUEST');
    });
    
    it('should not classify script resourceType as AD_REQUEST', () => {
      const result = classifyRequest({
        url: 'https://securepubads.g.doubleclick.net/gampad/ads',
        hostname: 'securepubads.g.doubleclick.net',
        path: '/gampad/ads',
        method: 'GET',
        resourceType: 'script'
      });
      
      // Should be TAG_LIBRARY because resourceType is script
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
    });
  });
  
  describe('IMPRESSION_BEACON classification', () => {
    it('should classify pixel URL with /imp and resourceType=image as IMPRESSION_BEACON', () => {
      const result = classifyRequest({
        url: 'https://example.com/track/imp?creative_id=123',
        hostname: 'example.com',
        path: '/track/imp',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('IMPRESSION_BEACON');
      expect(result.resourceType).toBeUndefined(); // Not included in result
    });
    
    it('should not classify script resourceType as IMPRESSION_BEACON', () => {
      const result = classifyRequest({
        url: 'https://example.com/track/imp',
        hostname: 'example.com',
        path: '/track/imp',
        method: 'GET',
        resourceType: 'script'
      });
      
      // Should be TAG_LIBRARY because resourceType is script
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
    });
    
    it('should classify /pixel endpoint as IMPRESSION_BEACON', () => {
      const result = classifyRequest({
        url: 'https://example.com/pixel?ad_id=456',
        hostname: 'example.com',
        path: '/pixel',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('IMPRESSION_BEACON');
    });
  });
  
  describe('CLICK_REDIRECT classification', () => {
    it('should classify click redirect with adurl= as CLICK_REDIRECT', () => {
      const result = classifyRequest({
        url: 'https://example.com/click?adurl=https://advertiser.com&creative_id=789',
        hostname: 'example.com',
        path: '/click',
        method: 'GET',
        resourceType: 'document'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('CLICK_REDIRECT');
    });
    
    it('should not classify script resourceType as CLICK_REDIRECT', () => {
      const result = classifyRequest({
        url: 'https://example.com/click?adurl=https://advertiser.com',
        hostname: 'example.com',
        path: '/click',
        method: 'GET',
        resourceType: 'script'
      });
      
      // Should be TAG_LIBRARY because resourceType is script
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
    });
    
    it('should classify /clk endpoint as CLICK_REDIRECT', () => {
      const result = classifyRequest({
        url: 'https://example.com/clk?redirect=1',
        hostname: 'example.com',
        path: '/clk',
        method: 'GET',
        resourceType: 'document'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('CLICK_REDIRECT');
    });
  });
  
  describe('Edge cases', () => {
    it('should return null for non-beacon requests', () => {
      const result = classifyRequest({
        url: 'https://example.com/style.css',
        hostname: 'example.com',
        path: '/style.css',
        method: 'GET',
        resourceType: 'stylesheet'
      });
      
      expect(result).toBeNull();
    });
    
    it('should handle invalid URL gracefully', () => {
      const result = classifyRequest({
        url: '',
        hostname: '',
        path: '',
        method: 'GET',
        resourceType: 'script'
      });
      
      // Should return null or handle gracefully
      expect(result === null || result.type === 'TAG_LIBRARY').toBe(true);
    });
  });
  
  describe('ResourceType edge cases', () => {
    it('gpt.js with resourceType=script must be TAG_LIBRARY (regression test)', () => {
      const result = classifyRequest({
        url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
        hostname: 'securepubads.g.doubleclick.net',
        path: '/tag/js/gpt.js',
        method: 'GET',
        resourceType: 'script'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
      expect(result.type).not.toBe('CLICK_REDIRECT');
      expect(result.type).not.toBe('IMPRESSION_BEACON');
      expect(result.type).not.toBe('AD_REQUEST');
    });
    
    it('Teads tag.js with resourceType=script must be TAG_LIBRARY (regression test)', () => {
      const result = classifyRequest({
        url: 'https://static.teads.tv/analytics/tag.js',
        hostname: 'static.teads.tv',
        path: '/analytics/tag.js',
        method: 'GET',
        resourceType: 'script'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('TAG_LIBRARY');
      expect(result.type).not.toBe('CLICK_REDIRECT');
      expect(result.type).not.toBe('IMPRESSION_BEACON');
      expect(result.type).not.toBe('AD_REQUEST');
    });
    
    it('gpt.js with resourceType=script never becomes CLICK_REDIRECT or IMPRESSION_BEACON (must be TAG_LIBRARY)', () => {
      // Even if URL has click/impression patterns, script resourceType should force TAG_LIBRARY
      const testCases = [
        {
          url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js?click=true',
          path: '/tag/js/gpt.js',
          description: 'gpt.js with click param'
        },
        {
          url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js?imp=true',
          path: '/tag/js/gpt.js',
          description: 'gpt.js with imp param'
        },
        {
          url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js?adurl=https://example.com',
          path: '/tag/js/gpt.js',
          description: 'gpt.js with adurl param'
        }
      ];
      
      testCases.forEach(testCase => {
        const result = classifyRequest({
          url: testCase.url,
          hostname: 'securepubads.g.doubleclick.net',
          path: testCase.path,
          method: 'GET',
          resourceType: 'script'
        });
        
        expect(result).not.toBeNull();
        expect(result.type).toBe('TAG_LIBRARY');
        expect(result.type).not.toBe('CLICK_REDIRECT');
        expect(result.type).not.toBe('IMPRESSION_BEACON');
      });
    });
    
    it('click redirect URL with resourceType=document is still CLICK_REDIRECT', () => {
      const result = classifyRequest({
        url: 'https://example.com/click?adurl=https://advertiser.com&creative_id=789',
        hostname: 'example.com',
        path: '/click',
        method: 'GET',
        resourceType: 'document' // Document navigations should still be classified
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('CLICK_REDIRECT');
      expect(result.vendor).toBeDefined();
    });
    
    it('click redirect URL with resourceType=xhr is CLICK_REDIRECT', () => {
      const result = classifyRequest({
        url: 'https://example.com/click?adurl=https://advertiser.com',
        hostname: 'example.com',
        path: '/click',
        method: 'GET',
        resourceType: 'xhr'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('CLICK_REDIRECT');
    });
    
    it('click redirect URL with resourceType=image is CLICK_REDIRECT', () => {
      const result = classifyRequest({
        url: 'https://example.com/click?adurl=https://advertiser.com',
        hostname: 'example.com',
        path: '/click',
        method: 'GET',
        resourceType: 'image'
      });
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('CLICK_REDIRECT');
    });
  });
});

