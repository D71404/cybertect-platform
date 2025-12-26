const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ID Extractors
const GA4_REGEX = /G-[A-Z0-9]{10}/gi;
const UA_REGEX = /UA-\d{4,10}-\d+/gi;
const GTM_REGEX = /GTM-[A-Z0-9]+/gi;
const GOOGLE_ADS_REGEX = /AW-\d{6,12}/gi;
const FB_PIXEL_REGEX = /fbq\(['"]init['"],\s*['"]?(\d{5,20})/gi;
const FB_PIXEL_URL_REGEX = /facebook\.com\/tr\?[^"'\\s]*[?&]id=(\d{5,20})/gi;
const ADOBE_LAUNCH_REGEX = /assets\.adobedtm\.com\/[^"'\s]*\/launch-[^"'\s]*\.js/gi;
const ADOBE_ANALYTICS_REGEX = /s\.account\s*=\s*['"]([^'"]+)['"]|s_account\s*=\s*['"]([^'"]+)['"]/gi;

function normalizeGa4Id(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^G-[A-Z0-9]{10}$/.test(upper) ? upper : null;
}

function normalizeUaId(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^UA-\d{4,10}-\d+$/.test(upper) ? upper : null;
}

function normalizeGtmId(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^GTM-[A-Z0-9]+$/.test(upper) ? upper : null;
}

function normalizeGoogleAdsId(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^AW-\d{6,12}$/.test(upper) ? upper : null;
}

function normalizeFbPixelId(id) {
  if (!id) return null;
  return /^\d{5,20}$/.test(id) ? id : null;
}

function extractIdsFromText(text, source) {
  const ids = {
    GA4: new Set(),
    UA: new Set(),
    GTM: new Set(),
    GOOGLE_ADS: new Set(),
    FACEBOOK_PIXEL: new Set(),
    ADOBE_LAUNCH: new Set(),
    ADOBE_ANALYTICS: new Set()
  };

  if (!text) return ids;

  // GA4
  const ga4Matches = text.match(GA4_REGEX);
  if (ga4Matches) {
    ga4Matches.forEach(id => {
      const normalized = normalizeGa4Id(id);
      if (normalized) ids.GA4.add(normalized);
    });
  }

  // UA
  const uaMatches = text.match(UA_REGEX);
  if (uaMatches) {
    uaMatches.forEach(id => {
      const normalized = normalizeUaId(id);
      if (normalized) ids.UA.add(normalized);
    });
  }

  // GTM
  const gtmMatches = text.match(GTM_REGEX);
  if (gtmMatches) {
    gtmMatches.forEach(id => {
      const normalized = normalizeGtmId(id);
      if (normalized) ids.GTM.add(normalized);
    });
  }

  // Google Ads
  const awMatches = text.match(GOOGLE_ADS_REGEX);
  if (awMatches) {
    awMatches.forEach(id => {
      const normalized = normalizeGoogleAdsId(id);
      if (normalized) ids.GOOGLE_ADS.add(normalized);
    });
  }

  // Facebook Pixel
  let fbMatch;
  FB_PIXEL_REGEX.lastIndex = 0; // Reset regex
  while ((fbMatch = FB_PIXEL_REGEX.exec(text)) !== null) {
    const normalized = normalizeFbPixelId(fbMatch[1]);
    if (normalized) ids.FACEBOOK_PIXEL.add(normalized);
  }
  FB_PIXEL_URL_REGEX.lastIndex = 0; // Reset regex
  while ((fbMatch = FB_PIXEL_URL_REGEX.exec(text)) !== null) {
    const normalized = normalizeFbPixelId(fbMatch[1]);
    if (normalized) ids.FACEBOOK_PIXEL.add(normalized);
  }

  // Adobe Launch (extract property/environment from URL)
  const adobeLaunchMatches = text.match(ADOBE_LAUNCH_REGEX);
  if (adobeLaunchMatches) {
    adobeLaunchMatches.forEach(url => {
      const match = url.match(/launch-([^./]+)/);
      if (match) ids.ADOBE_LAUNCH.add(match[1]);
    });
  }

  // Adobe Analytics
  ADOBE_ANALYTICS_REGEX.lastIndex = 0; // Reset regex
  let adobeMatch;
  while ((adobeMatch = ADOBE_ANALYTICS_REGEX.exec(text)) !== null) {
    const suiteId = adobeMatch[1] || adobeMatch[2];
    if (suiteId) ids.ADOBE_ANALYTICS.add(suiteId);
  }

  return ids;
}

// Crawler
async function fetchSitemap(baseUrl) {
  try {
    const sitemapUrl = new URL('/sitemap.xml', baseUrl).toString();
    const response = await axios.get(sitemapUrl, { timeout: 5000 });
    const text = response.data;
    const urlMatches = text.match(/<loc>(.*?)<\/loc>/gi);
    if (!urlMatches) return [];
    
    const baseHostname = new URL(baseUrl).hostname;
    const urls = urlMatches
      .map(match => match.replace(/<\/?loc>/gi, '').trim())
      .filter(url => {
        try {
          const urlObj = new URL(url);
          return urlObj.hostname === baseHostname || urlObj.hostname === `www.${baseHostname}` || `www.${urlObj.hostname}` === baseHostname;
        } catch {
          return false;
        }
      })
      .filter(url => {
        const lower = url.toLowerCase();
        return !lower.includes('/login') && !lower.includes('/cart') && !lower.includes('/checkout') && !lower.includes('/account');
      });
    
    return urls.slice(0, 20); // Limit to 20 URLs
  } catch (error) {
    return [];
  }
}

async function extractInternalLinks(page, baseUrl) {
  try {
    const baseHostname = new URL(baseUrl).hostname;
    const links = await page.evaluate((hostname) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const urls = new Set();
      anchors.forEach(a => {
        try {
          const href = a.getAttribute('href');
          if (!href) return;
          const url = new URL(href, window.location.href);
          if (url.hostname === hostname || url.hostname === `www.${hostname}` || `www.${url.hostname}` === hostname) {
            const path = url.pathname + url.search;
            if (path && path !== '/' && !path.includes('/login') && !path.includes('/cart') && !path.includes('/checkout') && !path.includes('/account')) {
              urls.add(url.toString());
            }
          }
        } catch {}
      });
      return Array.from(urls);
    }, baseHostname);
    return links.slice(0, 20);
  } catch (error) {
    return [];
  }
}

async function crawlPages(baseUrl, maxPages = 5, pageSampleStrategy = 'sitemap') {
  const pages = [baseUrl];
  const baseHostname = new URL(baseUrl).hostname;

  if (maxPages <= 1) return pages;

  if (pageSampleStrategy === 'sitemap') {
    const sitemapUrls = await fetchSitemap(baseUrl);
    pages.push(...sitemapUrls.slice(0, maxPages - 1));
  }

  if (pages.length < maxPages && (pageSampleStrategy === 'links' || pageSampleStrategy === 'sitemap')) {
    try {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const links = await extractInternalLinks(page, baseUrl);
      await browser.close();
      
      // Add unique links not already in pages
      const existing = new Set(pages);
      for (const link of links) {
        if (pages.length >= maxPages) break;
        if (!existing.has(link)) {
          pages.push(link);
          existing.add(link);
        }
      }
    } catch (error) {
      // Continue with just baseUrl if crawling fails
    }
  }

  return pages.slice(0, maxPages);
}

// Page Scanner
async function scanPage(url, includeTelemetryReplay = true, timeoutMs = 30000) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const inventory = {
    GA4: { ids: new Set(), byPage: {}, occurrences: {} },
    UA: { ids: new Set(), byPage: {}, occurrences: {} },
    GTM: { ids: new Set(), byPage: {}, occurrences: {} },
    GOOGLE_ADS: { ids: new Set(), byPage: {}, occurrences: {} },
    FACEBOOK_PIXEL: { ids: new Set(), byPage: {}, occurrences: {} },
    ADOBE_LAUNCH: { ids: new Set(), byPage: {}, occurrences: {} },
    ADOBE_ANALYTICS: { ids: new Set(), byPage: {}, occurrences: {} }
  };

  const networkRequests = [];
  const telemetrySteps = [];
  let screenshotPath = null;

  // Track network requests
  page.on('request', request => {
    const reqUrl = request.url();
    networkRequests.push({
      url: reqUrl,
      timestamp: Date.now(),
      method: request.method()
    });

    // Extract IDs from network URLs
    const ids = extractIdsFromText(reqUrl, 'network');
    Object.keys(ids).forEach(vendor => {
      ids[vendor].forEach(id => {
        inventory[vendor].ids.add(id);
        if (!inventory[vendor].occurrences[id]) {
          inventory[vendor].occurrences[id] = { inline: 0, scriptUrl: 0, network: 0, dataLayer: 0 };
        }
        inventory[vendor].occurrences[id].network++;
      });
    });
  });

  try {
    // Inject script to capture dataLayer and gtag calls
    await page.addInitScript(() => {
      if (typeof window.dataLayer === 'undefined') {
        window.dataLayer = [];
      }
      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function(...args) {
        window.__diagnosisDataLayer = window.__diagnosisDataLayer || [];
        window.__diagnosisDataLayer.push(...args);
        return originalPush.apply(this, args);
      };

      if (typeof window.gtag === 'function') {
        const originalGtag = window.gtag;
        window.gtag = function(...args) {
          window.__diagnosisGtag = window.__diagnosisGtag || [];
          window.__diagnosisGtag.push(...args);
          return originalGtag.apply(this, args);
        };
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(2000);

    // Extract from HTML
    const html = await page.content();
    const htmlIds = extractIdsFromText(html, 'inline');
    Object.keys(htmlIds).forEach(vendor => {
      htmlIds[vendor].forEach(id => {
        inventory[vendor].ids.add(id);
        if (!inventory[vendor].occurrences[id]) {
          inventory[vendor].occurrences[id] = { inline: 0, scriptUrl: 0, network: 0, dataLayer: 0 };
        }
        inventory[vendor].occurrences[id].inline++;
      });
    });

    // Extract from script sources
    const scriptSrcs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    });
    scriptSrcs.forEach(src => {
      const ids = extractIdsFromText(src, 'scriptUrl');
      Object.keys(ids).forEach(vendor => {
        ids[vendor].forEach(id => {
          inventory[vendor].ids.add(id);
          if (!inventory[vendor].occurrences[id]) {
            inventory[vendor].occurrences[id] = { inline: 0, scriptUrl: 0, network: 0, dataLayer: 0 };
          }
          inventory[vendor].occurrences[id].scriptUrl++;
        });
      });
    });

    // Extract from dataLayer
    const dataLayerData = await page.evaluate(() => {
      return {
        dataLayer: window.__diagnosisDataLayer || [],
        gtag: window.__diagnosisGtag || []
      };
    });
    const dataLayerText = JSON.stringify(dataLayerData);
    const dataLayerIds = extractIdsFromText(dataLayerText, 'dataLayer');
    Object.keys(dataLayerIds).forEach(vendor => {
      dataLayerIds[vendor].forEach(id => {
        inventory[vendor].ids.add(id);
        if (!inventory[vendor].occurrences[id]) {
          inventory[vendor].occurrences[id] = { inline: 0, scriptUrl: 0, network: 0, dataLayer: 0 };
        }
        inventory[vendor].occurrences[id].dataLayer++;
      });
    });

    // Store by page
    Object.keys(inventory).forEach(vendor => {
      inventory[vendor].byPage[url] = Array.from(inventory[vendor].ids);
    });

    // Telemetry Replay
    if (includeTelemetryReplay) {
      // Baseline - no interaction
      const baselineStart = Date.now();
      await page.waitForTimeout(3000);
      const baselineRequests = networkRequests.filter(r => r.timestamp >= baselineStart);
      const baselineCounts = countRequestsByVendor(baselineRequests);
      const baselineAnomalies = detectAnomalies(baselineRequests, 'baseline');
      telemetrySteps.push({
        page: url,
        step: 'baseline_no_interaction',
        counts: baselineCounts,
        anomalies: baselineAnomalies
      });

      // Scroll to 25%
      await scrollToPercent(page, 25);
      await page.waitForTimeout(500);
      const scroll25Requests = networkRequests.filter(r => r.timestamp >= baselineStart + 3000);
      telemetrySteps.push({
        page: url,
        step: 'scroll_25',
        counts: countRequestsByVendor(scroll25Requests),
        anomalies: detectAnomalies(scroll25Requests, 'scroll')
      });

      // Scroll to 50%
      await scrollToPercent(page, 50);
      await page.waitForTimeout(500);
      telemetrySteps.push({
        page: url,
        step: 'scroll_50',
        counts: countRequestsByVendor(networkRequests.filter(r => r.timestamp >= baselineStart + 3500)),
        anomalies: []
      });

      // Scroll to 75%
      await scrollToPercent(page, 75);
      await page.waitForTimeout(500);
      telemetrySteps.push({
        page: url,
        step: 'scroll_75',
        counts: countRequestsByVendor(networkRequests.filter(r => r.timestamp >= baselineStart + 4000)),
        anomalies: []
      });

      // Scroll to 100%
      await scrollToPercent(page, 100);
      await page.waitForTimeout(500);
      telemetrySteps.push({
        page: url,
        step: 'scroll_100',
        counts: countRequestsByVendor(networkRequests.filter(r => r.timestamp >= baselineStart + 4500)),
        anomalies: []
      });

      // Click prominent CTA
      const ctaClicked = await clickProminentCTA(page);
      if (ctaClicked) {
        await page.waitForTimeout(1000);
        telemetrySteps.push({
          page: url,
          step: 'cta_click',
          counts: countRequestsByVendor(networkRequests.filter(r => r.timestamp >= baselineStart + 5000)),
          anomalies: []
        });
      }

      // Take screenshot
      screenshotPath = `evidence_diagnosis_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
  } catch (error) {
    console.error(`Error scanning page ${url}:`, error.message);
  } finally {
    await browser.close();
  }

  // Convert Sets to Arrays for JSON serialization
  const serializedInventory = {};
  Object.keys(inventory).forEach(vendor => {
    serializedInventory[vendor] = {
      ids: Array.from(inventory[vendor].ids),
      byPage: inventory[vendor].byPage,
      occurrences: inventory[vendor].occurrences
    };
  });

  return {
    url,
    inventory: serializedInventory,
    telemetrySteps,
    screenshotPath
  };
}

function countRequestsByVendor(requests) {
  const counts = {};
  requests.forEach(req => {
    const url = req.url.toLowerCase();
    if (url.includes('google-analytics.com') || url.includes('googletagmanager.com')) {
      counts.GA4 = (counts.GA4 || 0) + 1;
    }
    if (url.includes('facebook.com/tr') || url.includes('connect.facebook.net')) {
      counts.FACEBOOK_PIXEL = (counts.FACEBOOK_PIXEL || 0) + 1;
    }
  });
  return counts;
}

function detectAnomalies(requests, step) {
  const anomalies = [];
  const urlCounts = {};
  requests.forEach(req => {
    urlCounts[req.url] = (urlCounts[req.url] || 0) + 1;
  });

  // Detect duplicate bursts
  Object.keys(urlCounts).forEach(url => {
    if (urlCounts[url] > 3) {
      anomalies.push(`duplicate_burst_${url.substring(0, 50)}`);
    }
  });

  // Detect phantom events
  if (step === 'baseline') {
    requests.forEach(req => {
      const url = req.url.toLowerCase();
      if (url.includes('scroll') || url.includes('view')) {
        anomalies.push('phantom_scroll_event');
      }
      if (url.includes('purchase') || url.includes('conversion') || url.includes('lead')) {
        anomalies.push('phantom_conversion_event');
      }
    });
  }

  return anomalies;
}

async function scrollToPercent(page, percent) {
  await page.evaluate((pct) => {
    const target = (document.body.scrollHeight * pct) / 100;
    window.scrollTo({ top: target, behavior: 'smooth' });
  });
}

async function clickProminentCTA(page) {
  try {
    const cta = await page.evaluate(() => {
      const keywords = ['sign up', 'get', 'learn', 'contact', 'book', 'start', 'buy'];
      const links = Array.from(document.querySelectorAll('a, button'));
      for (const link of links) {
        const text = (link.textContent || '').toLowerCase();
        if (keywords.some(kw => text.includes(kw))) {
          const rect = link.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
            return { tag: link.tagName, text: link.textContent.substring(0, 50) };
          }
        }
      }
      return null;
    });

    if (cta) {
      await page.click(`text="${cta.text.substring(0, 30)}"`).catch(() => {});
      return true;
    }
  } catch (error) {
    // Ignore click errors
  }
  return false;
}

// Collision Detection
function detectCollisions(inventory) {
  const findings = [];

  Object.keys(inventory).forEach(vendor => {
    const vendorData = inventory[vendor];
    const ids = vendorData.ids || [];

    // Duplicates: same ID appears multiple times on same page
    Object.keys(vendorData.byPage || {}).forEach(pageUrl => {
      const pageIds = vendorData.byPage[pageUrl] || [];
      const idCounts = {};
      pageIds.forEach(id => {
        idCounts[id] = (idCounts[id] || 0) + 1;
      });
      Object.keys(idCounts).forEach(id => {
        if (idCounts[id] > 1) {
          findings.push({
            severity: 'high',
            type: 'duplicate',
            vendor,
            title: `Duplicate ${vendor} ID: ${id}`,
            details: `ID ${id} appears ${idCounts[id]} times on ${pageUrl}`,
            evidence: { page: pageUrl, ids: [id], samples: [] }
          });
        }
      });
    });

    // Collisions: multiple IDs of same vendor on same page
    Object.keys(vendorData.byPage || {}).forEach(pageUrl => {
      const pageIds = vendorData.byPage[pageUrl] || [];
      if (pageIds.length > 1) {
        findings.push({
          severity: 'medium',
          type: 'collision',
          vendor,
          title: `Multiple ${vendor} IDs on same page`,
          details: `Found ${pageIds.length} different ${vendor} IDs on ${pageUrl}`,
          evidence: { page: pageUrl, ids: pageIds, samples: [] }
        });
      }
    });
  });

  // Cross-network collisions
  const vendorsWithIds = Object.keys(inventory).filter(v => (inventory[v].ids || []).length > 0);
  if (vendorsWithIds.length > 3) {
    findings.push({
      severity: 'high',
      type: 'collision',
      vendor: 'MULTIPLE',
      title: 'Multiple analytics stacks detected',
      details: `Found ${vendorsWithIds.length} different analytics vendors. High risk of KPI contamination.`,
      evidence: { page: 'multiple', ids: vendorsWithIds, samples: [] }
    });
  }

  return findings;
}

// Drift Detection
function detectDrift(pagesData) {
  const expected = {};
  const pageDeltas = [];

  // Build expected set (IDs seen on majority of pages)
  const vendorIdsAcrossPages = {};
  pagesData.forEach(pageData => {
    Object.keys(pageData.inventory || {}).forEach(vendor => {
      if (!vendorIdsAcrossPages[vendor]) vendorIdsAcrossPages[vendor] = {};
      const ids = pageData.inventory[vendor].ids || [];
      ids.forEach(id => {
        if (!vendorIdsAcrossPages[vendor][id]) vendorIdsAcrossPages[vendor][id] = [];
        vendorIdsAcrossPages[vendor][id].push(pageData.url);
      });
    });
  });

  const pageCount = pagesData.length;
  const majorityThreshold = Math.ceil(pageCount / 2);

  Object.keys(vendorIdsAcrossPages).forEach(vendor => {
    expected[vendor] = [];
    Object.keys(vendorIdsAcrossPages[vendor]).forEach(id => {
      if (vendorIdsAcrossPages[vendor][id].length >= majorityThreshold) {
        expected[vendor].push(id);
      }
    });
  });

  // Detect drift per page
  pagesData.forEach(pageData => {
    const missing = {};
    const extra = {};

    Object.keys(expected).forEach(vendor => {
      const pageIds = new Set(pageData.inventory[vendor]?.ids || []);
      const expectedIds = new Set(expected[vendor] || []);

      const missingIds = expected[vendor].filter(id => !pageIds.has(id));
      const extraIds = Array.from(pageIds).filter(id => !expectedIds.has(id));

      if (missingIds.length > 0) missing[vendor] = missingIds;
      if (extraIds.length > 0) extra[vendor] = extraIds;
    });

    if (Object.keys(missing).length > 0 || Object.keys(extra).length > 0) {
      pageDeltas.push({
        page: pageData.url,
        missing,
        extra
      });
    }
  });

  return { expected, pageDeltas };
}

// Rogue ID Detection
function detectRogueIds(pagesData) {
  const findings = [];

  // Count how many pages each ID appears on
  const idPageCounts = {};
  pagesData.forEach(pageData => {
    Object.keys(pageData.inventory || {}).forEach(vendor => {
      const ids = pageData.inventory[vendor].ids || [];
      ids.forEach(id => {
        if (!idPageCounts[id]) idPageCounts[id] = { vendor, pages: [], sources: [] };
        idPageCounts[id].pages.push(pageData.url);
        // Check if ID only appears via network (not in markup)
        const occurrences = pageData.inventory[vendor].occurrences?.[id] || {};
        if (occurrences.network > 0 && occurrences.inline === 0 && occurrences.scriptUrl === 0) {
          idPageCounts[id].sources.push('network_only');
        }
      });
    });
  });

  const pageCount = pagesData.length;
  Object.keys(idPageCounts).forEach(id => {
    const data = idPageCounts[id];
    // Rogue if appears on only 1 page OR only via network
    if (data.pages.length === 1 || data.sources.includes('network_only')) {
      findings.push({
        severity: 'medium',
        type: 'rogue',
        vendor: data.vendor,
        title: `Rogue ${data.vendor} ID: ${id}`,
        details: `ID ${id} appears on only ${data.pages.length} page(s)${data.sources.includes('network_only') ? ' and only via network calls' : ''}`,
        evidence: { page: data.pages[0], ids: [id], samples: [] }
      });
    }
  });

  return findings;
}

// Checklist Generator
function generateChecklist(findings, drift) {
  const checklist = [];

  findings.forEach(finding => {
    if (finding.type === 'duplicate') {
      checklist.push({
        severity: finding.severity,
        owner: 'publisher',
        action: `Remove duplicate ${finding.vendor} configs for ${finding.evidence.ids[0]}. Ensure only one gtag config per Measurement ID; dedupe via GTM triggers; remove hardcoded gtag if GTM manages ${finding.vendor}.`,
        why: 'Duplicate configs inflate sessions/events.'
      });
    } else if (finding.type === 'collision' && finding.vendor === 'GTM') {
      checklist.push({
        severity: finding.severity,
        owner: 'devops',
        action: 'Consolidate to one GTM container; remove legacy container; verify no CMS template injects a second container.',
        why: 'Multiple GTM containers can cause duplicate tracking.'
      });
    } else if (finding.type === 'rogue') {
      checklist.push({
        severity: finding.severity,
        owner: 'publisher',
        action: `Audit CMS/plugin injection for ${finding.evidence.ids[0]}; search theme templates; verify tag ownership; remove unknown IDs; require publisher sign-off.`,
        why: 'Rogue IDs may indicate unauthorized tracking.'
      });
    }
  });

  if (drift.pageDeltas.length > 0) {
    checklist.push({
      severity: 'medium',
      owner: 'devops',
      action: 'Standardize templates; validate tag deployment across key templates; confirm consent mode consistency.',
      why: 'Tag drift across pages indicates inconsistent deployment.'
    });
  }

  return checklist;
}

// Main Diagnosis Function
async function diagnoseAnalytics(url, options = {}) {
  const {
    maxPages = 5,
    includeTelemetryReplay = true,
    pageSampleStrategy = 'sitemap',
    timeoutMs = 30000
  } = options;

  console.log(`\n🔍 Starting Analytics Integrity Diagnosis for: ${url}`);
  console.log(`   Max pages: ${maxPages}, Telemetry replay: ${includeTelemetryReplay}, Strategy: ${pageSampleStrategy}`);

  // Crawl pages
  const pagesToScan = await crawlPages(url, maxPages, pageSampleStrategy);
  console.log(`   Found ${pagesToScan.length} page(s) to scan`);

  // Scan each page
  const pagesData = [];
  for (const pageUrl of pagesToScan) {
    console.log(`   Scanning: ${pageUrl}`);
    const pageData = await scanPage(pageUrl, includeTelemetryReplay, timeoutMs);
    pagesData.push(pageData);
  }

  // Aggregate inventory
  const aggregatedInventory = {
    GA4: { ids: new Set(), byPage: {}, occurrences: {} },
    UA: { ids: new Set(), byPage: {}, occurrences: {} },
    GTM: { ids: new Set(), byPage: {}, occurrences: {} },
    GOOGLE_ADS: { ids: new Set(), byPage: {}, occurrences: {} },
    FACEBOOK_PIXEL: { ids: new Set(), byPage: {}, occurrences: {} },
    ADOBE_LAUNCH: { ids: new Set(), byPage: {}, occurrences: {} },
    ADOBE_ANALYTICS: { ids: new Set(), byPage: {}, occurrences: {} }
  };

  pagesData.forEach(pageData => {
    Object.keys(pageData.inventory || {}).forEach(vendor => {
      const vendorData = pageData.inventory[vendor];
      (vendorData.ids || []).forEach(id => {
        aggregatedInventory[vendor].ids.add(id);
        if (!aggregatedInventory[vendor].byPage[pageData.url]) {
          aggregatedInventory[vendor].byPage[pageData.url] = [];
        }
        aggregatedInventory[vendor].byPage[pageData.url].push(id);
        if (vendorData.occurrences && vendorData.occurrences[id]) {
          if (!aggregatedInventory[vendor].occurrences[id]) {
            aggregatedInventory[vendor].occurrences[id] = { inline: 0, scriptUrl: 0, network: 0, dataLayer: 0 };
          }
          Object.keys(vendorData.occurrences[id]).forEach(source => {
            aggregatedInventory[vendor].occurrences[id][source] += vendorData.occurrences[id][source];
          });
        }
      });
    });
  });

  // Convert Sets to Arrays
  const serializedInventory = {};
  Object.keys(aggregatedInventory).forEach(vendor => {
    serializedInventory[vendor] = {
      ids: Array.from(aggregatedInventory[vendor].ids),
      byPage: aggregatedInventory[vendor].byPage,
      occurrences: aggregatedInventory[vendor].occurrences
    };
  });

  // Detect issues
  const collisionFindings = detectCollisions(serializedInventory);
  const driftData = detectDrift(pagesData);
  const rogueFindings = detectRogueIds(pagesData);
  const allFindings = [...collisionFindings, ...rogueFindings];

  // Add drift findings
  driftData.pageDeltas.forEach(delta => {
    Object.keys(delta.missing).forEach(vendor => {
      allFindings.push({
        severity: 'medium',
        type: 'drift',
        vendor,
        title: `Missing ${vendor} IDs on ${delta.page}`,
        details: `Expected IDs ${delta.missing[vendor].join(', ')} not found`,
        evidence: { page: delta.page, ids: delta.missing[vendor], samples: [] }
      });
    });
    Object.keys(delta.extra).forEach(vendor => {
      allFindings.push({
        severity: 'low',
        type: 'drift',
        vendor,
        title: `Extra ${vendor} IDs on ${delta.page}`,
        details: `Unexpected IDs ${delta.extra[vendor].join(', ')} found`,
        evidence: { page: delta.page, ids: delta.extra[vendor], samples: [] }
      });
    });
  });

  // Generate checklist
  const checklist = generateChecklist(allFindings, driftData);

  // Aggregate telemetry steps
  const allTelemetrySteps = [];
  pagesData.forEach(pageData => {
    if (pageData.telemetrySteps) {
      allTelemetrySteps.push(...pageData.telemetrySteps);
    }
  });

  // Collect screenshots
  const screenshots = pagesData.map(p => p.screenshotPath).filter(Boolean);

  const result = {
    url,
    scannedAt: new Date().toISOString(),
    pagesScanned: pagesToScan,
    inventory: serializedInventory,
    findings: allFindings,
    drift: driftData,
    telemetryReplay: {
      enabled: includeTelemetryReplay,
      steps: allTelemetrySteps
    },
    checklist,
    artifacts: {
      screenshots,
      requestLog: null // Could be enhanced to save network requests
    }
  };

  console.log(`✅ Diagnosis complete: ${allFindings.length} findings, ${checklist.length} checklist items`);
  return result;
}

// Export functions for testing
module.exports = { 
  diagnoseAnalytics,
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
};

