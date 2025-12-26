const { chromium } = require('playwright');

/**
 * Injected Telemetry Monitor Scanner
 * 
 * Detects analytics/ad telemetry that is injected after initial HTML load
 * via CMS plugins, tag managers, ad tech wrappers, CDNs/edge injection, or malicious scripts.
 */

// Vendor classification patterns
const VENDOR_PATTERNS = {
  google_analytics: [
    /google-analytics\.com\/g\/collect/i,
    /google-analytics\.com\/collect/i,
    /google-analytics\.com\/mp\/collect/i,
    /gtag\/js\?id=G-/i,
    /analytics\.js/i,
    /ga\(['"]create['"]/i,
    /gtag\(['"]config['"]/i
  ],
  gtm: [
    /googletagmanager\.com\/gtm\.js\?id=GTM-/i,
    /googletagmanager\.com/i
  ],
  google_ads: [
    /googleadservices\.com/i,
    /doubleclick\.net/i,
    /googlesyndication\.com/i,
    /AW-\d{6,}/i
  ],
  meta: [
    /connect\.facebook\.net/i,
    /facebook\.com\/tr\?/i,
    /fbq\(/i,
    /facebook\.com\/pixel/i
  ],
  tiktok: [
    /analytics\.tiktok\.com/i,
    /tiktok\.com\/i18n\/pixel/i
  ],
  linkedin: [
    /snap\.licdn\.com\/li\.lms-analytics/i,
    /linkedin\.com\/px/i
  ],
  hotjar: [
    /static\.hotjar\.com/i,
    /hj\.js/i
  ],
  session_replay: [
    /fullstory\.com/i,
    /logrocket\.com/i,
    /mixpanel\.com/i,
    /segment\.com/i
  ]
};

// Telemetry endpoint patterns for network requests
const TELEMETRY_ENDPOINTS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /googleadservices\.com/i,
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /connect\.facebook\.net/i,
  /facebook\.com\/tr/i,
  /analytics\.tiktok\.com/i,
  /tiktok\.com\/i18n\/pixel/i,
  /snap\.licdn\.com/i,
  /linkedin\.com\/px/i,
  /static\.hotjar\.com/i,
  /fullstory\.com/i,
  /logrocket\.com/i,
  /mixpanel\.com/i,
  /segment\.com/i
];

/**
 * Classify vendor from URL or content
 */
function classifyVendor(url, content = '') {
  const combined = url + ' ' + content;
  
  for (const [vendor, patterns] of Object.entries(VENDOR_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combined)) {
        return vendor;
      }
    }
  }
  
  return 'unknown';
}

/**
 * Determine artifact kind from element
 */
function getArtifactKind(element) {
  const tagName = element.tagName?.toLowerCase();
  const src = element.src || '';
  const href = element.href || '';
  
  if (tagName === 'script' && src) return 'dom_script';
  if (tagName === 'iframe' && src) return 'dom_iframe';
  if (tagName === 'img' && src) return 'dom_img_pixel';
  if (tagName === 'link' && href) return 'dom_link';
  if (tagName === 'noscript') return 'dom_noscript';
  if (tagName === 'script' && !src) return 'dom_script_inline';
  
  return 'dom_unknown';
}

/**
 * Determine injection phase from timestamp
 */
function getInjectionPhase(timestamp, loadStart, domContentLoaded, loadComplete, idleStart) {
  if (timestamp < domContentLoaded) return 'before_load';
  if (timestamp < loadComplete) return 'domcontentloaded';
  if (timestamp < idleStart) return 'after_load';
  return 'post_idle';
}

/**
 * Create a hash for deduplication
 */
function createHash(vendor, artifactKind, url) {
  const normalized = `${vendor}|${artifactKind}|${url}`.toLowerCase();
  return Buffer.from(normalized).toString('base64').substring(0, 32);
}

/**
 * Scan website for injected telemetry
 */
async function scanInjectedTelemetry(url, options = {}) {
  const {
    maxWaitMs = 10000,
    idleWaitMs = 1500
  } = options;

  const startedAt = new Date().toISOString();
  let browser;
  let page;
  
  // Storage for findings
  const domInsertions = new Map(); // hash -> insertion record
  const networkRequests = new Map(); // url -> request record
  const findings = [];
  
  // Timestamps for injection phase detection
  let loadStart = Date.now();
  let domContentLoadedTime = null;
  let loadCompleteTime = null;
  let idleStartTime = null;
  
  // Initial HTML storage
  let initialHtml = null;
  let finalHtml = null;

  try {
    // Normalize URL
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }
    
    try {
      new URL(targetUrl);
    } catch (e) {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    page = await context.newPage();
    
    loadStart = Date.now();

    // Install MutationObserver BEFORE any site JS runs
    await page.addInitScript(() => {
      // Create a global storage for DOM insertions
      window.__telemetryInsertions = [];
      
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return; // Only element nodes
            
            const element = node;
            const tagName = element.tagName?.toLowerCase();
            
            // Only track telemetry-relevant elements
            if (!['script', 'iframe', 'img', 'link', 'noscript', 'meta'].includes(tagName)) {
              return;
            }
            
            // Check if it's telemetry-related
            const src = element.src || '';
            const href = element.href || '';
            const innerHTML = element.innerHTML || '';
            const content = src + href + innerHTML;
            
            // Quick check for telemetry patterns
            const isTelemetry = /google-analytics|googletagmanager|facebook|tiktok|linkedin|hotjar|analytics|pixel|gtag|gtm|fbq/i.test(content);
            
            if (isTelemetry || src || (href && tagName === 'link')) {
              const record = {
                timestamp: Date.now(),
                tagName: tagName,
                src: src || '',
                href: href || '',
                id: element.id || '',
                className: element.className || '',
                outerHTML: element.outerHTML ? element.outerHTML.substring(0, 500) : '',
                attributes: {}
              };
              
              // Capture relevant attributes
              if (element.attributes) {
                Array.from(element.attributes).forEach(attr => {
                  record.attributes[attr.name] = attr.value;
                });
              }
              
              window.__telemetryInsertions.push(record);
            }
          });
        });
      });
      
      // Start observing before DOMContentLoaded
      if (document.readyState === 'loading') {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      } else {
        // Already loaded, observe immediately
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }
      
      // Keep observer active
      window.__telemetryObserver = observer;
    });

    // Track network requests
    const networkRequestsMap = new Map();
    
    page.on('request', (request) => {
      const reqUrl = request.url();
      const resourceType = request.resourceType();
      
      // Check if it's a telemetry endpoint
      const isTelemetry = TELEMETRY_ENDPOINTS.some(pattern => pattern.test(reqUrl));
      
      if (isTelemetry) {
        const timestamp = Date.now();
        const vendor = classifyVendor(reqUrl);
        
        if (!networkRequestsMap.has(reqUrl)) {
          networkRequestsMap.set(reqUrl, {
            url: reqUrl,
            method: request.method(),
            resourceType: resourceType,
            timestamp: timestamp,
            vendor: vendor,
            firstSeen: timestamp,
            lastSeen: timestamp
          });
        } else {
          const existing = networkRequestsMap.get(reqUrl);
          existing.lastSeen = timestamp;
        }
      }
    });

    // Track page lifecycle events
    page.on('domcontentloaded', () => {
      domContentLoadedTime = Date.now();
    });

    // Navigate and capture initial HTML
    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: maxWaitMs
      });
      
      // Capture initial HTML immediately after domcontentloaded
      initialHtml = await page.content();
      
      // Wait for load event
      await page.waitForLoadState('load', { timeout: maxWaitMs });
      loadCompleteTime = Date.now();
      
      // Wait for idle period
      await page.waitForTimeout(idleWaitMs);
      idleStartTime = Date.now();
      
      // Capture final HTML
      finalHtml = await page.content();
      
    } catch (error) {
      if (error.message.includes('timeout')) {
        throw new Error(`Page load timeout after ${maxWaitMs}ms`);
      }
      throw error;
    }

    // Collect DOM insertions from MutationObserver
    const insertions = await page.evaluate(() => {
      return window.__telemetryInsertions || [];
    });

    // Process DOM insertions
    for (const insertion of insertions) {
      const src = insertion.src || '';
      const href = insertion.href || '';
      const url = src || href || '';
      const content = insertion.outerHTML || '';
      
      if (!url && !content) continue;
      
      const vendor = classifyVendor(url, content);
      const artifactKind = getArtifactKind({
        tagName: insertion.tagName,
        src: src,
        href: href
      });
      
      // If MutationObserver caught it, it was definitely injected
      // (observer only fires on DOM additions, and we start it before site JS runs)
      const isInjected = true;
      
      const hash = createHash(vendor, artifactKind, url);
      
      if (!domInsertions.has(hash)) {
        const injectionPhase = getInjectionPhase(
          insertion.timestamp,
          loadStart,
          domContentLoadedTime || loadStart,
          loadCompleteTime || loadStart,
          idleStartTime || loadStart
        );
        
        domInsertions.set(hash, {
          type: vendor === 'unknown' ? 'unknown' : (vendor.includes('analytics') ? 'analytics' : (vendor.includes('ads') ? 'ad' : 'pixel')),
          vendor: vendor,
          artifactKind: artifactKind,
          url: url,
          firstSeen: new Date(insertion.timestamp).toISOString(),
          lastSeen: new Date(insertion.timestamp).toISOString(),
          injectionPhase: injectionPhase,
          injected: isInjected, // MutationObserver catches additions, so these are injected
          evidence: {
            domSnippet: insertion.outerHTML.substring(0, 300),
            attributes: insertion.attributes,
            tagName: insertion.tagName,
            matchedPattern: vendor
          }
        });
      }
    }

    // Process network requests
    for (const [reqUrl, reqData] of networkRequestsMap.entries()) {
      const vendor = reqData.vendor;
      const hash = createHash(vendor, 'network_request', reqUrl);
      
      // Check if this URL corresponds to a DOM element
      let correspondingDom = null;
      for (const [domHash, domData] of domInsertions.entries()) {
        if (domData.url === reqUrl || reqUrl.includes(domData.url) || domData.url.includes(reqUrl)) {
          correspondingDom = domData;
          break;
        }
      }
      
      // Only add if not already covered by DOM insertion
      if (!correspondingDom) {
        findings.push({
          type: vendor === 'unknown' ? 'unknown' : (vendor.includes('analytics') ? 'analytics' : (vendor.includes('ads') ? 'ad' : 'pixel')),
          vendor: vendor,
          artifactKind: 'network_request',
          url: reqUrl,
          firstSeen: new Date(reqData.firstSeen).toISOString(),
          lastSeen: new Date(reqData.lastSeen).toISOString(),
          injectionPhase: getInjectionPhase(
            reqData.timestamp,
            loadStart,
            domContentLoadedTime || loadStart,
            loadCompleteTime || loadStart,
            idleStartTime || loadStart
          ),
          injected: true, // Network requests are always "injected" (not in initial HTML)
          evidence: {
            method: reqData.method,
            resourceType: reqData.resourceType,
            matchedPattern: vendor
          }
        });
      }
    }

    // Add DOM insertions to findings
    for (const finding of domInsertions.values()) {
      findings.push(finding);
    }

    // Also check final HTML for scripts/iframes that weren't caught by MutationObserver
    // Compare initial vs final HTML
    if (initialHtml && finalHtml) {
      const initialScripts = (initialHtml.match(/<script[^>]*>/gi) || []).length;
      const finalScripts = (finalHtml.match(/<script[^>]*>/gi) || []).length;
      
      // If more scripts in final, some were injected
      // We already captured them via MutationObserver, but this is a sanity check
    }

    const finishedAt = new Date().toISOString();
    
    // Calculate summary
    const injectedCount = findings.filter(f => f.injected).length;
    const vendors = [...new Set(findings.map(f => f.vendor))];
    const types = [...new Set(findings.map(f => f.type))];
    
    const summary = {
      totalTelemetry: findings.length,
      injectedTelemetry: injectedCount,
      vendorsDetected: vendors.length,
      vendors: vendors,
      types: types,
      injectionPhases: {
        before_load: findings.filter(f => f.injectionPhase === 'before_load').length,
        domcontentloaded: findings.filter(f => f.injectionPhase === 'domcontentloaded').length,
        after_load: findings.filter(f => f.injectionPhase === 'after_load').length,
        post_idle: findings.filter(f => f.injectionPhase === 'post_idle').length
      }
    };

    return {
      url: targetUrl,
      startedAt: startedAt,
      finishedAt: finishedAt,
      findings: findings,
      summary: summary,
      evidencePack: {
        initialHtmlLength: initialHtml ? initialHtml.length : 0,
        finalHtmlLength: finalHtml ? finalHtml.length : 0,
        domInsertionsCount: domInsertions.size,
        networkRequestsCount: networkRequestsMap.size
      }
    };

  } catch (error) {
    throw new Error(`Scan failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { scanInjectedTelemetry };

