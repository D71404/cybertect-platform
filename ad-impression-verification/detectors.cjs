/**
 * Beacon Detection Module
 * Identifies impression, click, and viewability beacons from network requests
 * 
 * Event Taxonomy:
 * - TAG_LIBRARY: Script loads (gpt.js, pubads_impl.js, prebid.js, etc.) - Diagnostic only
 * - ID_SYNC: Identity/cookie sync pixels - Diagnostic only (excluded from verified impressions)
 * - AD_REQUEST: Ad server requests (/bid, /auction, openrtb, etc.) - Diagnostic only
 * - GAM_AD_REQUEST: Google Ad Manager ad requests (/gampad/ads) - Diagnostic, can correlate to verified impressions
 * - IMPRESSION_BEACON: Verified impression pixels/beacons - Billable (if mapped to slot render)
 * - GPT_SLOT_RENDER: GPT slotRenderEnded events (served ads) - Billable
 * - GPT_VIEWABLE: GPT impressionViewable events - Billable (viewability metric)
 * - CLICK_REDIRECT: User-click-correlated click redirects - Billable
 * - OTHER: Unclassified requests - Diagnostic only
 * 
 * IMPROVEMENTS:
 * - CLICK_REDIRECT classification now works with document resourceType (navigations)
 *   in addition to xhr/image/etc. Only scripts are excluded.
 */

const crypto = require('crypto');

// Runtime fingerprint: confirms new classification logic is loaded
console.log("✅ Cybertect AIV: detectors.cjs v2 loaded");

/**
 * Classify a network request into event types using ordered rules
 * SINGLE SOURCE OF TRUTH: This is the ONLY place where event.type is assigned for network requests.
 * @param {Object} req - Request object with { url, hostname, path, method, resourceType, initiatorType?, headers? }
 * @returns {Object|null} - { type: string, vendor: string, confidence: number } or null if not a beacon
 */
function classifyRequest(req) {
  const { url, hostname, path, method, resourceType: rawResourceType } = req;
  
  if (!url || typeof url !== 'string') return null;
  
  // Default resourceType to "other" if missing/undefined/null
  // This ensures scripts are still caught even if resourceType is not provided
  const resourceType = rawResourceType || 'other';
  
  const lowerUrl = url.toLowerCase();
  const lowerPath = path ? path.toLowerCase() : '';
  const lowerHostname = hostname ? hostname.toLowerCase() : '';
  
  // CRITICAL: Rule 1 - Force scripts to TAG_LIBRARY (FIRST CHECK, BEFORE ANYTHING ELSE)
  // Scripts MUST NEVER become CLICK_REDIRECT, IMPRESSION_BEACON, or AD_REQUEST
  // This prevents gpt.js, pubads_impl.js, teads tag.js from being misclassified
  if (resourceType === 'script') {
    return {
      type: 'TAG_LIBRARY',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.95
    };
  }
  
  // Rule 2: TAG_LIBRARY patterns (URL-based detection for non-script resources)
  // Check URL patterns matching known tag libraries
  // Note: Scripts are already handled above, so this is for non-script resources matching tag library URLs
  const tagLibraryPatterns = [
    /\/tag\/js\/gpt\.js/i,
    /\/tag\/js\/gpt_mobile\.js/i,
    /pubads_impl\.js/i,
    /googletagservices\.com\/tag\/js\/gpt\.js/i,
    /teads\.tv\/analytics\/tag\.js/i,
    /static\.teads\.tv\/analytics\/tag\.js/i,
    /prebid\.js/i,
    /prebid\.min\.js/i,
    /amazon-adsystem\.com\/aax2\/apstag\.js/i,
    /\/gpt\.js/i,
    /\/pubads_impl/i,
    /\/prebid/i,
    /\/apstag\.js/i
  ];
  
  if (tagLibraryPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath))) {
    return {
      type: 'TAG_LIBRARY',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.95
    };
  }
  
  // Rule 3: ID_SYNC (identity/cookie sync pixels - higher priority than IMPRESSION_BEACON)
  // Detect cookie sync traffic and exclude from verified impressions
  // Never classify resourceType === "script" as ID_SYNC (keep TAG_LIBRARY)
  const idSyncPatterns = [
    /\/sync\.php/i,
    /idsync/i,
    /setuid/i,
    /\/cm\//i,
    /cm\.g\.doubleclick\.net\/pixel/i,
    /pixel\.rubiconproject\.com\/.*sync/i,
    /pixel\.tapad\.com\/idsync/i,
    /ap\.lijit\.com\/pixel/i,
    /match\.adsrvr\.org/i,
    /bidswitch\.net\/.*sync/i,
    /criteo\.com\/.*sync/i
  ];
  
  // Known ad-tech domains that use sync patterns
  const knownAdTechDomains = [
    'doubleclick.net',
    'rubiconproject.com',
    'tapad.com',
    'lijit.com',
    'adsrvr.org',
    'bidswitch.net',
    'criteo.com',
    'pubmatic.com',
    'openx.com'
  ];
  
  // Check for sync patterns combined with known ad-tech domains
  const hasSyncKeyword = /match|cookie|usersync|syncing/i.test(lowerUrl);
  const isKnownAdTechDomain = knownAdTechDomains.some(domain => lowerHostname.includes(domain));
  
  if (idSyncPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath)) ||
      (hasSyncKeyword && isKnownAdTechDomain)) {
    return {
      type: 'ID_SYNC',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.9
    };
  }
  
  // Rule 4: CLICK_REDIRECT (must not be script, but can be document/xhr/image/etc.)
  // URL contains adurl=, path includes /click, /clk, /redirect
  // Note: Click redirects can appear as document navigations (resourceType="document")
  // or as network requests (xhr/image/etc.), so we only exclude scripts
  const clickRedirectPatterns = [
    /adurl=/i,
    /\/click/i,
    /\/clk/i,
    /\/redirect/i,
    /\/adclick/i
  ];
  
  if (clickRedirectPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath))) {
    return {
      type: 'CLICK_REDIRECT',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.85
    };
  }
  
  // Rule 5: GAM_AD_REQUEST (Google Ad Manager ad requests - can correlate to verified impressions)
  // Patterns: /gampad/ads, securepubads.../gampad/
  const gamAdRequestPatterns = [
    /\/gampad\/ads/i,
    /securepubads.*\/gampad\//i
  ];
  
  if (gamAdRequestPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath))) {
    return {
      type: 'GAM_AD_REQUEST',
      vendor: 'Google',
      confidence: 0.85
    };
  }
  
  // Rule 6: IMPRESSION_BEACON (must be image/xhr/fetch/beacon/ping, never script - already handled above)
  // Path includes /imp, /impression, /pixel, /view, /event, /beacon, /ping
  const impressionBeaconPatterns = [
    /\/imp[^a-z]/i,
    /\/impression/i,
    /\/pixel/i,
    /\/view[^a-z]/i,
    /\/event/i,
    /\/beacon/i,
    /\/ping/i
  ];
  
  const validImpressionResourceTypes = ['image', 'xhr', 'fetch', 'beacon', 'ping'];
  // Exclude ID_SYNC patterns from IMPRESSION_BEACON (ID_SYNC already checked above)
  const isIdSync = idSyncPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath)) ||
                   (hasSyncKeyword && isKnownAdTechDomain);
  
  if (!isIdSync && validImpressionResourceTypes.includes(resourceType) &&
      impressionBeaconPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath))) {
    return {
      type: 'IMPRESSION_BEACON',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.8
    };
  }
  
  // Rule 7: AD_REQUEST (must not be script - already handled above, and not GAM_AD_REQUEST)
  // Patterns like /pagead/, /bid, /auction, openrtb (excluding /gampad/ads which is GAM_AD_REQUEST)
  const adRequestPatterns = [
    /\/pagead\//i,
    /\/bid/i,
    /\/auction/i,
    /openrtb/i,
    /adsystem\.com/i
  ];
  
  // Exclude GAM patterns (already handled as GAM_AD_REQUEST)
  const isGamRequest = gamAdRequestPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath));
  
  if (!isGamRequest && adRequestPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(lowerPath))) {
    return {
      type: 'AD_REQUEST',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.7
    };
  }
  
  // Rule 6: OTHER (default fallback for unclassified requests)
  // Only return if it's a GET request to an ad domain (low confidence)
  const adDomains = [
    'doubleclick.net',
    'googlesyndication.com',
    'amazon-adsystem.com',
    'pubmatic.com',
    'criteo.com',
    'rubiconproject.com',
    'adsystem',
    'adserver',
    'adtech'
  ];
  
  if (method === 'GET' && adDomains.some(domain => lowerHostname.includes(domain))) {
    return {
      type: 'OTHER',
      vendor: extractVendor(lowerHostname, lowerUrl),
      confidence: 0.3
    };
  }
  
  // Return null for non-beacon requests (stylesheets, fonts, etc. that don't match any pattern)
  // Note: Scripts are already handled above and return TAG_LIBRARY
  return null;
}

/**
 * Detect beacon type from URL (legacy function - kept for backward compatibility)
 * @param {string} url - Request URL
 * @param {string} method - HTTP method
 * @returns {Object|null} - { type: 'impression'|'click'|'viewability', vendor: string, confidence: number }
 */
function detectBeaconType(url, method) {
  if (!url || typeof url !== 'string') return null;
  
  const lowerUrl = url.toLowerCase();
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  
  // Impression beacon patterns
  const impressionPatterns = [
    /impression/i,
    /imp/i,
    /view/i,
    /track/i,
    /gampad/i,
    /ads/i,
    /adserver/i,
    /pixel/i,
    /collect[?&]v=/i,
    /beacon/i,
    /adview/i,
    /adimp/i,
    /ad_impression/i,
    /impressionviewable/i
  ];
  
  // Click beacon patterns
  const clickPatterns = [
    /click/i,
    /clk/i,
    /redirect/i,
    /adclick/i,
    /ad_click/i,
    /clicks/i
  ];
  
  // Viewability beacon patterns (IAS, MOAT, DoubleVerify, etc.)
  const viewabilityPatterns = [
    /viewability/i,
    /ias\.com/i,
    /moatads\.com/i,
    /doubleverify\.com/i,
    /dv\.com/i,
    /viewable/i,
    /inview/i,
    /in_view/i,
    /viewabilitymeasurement/i,
    /vpaid/i,
    /omid/i
  ];
  
  // Check viewability first (most specific)
  if (viewabilityPatterns.some(pattern => pattern.test(lowerUrl) || pattern.test(hostname))) {
    return {
      type: 'viewability',
      vendor: extractVendor(hostname, lowerUrl),
      confidence: 0.9
    };
  }
  
  // Check click patterns
  if (clickPatterns.some(pattern => pattern.test(lowerUrl))) {
    return {
      type: 'click',
      vendor: extractVendor(hostname, lowerUrl),
      confidence: 0.8
    };
  }
  
  // Check impression patterns
  if (impressionPatterns.some(pattern => pattern.test(lowerUrl))) {
    return {
      type: 'impression',
      vendor: extractVendor(hostname, lowerUrl),
      confidence: 0.7
    };
  }
  
  // Default: if it's a GET request to an ad domain, likely an impression
  const adDomains = [
    'doubleclick.net',
    'googlesyndication.com',
    'amazon-adsystem.com',
    'pubmatic.com',
    'criteo.com',
    'rubiconproject.com',
    'adsystem',
    'adserver',
    'adtech'
  ];
  
  if (method === 'GET' && adDomains.some(domain => hostname.includes(domain))) {
    return {
      type: 'impression',
      vendor: extractVendor(hostname, lowerUrl),
      confidence: 0.5
    };
  }
  
  return null;
}

/**
 * Extract vendor name from URL/hostname
 * Infers vendor by hostname patterns (doubleclick/googleads/teads/facebook/etc.)
 */
function extractVendor(hostname, url) {
  const vendorMap = {
    'doubleclick': 'Google',
    'googlesyndication': 'Google',
    'google': 'Google',
    'googleads': 'Google',
    'googletagservices': 'Google',
    'securepubads': 'Google',
    'amazon-adsystem': 'Amazon',
    'pubmatic': 'PubMatic',
    'criteo': 'Criteo',
    'rubiconproject': 'Rubicon',
    'teads': 'Teads',
    'teads.tv': 'Teads',
    'ias.com': 'IAS',
    'moatads.com': 'MOAT',
    'doubleverify.com': 'DoubleVerify',
    'dv.com': 'DoubleVerify',
    'facebook.com': 'Facebook',
    'facebook.net': 'Facebook',
    'meta': 'Meta',
    'prebid': 'Prebid'
  };
  
  const lowerHostname = (hostname || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();
  
  for (const [key, vendor] of Object.entries(vendorMap)) {
    if (lowerHostname.includes(key) || lowerUrl.includes(key)) {
      return vendor;
    }
  }
  
  // Extract from hostname
  if (hostname) {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }
  }
  
  return 'Unknown';
}

/**
 * Extract identifiers from URL query params
 */
function extractIdentifiers(url) {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    
    return {
      creativeId: params.get('crid') || params.get('creative_id') || params.get('adid') || params.get('ad_id') || params.get('creativeId') || null,
      placement: params.get('placement') || params.get('placement_id') || params.get('slotname') || params.get('iu') || params.get('slot') || null,
      siteId: params.get('siteId') || params.get('site_id') || params.get('site') || null,
      lineItemId: params.get('line_item_id') || params.get('lineItemId') || params.get('li') || null,
      campaignId: params.get('campaign_id') || params.get('campaignId') || params.get('cid') || null
    };
  } catch (e) {
    return {
      creativeId: null,
      placement: null,
      siteId: null,
      lineItemId: null,
      campaignId: null
    };
  }
}

/**
 * Generate stable hash key from URL + context
 */
function generateStableKey(url, frameUrl, initiator) {
  const key = `${url}|${frameUrl || ''}|${initiator || ''}`;
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
}

/**
 * Process a network request and extract beacon information
 * @param {Object} request - Playwright request object
 * @param {string} frameUrl - Frame URL where request originated
 * @param {string} pageUrl - Main page URL
 * @returns {Object|null} - Beacon object or null if not a beacon
 */
/**
 * Process a network request and extract beacon information
 * SINGLE SOURCE OF TRUTH: This is the ONLY place where event.type is assigned for network requests.
 * All classification comes from classifyRequest() - no legacy mappings or transformations.
 * 
 * NOTE: Node.js requires server restart to load changed modules. If you see old classifications,
 * restart the server to ensure new code is executing.
 * 
 * @param {Object} request - Playwright request object
 * @param {string} frameUrl - Frame URL where request originated
 * @param {string} pageUrl - Main page URL
 * @returns {Object|null} - Beacon object or null if not a beacon
 */
function processBeacon(request, frameUrl, pageUrl) {
  const url = request.url();
  const method = request.method();
  // CRITICAL: Get resourceType from Playwright request - this is what prevents scripts from being misclassified
  const resourceType = request.resourceType() || 'other'; // Default to 'other' if missing
  
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const path = parsed.pathname;
    
    // SINGLE SOURCE OF TRUTH: Use classifyRequest() - this is the ONLY place event.type is assigned
    const classification = classifyRequest({
      url,
      hostname,
      path,
      method,
      resourceType, // Pass resourceType correctly - scripts will be forced to TAG_LIBRARY
      initiatorType: null // Can be added if needed
    });
    
    // Return null for non-beacon requests (stylesheets, fonts, etc. that don't match any pattern)
    // Note: Scripts that match tag library patterns will return TAG_LIBRARY, not null
    if (!classification) {
      return null;
    }
    
    const identifiers = extractIdentifiers(url);
    const stableKey = identifiers.creativeId || identifiers.placement || generateStableKey(url, frameUrl, resourceType);
    
    // Return event with type from classifyRequest() - NO TRANSFORMATIONS OR MAPPINGS
    return {
      ts: Date.now(),
      type: classification.type, // Direct assignment from classifyRequest() - no legacy mapping
      vendor: classification.vendor,
      creativeId: identifiers.creativeId || stableKey,
      placement: identifiers.placement || 'unknown',
      requestUrl: url,
      status: null, // Will be filled when response is received
      frameUrl: frameUrl || pageUrl,
      pageUrl: pageUrl,
      confidence: classification.confidence,
      identifiers: identifiers,
      resourceType: resourceType // Include resourceType for debugging
    };
  } catch (e) {
    // Invalid URL or other error
    return null;
  }
}

module.exports = {
  classifyRequest,
  detectBeaconType, // Legacy - kept for backward compatibility
  extractVendor,
  extractIdentifiers,
  generateStableKey,
  processBeacon
};

