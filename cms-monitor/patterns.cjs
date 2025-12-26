/**
 * CMS Monitor - Detection Patterns
 * Centralized patterns for tag detection, ID normalization, and partner identification
 */

// Measurement ID Patterns
const GA4_PATTERN = /G-[A-Z0-9]{10}/gi;
const UA_PATTERN = /UA-\d{8,10}-\d{1,2}/gi;
const GTM_PATTERN = /GTM-[A-Z0-9]{4,10}/gi;
const GOOGLE_ADS_PATTERN = /AW-\d{6,}/gi;
const FB_PIXEL_PATTERN = /fbq\(['"]init['"],\s*['"]?(\d{8,18})/gi;
const FB_PIXEL_URL_PATTERN = /facebook\.com\/tr\?[^"'\\s]*[?&]id=(\d{8,18})/gi;

// Common vendor domains
const VENDOR_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googleadservices.com',
  'doubleclick.net',
  'googlesyndication.com',
  'facebook.com',
  'connect.facebook.net',
  'amazon-adsystem.com',
  'pubmatic.com',
  'criteo.com',
  'rubiconproject.com',
  'rubiconproject.net',
  'moatads.com',
  'moat.com',
  'doubleverify.com',
  'integralads.com',
  'adsafeprotected.com',
  'outbrain.com',
  'taboola.com',
  'quantserve.com',
  'scorecardresearch.com'
];

// Macro patterns (unauthorized macros in URLs)
const MACRO_PATTERNS = [
  /%%[\w_]+%%/g,           // %%PATTERN%%
  /\{[\w_]+\}/g,            // {macro}
  /\$\{[\w_]+\}/g,          // ${macro}
  /\{\{[\w_]+\}\}/g,        // {{macro}}
  /\[\[[\w_]+\]\]/g,        // [[macro]]
  /%[\w_]+%/g               // %macro%
];

// Widget/module attribute patterns for attribution
const WIDGET_ATTRIBUTES = [
  'data-widget',
  'data-module',
  'data-component',
  'data-template',
  'data-cms',
  'data-slot',
  'id',
  'class'
];

// Suspicious query parameter patterns
const SUSPICIOUS_PARAMS = [
  'redirect',
  'redirect_uri',
  'callback',
  'return',
  'next',
  'goto',
  'url',
  'link',
  'dest',
  'destination'
];

/**
 * Normalize measurement IDs
 */
function normalizeMeasurementId(id, type) {
  if (!id) return null;
  
  const upper = id.toUpperCase();
  
  switch (type) {
    case 'ga4':
      return /^G-[A-Z0-9]{10}$/.test(upper) ? upper : null;
    case 'ua':
      return /^UA-\d{8,10}-\d{1,2}$/.test(upper) ? upper : null;
    case 'gtm':
      return /^GTM-[A-Z0-9]{4,10}$/.test(upper) ? upper : null;
    case 'aw':
      return /^AW-\d{6,}$/.test(upper) ? upper : null;
    case 'fb':
      return /^\d{8,18}$/.test(id) ? id : null;
    default:
      return null;
  }
}

/**
 * Extract measurement IDs from text
 */
function extractMeasurementIds(text) {
  const ids = {
    ga4: new Set(),
    ua: new Set(),
    gtm: new Set(),
    aw: new Set(),
    fb: new Set()
  };
  
  if (!text) return ids;
  
  // GA4
  const ga4Matches = text.match(GA4_PATTERN);
  if (ga4Matches) {
    ga4Matches.forEach(id => {
      const normalized = normalizeMeasurementId(id, 'ga4');
      if (normalized) ids.ga4.add(normalized);
    });
  }
  
  // UA
  const uaMatches = text.match(UA_PATTERN);
  if (uaMatches) {
    uaMatches.forEach(id => {
      const normalized = normalizeMeasurementId(id, 'ua');
      if (normalized) ids.ua.add(normalized);
    });
  }
  
  // GTM
  const gtmMatches = text.match(GTM_PATTERN);
  if (gtmMatches) {
    gtmMatches.forEach(id => {
      const normalized = normalizeMeasurementId(id, 'gtm');
      if (normalized) ids.gtm.add(normalized);
    });
  }
  
  // Google Ads
  const awMatches = text.match(GOOGLE_ADS_PATTERN);
  if (awMatches) {
    awMatches.forEach(id => {
      const normalized = normalizeMeasurementId(id, 'aw');
      if (normalized) ids.aw.add(normalized);
    });
  }
  
  // Facebook Pixel
  let fbMatch;
  while ((fbMatch = FB_PIXEL_PATTERN.exec(text)) !== null) {
    const normalized = normalizeMeasurementId(fbMatch[1], 'fb');
    if (normalized) ids.fb.add(normalized);
  }
  
  // Reset regex
  FB_PIXEL_PATTERN.lastIndex = 0;
  
  // Facebook Pixel URL
  while ((fbMatch = FB_PIXEL_URL_PATTERN.exec(text)) !== null) {
    const normalized = normalizeMeasurementId(fbMatch[1], 'fb');
    if (normalized) ids.fb.add(normalized);
  }
  
  FB_PIXEL_URL_PATTERN.lastIndex = 0;
  
  return ids;
}

/**
 * Detect macros in URL or text
 */
function detectMacros(text) {
  if (!text) return [];
  
  const found = [];
  MACRO_PATTERNS.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  });
  
  return [...new Set(found)];
}

/**
 * Check if domain is a known vendor
 */
function isVendorDomain(domain) {
  if (!domain) return false;
  const lower = domain.toLowerCase().replace(/^www\./, '');
  return VENDOR_DOMAINS.some(vendor => lower.includes(vendor));
}

/**
 * Check if query params contain suspicious patterns
 */
function hasSuspiciousParams(url) {
  try {
    const parsed = new URL(url);
    return SUSPICIOUS_PARAMS.some(param => parsed.searchParams.has(param));
  } catch (e) {
    return false;
  }
}

/**
 * Generate hash for inline script content
 */
function hashContent(content) {
  // Simple hash function (for deterministic hashing)
  let hash = 0;
  const str = String(content).substring(0, 10000); // Limit size
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

module.exports = {
  normalizeMeasurementId,
  extractMeasurementIds,
  detectMacros,
  isVendorDomain,
  hasSuspiciousParams,
  hashContent,
  WIDGET_ATTRIBUTES,
  VENDOR_DOMAINS,
  MACRO_PATTERNS
};

