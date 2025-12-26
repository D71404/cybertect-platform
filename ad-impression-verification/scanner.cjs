/**
 * Ad Impression Verification Scanner
 * Main scanning logic using Playwright
 * 
 * IMPROVEMENTS IMPLEMENTED:
 * - Deduplication: Prevents counting duplicate GPT_SLOT_RENDER and IMPRESSION_BEACON events
 *   due to refresh/retries/SPA rerenders within 15s TTL window
 * - Navigation capture: Captures click redirects as document navigations via framenavigated events
 * - Broad click tracking: Tracks ALL clicks (not just ad elements) with ring buffer and context tagging
 * - Metrics split: servedImpressions (GPT_SLOT_RENDER), verifiedImpressions (IMPRESSION_BEACON), totalImpressions
 * - GPT_SLOT_RENDER serves as "served proxy" - indicates ad was served but can fire multiple times
 * - ID_SYNC detection: Excludes cookie-sync pixels from verified impressions
 * - Verified impression correlation: Requires GAM_AD_REQUEST -> GPT_SLOT_RENDER correlation or slot identifiers
 * - Ad stacking detection: Detects overlapping/hidden ad iframes with screenshots
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { processBeacon, classifyRequest } = require('./detectors.cjs');
const { generateViewabilityScript } = require('./viewability.cjs');

/**
 * Deduplication Helper
 * Prevents counting duplicate GPT_SLOT_RENDER and IMPRESSION_BEACON events
 * due to refresh/retries/SPA rerenders within a short time window.
 * 
 * GPT_SLOT_RENDER serves as a "served proxy" - it indicates an ad was served,
 * but can fire multiple times for the same ad due to page refreshes or SPA navigation.
 * Deduplication ensures we count each unique ad serve only once per time window.
 */
const DEDUPE_TTL_MS = 15000; // 15 seconds - configurable for future tuning
const DEDUPE_PRUNE_THRESHOLD = 1000; // Prune when map exceeds this size
const DEDUPE_PRUNE_INTERVAL = 100; // Prune every N events

class DedupeHelper {
  constructor() {
    this.seen = new Map(); // key -> last-seen timestamp (ms)
    this.eventCount = 0;
  }
  
  /**
   * Check if an event should be counted (not a duplicate within TTL)
   * @param {string} key - Deduplication key
   * @param {number} now - Current timestamp (ms)
   * @param {number} ttlMs - Time-to-live in milliseconds
   * @returns {boolean} - true if should count, false if duplicate
   */
  shouldCount(key, now, ttlMs = DEDUPE_TTL_MS) {
    const lastSeen = this.seen.get(key);
    
    if (lastSeen === undefined) {
      // First time seeing this key
      this.seen.set(key, now);
      this.eventCount++;
      this._maybePrune(now, ttlMs);
      return true;
    }
    
    const age = now - lastSeen;
    if (age >= ttlMs) {
      // Expired - count again
      this.seen.set(key, now);
      this.eventCount++;
      this._maybePrune(now, ttlMs);
      return true;
    }
    
    // Within TTL - duplicate, don't count
    return false;
  }
  
  /**
   * Prune expired entries
   * @param {number} now - Current timestamp (ms)
   * @param {number} maxAgeMs - Maximum age before pruning
   */
  prune(now, maxAgeMs = DEDUPE_TTL_MS) {
    let pruned = 0;
    for (const [key, timestamp] of this.seen.entries()) {
      if (now - timestamp >= maxAgeMs) {
        this.seen.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
  
  /**
   * Auto-prune if needed (when map size exceeds threshold or every N events)
   */
  _maybePrune(now, ttlMs) {
    if (this.seen.size > DEDUPE_PRUNE_THRESHOLD || this.eventCount % DEDUPE_PRUNE_INTERVAL === 0) {
      this.prune(now, ttlMs);
    }
  }
  
  /**
   * Clear all entries
   */
  clear() {
    this.seen.clear();
    this.eventCount = 0;
  }
  
  /**
   * Get current map size
   */
  size() {
    return this.seen.size;
  }
}

/**
 * Generate dedupe key for GPT_SLOT_RENDER event
 * Format: slotId|creativeId|lineItemId|sizesNormalized|adUnitPath
 */
function generateGPTDedupeKey(event) {
  const parts = [
    event.slotId || '',
    event.creativeId || '',
    event.lineItemId || '',
    (event.sizes || '').replace(/\s+/g, '').toLowerCase(), // Normalize sizes
    event.adUnitPath || ''
  ];
  return parts.join('|');
}

/**
 * Generate dedupe key for IMPRESSION_BEACON event
 * Format: vendor|hostname|path|creativeId(optional)|placement(optional)
 * OR: urlWithoutCacheBusters if no IDs exist
 */
function generateImpressionDedupeKey(beacon) {
  try {
    const url = new URL(beacon.requestUrl);
    const hostname = url.hostname;
    const pathname = url.pathname;
    
    // If we have creativeId or placement, use them for better deduplication
    if (beacon.creativeId || beacon.placement) {
      const parts = [
        beacon.vendor || 'Unknown',
        hostname,
        pathname,
        beacon.creativeId || '',
        beacon.placement || ''
      ];
      return parts.join('|');
    }
    
    // Otherwise, use URL without cachebusters
    return stripCacheBusters(beacon.requestUrl);
  } catch (e) {
    // Fallback to full URL without cachebusters
    return stripCacheBusters(beacon.requestUrl);
  }
}

/**
 * Strip common cachebuster parameters from URL
 * Removes: cb, cachebust, _, ord, rnd, t, timestamp, etc.
 */
function stripCacheBusters(url) {
  try {
    const parsed = new URL(url);
    const cachebusterParams = ['cb', 'cachebust', '_', 'ord', 'rnd', 't', 'timestamp', 'nocache', 'r'];
    
    cachebusterParams.forEach(param => {
      parsed.searchParams.delete(param);
    });
    
    // Return normalized URL
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (e) {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Parse viewability rule string (e.g., "50%/1s" -> { percent: 50, duration: 1000 })
 */
function parseViewabilityRule(ruleString) {
  const match = ruleString.match(/(\d+)%\/(\d+)s/);
  if (match) {
    return {
      percent: parseInt(match[1]),
      duration: parseInt(match[2]) * 1000
    };
  }
  // Default
  return { percent: 50, duration: 1000 };
}

/**
 * Slot Timeline Tracker
 * Tracks GAM_AD_REQUEST -> GPT_SLOT_RENDER correlations for verified impression calculation
 */
class SlotTimelineTracker {
  constructor() {
    this.slotRenders = new Map(); // slotId/adUnitPath -> [{ts, slotId, adUnitPath, creativeId, lineItemId, isEmpty}]
    this.gamRequests = new Map(); // slotId/adUnitPath -> [{ts, url, slotInfo}]
    this.correlationWindow = 5000; // 5 seconds
  }
  
  /**
   * Record a GPT_SLOT_RENDER event
   */
  recordSlotRender(event) {
    const key = event.slotId || event.adUnitPath || 'unknown';
    if (!this.slotRenders.has(key)) {
      this.slotRenders.set(key, []);
    }
    this.slotRenders.get(key).push({
      ts: event.ts || event.timestamp || Date.now(),
      slotId: event.slotId,
      adUnitPath: event.adUnitPath,
      creativeId: event.creativeId,
      lineItemId: event.lineItemId,
      isEmpty: event.isEmpty
    });
  }
  
  /**
   * Record a GAM_AD_REQUEST event
   */
  recordGamRequest(event) {
    // Try to extract slot info from URL or event data
    const slotId = event.slotId || extractSlotFromUrl(event.requestUrl) || 'unknown';
    const key = slotId;
    if (!this.gamRequests.has(key)) {
      this.gamRequests.set(key, []);
    }
    this.gamRequests.get(key).push({
      ts: event.ts || event.timestamp || Date.now(),
      url: event.requestUrl,
      slotInfo: { slotId, adUnitPath: event.adUnitPath }
    });
  }
  
  /**
   * Check if a GAM_AD_REQUEST can be correlated to a non-empty GPT_SLOT_RENDER
   */
  canCorrelateGamRequest(gamRequest) {
    const slotId = gamRequest.slotId || extractSlotFromUrl(gamRequest.requestUrl) || 'unknown';
    const renders = this.slotRenders.get(slotId) || [];
    const gamTs = gamRequest.ts || gamRequest.timestamp || Date.now();
    
    // Check if there's a non-empty slot render within correlation window
    return renders.some(render => {
      if (render.isEmpty) return false;
      const timeDiff = render.ts - gamTs;
      return timeDiff >= 0 && timeDiff <= this.correlationWindow;
    });
  }
  
  /**
   * Check if an IMPRESSION_BEACON can be mapped to a slot render
   */
  canMapToSlotRender(beacon) {
    if (!beacon.creativeId && !beacon.lineItemId) return false;
    
    // Search all slot renders for matching creativeId or lineItemId
    for (const renders of this.slotRenders.values()) {
      const match = renders.find(render => 
        !render.isEmpty && (
          (beacon.creativeId && render.creativeId === beacon.creativeId) ||
          (beacon.lineItemId && render.lineItemId === beacon.lineItemId)
        )
      );
      if (match) return true;
    }
    return false;
  }
}

/**
 * Extract slot identifier from GAM URL
 */
function extractSlotFromUrl(url) {
  try {
    const parsed = new URL(url);
    // Common patterns: slot=, slot_id=, adslot=
    const slot = parsed.searchParams.get('slot') || 
                 parsed.searchParams.get('slot_id') || 
                 parsed.searchParams.get('adslot');
    return slot || null;
  } catch (e) {
    return null;
  }
}

/**
 * Ad Stacking Detector
 * Detects overlapping/hidden ad iframes
 */
const STACK_OVERLAP_THRESHOLD = 0.30; // 30% overlap ratio
const MIN_AREA_FOR_OVERLAP = 2000; // 2000 px² minimum area

class AdStackingDetector {
  constructor() {
    this.findings = [];
  }
  
  /**
   * Detect ad stacking on a page
   * @param {Page} page - Playwright page object
   * @param {string} evidenceDir - Directory to save screenshots
   * @returns {Promise<Object>} - Findings object
   */
  async detectAdStacking(page, evidenceDir) {
    const findings = {
      stackedPairsCount: 0,
      hiddenIframesCount: 0,
      tinyIframesCount: 0,
      offscreenIframesCount: 0,
      findings: []
    };
    
    try {
      // Enumerate likely ad iframes
      const adIframes = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const candidates = [];
        
        iframes.forEach((iframe, index) => {
          try {
            const id = iframe.id || '';
            const className = iframe.className || '';
            const src = iframe.src || '';
            
            // Filter to ad candidates
            const isAdCandidate = 
              id.toLowerCase().includes('ad') ||
              id.toLowerCase().includes('ads') ||
              id.toLowerCase().includes('google_ads_iframe') ||
              id.toLowerCase().includes('gpt') ||
              id.toLowerCase().includes('dfp') ||
              id.toLowerCase().includes('div-gpt-ad') ||
              className.toLowerCase().includes('ad') ||
              className.toLowerCase().includes('teads') ||
              className.toLowerCase().includes('outbrain') ||
              className.toLowerCase().includes('taboola') ||
              src.includes('doubleclick') ||
              src.includes('googlesyndication') ||
              src.includes('googleadservices') ||
              src.includes('teads') ||
              src.includes('outbrain') ||
              src.includes('taboola');
            
            if (isAdCandidate) {
              const rect = iframe.getBoundingClientRect();
              const computedStyle = window.getComputedStyle(iframe);
              
              candidates.push({
                index,
                id: id || `iframe-${index}`,
                className: className,
                src: src.substring(0, 100), // Truncate long URLs
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  left: rect.left
                },
                style: {
                  opacity: computedStyle.opacity,
                  display: computedStyle.display,
                  visibility: computedStyle.visibility,
                  zIndex: parseInt(computedStyle.zIndex) || 0
                },
                viewport: {
                  width: window.innerWidth,
                  height: window.innerHeight
                }
              });
            }
          } catch (e) {
            // Skip iframe if we can't access it
          }
        });
        
        return candidates;
      });
      
      // Analyze each iframe
      for (const iframe of adIframes) {
        const reasons = [];
        const rect = iframe.rect;
        const style = iframe.style;
        const viewport = iframe.viewport;
        const area = rect.width * rect.height;
        
        // Check visibility flags
        if (rect.width <= 2 || rect.height <= 2) {
          reasons.push('TINY');
          findings.tinyIframesCount++;
        }
        
        if (parseFloat(style.opacity) === 0) {
          reasons.push('HIDDEN_OPACITY');
          findings.hiddenIframesCount++;
        }
        
        if (style.display === 'none') {
          reasons.push('HIDDEN_DISPLAY');
          findings.hiddenIframesCount++;
        }
        
        if (style.visibility === 'hidden') {
          reasons.push('HIDDEN_VISIBILITY');
          findings.hiddenIframesCount++;
        }
        
        if (parseInt(style.zIndex) < 0) {
          reasons.push('NEGATIVE_ZINDEX');
        }
        
        // Check if offscreen
        if (rect.right < 0 || rect.bottom < 0 || 
            rect.left > viewport.width || rect.top > viewport.height) {
          reasons.push('OFFSCREEN');
          findings.offscreenIframesCount++;
        }
        
        // Take screenshot if flagged
        if (reasons.length > 0 && area > 0) {
          try {
            const screenshotPath = path.join(evidenceDir, `adstack_${iframe.id}_${reasons[0]}.png`);
            await page.screenshot({
              path: screenshotPath,
              clip: {
                x: Math.max(0, rect.x),
                y: Math.max(0, rect.y),
                width: Math.min(rect.width, viewport.width - Math.max(0, rect.x)),
                height: Math.min(rect.height, viewport.height - Math.max(0, rect.y))
              }
            });
            
            findings.findings.push({
              iframeId: iframe.id,
              reason: reasons.join('|'),
              rect: rect,
              screenshot: screenshotPath,
              src: iframe.src
            });
          } catch (e) {
            // Screenshot failed, but still record finding
            findings.findings.push({
              iframeId: iframe.id,
              reason: reasons.join('|'),
              rect: rect,
              screenshot: null,
              src: iframe.src,
              error: e.message
            });
          }
        }
      }
      
      // Check for overlaps
      for (let i = 0; i < adIframes.length; i++) {
        for (let j = i + 1; j < adIframes.length; j++) {
          const iframe1 = adIframes[i];
          const iframe2 = adIframes[j];
          const area1 = iframe1.rect.width * iframe1.rect.height;
          const area2 = iframe2.rect.width * iframe2.rect.height;
          
          // Only check overlaps for iframes with sufficient area
          if (area1 >= MIN_AREA_FOR_OVERLAP && area2 >= MIN_AREA_FOR_OVERLAP) {
            const overlapRatio = calculateOverlapRatio(iframe1.rect, iframe2.rect);
            if (overlapRatio >= STACK_OVERLAP_THRESHOLD) {
              findings.stackedPairsCount++;
              findings.findings.push({
                iframeId1: iframe1.id,
                iframeId2: iframe2.id,
                reason: 'OVERLAP',
                overlapRatio: Math.round(overlapRatio * 100) / 100,
                rect1: iframe1.rect,
                rect2: iframe2.rect
              });
            }
          }
        }
      }
      
    } catch (e) {
      console.error('Error detecting ad stacking:', e);
    }
    
    return findings;
  }
}

/**
 * Calculate overlap ratio between two rectangles
 * Returns: intersection area / smaller area
 */
function calculateOverlapRatio(rect1, rect2) {
  const left = Math.max(rect1.left, rect2.left);
  const right = Math.min(rect1.right, rect2.right);
  const top = Math.max(rect1.top, rect2.top);
  const bottom = Math.min(rect1.bottom, rect2.bottom);
  
  if (left >= right || top >= bottom) {
    return 0; // No overlap
  }
  
  const intersectionArea = (right - left) * (bottom - top);
  const area1 = rect1.width * rect1.height;
  const area2 = rect2.width * rect2.height;
  const smallerArea = Math.min(area1, area2);
  
  return smallerArea > 0 ? intersectionArea / smallerArea : 0;
}

/**
 * Parse delivery totals from CSV or JSON
 */
function parseDeliveryTotals(input) {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim();
  
  // Try JSON first
  try {
    const json = JSON.parse(trimmed);
    return {
      adserverImps: json.adserverImps || json.adserver_imps || 0,
      dspImps: json.dspImps || json.dsp_imps || 0,
      clicks: json.clicks || 0
    };
  } catch (e) {
    // Not JSON, try CSV
    const lines = trimmed.split('\n');
    if (lines.length > 1) {
      // Assume header row
      const header = lines[0].toLowerCase();
      const data = lines[1];
      
      const adserverIdx = header.split(',').findIndex(h => h.includes('adserver'));
      const dspIdx = header.split(',').findIndex(h => h.includes('dsp'));
      const clicksIdx = header.split(',').findIndex(h => h.includes('click'));
      
      const values = data.split(',');
      
      return {
        adserverImps: adserverIdx >= 0 ? parseInt(values[adserverIdx]) || 0 : 0,
        dspImps: dspIdx >= 0 ? parseInt(values[dspIdx]) || 0 : 0,
        clicks: clicksIdx >= 0 ? parseInt(values[clicksIdx]) || 0 : 0
      };
    }
  }
  
  return null;
}

/**
 * Main scan function
 */
async function scanAdImpressions(options) {
  const {
    url,
    viewabilityRule = '50%/1s',
    discrepancyThreshold = 10,
    deliveryTotals = null,
    campaignLabel = null
  } = options;
  
  const runId = `run_${Date.now()}`;
  const viewabilityConfig = parseViewabilityRule(viewabilityRule);
  const delivery = parseDeliveryTotals(deliveryTotals);
  
  // Runtime fingerprint: confirms new classification logic is being used
  console.log("✅ Cybertect AIV: using classifyRequest for all events");
  
  const sequences = [];
  const viewabilityEvents = [];
  const gptEvents = [];
  const userClicks = []; // Track all user clicks (ring buffer, last 20)
  const navigationEvents = []; // Track frame navigations for click redirects
  const networkRequests = [];
  const screenshots = [];
  
  // Initialize deduplication helpers
  const gptDedupe = new DedupeHelper();
  const impressionDedupe = new DedupeHelper();
  const viewableDedupe = new DedupeHelper(); // Optional dedupe for GPT_VIEWABLE
  
  // Initialize slot timeline tracker for verified impression correlation
  const slotTracker = new SlotTimelineTracker();
  
  // Initialize ad stacking detector
  const adStackingDetector = new AdStackingDetector();
  
  let browser;
  let page;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext();
    page = await context.newPage();
    
    // Set up HAR recording
    await context.route('**/*', route => {
      networkRequests.push({
        url: route.request().url(),
        method: route.request().method(),
        timestamp: Date.now()
      });
      route.continue();
    });
    
    // Collect viewability events from console
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[CYBERTECT_VIEWABILITY]')) {
        try {
          const jsonStr = text.replace('[CYBERTECT_VIEWABILITY]', '').trim();
          const event = JSON.parse(jsonStr);
          viewabilityEvents.push({
            ...event,
            timestamp: event.timestamp || Date.now()
          });
        } catch (e) {
          // Ignore parse errors
        }
      }
      // Collect GPT events (slotRenderEnded, impressionViewable)
      if (text.includes('[CYBERTECT_GPT_EVENT]')) {
        try {
          const jsonStr = text.replace('[CYBERTECT_GPT_EVENT]', '').trim();
          const event = JSON.parse(jsonStr);
          gptEvents.push({
            ...event,
            timestamp: event.timestamp || Date.now()
          });
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    
    // Track ALL user clicks (not just ad elements) using ring buffer
    // Ring buffer: keep last 20 clicks
    const MAX_CLICKS = 20;
    
    // Expose function for click tracking from page context
    await page.exposeFunction('__cybertectClick', (clickData) => {
      const now = Date.now();
      userClicks.push({
        timestamp: now,
        x: clickData.x,
        y: clickData.y,
        tagName: clickData.tagName,
        id: clickData.id,
        className: clickData.className,
        href: clickData.href,
        context: clickData.context // 'ad-likely' | 'unknown'
      });
      
      // Maintain ring buffer (keep last MAX_CLICKS)
      if (userClicks.length > MAX_CLICKS) {
        userClicks.shift();
      }
    });
    
    // Inject document-level click listener
    await page.addInitScript({
      content: `
        (function() {
          'use strict';
          
          document.addEventListener('click', function(event) {
            try {
              const target = event.target;
              if (!target) return;
              
              // Determine context (ad-likely or unknown)
              let context = 'unknown';
              
              // Check if click is on an ad element
              if (target.tagName === 'IFRAME') {
                context = 'ad-likely';
              } else if (target.id && target.id.toLowerCase().includes('ad')) {
                context = 'ad-likely';
              } else if (target.className && typeof target.className === 'string' && target.className.toLowerCase().includes('ad')) {
                context = 'ad-likely';
              } else if (target.getAttribute && (target.getAttribute('data-ad') || target.getAttribute('data-slot'))) {
                context = 'ad-likely';
              } else {
                // Check if element is within an ad container
                const parent = target.closest('[id*="ad"], [class*="ad"], [data-ad], [data-slot]');
                if (parent) {
                  context = 'ad-likely';
                }
              }
              
              // Find closest anchor href
              let href = null;
              const anchor = target.closest('a');
              if (anchor && anchor.href) {
                href = anchor.href;
              }
              
              // Send click data to parent
              if (window.__cybertectClick) {
                window.__cybertectClick({
                  x: event.clientX,
                  y: event.clientY,
                  tagName: target.tagName,
                  id: target.id || '',
                  className: target.className || '',
                  href: href,
                  context: context
                });
              }
            } catch (e) {
              // Ignore errors
            }
          }, true); // Use capture phase
        })();
      `
    });
    
    // Inject viewability measurement script (before page load)
    await page.addInitScript({
      content: generateViewabilityScript(viewabilityConfig)
    });
    
    // Track network requests for beacons
    // Note: Do NOT exclude resourceType === "document" for click detection
    page.on('request', request => {
      const frame = request.frame();
      const frameUrl = frame ? frame.url() : null;
      const beacon = processBeacon(request, frameUrl, url);
      
      if (beacon) {
        const now = Date.now();
        
        // Apply deduplication for IMPRESSION_BEACON
        if (beacon.type === 'IMPRESSION_BEACON') {
          const dedupeKey = generateImpressionDedupeKey(beacon);
          if (!impressionDedupe.shouldCount(dedupeKey, now)) {
            // Duplicate within TTL - skip adding to sequences
            return;
          }
        }
        
        // Track GAM_AD_REQUEST for slot correlation
        if (beacon.type === 'GAM_AD_REQUEST') {
          slotTracker.recordGamRequest({ ...beacon, ts: now });
        }
        
        // For CLICK_REDIRECT, check if there was a user click within 0-1500ms before
        if (beacon.type === 'CLICK_REDIRECT') {
          const clickTime = beacon.ts;
          const correlatedClick = userClicks.find(click => {
            const timeDiff = clickTime - click.timestamp;
            return timeDiff >= 0 && timeDiff <= 1500;
          });
          
          if (!correlatedClick) {
            // No user click correlation - mark as SUSPECT_CLICK
            beacon.type = 'SUSPECT_CLICK';
            beacon.confidence = 0.3;
          }
        }
        
        sequences.push({
          ...beacon,
          status: 'pending'
        });
      }
    });
    
    // Update status when response is received
    page.on('response', response => {
      const request = response.request();
      const frame = response.frame();
      const frameUrl = frame ? frame.url() : null;
      const beacon = processBeacon(request, frameUrl, url);
      
      if (beacon) {
        const existing = sequences.find(s => 
          s.requestUrl === beacon.requestUrl && Math.abs(s.ts - beacon.ts) < 100
        );
        
        if (existing) {
          existing.status = response.status();
        } else {
          const now = Date.now();
          
          // Track GAM_AD_REQUEST for slot correlation
          if (beacon.type === 'GAM_AD_REQUEST') {
            slotTracker.recordGamRequest({ ...beacon, ts: now });
          }
          
          // Apply deduplication for IMPRESSION_BEACON
          if (beacon.type === 'IMPRESSION_BEACON') {
            const dedupeKey = generateImpressionDedupeKey(beacon);
            if (!impressionDedupe.shouldCount(dedupeKey, now)) {
              // Duplicate within TTL - skip adding to sequences
              return;
            }
          }
          
          // For CLICK_REDIRECT, check correlation
          if (beacon.type === 'CLICK_REDIRECT') {
            const clickTime = beacon.ts;
            const correlatedClick = userClicks.find(click => {
              const timeDiff = clickTime - click.timestamp;
              return timeDiff >= 0 && timeDiff <= 1500;
            });
            
            if (!correlatedClick) {
              beacon.type = 'SUSPECT_CLICK';
              beacon.confidence = 0.3;
            }
          }
          
          sequences.push({
            ...beacon,
            status: response.status()
          });
        }
      }
    });
    
    // Track frame navigations for click redirects (document navigations)
    page.on('framenavigated', frame => {
      try {
        const frameUrl = frame.url();
        if (!frameUrl || frameUrl === 'about:blank') return;
        
        // Classify navigation URL to see if it's a click redirect
        const parsed = new URL(frameUrl);
        const classification = classifyRequest({
          url: frameUrl,
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'GET',
          resourceType: 'document' // Navigations are document type
        });
        
        if (classification && classification.type === 'CLICK_REDIRECT') {
          const now = Date.now();
          navigationEvents.push({
            url: frameUrl,
            timestamp: now,
            type: 'CLICK_REDIRECT',
            vendor: classification.vendor,
            confidence: classification.confidence
          });
          
          // Check for click correlation
          const correlatedClick = userClicks.find(click => {
            const timeDiff = now - click.timestamp;
            return timeDiff >= 0 && timeDiff <= 1500;
          });
          
          if (correlatedClick) {
            // Add as synthetic CLICK_REDIRECT event
            sequences.push({
              ts: now,
              type: 'CLICK_REDIRECT',
              vendor: classification.vendor,
              creativeId: null,
              placement: null,
              requestUrl: frameUrl,
              status: 200,
              frameUrl: frameUrl,
              pageUrl: url,
              confidence: classification.confidence,
              source: 'navigation'
            });
          } else {
            // No correlation - add as SUSPECT_CLICK
            sequences.push({
              ts: now,
              type: 'SUSPECT_CLICK',
              vendor: classification.vendor,
              creativeId: null,
              placement: null,
              requestUrl: frameUrl,
              status: 200,
              frameUrl: frameUrl,
              pageUrl: url,
              confidence: 0.3,
              source: 'navigation'
            });
          }
        }
      } catch (e) {
        // Ignore errors
      }
    });
    
    // Navigate to page
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait for initial load
    await page.waitForTimeout(3000);
    
    // Re-inject GPT hooks if GPT is available but not hooked yet
    try {
      const gptAvailable = await page.evaluate(() => {
        return typeof window.googletag !== 'undefined';
      });
      
      if (gptAvailable) {
        // Re-inject the script to ensure GPT hooks are attached
        const scriptContent = generateViewabilityScript(viewabilityConfig);
        await page.evaluate(scriptContent);
      }
    } catch (e) {
      // Ignore errors
    }
    
    // Take initial screenshot
    const screenshot1 = await page.screenshot({ 
      path: null, 
      fullPage: false 
    });
    screenshots.push({ name: 'initial_load.png', data: screenshot1 });
    
    // Scroll to trigger lazy-loaded ads
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let scrolls = 0;
        const maxScrolls = 10;
        const timer = setInterval(() => {
          window.scrollBy(0, 300);
          scrolls++;
          if (scrolls >= maxScrolls) {
            clearInterval(timer);
            resolve();
          }
        }, 500);
      });
    });
    
    await page.waitForTimeout(2000);
    
    // Take screenshot after scroll
    const screenshot2 = await page.screenshot({ 
      path: null, 
      fullPage: false 
    });
    screenshots.push({ name: 'after_scroll.png', data: screenshot2 });
    
    // Wait for viewability events to accumulate
    await page.waitForTimeout(viewabilityConfig.duration + 1000);
    
    // Take final screenshot
    const screenshot3 = await page.screenshot({ 
      path: null, 
      fullPage: true 
    });
    screenshots.push({ name: 'final_state.png', data: screenshot3 });
    
    // Add GPT events to sequences with deduplication and track for correlation
    const now = Date.now();
    gptEvents.forEach(gptEvent => {
      if (gptEvent.type === 'GPT_SLOT_RENDER') {
        // Track slot render for correlation
        slotTracker.recordSlotRender({
          ...gptEvent,
          ts: gptEvent.timestamp || now
        });
        
        // Only dedupe non-empty slot renders (empty slots are not impressions)
        if (!gptEvent.isEmpty) {
          const dedupeKey = generateGPTDedupeKey(gptEvent);
          if (!gptDedupe.shouldCount(dedupeKey, gptEvent.timestamp || now)) {
            // Duplicate within TTL - skip
            return;
          }
        }
      } else if (gptEvent.type === 'GPT_VIEWABLE') {
        // Optional dedupe for viewable events
        const viewableKey = `${gptEvent.slotId}|${gptEvent.creativeId || ''}|${gptEvent.lineItemId || ''}`;
        if (!viewableDedupe.shouldCount(viewableKey, gptEvent.timestamp || now)) {
          // Duplicate within TTL - skip
          return;
        }
      }
      
      sequences.push({
        ts: gptEvent.timestamp || now,
        type: gptEvent.type, // GPT_SLOT_RENDER or GPT_VIEWABLE
        vendor: 'Google',
        creativeId: gptEvent.creativeId || gptEvent.slotId,
        placement: gptEvent.placement || gptEvent.adUnitPath || gptEvent.slotId,
        requestUrl: 'gpt-event',
        status: 200,
        frameUrl: url,
        pageUrl: url,
        confidence: 1.0,
        slotId: gptEvent.slotId,
        adUnitPath: gptEvent.adUnitPath,
        lineItemId: gptEvent.lineItemId,
        sizes: gptEvent.sizes,
        isEmpty: gptEvent.isEmpty,
        percentInView: gptEvent.percentInView,
        duration: gptEvent.duration
      });
    });
    
    // Add fallback viewability events (when GPT not available)
    viewabilityEvents.forEach(viewEvent => {
      // Only add if it's not a GPT event (those are already added above)
      if (viewEvent.type === 'VIEWABILITY' && viewEvent.source === 'intersection') {
        sequences.push({
          ts: viewEvent.timestamp,
          type: 'VIEWABILITY',
          vendor: 'In-Page Measurement',
          creativeId: viewEvent.creativeId,
          placement: viewEvent.placement,
          requestUrl: 'in-page-measurement',
          status: 200,
          frameUrl: url,
          pageUrl: url,
          confidence: 0.8,
          percentInView: viewEvent.percentInView,
          duration: viewEvent.duration
        });
      }
    });
    
    // Sort sequences by timestamp
    sequences.sort((a, b) => a.ts - b.ts);
    
    // Calculate summary using new event taxonomy with deduplication applied
    const tagLibraryLoads = sequences.filter(s => s.type === 'TAG_LIBRARY');
    const idSyncEvents = sequences.filter(s => s.type === 'ID_SYNC');
    const adRequests = sequences.filter(s => s.type === 'AD_REQUEST');
    const gamAdRequests = sequences.filter(s => s.type === 'GAM_AD_REQUEST');
    const impressionBeacons = sequences.filter(s => s.type === 'IMPRESSION_BEACON'); // Already deduped
    const gptSlotRenders = sequences.filter(s => s.type === 'GPT_SLOT_RENDER' && !s.isEmpty); // Already deduped
    const gptViewable = sequences.filter(s => s.type === 'GPT_VIEWABLE'); // Already deduped
    const clickRedirects = sequences.filter(s => s.type === 'CLICK_REDIRECT'); // Only verified clicks
    const suspectClicks = sequences.filter(s => s.type === 'SUSPECT_CLICK');
    
    // Calculate verified impressions with strict correlation requirements
    // A) GPT_SLOT_RENDER (non-empty) counts as verified (served proof)
    const verifiedFromGPT = gptSlotRenders.length;
    
    // B) GAM_AD_REQUEST -> GPT_SLOT_RENDER correlation (within 5s)
    const verifiedFromGamCorrelation = gamAdRequests.filter(gamReq => {
      return slotTracker.canCorrelateGamRequest(gamReq);
    }).length;
    
    // C) IMPRESSION_BEACON mapped to slot render (must have creativeId/lineItemId)
    const verifiedFromBeacons = impressionBeacons.filter(beacon => {
      // Exclude ID_SYNC (already filtered above, but double-check)
      if (beacon.type === 'ID_SYNC') return false;
      // Must have identifiers and map to slot render
      return slotTracker.canMapToSlotRender(beacon);
    }).length;
    
    // Unattributed beacons (impression-like but no correlation)
    const unattributedBeacons = impressionBeacons.filter(beacon => {
      if (beacon.type === 'ID_SYNC') return false;
      return !slotTracker.canMapToSlotRender(beacon);
    }).length;
    
    // Split impressions metrics
    const servedImpressions = verifiedFromGPT; // GPT_SLOT_RENDER (non-empty, deduped) - "served proxy"
    const verifiedImpressions = verifiedFromGPT + verifiedFromGamCorrelation + verifiedFromBeacons; // Strict correlation required
    const totalImpressions = servedImpressions + verifiedFromBeacons; // Backward compatible (served + verified beacons)
    const viewableVerified = gptViewable.length; // GPT_VIEWABLE (deduped)
    const clicks = clickRedirects.length; // Only verified clicks
    
    // Group by creativeId/placement for flagging
    const byCreative = new Map();
    
    // Count impressions (beacons + GPT slot renders)
    [...impressionBeacons, ...gptSlotRenders].forEach(imp => {
      const key = imp.creativeId;
      if (!byCreative.has(key)) {
        byCreative.set(key, {
          creativeId: key,
          placement: imp.placement,
          impressions: 0,
          viewable: 0,
          clicks: 0
        });
      }
      byCreative.get(key).impressions++;
    });
    
    // Count viewable (GPT viewable events)
    gptViewable.forEach(v => {
      const key = v.creativeId;
      if (byCreative.has(key)) {
        byCreative.get(key).viewable++;
      }
    });
    
    // Count clicks (only verified click redirects)
    clickRedirects.forEach(c => {
      const key = c.creativeId;
      if (byCreative.has(key)) {
        byCreative.get(key).clicks++;
      }
    });
    
    // Calculate flags
    const flags = [];
    byCreative.forEach((stats, creativeId) => {
      // Only calculate discrepancy if we have viewability data
      if (stats.impressions > 0 && stats.viewable > 0) {
        const discrepancy = ((stats.impressions - stats.viewable) / stats.impressions) * 100;
        
        if (discrepancy > discrepancyThreshold) {
          flags.push({
            creativeId: stats.creativeId,
            placement: stats.placement,
            impressions: stats.impressions,
            viewable: stats.viewable,
            discrepancy: Math.round(discrepancy * 100) / 100,
            message: `Viewability gap: ${Math.round(discrepancy)}% (${stats.viewable}/${stats.impressions} verified)`
          });
        }
      }
    });
    
    // Reconcile against delivery totals
    let reconciliation = null;
    if (delivery) {
      const verifiedViewabilityRate = totalImpressions > 0 && viewableVerified > 0
        ? (viewableVerified / totalImpressions) * 100 
        : null;
      
      const discrepancyVsAdserver = delivery.adserverImps > 0
        ? ((delivery.adserverImps - totalImpressions) / delivery.adserverImps) * 100
        : null;
      
      const discrepancyVsDSP = delivery.dspImps > 0
        ? ((delivery.dspImps - totalImpressions) / delivery.dspImps) * 100
        : null;
      
      reconciliation = {
        verifiedViewabilityRate: verifiedViewabilityRate !== null ? Math.round(verifiedViewabilityRate * 100) / 100 : null,
        discrepancyVsAdserver: discrepancyVsAdserver !== null ? Math.round(discrepancyVsAdserver * 100) / 100 : null,
        discrepancyVsDSP: discrepancyVsDSP !== null ? Math.round(discrepancyVsDSP * 100) / 100 : null,
        detectedImpressions: totalImpressions,
        adserverImpressions: delivery.adserverImps,
        dspImpressions: delivery.dspImps,
        detectedClicks: clicks,
        reportedClicks: delivery.clicks
      };
    }
    
    // Calculate discrepancy (only if we have viewability data)
    let discrepancyPercent = null;
    if (totalImpressions > 0 && viewableVerified > 0) {
      discrepancyPercent = Math.round(((totalImpressions - viewableVerified) / totalImpressions) * 100 * 100) / 100;
    }
    
    // Save run data directory first
    const runDir = path.join(__dirname, '..', 'runs', 'ad-impression-verification', runId);
    fs.mkdirSync(runDir, { recursive: true });
    
    // Detect ad stacking before closing browser
    const evidenceDir = path.join(runDir, 'screenshots');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const adStackingFindings = await adStackingDetector.detectAdStacking(page, evidenceDir);
    
    const summary = {
      totalImpressions: totalImpressions, // Backward compatible
      servedImpressions: servedImpressions, // GPT_SLOT_RENDER (deduped)
      verifiedImpressions: verifiedImpressions, // Strict correlation required
      viewableImpressions: viewableVerified,
      clicks: clicks,
      discrepancyPercent: discrepancyPercent, // null if no viewability data
      sequencesCount: sequences.length,
      flagsCount: flags.length,
      diagnostic: {
        tagLibraryLoads: tagLibraryLoads.length,
        idSyncCount: idSyncEvents.length,
        adRequests: adRequests.length,
        gamAdRequests: gamAdRequests.length,
        unattributedBeacons: unattributedBeacons,
        totalEvents: sequences.length,
        suspectClicks: suspectClicks.length
      },
      adStackingFindings: {
        stackedPairsCount: adStackingFindings.stackedPairsCount,
        hiddenIframesCount: adStackingFindings.hiddenIframesCount,
        tinyIframesCount: adStackingFindings.tinyIframesCount,
        offscreenIframesCount: adStackingFindings.offscreenIframesCount,
        findingsCount: adStackingFindings.findings.length
      }
    };
    
    // Save ad stacking report
    fs.writeFileSync(
      path.join(runDir, 'adstack_report.json'),
      JSON.stringify(adStackingFindings, null, 2)
    );
    
    const runData = {
      runId,
      url,
      campaignLabel,
      viewabilityRule,
      discrepancyThreshold,
      scanTimestamp: new Date().toISOString(),
      summary,
      sequences,
      flags,
      reconciliation,
      deliveryTotals: delivery,
      adStackingFindings: adStackingFindings
    };
    
    fs.writeFileSync(
      path.join(runDir, 'summary.json'),
      JSON.stringify(runData, null, 2)
    );
    
    fs.writeFileSync(
      path.join(runDir, 'sequences.json'),
      JSON.stringify(sequences, null, 2)
    );
    
    fs.writeFileSync(
      path.join(runDir, 'flags.json'),
      JSON.stringify(flags, null, 2)
    );
    
    // Save screenshots
    screenshots.forEach((screenshot, idx) => {
      fs.writeFileSync(
        path.join(runDir, screenshot.name),
        screenshot.data
      );
    });
    
    // Save network requests as HAR-like format
    fs.writeFileSync(
      path.join(runDir, 'network.json'),
      JSON.stringify(networkRequests, null, 2)
    );
    
    return runData;
    
  } catch (error) {
    console.error('Scan error:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  scanAdImpressions,
  parseViewabilityRule,
  parseDeliveryTotals
};

