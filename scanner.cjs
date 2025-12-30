const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { runTagParityDetection } = require('./tagAssistantParity.cjs');
const { indexTelemetryFromScan } = require('./src/index-telemetry.cjs');

// Debug logging helper
function debugLog(location, message, data, hypothesisId) {
  try {
    const logPath = path.join(__dirname, '.cursor', 'debug.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logEntry = JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId
    }) + '\n';
    fs.appendFileSync(logPath, logEntry);
  } catch (e) {
    // Log to console as fallback
    console.error('[DebugLog Error]', e.message);
  }
}

const STAGE_A_MS = 12_000;
const STAGE_B_MS = 6_000;
const GA_ENDPOINTS = [
  'google-analytics.com/g/collect',
  'google-analytics.com/collect',
  'google-analytics.com/mp/collect',
  'stats.g.doubleclick.net/collect',
  'stats.g.doubleclick.net/g/collect'
];
const TAG_ENDPOINT_HOSTS = [
  'google-analytics.com',
  'stats.g.doubleclick.net',
  'googletagmanager.com',
  'facebook.com',
  'connect.facebook.net'
];
const AD_HOST_PATTERNS = [
  'doubleclick.net',
  'googlesyndication.com',
  'amazon-adsystem.com',
  'pubmatic.com',
  'criteo.com',
  'rubiconproject.com',
  'rubiconproject.net',
  'rubiconproject'
];
const VIEWABILITY_KEYWORDS = [
  'view', 'viewable', 'in_view', 'inview', 'visible',
  'pct', 'percent', 'time_in_view', 'viewport'
];
const ID_REGEX = /(G-[A-Z0-9]{8,12}|UA-\d{8,10}-\d{1,2})/g;
const GA4_VALID_REGEX = /^G-[A-Z0-9]{8,12}$/;
const GA4_TOKEN_REGEX = /G-[A-Z0-9]{8,12}/gi;
const GTAG_CONFIG_REGEX = /gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]{8,12})['"]/gi;
const GTAG_JS_BOOTSTRAP_REGEX = /gtag\(\s*['"]js['"]\s*,\s*new Date\(\)\s*\)/i;
const GTM_REGEX = /(GTM-[A-Z0-9]{4,10})/gi;
const FBQ_REGEX = /fbq\(['"]init['"],\s*['"]?(\d{8,18})/gi;
const FB_PIXEL_URL_REGEX = /facebook\.com\/tr\?[^"'\\s]*[?&]id=(\d{8,18})/gi;

async function scanWebsite(url, onProgress) {
  const progressEmitter = createProgressEmitter(onProgress);
  const startTime = Date.now();

  const metrics = createEmptyMetrics();
  const measurementIds = new Set();
  const queryIds = new Set();
  const adImpressionQueryIds = new Set();
  const gaEvents = [];
  const contextEventCounts = new Map();
  const fraudWarnings = [];
  const advertisers = new Map();
  const tagInventory = {
    analyticsIds: new Set(),
    gtmContainers: new Set(),
    facebookPixels: new Set(),
    googleAdsIds: new Set()
  };
  const tagInventoryDetailed = {
    ga4: new Map(), // verified
    ga4_unverified: new Map(),
    ga4_false: new Map(),
    ua: new Map(),
    gtm: new Map(),
    aw: new Map(),
    fb: new Map()
  };
  const adHostCounts = new Map();
  const diagnostics = {
    topHostnames: [],
    tagEndpointSamples: [],
    gaHitSamples: [],
    notes: []
  };
  const warningSet = new Set();
  
  // Tag Assistant-style Hits Sent tracking
  const hitsById = {}; // { [tid]: { total: number, events: { [eventName]: number }, samples: [...] } }
  let currentNavigationStart = Date.now();
  const pageViewsPerNavigation = new Map(); // Track pageviews per navigation: { navigationId: { [tid]: count } }
  let navigationId = 0;

  let browser;
  let page;
  let currentStage = 'A';
  let isScannerScrolling = false;
  let screenshotPath;
  let stageADeltas = { adImpressions: 0 };
  let finalScore = 0;
  let signals = [];
  const networkRequests = []; // Track network requests for telemetry indexing

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext();
    page = await context.newPage();

    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        metrics.pageLoadCount += 1;
        // Start new navigation tracking
        navigationId += 1;
        currentNavigationStart = Date.now();
        pageViewsPerNavigation.set(navigationId, {});
        
        if (metrics.pageLoadCount > 1) {
          pushWarningOnce(warningSet, fraudWarnings, {
            type: 'Auto-Refresh / Inflation',
            details: 'Page reloaded itself without user interaction.',
            url: frame.url()
          });
        }
      }
    });

    page.on('request', async request => {
      const reqUrl = request.url();
      let host = '';
      try {
        host = new URL(reqUrl).hostname.replace(/^www\./, '');
      } catch (err) {
        host = '';
      }
      const lowerHost = host.toLowerCase();
      const lowerUrl = reqUrl.toLowerCase();

      // Track telemetry-related network requests for indexing
      if (isTagEndpoint(host, lowerUrl) || isGaEndpoint(reqUrl) || 
          lowerHost.includes('facebook.com') || lowerHost.includes('googletagmanager.com')) {
        if (networkRequests.length < 100) { // Limit to 100 requests
          networkRequests.push(reqUrl);
        }
      }

      if (host) {
        adHostCounts.set(host, (adHostCounts.get(host) || 0) + 1);
        if (AD_HOST_PATTERNS.some(pattern => lowerHost.endsWith(pattern) || lowerHost.includes(pattern))) {
          metrics.adRequestCount += 1;
          recordAdvertiserImpression(reqUrl, advertisers);
        }
      }

      if (lowerHost.includes('facebook.com') && reqUrl.includes('/tr')) {
        // #region agent log
        debugLog('scanner.cjs:122', 'Facebook pixel URL detected', { url: reqUrl.substring(0, 200) }, 'B');
        // #endregion
        const pixelMatch = reqUrl.match(/[?&]id=(\d{8,18})/);
        // #region agent log
        debugLog('scanner.cjs:124', 'Facebook pixel match result', { hasMatch: !!pixelMatch, pixelId: pixelMatch?.[1] || null }, 'B');
        // #endregion
        if (pixelMatch) {
          const result = addDetailedId(tagInventoryDetailed, tagInventory, 'fb', pixelMatch[1], 'network_collect');
          // #region agent log
          debugLog('scanner.cjs:125', 'addDetailedId result for FB', { result: result, rawId: pixelMatch[1] }, 'B');
          // #endregion
        }
      }

      if (lowerHost.includes('googletagmanager.com')) {
        const gtmMatch = reqUrl.match(/id=(GTM-[A-Z0-9]+)/i);
        if (gtmMatch) {
          // #region agent log
          debugLog('scanner.cjs:164', 'GTM match found', { gtmId: gtmMatch[1], url: reqUrl.substring(0, 200) }, 'E');
          // #endregion
          addDetailedId(tagInventoryDetailed, tagInventory, 'gtm', gtmMatch[1], 'network_script_src');
        }
        if (lowerUrl.includes('gtag/js')) {
          // Fix: Match exactly 10 characters after G- to match GA4 format
          const gaMatch = reqUrl.match(/id=(G-[A-Z0-9]{10})/i);
          // #region agent log
          debugLog('scanner.cjs:167', 'GA4 extraction attempt', { hasGtagJs: true, gaMatch: gaMatch?.[1] || null, url: reqUrl.substring(0, 200) }, 'E');
          // #endregion
          if (gaMatch) {
            const result = addDetailedId(tagInventoryDetailed, tagInventory, 'ga4', gaMatch[1], 'network_script_src');
            // #region agent log
            debugLog('scanner.cjs:170', 'GA4 addDetailedId result', { result: result, rawId: gaMatch[1] }, 'E');
            // #endregion
          }
        }
      }

      if (lowerUrl.includes('aw-')) {
        // #region agent log
        debugLog('scanner.cjs:136', 'AW tag URL detected', { url: reqUrl.substring(0, 200) }, 'C');
        // #endregion
        const awMatch = reqUrl.match(/AW-\d{6,}/i);
        // #region agent log
        debugLog('scanner.cjs:138', 'AW tag match result', { hasMatch: !!awMatch, awId: awMatch?.[0] || null }, 'C');
        // #endregion
        if (awMatch) {
          const result = addDetailedId(tagInventoryDetailed, tagInventory, 'aw', awMatch[0], 'network_collect');
          // #region agent log
          debugLog('scanner.cjs:139', 'addDetailedId result for AW', { result: result, rawId: awMatch[0] }, 'C');
          // #endregion
        }
      }

      if (lowerUrl.includes('scroll') && !isScannerScrolling) {
        pushWarningOnce(warningSet, fraudWarnings, {
          type: 'Phantom Scroll (Telemetry Fraud)',
          details: 'Scroll telemetry fired while scanner was idle.',
          url: reqUrl.substring(0, 120)
        });
      }

      if (isTagEndpoint(host, lowerUrl) && diagnostics.tagEndpointSamples.length < 50) {
        diagnostics.tagEndpointSamples.push({
          t: Date.now(),
          url: reqUrl.substring(0, 200),
          method: request.method()
        });
      }

      if (isGaEndpoint(reqUrl)) {
        // #region agent log
        debugLog('scanner.cjs:157', 'GA endpoint detected', { url: reqUrl.substring(0, 200) }, 'A');
        // #endregion
        const gaEvent = await parseGaHit(request);
        // #region agent log
        debugLog('scanner.cjs:159', 'GA event parsed', { hasEvent: !!gaEvent, tid: gaEvent?.tid || null }, 'A');
        // #endregion
        if (gaEvent) {
          processGaHit(gaEvent, {
            metrics,
            measurementIds,
            queryIds,
            adImpressionQueryIds,
            gaEvents,
            contextEventCounts,
            tagInventory,
            fraudWarnings,
            diagnostics,
            warningSet,
            tagInventoryDetailed,
            hitsById,
            navigationId,
            pageViewsPerNavigation
          });

          progressEmitter({
            stage: `${currentStage}_PROGRESS`,
            url,
            metrics: cloneMetrics(metrics),
            riskScore: finalScore,
            verdict: verdictFromScore(finalScore),
            signals,
            advertisers: mapAdvertisers(advertisers)
          });
        }
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    await collectDomTagInventory(page, tagInventory, tagInventoryDetailed);

    // Run Tag Assistant parity detection
    let tagParityResult = null;
    try {
      tagParityResult = await runTagParityDetection(page);
      console.log(`[Scanner] Tag Parity Detection: GA4=${tagParityResult.ga4_ids.length}, GTM=${tagParityResult.gtm_containers.length}, AW=${tagParityResult.gads_aw_ids.length}, FB=${tagParityResult.fb_pixel_ids.length}`);
      
      // Merge detected IDs into tagInventory
      const ga4FromParity = (tagParityResult._detailed && Array.isArray(tagParityResult._detailed.ga4) && tagParityResult._detailed.ga4.length)
        ? tagParityResult._detailed.ga4.map(entry => ({ id: entry.id, confidence: entry.confidence }))
        : tagParityResult.ga4_ids.map(id => ({ id, confidence: 'LOW' }));

      ga4FromParity.forEach(entry => {
        const normalized = addGa4Candidate(tagInventoryDetailed, tagInventory, entry.id, 'tag_parity', {
          context: entry.confidence === 'HIGH' ? 'tag_parity_network' : 'tag_parity_runtime',
          confidence: entry.confidence
        });
        if (normalized && getGa4Status(tagInventoryDetailed, normalized) === 'verified') {
          measurementIds.add(normalized);
        }
      });
      tagParityResult.gtm_containers.forEach(id => {
        addDetailedId(tagInventoryDetailed, tagInventory, 'gtm', id, 'tag_parity');
      });
      tagParityResult.gads_aw_ids.forEach(id => {
        addDetailedId(tagInventoryDetailed, tagInventory, 'aw', id, 'tag_parity');
      });
      tagParityResult.fb_pixel_ids.forEach(id => {
        addDetailedId(tagInventoryDetailed, tagInventory, 'fb', id, 'tag_parity');
      });

      // Add flags to fraud warnings if they indicate issues
      if (tagParityResult.flags.includes('MULTIPLE_GA4')) {
        pushWarningOnce(warningSet, fraudWarnings, {
          type: 'Multiple GA4 IDs Detected',
          details: `Found ${tagParityResult.ga4_ids.length} GA4 measurement IDs: ${tagParityResult.ga4_ids.join(', ')}`,
          url: 'tag-parity-detection',
          risk: 'Medium'
        });
      }
      if (tagParityResult.flags.includes('MULTIPLE_GTM')) {
        pushWarningOnce(warningSet, fraudWarnings, {
          type: 'Multiple GTM Containers Detected',
          details: `Found ${tagParityResult.gtm_containers.length} GTM containers: ${tagParityResult.gtm_containers.join(', ')}`,
          url: 'tag-parity-detection',
          risk: 'Medium'
        });
      }
      if (tagParityResult.flags.includes('TAGS_PRESENT_NO_BEACONS')) {
        pushWarningOnce(warningSet, fraudWarnings, {
          type: 'Tags Present But No Beacons',
          details: 'Analytics tags detected but no collect/tr hits observed. Possible consent blocking or tag misconfiguration.',
          url: 'tag-parity-detection',
          risk: 'Low'
        });
      }
    } catch (error) {
      console.error(`[Scanner] Tag Parity Detection failed: ${error.message}`);
    }

    await page.waitForTimeout(STAGE_A_MS);
    stageADeltas = { adImpressions: metrics.adImpressionCount };
    updateDerivedMetrics(metrics, measurementIds, queryIds, STAGE_A_MS / 1000, contextEventCounts);
    ({ score: finalScore, signals } = scoreSignals(metrics, [], hitsById));
    progressEmitter({
      stage: 'A_DONE',
      url,
      metrics: cloneMetrics(metrics),
      verdict: verdictFromScore(finalScore),
      riskScore: finalScore,
      signals,
      advertisers: mapAdvertisers(advertisers)
    }, true);

    if (finalScore >= 30) {
      currentStage = 'B';
      await performHalfScroll(page);
      await page.waitForTimeout(STAGE_B_MS);
      const delta = metrics.adImpressionCount - stageADeltas.adImpressions;
      updateDerivedMetrics(metrics, measurementIds, queryIds, (STAGE_A_MS + STAGE_B_MS) / 1000, contextEventCounts);
      ({ score: finalScore, signals } = scoreSignals(metrics, signals, hitsById));
      if (delta >= 3 && !metrics.hasViewabilityParams) {
        signals.push({
          id: 'post_scroll_burst',
          severity: 'med',
          detail: 'Ad impressions continued at high rate after scroll without viewability checks.'
        });
        finalScore = Math.min(100, finalScore + 10);
      }
      progressEmitter({
        stage: 'B_DONE',
        url,
        metrics: cloneMetrics(metrics),
        verdict: verdictFromScore(finalScore),
        riskScore: finalScore,
        signals,
        advertisers: mapAdvertisers(advertisers)
      }, true);
    }

    if (finalScore >= 60) {
      currentStage = 'C';
      isScannerScrolling = true;
      await autoScroll(page);
      isScannerScrolling = false;
      await analyzeFrames(page, fraudWarnings);
      screenshotPath = await takeScreenshot(page);
      await harvestStaticTags(page, tagInventory, tagInventoryDetailed);
      progressEmitter({
        stage: 'C_DONE',
        url,
        metrics: cloneMetrics(metrics),
        verdict: verdictFromScore(finalScore),
        riskScore: finalScore,
        signals,
        advertisers: mapAdvertisers(advertisers)
      }, true);
    }

    const observed = {
      stageASeconds: STAGE_A_MS / 1000
    };
    if (finalScore >= 30) observed.stageBSeconds = STAGE_B_MS / 1000;

    diagnostics.topHostnames = getTopHostnames(adHostCounts);

    const detailedOutput = formatDetailedInventory(tagInventoryDetailed);

    // Inflation detection: Multiple GA4 properties firing page_view
    // Requirement: "if multiple GA4 tids each send page_view at least once => issue 'Multiple GA4 properties firing page_view' and set risk at least Medium"
    const ga4TidsWithPageView = Object.keys(hitsById).filter(tid => {
      const info = classifyMeasurementId(tid);
      // Only check GA4 properties (not UA) and specifically for page_view events
      return info && info.type === 'ga4' && hitsById[tid].events['page_view'] > 0;
    });
    
    if (ga4TidsWithPageView.length > 1) {
      pushWarningOnce(warningSet, fraudWarnings, {
        type: 'Multiple GA4 properties firing page_view',
        details: `${ga4TidsWithPageView.length} GA4 measurement IDs each sent at least one page_view: ${ga4TidsWithPageView.join(', ')}`,
        url: 'google-analytics.com',
        risk: 'Medium'
      });
    }
    
    // Calculate total pageviews per navigation across all GA4 tids
    let pageviewsPerNavigationTotal = 0;
    for (const [navId, navPageViews] of pageViewsPerNavigation.entries()) {
      const navTotal = Object.values(navPageViews).reduce((sum, count) => sum + count, 0);
      pageviewsPerNavigationTotal = Math.max(pageviewsPerNavigationTotal, navTotal);
    }
    
    // If no pageviews detected but we have hits, calculate from hitsById
    if (pageviewsPerNavigationTotal === 0) {
      pageviewsPerNavigationTotal = Object.values(hitsById).reduce((sum, hitData) => {
        return sum + (hitData.events['page_view'] || 0) + (hitData.events['pageview'] || 0);
      }, 0);
    }
    
    // Update metrics.pageViewCount with computed value if it's higher
    if (pageviewsPerNavigationTotal > metrics.pageViewCount) {
      metrics.pageViewCount = pageviewsPerNavigationTotal;
    }
    
    // Ensure at least 1 pageview if analytics IDs are detected but no pageviews were counted
    // Check both measurementIds (from network) and tagInventory.analyticsIds (from DOM)
    const domAnalyticsCount = tagInventory && tagInventory.analyticsIds
      ? (typeof tagInventory.analyticsIds.size === 'number' ? tagInventory.analyticsIds.size : tagInventory.analyticsIds.length || 0)
      : 0;
    const hasAnalyticsIds = measurementIds.size > 0 || domAnalyticsCount > 0;
    
    if (metrics.pageViewCount === 0 && hasAnalyticsIds) {
      metrics.pageViewCount = 1;
      console.log(`[Scanner] Set default pageview count to 1 (analytics IDs detected: ${measurementIds.size} network, ${tagInventory?.analyticsIds?.length || 0} DOM)`);
    }

    // Update risk score if flags indicate issues
    if (tagParityResult && tagParityResult.flags.length > 0) {
      const hasMultipleFlags = tagParityResult.flags.some(f => f.startsWith('MULTIPLE_'));
      if (hasMultipleFlags && finalScore < 30) {
        finalScore = Math.max(finalScore, 30); // At least Medium risk
        if (finalScore >= 30 && verdictFromScore(finalScore) !== 'SUSPICIOUS') {
          // Update verdict if needed
        }
      }
    }

    const output = {
      url,
      scanTimestamp: new Date().toISOString(),
      observed,
      verdict: verdictFromScore(finalScore),
      riskScore: finalScore,
      metrics: cloneMetrics(metrics),
      signals,
      tagInventory: {
        analyticsIds: Array.from(new Set([...tagInventory.analyticsIds, ...measurementIds])),
        gtmContainers: Array.from(tagInventory.gtmContainers),
        facebookPixels: Array.from(tagInventory.facebookPixels),
        googleAdsIds: Array.from(tagInventory.googleAdsIds)
      },
      // Tag Assistant Parity Detection results
      tagParity: tagParityResult ? {
        ga4_ids: tagParityResult.ga4_ids,
        gtm_containers: tagParityResult.gtm_containers,
        gads_aw_ids: tagParityResult.gads_aw_ids,
        fb_pixel_ids: tagParityResult.fb_pixel_ids,
        flags: tagParityResult.flags,
        evidence: tagParityResult.evidence
      } : null,
      // #region agent log
      // Final tag inventory summary
      _debugTagInventory: {
        analyticsIdsCount: tagInventory.analyticsIds.size,
        analyticsIds: Array.from(tagInventory.analyticsIds),
        measurementIdsCount: measurementIds.size,
        measurementIds: Array.from(measurementIds),
        gtmContainersCount: tagInventory.gtmContainers.size,
        facebookPixelsCount: tagInventory.facebookPixels.size,
        googleAdsIdsCount: tagInventory.googleAdsIds.size
      },
      // #endregion
      tagInventoryDetailed: detailedOutput,
      advertisers: mapAdvertisers(advertisers),
      evidence: {
        sampleGaHits: gaEvents.slice(0, 10),
        adImpressionQueryIds: Array.from(adImpressionQueryIds),
        screenshotPath
      },
      fraudWarnings,
      diagnostics,
      // Tag Assistant-style Hits Sent data
      hitsById: hitsById,
      pageviewsPerNavigation: pageviewsPerNavigationTotal
    };

    // Index telemetry IDs into global database
    try {
      indexTelemetryFromScan(output, networkRequests);
      if (process.env.REVERSE_SEARCH_DEBUG === 'true') {
        console.log(`[Scanner] Indexed telemetry IDs for ${url}`);
      }
    } catch (error) {
      console.warn(`[Scanner] Failed to index telemetry IDs: ${error.message}`);
    }

    return output;
  } catch (error) {
    diagnostics.topHostnames = getTopHostnames(adHostCounts);

    const detailedOutput = formatDetailedInventory(tagInventoryDetailed);

    return {
      url,
      scanTimestamp: new Date().toISOString(),
      observed: { stageASeconds: 0 },
      verdict: 'PASS',
      riskScore: 0,
      metrics: cloneMetrics(metrics),
      signals,
      tagInventory: {
        analyticsIds: [],
        gtmContainers: [],
        facebookPixels: [],
        googleAdsIds: []
      },
      tagParity: null,
      tagInventoryDetailed: detailedOutput,
      advertisers: mapAdvertisers(advertisers),
      evidence: {
        sampleGaHits: gaEvents.slice(0, 10),
        adImpressionQueryIds: Array.from(adImpressionQueryIds)
      },
      fraudWarnings,
      diagnostics,
      hitsById: hitsById,
      pageviewsPerNavigation: 0,
      error: {
        message: error.message || 'Scan failed',
        stage: currentStage === 'A' ? 'observe' : currentStage === 'B' ? 'parse' : 'evidence'
      }
    };
  } finally {
    if (browser) await browser.close();
  }
}

function createEmptyMetrics() {
  return {
    pageLoadCount: 0,
    pageViewCount: 0,
    adRequestCount: 0,
    adImpressionCount: 0,
    uniqueQueryIds: 0,
    queryIdUniquenessRatio: 0,
    adImpressionsPerSecond: 0,
    uniqueMeasurementIds: [],
    selfReferrer: false,
    hasViewabilityParams: false,
    repeatedContextEvents: {}
  };
}

function cloneMetrics(metrics) {
  return JSON.parse(JSON.stringify(metrics));
}

function createProgressEmitter(cb) {
  if (typeof cb !== 'function') return () => {};
  let lastEmit = 0;
  return (payload, force = false) => {
    const now = Date.now();
    if (force || now - lastEmit >= 1000) {
      lastEmit = now;
      cb(payload);
    }
  };
}

async function parseGaHit(request) {
  try {
    const parsedUrl = new URL(request.url());
    const event = {
      timestamp: Date.now(),
      tid: null,
      en: null,
      t: null, // UA event type (pageview, event, transaction, item, etc.)
      dl: null,
      dr: null,
      dt: null,
      sid: null,
      _p: null,
      ep: {},
      __hasViewability: false,
      __uaPageView: false
    };

    const absorbParams = params => {
      for (const [key, value] of params.entries()) {
        if (typeof value !== 'string' || value === '') continue;
        if (key === 'tid') event.tid = value;
        else if (key === 'en') event.en = value;
        else if (key === 't') {
          // Capture all UA event types (pageview, event, transaction, item, etc.)
          event.t = value;
          if (value === 'pageview') event.__uaPageView = true;
        }
        else if (key === 'dl') event.dl = value;
        else if (key === 'dr') event.dr = value;
        else if (key === 'dt') event.dt = value;
        else if (key === 'sid') event.sid = value;
        else if (key === '_p') event._p = value;
        else if (key.startsWith('ep.')) {
          const epKey = key.slice(3);
          event.ep[epKey] = value;
          if (VIEWABILITY_KEYWORDS.some(term => epKey.toLowerCase().includes(term) || value.toLowerCase().includes(term))) {
            event.__hasViewability = true;
          }
        } else if (VIEWABILITY_KEYWORDS.some(term => key.toLowerCase().includes(term))) {
          event.__hasViewability = true;
        }
      }
    };

    absorbParams(parsedUrl.searchParams);
    const body = request.postData();
    if (body && body.length < 5000) {
      absorbParams(new URLSearchParams(body));
    }
    return event;
  } catch (error) {
    return null;
  }
}

function processGaHit(event, context) {
  const {
    metrics,
    measurementIds,
    queryIds,
    adImpressionQueryIds,
    gaEvents,
    contextEventCounts,
    tagInventory,
    fraudWarnings,
    diagnostics,
    warningSet,
    tagInventoryDetailed,
    hitsById,
    navigationId,
    pageViewsPerNavigation
  } = context;

  if (event.tid) {
    // #region agent log
    debugLog('scanner.cjs:430', 'Processing tid from GA event', { tid: event.tid }, 'A');
    // #endregion
    const info = classifyMeasurementId(event.tid);
    // #region agent log
    debugLog('scanner.cjs:432', 'classifyMeasurementId result', { hasInfo: !!info, info: info }, 'A');
    // #endregion
    if (info) {
      if (info.type === 'ga4') {
        const normalized = addGa4Candidate(tagInventoryDetailed, tagInventory, info.id, 'network_collect', { context: 'network_collect' });
        // #region agent log
        debugLog('scanner.cjs:434', 'addGa4Candidate result for GA4', { result: normalized, type: info.type, id: info.id }, 'A');
        // #endregion
        if (normalized && getGa4Status(tagInventoryDetailed, normalized) === 'verified') {
          measurementIds.add(normalized);
        }
      } else {
        const result = addDetailedId(tagInventoryDetailed, tagInventory, info.type, info.id, 'network_collect');
        // #region agent log
        debugLog('scanner.cjs:434', 'addDetailedId result for GA', { result: result, type: info.type, id: info.id }, 'A');
        // #endregion
        measurementIds.add(info.id);
      }
    }
    
    // Tag Assistant-style Hits Sent tracking
    const tid = event.tid;
    if (!hitsById[tid]) {
      hitsById[tid] = {
        total: 0,
        events: {},
        samples: []
      };
    }
    
    hitsById[tid].total += 1;
    
    // Determine event name: GA4 en or UA type t
    let eventName = null;
    if (event.en) {
      // GA4 event name (e.g., page_view, ad_impression, etc.)
      eventName = event.en;
    } else if (event.t) {
      // UA event type (pageview, event, transaction, item, etc.)
      eventName = event.t;
    } else if (event.tid && event.dl && !event.en && !event.t) {
      // GA4 automatic pageview (no en parameter, but has dl)
      eventName = 'page_view';
    }
    
    if (eventName) {
      hitsById[tid].events[eventName] = (hitsById[tid].events[eventName] || 0) + 1;
    }
    
    // Store sample (limit to 10 per tid)
    if (hitsById[tid].samples.length < 10) {
      hitsById[tid].samples.push({
        timestamp: event.timestamp,
        eventName: eventName,
        en: event.en,
        t: event.t,
        __uaPageView: event.__uaPageView,
        dl: event.dl
      });
    }
    
    // Track pageviews per navigation for inflation detection
    // Check for explicit GA4 page_view (en=page_view) or UA pageview (t=pageview) or automatic GA4 pageview
    const isPageView = eventName === 'page_view' || eventName === 'pageview' || 
                       (event.tid && event.dl && !event.en && !event.t);
    
    if (isPageView) {
      const navPageViews = pageViewsPerNavigation.get(navigationId) || {};
      navPageViews[tid] = (navPageViews[tid] || 0) + 1;
      pageViewsPerNavigation.set(navigationId, navPageViews);
      
      // Inflation detection: duplicate page_view in same navigation
      // Specifically check for GA4 en=page_view count > 1 OR UA pageview count > 1
      if (navPageViews[tid] > 1) {
        const isGA4PageView = event.en === 'page_view' || (event.tid && event.dl && !event.en && !event.t);
        const warningType = isGA4PageView ? 'Duplicate page_view' : 'Duplicate pageview';
        pushWarningOnce(warningSet, fraudWarnings, {
          type: warningType,
          details: `Measurement ID ${tid} sent ${navPageViews[tid]} ${isGA4PageView ? 'page_view' : 'pageview'} hits during one navigation.`,
          url: 'google-analytics.com',
          risk: 'High'
        });
      }
    }
    
    // Inflation detection: duplicate ad_impression
    // Check specifically for GA4 en=ad_impression count > 1
    if (eventName === 'ad_impression' && event.en === 'ad_impression') {
      const adImpCount = hitsById[tid].events['ad_impression'] || 0;
      if (adImpCount > 1) {
        pushWarningOnce(warningSet, fraudWarnings, {
          type: 'Duplicate ad_impression',
          details: `Measurement ID ${tid} sent ${adImpCount} ad_impression hits.`,
          url: 'google-analytics.com',
          risk: 'High'
        });
      }
    }
  }

  if (diagnostics && diagnostics.gaHitSamples.length < 50) {
    diagnostics.gaHitSamples.push({
      t: event.timestamp,
      tid: event.tid,
      en: event.en,
      dl: event.dl,
      dr: event.dr,
      dt: event.dt,
      sid: event.sid,
      _p: event._p,
      ep: event.ep
    });
  }

  if (gaEvents.length < 50) {
    gaEvents.push({
      timestamp: event.timestamp,
      tid: event.tid,
      en: event.en,
      dl: event.dl,
      dr: event.dr,
      dt: event.dt,
      sid: event.sid,
      _p: event._p,
      ep: event.ep
    });
  }

  if (event.en === 'ad_impression') {
    metrics.adImpressionCount += 1;
    if (event.ep && event.ep.query_id) {
      queryIds.add(event.ep.query_id);
      adImpressionQueryIds.add(event.ep.query_id);
    }
  }

  // Count pageviews: GA4 en=page_view, UA t=pageview, or GA4 automatic pageview
  if (event.en === 'page_view' || event.t === 'pageview' || event.__uaPageView) {
    metrics.pageViewCount += 1;
    console.log(`[Scanner] Explicit pageview detected: en=${event.en}, t=${event.t}, __uaPageView=${event.__uaPageView}`);
  }

  // Also count pageviews from GA4 automatic pageviews (no en or t, but has dl)
  if (event.tid && event.dl && !event.en && !event.t) {
    metrics.pageViewCount += 1;
    console.log(`[Scanner] Automatic GA4 pageview detected: tid=${event.tid}, dl=${event.dl}`);
  }

  if (event.en && !['ad_impression', 'page_view'].includes(event.en)) {
    const count = contextEventCounts.get(event.en) || 0;
    contextEventCounts.set(event.en, count + 1);
  }

  if (event.dl && event.dr && event.dl === event.dr) {
    metrics.selfReferrer = true;
  }

  if (event.__hasViewability) {
    metrics.hasViewabilityParams = true;
  }
}

function updateDerivedMetrics(metrics, measurementIds, queryIds, observedSeconds, contextEventCounts) {
  metrics.uniqueQueryIds = queryIds.size;
  metrics.queryIdUniquenessRatio = metrics.adImpressionCount
    ? Number((metrics.uniqueQueryIds / metrics.adImpressionCount).toFixed(3))
    : 0;
  metrics.adImpressionsPerSecond = observedSeconds
    ? Number((metrics.adImpressionCount / observedSeconds).toFixed(3))
    : 0;
  metrics.uniqueMeasurementIds = Array.from(measurementIds);

  const repeated = {};
  contextEventCounts.forEach((count, eventName) => {
    if (count > 1) repeated[eventName] = count;
  });
  metrics.repeatedContextEvents = repeated;
}

function scoreSignals(metrics, existingSignals = [], hitsById = {}) {
  let score = 0;
  const signals = [...existingSignals];

  if (metrics.adImpressionCount >= 5) {
    score += 30;
    signals.push({
      id: 'rapid_ad_impressions',
      severity: 'high',
      detail: '5+ ad_impression events within 12 seconds.'
    });
  }

  if (metrics.uniqueQueryIds >= 3) {
    score += 20;
    signals.push({
      id: 'query_id_churn',
      severity: 'med',
      detail: 'Multiple unique query_id values detected.'
    });
  }

  if (
    metrics.adImpressionCount > 0 &&
    metrics.queryIdUniquenessRatio >= 0.8
  ) {
    score += 15;
    signals.push({
      id: 'query_id_ratio',
      severity: 'med',
      detail: 'High ratio of unique ad_impression query IDs.'
    });
  }

  if (metrics.adImpressionCount > 0 && !metrics.hasViewabilityParams) {
    score += 15;
    signals.push({
      id: 'missing_viewability',
      severity: 'med',
      detail: 'No viewability parameters found in GA telemetry.'
    });
  }

  if (metrics.uniqueMeasurementIds.length > 1) {
    score += 10;
    signals.push({
      id: 'multiple_measurement_ids',
      severity: 'low',
      detail: 'Multiple GA measurement IDs observed simultaneously.'
    });
  }

  if (metrics.selfReferrer) {
    score += 5;
    signals.push({
      id: 'self_referrer',
      severity: 'low',
      detail: 'GA hits reference same domain as referrer.'
    });
  }
  
  // Check for duplicate pageviews in hitsById
  for (const [tid, hitData] of Object.entries(hitsById)) {
    const pageViewCount = (hitData.events['page_view'] || 0) + (hitData.events['pageview'] || 0);
    if (pageViewCount > 1) {
      score += 20;
      signals.push({
        id: 'duplicate_pageview',
        severity: 'high',
        detail: `Measurement ID ${tid} sent ${pageViewCount} page_view hits.`
      });
    }
  }

  return { score: Math.min(score, 100), signals };
}

function verdictFromScore(score) {
  if (score >= 60) return 'HIGH_RISK';
  if (score >= 30) return 'SUSPICIOUS';
  return 'PASS';
}

async function performHalfScroll(page) {
  try {
    await page.evaluate(() => {
      const target = document.body.scrollHeight * 0.5;
      window.scrollTo({ top: target, behavior: 'smooth' });
    });
  } catch (err) {
    // ignore scroll issues
  }
}

async function analyzeFrames(page, fraudWarnings) {
  const frames = page.frames();
  const frameBoxes = [];

  for (const frame of frames) {
    try {
      const element = await frame.frameElement();
      if (!element) continue;
      const box = await element.boundingBox();
      if (!box) continue;

      const width = Math.round(box.width || 0);
      const height = Math.round(box.height || 0);
      const frameUrl = frame.url() || 'about:blank';

      const visibility = await element.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return {
          opacity: styles.opacity,
          display: styles.display,
          visibility: styles.visibility
        };
      });

      const isTiny = width <= 5 && height <= 5;
      const isPixelStuffed = width <= 1 || height <= 1 || width * height <= 4;
      const isHidden =
        visibility.display === 'none' ||
        visibility.visibility === 'hidden' ||
        Number(visibility.opacity) === 0;

      if ((isTiny || isHidden) && !isSafeSyncPixel(frameUrl, width, height)) {
        const type = isPixelStuffed ? 'Pixel Stuffing (1x1)' : 'Hidden/Tiny Frame';
        fraudWarnings.push({
          type,
          details: `Frame size ${width}x${height}px${isHidden ? ' hidden' : ''}`,
          url: frameUrl.substring(0, 120)
        });
      }

      frameBoxes.push({ box, url: frameUrl, width, height });
    } catch (err) {
      // ignore frame errors
    }
  }

  for (let i = 0; i < frameBoxes.length; i++) {
    for (let j = i + 1; j < frameBoxes.length; j++) {
      const f1 = frameBoxes[i];
      const f2 = frameBoxes[j];
      const overlapRatio = computeOverlap(f1.box, f2.box, f1.width, f1.height, f2.width, f2.height);
      if (overlapRatio >= 0.6) {
        fraudWarnings.push({
          type: 'Ad Stacking Detected',
          details: `Overlap ${Math.round(overlapRatio * 100)}% between ad frames.`,
          url: `${f1.url.substring(0, 60)} | ${f2.url.substring(0, 60)}`
        });
      }
    }
  }
}

function computeOverlap(box1, box2, width1, height1, width2, height2) {
  if (width1 < 40 || height1 < 40 || width2 < 40 || height2 < 40) return 0;
  const xOverlap = Math.max(
    0,
    Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y)
  );
  const overlapArea = xOverlap * yOverlap;
  const smallerArea = Math.min(box1.width * box1.height, box2.width * box2.height);
  if (smallerArea === 0) return 0;
  return overlapArea / smallerArea;
}

async function harvestStaticTags(page, tagInventory, tagInventoryDetailed) {
  try {
    const html = await page.content();
    extractTagsFromText(html, tagInventory, tagInventoryDetailed, 'dom_html');
  } catch (err) {
    // ignore parsing issues
  }
}

async function takeScreenshot(page) {
  try {
    const path = `evidence_${Date.now()}.png`;
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch (err) {
    return undefined;
  }
}

function isSafeSyncPixel(url, width, height) {
  if (width > 5 || height > 5) return false;
  const safeKeywords = [
    'sync', 'pixel', 'beacon', 'getuid', 'usermatch',
    'push_onload', 'usersync', 'cm/pixel', 'usync', 'amazon-adsystem'
  ];
  const lowerUrl = url.toLowerCase();
  return safeKeywords.some(keyword => lowerUrl.includes(keyword));
}

function recordAdvertiserImpression(url, advertisers) {
  try {
    const parsed = new URL(url);
    const advertiser = parsed.hostname.replace(/^www\./, '') || 'unknown-advertiser';
    const params = parsed.searchParams;
    const candidateId =
      params.get('adid') ||
      params.get('ad_id') ||
      params.get('tagid') ||
      params.get('placement_id') ||
      params.get('slotname') ||
      params.get('iu') ||
      parsed.pathname;

    const adId = candidateId ? candidateId.substring(0, 120) : 'unknown-slot';
    const key = `${advertiser}|${adId}`;
    const timestamp = new Date().toISOString();
    if (!advertisers.has(key)) {
      advertisers.set(key, {
        advertiser,
        adId,
        impressions: 0,
        firstSeen: timestamp,
        lastSeen: timestamp
      });
    }
    const entry = advertisers.get(key);
    entry.impressions += 1;
    entry.lastSeen = timestamp;
  } catch (err) {
    // ignore malformed URLs
  }
}

function mapAdvertisers(advertisers) {
  return Array.from(advertisers.values()).sort((a, b) => b.impressions - a.impressions);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let scrolls = 0;
      const distance = 150;
      const maxScrolls = 120;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        scrolls += 1;
        const atBottom =
          window.innerHeight + window.scrollY >= document.body.scrollHeight;
        if (atBottom || scrolls >= maxScrolls) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}

async function healthCheck() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    return { browser_ok: true };
  } catch (err) {
    return { browser_ok: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

function pushWarningOnce(cache, list, warning) {
  const key = `${warning.type}|${warning.details}|${warning.url || ''}`;
  if (cache.has(key)) return;
  cache.add(key);
  list.push(warning);
}

function isGaEndpoint(url) {
  const lower = url.toLowerCase();
  // Match GA4 endpoints: https://*.google-analytics.com/g/collect* and /collect*
  if (lower.includes('google-analytics.com')) {
    if (lower.includes('/g/collect') || lower.includes('/collect')) return true;
  }
  // Match DoubleClick: https://stats.g.doubleclick.net/g/collect* and /collect*
  if (lower.includes('stats.g.doubleclick.net')) {
    if (lower.includes('/g/collect') || lower.includes('/collect')) return true;
  }
  return false;
}

function isTagEndpoint(host, lowerUrl) {
  if (!host) return false;
  const lh = host.toLowerCase();
  if (lh.includes('google-analytics.com') && lowerUrl.includes('/collect')) return true;
  if (lh.includes('stats.g.doubleclick.net') && lowerUrl.includes('/collect')) return true;
  if (lh.includes('googletagmanager.com') && (lowerUrl.includes('gtm.js') || lowerUrl.includes('gtag/js'))) return true;
  if (lh.includes('facebook.com') && lowerUrl.includes('/tr')) return true;
  if (lh.includes('connect.facebook.net') && lowerUrl.includes('fbevents.js')) return true;
  return false;
}

async function collectDomTagInventory(page, tagInventory, tagInventoryDetailed) {
  try {
    const data = await page.evaluate(() => {
      const scripts = Array.from(document.scripts).map(script => ({
        src: script.src || '',
        text: script.src ? '' : script.textContent || ''
      }));
      let budget = 200000;
      const inlineChunks = [];
      for (const script of scripts) {
        if (script.src) continue;
        if (budget <= 0) break;
        const chunk = script.text.slice(0, budget);
        inlineChunks.push(chunk);
        budget -= chunk.length;
      }
      return {
        srcs: scripts.map(s => s.src).filter(Boolean),
        inline: inlineChunks.join('\n')
      };
    });
    data.srcs.forEach(src => extractTagsFromText(src, tagInventory, tagInventoryDetailed, 'network_script_src'));
    extractTagsFromText(data.inline, tagInventory, tagInventoryDetailed, 'dom_inline_script');
  } catch (err) {
    // ignore DOM extraction errors
  }
}

function extractTagsFromText(text, tagInventory, tagInventoryDetailed, source = 'dom_html') {
  if (!text) return;
  const uaRegex = /UA-\d{8,10}-\d{1,2}/gi;
  const gtmRegex = /GTM-[A-Z0-9]{4,10}/gi;
  const awRegex = /AW-\d{6,}/gi;
  const fbRegex = /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,18})/gi;
  const seenGa4 = new Set();

  const registerGa4 = (id, context, meta = {}) => {
    const normalized = addGa4Candidate(tagInventoryDetailed, tagInventory, id, source, { ...meta, context });
    if (normalized) seenGa4.add(normalized);
  };

  // gtag/js script tag
  for (const match of text.matchAll(/googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]{8,12})/gi)) {
    registerGa4(match[1], 'gtag_js');
  }

  // gtag('config', 'G-XXXX')
  const hasBootstrap = GTAG_JS_BOOTSTRAP_REGEX.test(text);
  for (const match of text.matchAll(GTAG_CONFIG_REGEX)) {
    registerGa4(match[1], 'gtag_config', { hasBootstrap });
  }

  // measurement_id inline configs (commonly in GTM dataLayer pushes)
  for (const match of text.matchAll(/['"]measurement_id['"]\s*:\s*['"](G-[A-Z0-9]{8,12})['"]/gi)) {
    registerGa4(match[1], 'gtm_config');
  }

  const uaMatches = text.match(uaRegex);
  if (uaMatches) uaMatches.forEach(id => addDetailedId(tagInventoryDetailed, tagInventory, 'ua', id, source));
  const gtmMatches = text.match(gtmRegex);
  if (gtmMatches) gtmMatches.forEach(id => addDetailedId(tagInventoryDetailed, tagInventory, 'gtm', id, source));
  const awMatches = text.match(awRegex);
  if (awMatches) awMatches.forEach(id => addDetailedId(tagInventoryDetailed, tagInventory, 'aw', id, source));
  let fbMatch;
  while ((fbMatch = fbRegex.exec(text)) !== null) {
    addDetailedId(tagInventoryDetailed, tagInventory, 'fb', fbMatch[1], source);
  }

  // Stray GA-like tokens without execution context are logged as false positives
  const strayMatches = text.match(GA4_TOKEN_REGEX);
  if (strayMatches) {
    strayMatches.forEach(raw => {
      const normalized = normalizeGa4Id(raw);
      if (!normalized) return;
      if (seenGa4.has(normalized)) return;
      const status = getGa4Status(tagInventoryDetailed, normalized);
      if (status === 'verified') return;
      addGa4Candidate(tagInventoryDetailed, tagInventory, normalized, source, {
        context: 'stray_token',
        forceClassification: 'non_ga',
        reason: 'Found outside GA4 script context'
      });
    });
  }
}

function getTopHostnames(map) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([host, count]) => ({ host, count }));
}

function normalizeMeasurementId(id) {
  const info = classifyMeasurementId(id);
  return info ? info.id : null;
}

function classifyMeasurementId(id) {
  const ga = normalizeGa4Id(id);
  if (ga) return { id: ga, type: 'ga4' };
  const ua = normalizeUaId(id);
  if (ua) return { id: ua, type: 'ua' };
  return null;
}

function normalizeGa4Id(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  const result = GA4_VALID_REGEX.test(upper) ? upper : null;
  // #region agent log
  debugLog('scanner.cjs:927', 'normalizeGa4Id', { input: id, upper: upper, result: result, length: upper.length }, 'D');
  // #endregion
  return result;
}

function normalizeUaId(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^UA-\d{8,10}-\d{1,2}$/.test(upper) ? upper : null;
}

function normalizeGtmId(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^GTM-[A-Z0-9]{4,10}$/.test(upper) ? upper : null;
}

function normalizeAwId(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  const result = /^AW-\d{6,}$/.test(upper) ? upper : null;
  // #region agent log
  debugLog('scanner.cjs:949', 'normalizeAwId', { input: id, upper: upper, result: result }, 'D');
  // #endregion
  return result;
}

function normalizeFbId(id) {
  if (!id) return null;
  const result = /^\d{8,18}$/.test(id) ? id : null;
  // #region agent log
  debugLog('scanner.cjs:959', 'normalizeFbId', { input: id, result: result, length: id.length }, 'D');
  // #endregion
  return result;
}

const GA4_STATUS_PRIORITY = { verified: 3, unverified: 2, non_ga: 1, unknown: 0 };

function getGa4Status(detailMaps, id) {
  if (detailMaps.ga4 && detailMaps.ga4.has(id)) return 'verified';
  if (detailMaps.ga4_unverified && detailMaps.ga4_unverified.has(id)) return 'unverified';
  if (detailMaps.ga4_false && detailMaps.ga4_false.has(id)) return 'non_ga';
  return 'unknown';
}

function clearGa4FromAll(detailMaps, id) {
  if (detailMaps.ga4) detailMaps.ga4.delete(id);
  if (detailMaps.ga4_unverified) detailMaps.ga4_unverified.delete(id);
  if (detailMaps.ga4_false) detailMaps.ga4_false.delete(id);
}

function getGa4MapForStatus(detailMaps, status) {
  if (status === 'verified') return detailMaps.ga4;
  if (status === 'unverified') return detailMaps.ga4_unverified;
  return detailMaps.ga4_false;
}

function classifyGa4Candidate(rawId, source, meta = {}) {
  const normalized = normalizeGa4Id(rawId);
  const context = meta.context || source || 'unknown';
  if (!normalized) {
    return {
      normalized: null,
      status: 'non_ga',
      reason: meta.reason || 'Invalid GA4 format',
      context
    };
  }

  if (meta.forceClassification === 'non_ga') {
    return {
      normalized,
      status: 'non_ga',
      reason: meta.reason || 'Non-analytics token',
      context
    };
  }

  const verifiedContexts = new Set([
    'network_collect',
    'network_script_src',
    'gtag_js',
    'gtag_config',
    'tag_parity_network',
    'gtm_config'
  ]);

  const status = verifiedContexts.has(context) || meta.confidence === 'HIGH'
    ? 'verified'
    : 'unverified';

  return {
    normalized,
    status,
    reason: status === 'verified' ? 'Valid GA4 execution context observed' : (meta.reason || 'Script context missing'),
    context
  };
}

function addGa4Candidate(detailMaps, tagInventory, rawId, source, meta = {}) {
  const { normalized, status, reason, context } = classifyGa4Candidate(rawId, source, meta);
  if (!normalized) {
    if (rawId && rawId.toString().toUpperCase().startsWith('G-')) {
      const map = getGa4MapForStatus(detailMaps, 'non_ga');
      const upper = rawId.toString().toUpperCase();
      const existing = map.get(upper) || { id: upper, type: 'NON_GA', source, classification: 'non_ga', contexts: new Set(), reason };
      if (existing.contexts instanceof Set) existing.contexts.add(context || source || 'unknown');
      map.set(upper, existing);
    }
    return null;
  }

  const currentStatus = getGa4Status(detailMaps, normalized);
  const shouldUpgrade = GA4_STATUS_PRIORITY[status] > GA4_STATUS_PRIORITY[currentStatus];
  const finalStatus = shouldUpgrade ? status : currentStatus;
  if (shouldUpgrade) {
    clearGa4FromAll(detailMaps, normalized);
  }

  const targetMap = getGa4MapForStatus(detailMaps, finalStatus === 'unknown' ? status : finalStatus);
  const entry = targetMap.get(normalized) || {
    id: normalized,
    type: 'GA4',
    source,
    classification: status,
    contexts: new Set(),
    reason
  };
  entry.source = entry.source || source;
  entry.classification = GA4_STATUS_PRIORITY[status] >= GA4_STATUS_PRIORITY[entry.classification || 'unknown']
    ? status
    : entry.classification;
  entry.reason = entry.reason || reason;
  if (entry.contexts instanceof Set) entry.contexts.add(context || source || 'unknown');
  targetMap.set(normalized, entry);

  if (entry.classification === 'verified') {
    tagInventory.analyticsIds.add(normalized);
  }
  return normalized;
}

function addDetailedId(detailMaps, tagInventory, type, rawId, source) {
  if (type === 'ga4') {
    return addGa4Candidate(detailMaps, tagInventory, rawId, source);
  }
  // #region agent log
  debugLog('scanner.cjs:907', 'addDetailedId called', { type: type, rawId: rawId, source: source }, 'D');
  // #endregion
  const normalized = normalizeIdByType(type, rawId);
  // #region agent log
  debugLog('scanner.cjs:909', 'normalizeIdByType result', { normalized: normalized, type: type, rawId: rawId }, 'D');
  // #endregion
  if (!normalized) return null;
  const map = detailMaps[type];
  if (!map.has(normalized)) {
    map.set(normalized, { id: normalized, type: type.toUpperCase(), source });
    if (type === 'ga4' || type === 'ua') tagInventory.analyticsIds.add(normalized);
    else if (type === 'gtm') tagInventory.gtmContainers.add(normalized);
    else if (type === 'aw') tagInventory.googleAdsIds.add(normalized);
    else if (type === 'fb') tagInventory.facebookPixels.add(normalized);
  }
  return normalized;
}

function normalizeIdByType(type, id) {
  switch (type) {
    case 'ga4': return normalizeGa4Id(id);
    case 'ua': return normalizeUaId(id);
    case 'gtm': return normalizeGtmId(id);
    case 'aw': return normalizeAwId(id);
    case 'fb': return normalizeFbId(id);
    default: return null;
  }
}

function formatDetailedInventory(detailMaps) {
  const toArray = map => Array.from(map.values()).map(entry => {
    const contexts = entry.contexts instanceof Set ? Array.from(entry.contexts) : entry.contexts;
    return { ...entry, contexts };
  });
  return {
    ga4: toArray(detailMaps.ga4),
    ga4_unverified: toArray(detailMaps.ga4_unverified || new Map()),
    ga4_false: toArray(detailMaps.ga4_false || new Map()),
    ua: toArray(detailMaps.ua),
    gtm: toArray(detailMaps.gtm),
    aw: toArray(detailMaps.aw),
    fb: toArray(detailMaps.fb)
  };
}

console.assert(normalizeGa4Id('G-ABCD123456') !== null, 'Valid GA4 ID rejected');
console.assert(classifyGa4Candidate('G-THUMBNAILS', 'stray_token', { forceClassification: 'non_ga' }).status === 'non_ga', 'Invalid GA4 token not classified as non-ga');

module.exports = { scanWebsite, healthCheck };

if (require.main === module) {
  (async () => {
    const targetUrl = process.argv[2] || 'https://example.com';
    const result = await scanWebsite(targetUrl, payload => {
      if (payload && payload.stage) {
        console.log(`[${payload.stage}] score=${payload.riskScore} verdict=${payload.verdict}`);
      }
    });
    const outputPath = 'scan_results_ultimate.json';
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nScan complete. Results saved to ${outputPath}`);
  })();
}

/*
How to run:
  node scanner.js https://example.com
   - or import { scanWebsite } and call with (url, onProgress?)
*/
