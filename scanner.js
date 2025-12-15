const { chromium } = require('playwright');
const fs = require('fs');

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
const ID_REGEX = /(G-[A-Z0-9]{10}|UA-\d{8,10}-\d{1,2})/g;
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
    ga4: new Map(),
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

  let browser;
  let page;
  let currentStage = 'A';
  let isScannerScrolling = false;
  let screenshotPath;
  let stageADeltas = { adImpressions: 0 };
  let finalScore = 0;
  let signals = [];

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

      if (host) {
        adHostCounts.set(host, (adHostCounts.get(host) || 0) + 1);
        if (AD_HOST_PATTERNS.some(pattern => lowerHost.endsWith(pattern) || lowerHost.includes(pattern))) {
          metrics.adRequestCount += 1;
          recordAdvertiserImpression(reqUrl, advertisers);
        }
      }

      if (lowerHost.includes('facebook.com') && reqUrl.includes('/tr')) {
        const pixelMatch = reqUrl.match(/[?&]id=(\d{8,18})/);
        if (pixelMatch) addDetailedId(tagInventoryDetailed, tagInventory, 'fb', pixelMatch[1], 'network_collect');
      }

      if (lowerHost.includes('googletagmanager.com')) {
        const gtmMatch = reqUrl.match(/id=(GTM-[A-Z0-9]+)/i);
        if (gtmMatch) addDetailedId(tagInventoryDetailed, tagInventory, 'gtm', gtmMatch[1], 'network_script_src');
        if (lowerUrl.includes('gtag/js')) {
          const gaMatch = reqUrl.match(/id=(G-[A-Z0-9]+)/i);
          if (gaMatch) addDetailedId(tagInventoryDetailed, tagInventory, 'ga4', gaMatch[1], 'network_script_src');
        }
      }

      if (lowerUrl.includes('aw-')) {
        const awMatch = reqUrl.match(/AW-\d{6,}/i);
        if (awMatch) addDetailedId(tagInventoryDetailed, tagInventory, 'aw', awMatch[0], 'network_collect');
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
        const gaEvent = await parseGaHit(request);
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
            tagInventoryDetailed
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

    await page.waitForTimeout(STAGE_A_MS);
    stageADeltas = { adImpressions: metrics.adImpressionCount };
    updateDerivedMetrics(metrics, measurementIds, queryIds, STAGE_A_MS / 1000, contextEventCounts);
    ({ score: finalScore, signals } = scoreSignals(metrics));
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
      ({ score: finalScore, signals } = scoreSignals(metrics));
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
      tagInventoryDetailed: detailedOutput,
      advertisers: mapAdvertisers(advertisers),
      evidence: {
        sampleGaHits: gaEvents.slice(0, 10),
        adImpressionQueryIds: Array.from(adImpressionQueryIds),
        screenshotPath
      },
      fraudWarnings,
      diagnostics
    };

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
      tagInventoryDetailed: detailedOutput,
      advertisers: mapAdvertisers(advertisers),
      evidence: {
        sampleGaHits: gaEvents.slice(0, 10),
        adImpressionQueryIds: Array.from(adImpressionQueryIds)
      },
      fraudWarnings,
      diagnostics,
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
        else if (key === 'dl') event.dl = value;
        else if (key === 'dr') event.dr = value;
        else if (key === 'dt') event.dt = value;
        else if (key === 'sid') event.sid = value;
        else if (key === '_p') event._p = value;
        else if (key === 't' && value === 'pageview') event.__uaPageView = true;
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
    tagInventoryDetailed
  } = context;

  if (event.tid) {
    const info = classifyMeasurementId(event.tid);
    if (info) {
      measurementIds.add(info.id);
      addDetailedId(tagInventoryDetailed, tagInventory, info.type, info.id, 'network_collect');
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

  if (event.en === 'page_view' || event.__uaPageView) {
    metrics.pageViewCount += 1;
    if (metrics.pageViewCount > 1) {
      pushWarningOnce(warningSet, fraudWarnings, {
        type: 'Inflated Page Views',
        details: `Multiple page_view hits (${metrics.pageViewCount}) detected without navigation.`,
        url: 'google-analytics.com'
      });
    }
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

function scoreSignals(metrics, existingSignals = []) {
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
  if (lower.includes('google-analytics.com') && lower.includes('/collect')) return true;
  if (lower.includes('stats.g.doubleclick.net') && lower.includes('/collect')) return true;
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
  const gaRegex = /G-[A-Z0-9]{10}/gi;
  const uaRegex = /UA-\d{8,10}-\d{1,2}/gi;
  const gtmRegex = /GTM-[A-Z0-9]{4,10}/gi;
  const awRegex = /AW-\d{6,}/gi;
  const fbRegex = /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,18})/gi;

  const gaMatches = text.match(gaRegex);
  if (gaMatches) gaMatches.forEach(id => addDetailedId(tagInventoryDetailed, tagInventory, 'ga4', id, source));
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
  return /^G-[A-Z0-9]{10}$/.test(upper) ? upper : null;
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
  return /^AW-\d{6,}$/.test(upper) ? upper : null;
}

function normalizeFbId(id) {
  if (!id) return null;
  return /^\d{8,18}$/.test(id) ? id : null;
}

function addDetailedId(detailMaps, tagInventory, type, rawId, source) {
  const normalized = normalizeIdByType(type, rawId);
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
  const toArray = map => Array.from(map.values());
  return {
    ga4: toArray(detailMaps.ga4),
    ua: toArray(detailMaps.ua),
    gtm: toArray(detailMaps.gtm),
    aw: toArray(detailMaps.aw),
    fb: toArray(detailMaps.fb)
  };
}

console.assert(normalizeGa4Id('G-ABCD123456') !== null, 'Valid GA4 ID rejected');
console.assert(normalizeGa4Id('G-THUMBNAILS') === null, 'Invalid GA4 ID accepted');

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
