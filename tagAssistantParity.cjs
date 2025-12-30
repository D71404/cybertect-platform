console.log("[TAG-PARITY] loaded");

const { chromium } = require('playwright');

// Regex patterns for ID extraction
// GA4 IDs: G- + 8-12 alphanumerics (validated later by context)
const GA4_REGEX = /\bG-[A-Z0-9]{8,12}\b/g;
const GTAG_CONFIG_REGEX = /gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]{8,12})['"]/gi;
const GA4_MEASUREMENT_KEY_REGEX = /['"]measurement_id['"]\s*:\s*['"](G-[A-Z0-9]{8,12})['"]/gi;
const GTM_REGEX = /\bGTM-[A-Z0-9]+\b/g;
const GOOGLE_ADS_REGEX = /\bAW-\d{6,}\b/g;
const FB_PIXEL_ID_REGEX = /facebook\.com\/tr\/?\?[^"'\\s]*[?&]id=(\d{8,20})/gi;
const FB_PIXEL_INIT_REGEX = /fbq\(['"]init['"],\s*['"]?(\d{8,18})/gi;

// Evidence collector (max 50 entries)
class EvidenceCollector {
  constructor(maxSize = 50) {
    this.evidence = [];
    this.maxSize = maxSize;
  }

  add(type, source, value, url = '', frame = '', ts = null) {
    if (this.evidence.length >= this.maxSize) return;
    this.evidence.push({
      type,
      source,
      value,
      url: url.substring(0, 200), // Limit URL length
      frame: frame.substring(0, 200),
      ts: ts || Date.now()
    });
  }

  getAll() {
    return this.evidence;
  }
}

// ID deduplication with confidence tracking
class IdTracker {
  constructor() {
    this.ids = new Map(); // id -> { confidence: 'HIGH'|'MEDIUM'|'LOW', sources: Set }
  }

  add(id, confidence, source) {
    if (!id) return;
    const existing = this.ids.get(id);
    if (!existing) {
      this.ids.set(id, { confidence, sources: new Set([source]) });
    } else {
      // Upgrade confidence if higher
      const confOrder = { LOW: 0, MEDIUM: 1, HIGH: 2 };
      if (confOrder[confidence] > confOrder[existing.confidence]) {
        existing.confidence = confidence;
      }
      existing.sources.add(source);
    }
  }

  getAll() {
    return Array.from(this.ids.keys());
  }

  getConfidence(id) {
    return this.ids.get(id)?.confidence || 'LOW';
  }
}

function extractGa4Configs(text) {
  if (!text) return [];
  const found = new Set();
  for (const match of text.matchAll(GTAG_CONFIG_REGEX)) {
    found.add(match[1].toUpperCase());
  }
  for (const match of text.matchAll(GA4_MEASUREMENT_KEY_REGEX)) {
    found.add(match[1].toUpperCase());
  }
  return Array.from(found);
}

// Consent banner handler
async function handleConsentBanner(page) {
  const consentKeywords = [
    'accept', 'agree', 'allow all', 'aceptar', 'estoy de acuerdo', 'ok',
    'i agree', 'accept all', 'allow cookies', 'accept cookies'
  ];

  try {
    // Try to find and click consent buttons
    const buttons = await page.$$('button, a, [role="button"]');
    for (const button of buttons) {
      try {
        const text = await button.textContent();
        if (!text) continue;
        const lowerText = text.toLowerCase().trim();
        if (consentKeywords.some(keyword => lowerText.includes(keyword))) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            await button.click();
            console.log(`[TagParity] Clicked consent button: ${text.substring(0, 50)}`);
            await page.waitForTimeout(1000); // Wait for consent to process
            return true;
          }
        }
      } catch (e) {
        // Continue to next button
      }
    }
  } catch (e) {
    // Consent handling failed, continue anyway
  }
  return false;
}

// Extract IDs from network requests
function extractIdsFromNetwork(request, evidence, ga4Tracker, gtmTracker, awTracker, fbTracker) {
  const url = request.url();
  const method = request.method();
  const lowerUrl = url.toLowerCase();
  const isGaEndpoint = lowerUrl.includes('google-analytics.com') || lowerUrl.includes('doubleclick.net');

  // GTM container detection
  if (lowerUrl.includes('googletagmanager.com/gtm.js')) {
    const gtmMatch = url.match(/id=(GTM-[A-Z0-9]+)/i);
    if (gtmMatch) {
      const id = gtmMatch[1].toUpperCase();
      gtmTracker.add(id, 'HIGH', 'network_gtm_js');
      evidence.add('gtm', 'network_gtm_js', id, url, '', Date.now());
    }
  }

  // GA4 via gtag/js
  if (lowerUrl.includes('googletagmanager.com/gtag/js') || lowerUrl.includes('google-analytics.com/gtag/js')) {
    const gaMatch = url.match(/id=(G-[A-Z0-9]{8,12})/i);
    if (gaMatch) {
      const id = gaMatch[1].toUpperCase();
      ga4Tracker.add(id, 'HIGH', 'network_gtag_js');
      evidence.add('ga4', 'network_gtag_js', id, url, '', Date.now());
    }
  }

  // Google Ads (AW-)
  if (lowerUrl.includes('aw-') || lowerUrl.includes('googleads')) {
    const awMatch = url.match(/AW-\d{6,}/i);
    if (awMatch) {
      const id = awMatch[0].toUpperCase();
      awTracker.add(id, 'HIGH', 'network_aw');
      evidence.add('aw', 'network_aw', id, url, '', Date.now());
    }
  }

  // Facebook pixel detection
  if (lowerUrl.includes('facebook.com/tr')) {
    const fbMatch = url.match(/[?&]id=(\d{8,20})/);
    if (fbMatch) {
      const id = fbMatch[1];
      fbTracker.add(id, 'HIGH', 'network_fb_tr');
      evidence.add('fb', 'network_fb_tr', id, url, '', Date.now());
    }
  }

  if (lowerUrl.includes('connect.facebook.net') && lowerUrl.includes('fbevents.js')) {
    // FB pixel might be initialized in the script, check POST body if available
    try {
      const postData = request.postData();
      if (postData) {
        const fbInitMatch = postData.match(/fbq\(['"]init['"],\s*['"]?(\d{8,18})/i);
        if (fbInitMatch) {
          const id = fbInitMatch[1];
          fbTracker.add(id, 'MEDIUM', 'network_fbevents_init');
          evidence.add('fb', 'network_fbevents_init', id, url, '', Date.now());
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // Check POST body for IDs
  if (method === 'POST' && isGaEndpoint) {
    try {
      const postData = request.postData();
      if (postData && postData.length < 10000) {
        // Extract GA4 IDs from POST body
        const ga4Matches = postData.match(GA4_REGEX);
        if (ga4Matches) {
          ga4Matches.forEach(id => {
            ga4Tracker.add(id.toUpperCase(), 'MEDIUM', 'network_post_body');
            evidence.add('ga4', 'network_post_body', id.toUpperCase(), url, '', Date.now());
          });
        }

        // Extract GTM IDs from POST body
        const gtmMatches = postData.match(GTM_REGEX);
        if (gtmMatches) {
          gtmMatches.forEach(id => {
            gtmTracker.add(id.toUpperCase(), 'MEDIUM', 'network_post_body');
            evidence.add('gtm', 'network_post_body', id.toUpperCase(), url, '', Date.now());
          });
        }

        // Extract AW IDs from POST body
        const awMatches = postData.match(GOOGLE_ADS_REGEX);
        if (awMatches) {
          awMatches.forEach(id => {
            awTracker.add(id.toUpperCase(), 'MEDIUM', 'network_post_body');
            evidence.add('aw', 'network_post_body', id.toUpperCase(), url, '', Date.now());
          });
        }
      }
    } catch (e) {
      // Ignore POST body parsing errors
    }
  }
}

// Extract IDs from runtime objects
async function extractIdsFromRuntime(page, frameUrl, evidence, ga4Tracker, gtmTracker, awTracker, fbTracker) {
  try {
    const runtimeData = await page.evaluate(() => {
      const result = {
        dataLayer: null,
        googleTagManager: null,
        scripts: []
      };

      // Check window.dataLayer
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        try {
          result.dataLayer = JSON.stringify(window.dataLayer).substring(0, 50000);
        } catch (e) {
          result.dataLayer = '[unable to stringify]';
        }
      }

      // Check window.google_tag_manager
      if (window.google_tag_manager) {
        try {
          const gtmKeys = Object.keys(window.google_tag_manager);
          result.googleTagManager = gtmKeys;
        } catch (e) {
          result.googleTagManager = [];
        }
      }

      // Get all script srcs after load
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      result.scripts = scripts.map(s => s.src).filter(Boolean);

      return result;
    });

    // Extract from dataLayer using explicit GA4 config contexts
    if (runtimeData.dataLayer) {
      const ga4Configs = extractGa4Configs(runtimeData.dataLayer);
      ga4Configs.forEach(id => {
        ga4Tracker.add(id, 'MEDIUM', 'runtime_datalayer_config');
        evidence.add('ga4', 'runtime_datalayer_config', id, frameUrl, frameUrl, Date.now());
      });

      const gtmMatches = runtimeData.dataLayer.match(GTM_REGEX);
      if (gtmMatches) {
        gtmMatches.forEach(id => {
          gtmTracker.add(id.toUpperCase(), 'MEDIUM', 'runtime_datalayer');
          evidence.add('gtm', 'runtime_datalayer', id.toUpperCase(), frameUrl, frameUrl, Date.now());
        });
      }

      const awMatches = runtimeData.dataLayer.match(GOOGLE_ADS_REGEX);
      if (awMatches) {
        awMatches.forEach(id => {
          awTracker.add(id.toUpperCase(), 'MEDIUM', 'runtime_datalayer');
          evidence.add('aw', 'runtime_datalayer', id.toUpperCase(), frameUrl, frameUrl, Date.now());
        });
      }
    }

    // Extract GTM container IDs from window.google_tag_manager
    if (runtimeData.googleTagManager && Array.isArray(runtimeData.googleTagManager)) {
      runtimeData.googleTagManager.forEach(key => {
        const gtmMatch = key.match(/^(GTM-[A-Z0-9]+)/i);
        if (gtmMatch) {
          const id = gtmMatch[1].toUpperCase();
          gtmTracker.add(id, 'MEDIUM', 'runtime_google_tag_manager');
          evidence.add('gtm', 'runtime_google_tag_manager', id, frameUrl, frameUrl, Date.now());
        }
      });
    }

    // Extract from script srcs
    runtimeData.scripts.forEach(src => {
      const isGtagJs = src.toLowerCase().includes('googletagmanager.com/gtag/js');
      const ga4Match = isGtagJs ? src.match(/id=(G-[A-Z0-9]{8,12})/i) : null;
      if (ga4Match) {
        const id = ga4Match[1].toUpperCase();
        ga4Tracker.add(id, 'MEDIUM', 'dom_script_src');
        evidence.add('ga4', 'dom_script_src', id, src, frameUrl, Date.now());
      }

      const gtmMatch = src.match(/id=(GTM-[A-Z0-9]+)/i);
      if (gtmMatch) {
        const id = gtmMatch[1].toUpperCase();
        gtmTracker.add(id, 'MEDIUM', 'dom_script_src');
        evidence.add('gtm', 'dom_script_src', id, src, frameUrl, Date.now());
      }

      const awMatch = src.match(/AW-\d{6,}/i);
      if (awMatch) {
        const id = awMatch[0].toUpperCase();
        awTracker.add(id, 'MEDIUM', 'dom_script_src');
        evidence.add('aw', 'dom_script_src', id, src, frameUrl, Date.now());
      }
    });

    // Extract FB pixel from inline scripts
    try {
      const inlineScripts = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script:not([src])'));
        return scripts.map(s => s.textContent || '').join('\n');
      });
      const fbMatches = inlineScripts.match(FB_PIXEL_INIT_REGEX);
      if (fbMatches) {
        fbMatches.forEach(match => {
          const idMatch = match.match(/(\d{8,18})/);
          if (idMatch) {
            const id = idMatch[1];
            fbTracker.add(id, 'MEDIUM', 'dom_inline_script');
            evidence.add('fb', 'dom_inline_script', id, frameUrl, frameUrl, Date.now());
          }
        });
      }
    } catch (e) {
      // Ignore
    }
  } catch (e) {
    console.error(`[TagParity] Error extracting from runtime: ${e.message}`);
  }
}

// Extract IDs from iframe
async function extractIdsFromFrame(frame, evidence, ga4Tracker, gtmTracker, awTracker, fbTracker) {
  try {
    const frameUrl = frame.url();
    if (!frameUrl || frameUrl === 'about:blank') return;

    // Extract from frame's DOM
    try {
      const framePage = frame;
      await extractIdsFromRuntime(framePage, frameUrl, evidence, ga4Tracker, gtmTracker, awTracker, fbTracker);
    } catch (e) {
      // Frame might not be accessible, continue
    }
  } catch (e) {
    // Ignore frame errors
  }
}

// Generate risk flags
function generateFlags(ga4Ids, gtmIds, awIds, fbIds, hasBeacons) {
  const flags = [];

  if (ga4Ids.length >= 2) {
    flags.push('MULTIPLE_GA4');
  }

  if (gtmIds.length >= 2) {
    flags.push('MULTIPLE_GTM');
  }

  if (ga4Ids.length > 0 && gtmIds.length > 0) {
    flags.push('GA4_AND_GTM');
  }

  if ((ga4Ids.length > 0 || gtmIds.length > 0 || awIds.length > 0 || fbIds.length > 0) && !hasBeacons) {
    flags.push('TAGS_PRESENT_NO_BEACONS');
  }

  return flags;
}

// Main detection function
async function runTagParityDetection(page) {
  const evidence = new EvidenceCollector(50);
  const ga4Tracker = new IdTracker();
  const gtmTracker = new IdTracker();
  const awTracker = new IdTracker();
  const fbTracker = new IdTracker();

  let hasBeacons = false;
  const networkRequests = [];

  // Set up network interception (one-time listener)
  const requestHandler = request => {
    const url = request.url().toLowerCase();
    networkRequests.push({ url, timestamp: Date.now() });

    // Track beacon requests
    if (url.includes('google-analytics.com/g/collect') ||
        url.includes('google-analytics.com/collect') ||
        url.includes('facebook.com/tr')) {
      hasBeacons = true;
    }

    extractIdsFromNetwork(request, evidence, ga4Tracker, gtmTracker, awTracker, fbTracker);
  };

  page.on('request', requestHandler);

  // Wait for network to settle (page should already be navigated)
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch (e) {
    // Timeout is OK, continue
  }

  // Handle consent banner
  const consentClicked = await handleConsentBanner(page);
  if (consentClicked) {
    await page.waitForTimeout(2000);
  }

  // Extract from main frame runtime
  await extractIdsFromRuntime(page, page.url(), evidence, ga4Tracker, gtmTracker, awTracker, fbTracker);

  // Extract from all frames
  const frames = page.frames();
  for (const frame of frames) {
    await extractIdsFromFrame(frame, evidence, ga4Tracker, gtmTracker, awTracker, fbTracker);
  }

  // Final observation window (2 seconds)
  await page.waitForTimeout(2000);

  // Re-check runtime after observation window
  await extractIdsFromRuntime(page, page.url(), evidence, ga4Tracker, gtmTracker, awTracker, fbTracker);

  // Get deduplicated IDs
  const ga4Ids = ga4Tracker.getAll();
  const gtmIds = gtmTracker.getAll();
  const awIds = awTracker.getAll();
  const fbIds = fbTracker.getAll();

  // Generate flags
  const flags = generateFlags(ga4Ids, gtmIds, awIds, fbIds, hasBeacons);

  // Add confidence to each ID
  const ga4WithConfidence = ga4Ids.map(id => ({
    id,
    confidence: ga4Tracker.getConfidence(id)
  }));

  const gtmWithConfidence = gtmIds.map(id => ({
    id,
    confidence: gtmTracker.getConfidence(id)
  }));

  const awWithConfidence = awIds.map(id => ({
    id,
    confidence: awTracker.getConfidence(id)
  }));

  const fbWithConfidence = fbIds.map(id => ({
    id,
    confidence: fbTracker.getConfidence(id)
  }));

  return {
    ga4_ids: ga4Ids,
    gtm_containers: gtmIds,
    gads_aw_ids: awIds,
    fb_pixel_ids: fbIds,
    evidence: evidence.getAll(),
    flags,
    // Detailed info with confidence
    _detailed: {
      ga4: ga4WithConfidence,
      gtm: gtmWithConfidence,
      aw: awWithConfidence,
      fb: fbWithConfidence
    }
  };
}

module.exports = { runTagParityDetection };

