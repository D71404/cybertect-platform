/**
 * CMS Output Monitor Scanner
 * Scans CMS templates/modules for injected telemetry, duplicate tags, and unauthorized partners
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// #region agent log - Check Playwright executable path
try {
  const executablePath = chromium.executablePath();
  const pathExists = fs.existsSync(executablePath);
  fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cms-monitor/scanner.cjs:9',message:'Playwright executable path check',data:{executablePath,pathExists,nodeArch:process.arch},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2,H3,H4'})}).catch(()=>{});
} catch (e) {
  fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cms-monitor/scanner.cjs:9',message:'Failed to get executable path',data:{error:e.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2,H3'})}).catch(()=>{});
}
// #endregion
const {
  extractMeasurementIds,
  detectMacros,
  isVendorDomain,
  hasSuspiciousParams,
  hashContent,
  WIDGET_ATTRIBUTES
} = require('./patterns.cjs');

/**
 * Find widget/module attribution for an element
 */
async function findWidgetAttribution(page, elementHandle) {
  try {
    const attribution = await page.evaluate((el) => {
      let current = el;
      const maxDepth = 10;
      let depth = 0;
      
      while (current && depth < maxDepth) {
        // Check for widget attributes
        for (const attr of ['data-widget', 'data-module', 'data-component', 'data-template', 'data-cms', 'data-slot']) {
          const value = current.getAttribute(attr);
          if (value) {
            return {
              attribute: attr,
              value: value,
              selector: current.tagName.toLowerCase() + (current.id ? `#${current.id}` : '') + (current.className ? `.${String(current.className).split(' ')[0]}` : '')
            };
          }
        }
        
        // Check ID
        if (current.id) {
          return {
            attribute: 'id',
            value: current.id,
            selector: `#${current.id}`
          };
        }
        
        // Check for widget-like class names
        const className = current.className;
        if (className && typeof className === 'string') {
          const widgetClasses = className.split(' ').filter(c => 
            c.includes('widget') || c.includes('module') || c.includes('component') || c.includes('cms')
          );
          if (widgetClasses.length > 0) {
            return {
              attribute: 'class',
              value: widgetClasses[0],
              selector: `.${widgetClasses[0]}`
            };
          }
        }
        
        current = current.parentElement;
        depth++;
      }
      
      return null;
    }, elementHandle);
    
    return attribution;
  } catch (e) {
    return null;
  }
}

/**
 * Generate CSS selector for an element
 */
async function generateSelector(page, elementHandle) {
  try {
    return await page.evaluate((el) => {
      if (el.id) return `#${el.id}`;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(' ').filter(c => c).slice(0, 2);
        if (classes.length > 0) {
          return `.${classes.join('.')}`;
        }
      }
      return el.tagName.toLowerCase();
    }, elementHandle);
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Scan a single page
 */
async function scanPage(page, url, options = {}) {
  const {
    authHeader = null,
    authCookie = null,
    timeout = 30000
  } = options;
  
  const scripts = [];
  const pixels = [];
  const networkRequests = [];
  const measurementIds = {
    ga4: new Set(),
    ua: new Set(),
    gtm: new Set(),
    aw: new Set(),
    fb: new Set()
  };
  
  // Set up authentication if provided
  if (authHeader || authCookie) {
    const context = page.context();
    if (authHeader) {
      const [key, value] = authHeader.split(':').map(s => s.trim());
      await context.setExtraHTTPHeaders({ [key]: value });
    }
    if (authCookie) {
      const [name, cookieValue] = authCookie.split('=').map(s => s.trim());
      await context.addCookies([{
        name,
        value: cookieValue,
        domain: new URL(url).hostname,
        path: '/'
      }]);
    }
  }
  
  // Track network requests
  page.on('request', (request) => {
    const reqUrl = request.url();
    const initiator = request.resourceType();
    
    networkRequests.push({
      url: reqUrl,
      method: request.method(),
      resourceType: initiator,
      timestamp: Date.now()
    });
    
    // Extract IDs from network requests
    const ids = extractMeasurementIds(reqUrl);
    Object.keys(ids).forEach(type => {
      ids[type].forEach(id => measurementIds[type].add(id));
    });
    
    // Check for macros
    const macros = detectMacros(reqUrl);
    if (macros.length > 0) {
      networkRequests[networkRequests.length - 1].macros = macros;
    }
  });
  
  // Navigate to page
  try {
    console.log(`[CMS Scanner] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    console.log(`[CMS Scanner] Page loaded, waiting for scripts...`);
    await page.waitForTimeout(2000); // Wait for scripts to load
    console.log(`[CMS Scanner] Scripts loaded, extracting data...`);
  } catch (e) {
    console.error(`[CMS Scanner] Failed to load page ${url}:`, e.message);
    return {
      url,
      error: `Failed to load page: ${e.message}`,
      scripts: [],
      pixels: [],
      networkRequests: [],
      measurementIds: {},
      widgetMap: {}
    };
  }
  
  // Extract scripts
  console.log(`[CMS Scanner] Extracting scripts...`);
  const scriptElements = await page.$$('script');
  console.log(`[CMS Scanner] Found ${scriptElements.length} script elements`);
  
  for (const scriptEl of scriptElements) {
    try {
      const src = await scriptEl.getAttribute('src');
      const textContent = await scriptEl.textContent();
      
      if (src) {
        // External script
        const scriptHash = hashContent(src);
        const ids = extractMeasurementIds(src);
        const macros = detectMacros(src);
        const attribution = await findWidgetAttribution(page, scriptEl);
        const selector = await generateSelector(page, scriptEl);
        
        scripts.push({
          type: 'external',
          src,
          hash: scriptHash,
          measurementIds: Object.fromEntries(
            Object.entries(ids).map(([k, v]) => [k, Array.from(v)])
          ),
          macros: macros,
          attribution: attribution,
          selector: selector
        });
        
        // Add IDs to master set
        Object.keys(ids).forEach(type => {
          ids[type].forEach(id => measurementIds[type].add(id));
        });
      } else if (textContent && textContent.trim().length > 0) {
        // Inline script
        const scriptHash = hashContent(textContent);
        const ids = extractMeasurementIds(textContent);
        const macros = detectMacros(textContent);
        const attribution = await findWidgetAttribution(page, scriptEl);
        const selector = await generateSelector(page, scriptEl);
        
        scripts.push({
          type: 'inline',
          hash: scriptHash,
          content: textContent.substring(0, 500), // Limit size
          measurementIds: Object.fromEntries(
            Object.entries(ids).map(([k, v]) => [k, Array.from(v)])
          ),
          macros: macros,
          attribution: attribution,
          selector: selector
        });
        
        // Add IDs to master set
        Object.keys(ids).forEach(type => {
          ids[type].forEach(id => measurementIds[type].add(id));
        });
      }
    } catch (e) {
      // Skip script if we can't process it
    }
  }
  
  // Extract pixels (img, iframe, noscript)
  console.log(`[CMS Scanner] Extracting pixels...`);
  const pixelSelectors = ['img[src*="pixel"]', 'img[src*="beacon"]', 'img[src*="track"]', 'iframe[src*="pixel"]', 'noscript'];
  for (const selector of pixelSelectors) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements) {
        try {
          const src = await el.getAttribute('src') || await el.textContent();
          if (src && (src.includes('http') || src.includes('//'))) {
            const ids = extractMeasurementIds(src);
            const macros = detectMacros(src);
            const attribution = await findWidgetAttribution(page, el);
            const selector = await generateSelector(page, el);
            
            pixels.push({
              type: selector.includes('iframe') ? 'iframe' : selector.includes('noscript') ? 'noscript' : 'img',
              src: src.substring(0, 500),
              measurementIds: Object.fromEntries(
                Object.entries(ids).map(([k, v]) => [k, Array.from(v)])
              ),
              macros: macros,
              attribution: attribution,
              selector: selector
            });
            
            // Add IDs to master set
            Object.keys(ids).forEach(type => {
              ids[type].forEach(id => measurementIds[type].add(id));
            });
          }
        } catch (e) {
          // Skip pixel if we can't process it
        }
      }
    } catch (e) {
      // Skip selector if it fails
    }
  }
  
  // Build widget attribution map
  const widgetMap = {};
  [...scripts, ...pixels].forEach(item => {
    if (item.attribution) {
      const key = `${item.attribution.attribute}:${item.attribution.value}`;
      if (!widgetMap[key]) {
        widgetMap[key] = {
          widget: item.attribution.value,
          attribute: item.attribution.attribute,
          selector: item.attribution.selector,
          scripts: [],
          pixels: [],
          measurementIds: {
            ga4: new Set(),
            ua: new Set(),
            gtm: new Set(),
            aw: new Set(),
            fb: new Set()
          }
        };
      }
      
      if (item.type === 'external' || item.type === 'inline') {
        widgetMap[key].scripts.push(item);
      } else {
        widgetMap[key].pixels.push(item);
      }
      
      // Aggregate measurement IDs
      Object.keys(item.measurementIds || {}).forEach(type => {
        (item.measurementIds[type] || []).forEach(id => {
          widgetMap[key].measurementIds[type].add(id);
        });
      });
    }
  });
  
  // Convert Sets to Arrays in widgetMap
  Object.keys(widgetMap).forEach(key => {
    Object.keys(widgetMap[key].measurementIds).forEach(type => {
      widgetMap[key].measurementIds[type] = Array.from(widgetMap[key].measurementIds[type]);
    });
  });
  
  const result = {
    url,
    scanTimestamp: new Date().toISOString(),
    scripts,
    pixels,
    networkRequests: networkRequests.slice(0, 500), // Limit size
    measurementIds: Object.fromEntries(
      Object.entries(measurementIds).map(([k, v]) => [k, Array.from(v)])
    ),
    widgetMap: Object.fromEntries(
      Object.entries(widgetMap).map(([k, v]) => [k, {
        ...v,
        measurementIds: Object.fromEntries(
          Object.entries(v.measurementIds).map(([type, ids]) => [type, ids])
        )
      }])
    )
  };
  
  console.log(`[CMS Scanner] Page scan result:`, {
    url: result.url,
    scriptsCount: result.scripts.length,
    pixelsCount: result.pixels.length,
    networkRequestsCount: result.networkRequests.length,
    measurementIdsCount: Object.values(result.measurementIds).reduce((sum, ids) => sum + ids.length, 0),
    widgetMapKeys: Object.keys(result.widgetMap).length
  });
  
  return result;
}

/**
 * Find duplicate tags/IDs
 */
function findDuplicates(pageResults) {
  const duplicates = {
    duplicateIds: {},
    duplicateScripts: {},
    duplicateLibraries: {}
  };
  
  // Track IDs across all pages
  const idCounts = {};
  const scriptHashes = {};
  const librarySources = {};
  
  pageResults.forEach(pageResult => {
    // Count measurement IDs
    Object.keys(pageResult.measurementIds || {}).forEach(type => {
      (pageResult.measurementIds[type] || []).forEach(id => {
        const key = `${type}:${id}`;
        idCounts[key] = (idCounts[key] || 0) + 1;
      });
    });
    
    // Count script hashes
    (pageResult.scripts || []).forEach(script => {
      const hash = script.hash || script.src;
      if (hash) {
        scriptHashes[hash] = (scriptHashes[hash] || 0) + 1;
      }
    });
    
    // Count library sources
    (pageResult.scripts || []).forEach(script => {
      if (script.src) {
        const domain = new URL(script.src).hostname;
        const libName = script.src.split('/').pop().split('?')[0];
        const key = `${domain}/${libName}`;
        librarySources[key] = (librarySources[key] || 0) + 1;
      }
    });
  });
  
  // Find duplicates
  Object.entries(idCounts).forEach(([key, count]) => {
    if (count > 1) {
      duplicates.duplicateIds[key] = count;
    }
  });
  
  Object.entries(scriptHashes).forEach(([hash, count]) => {
    if (count > 1) {
      duplicates.duplicateScripts[hash] = count;
    }
  });
  
  Object.entries(librarySources).forEach(([lib, count]) => {
    if (count > 1) {
      duplicates.duplicateLibraries[lib] = count;
    }
  });
  
  return duplicates;
}

/**
 * Detect unauthorized partners
 */
function detectUnauthorizedPartners(pageResults, allowedPartners = []) {
  const unauthorized = [];
  const allowedDomains = new Set(allowedPartners.map(p => p.toLowerCase()));
  
  pageResults.forEach(pageResult => {
    // Check scripts
    (pageResult.scripts || []).forEach(script => {
      if (script.src) {
        try {
          const domain = new URL(script.src).hostname.replace(/^www\./, '');
          if (!allowedDomains.has(domain.toLowerCase()) && isVendorDomain(domain)) {
            unauthorized.push({
              type: 'script',
              url: script.src,
              domain: domain,
              page: pageResult.url,
              reason: 'Not in allowed partners list'
            });
          }
        } catch (e) {
          // Skip invalid URLs
        }
      }
    });
    
    // Check network requests
    (pageResult.networkRequests || []).forEach(req => {
      try {
        const domain = new URL(req.url).hostname.replace(/^www\./, '');
        if (!allowedDomains.has(domain.toLowerCase()) && isVendorDomain(domain)) {
          unauthorized.push({
            type: 'network_request',
            url: req.url,
            domain: domain,
            page: pageResult.url,
            reason: 'Not in allowed partners list'
          });
        }
      } catch (e) {
        // Skip invalid URLs
      }
    });
  });
  
  // Deduplicate
  const seen = new Set();
  return unauthorized.filter(item => {
    const key = `${item.type}:${item.domain}:${item.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Main scan function
 */
async function scanCMSOutput(options) {
  const {
    baseUrl,
    buildLabel,
    authHeader = null,
    authCookie = null,
    crawlDepth = 1,
    samplePages = [],
    allowedPartners = [],
    timeout = 30000
  } = options;
  
  console.log(`[CMS Scanner] Starting scan for: ${baseUrl}`);
  console.log(`[CMS Scanner] Options:`, { buildLabel, crawlDepth, samplePagesCount: samplePages.length, allowedPartnersCount: allowedPartners.length });
  
  const scanId = `cms_${Date.now()}`;
  const pagesToScan = [];
  
  // Add sample pages
  if (samplePages && samplePages.length > 0) {
    pagesToScan.push(...samplePages);
    console.log(`[CMS Scanner] Using ${samplePages.length} sample pages`);
  } else {
    // Default: just scan base URL
    pagesToScan.push(baseUrl);
    console.log(`[CMS Scanner] Using base URL only`);
  }
  
  // Simple crawl (limited depth)
  if (crawlDepth > 0 && pagesToScan.length === 1) {
    // For now, just scan the base URL
    // In a full implementation, you'd crawl links here
  }
  
  let browser;
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cms-monitor/scanner.cjs:523',message:'Before browser launch',data:{hasChromium:!!chromium,chromiumType:typeof chromium},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    console.log(`[CMS Scanner] Launching browser...`);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cms-monitor/scanner.cjs:531',message:'Browser launched successfully',data:{browserPid:browser?._browserPid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    console.log(`[CMS Scanner] Browser launched successfully`);
  } catch (browserError) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e933f9c9-0276-4ab0-af7d-7f6d057d32c0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cms-monitor/scanner.cjs:540',message:'Browser launch failed',data:{errorMessage:browserError.message,errorStack:browserError.stack,errorCode:browserError.code,errorName:browserError.name},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1,H2,H3,H4'})}).catch(()=>{});
    // #endregion
    
    console.error(`[CMS Scanner] Failed to launch browser:`, browserError);
    throw new Error(`Failed to launch browser: ${browserError.message}`);
  }
  
  const pageResults = [];
  const screenshots = [];
  
  try {
    for (let i = 0; i < pagesToScan.length; i++) {
      const url = pagesToScan[i];
      console.log(`[CMS Scanner] Scanning page ${i + 1}/${pagesToScan.length}: ${url}`);
      
      try {
        const page = await browser.newPage();
        console.log(`[CMS Scanner] Page created, starting scan...`);
        
        const result = await scanPage(page, url, {
          authHeader,
          authCookie,
          timeout
        });
        
        console.log(`[CMS Scanner] Page scan completed:`, {
          url: result.url,
          scriptsCount: result.scripts?.length || 0,
          pixelsCount: result.pixels?.length || 0,
          hasError: !!result.error
        });
        
        pageResults.push(result);
        
        // Take screenshot for first few pages
        if (screenshots.length < 3) {
          try {
            const screenshotsDir = path.join(__dirname, '..', 'data', 'cms-monitor', 'screenshots');
            if (!fs.existsSync(screenshotsDir)) {
              fs.mkdirSync(screenshotsDir, { recursive: true });
            }
            const screenshotPath = path.join(screenshotsDir, `cms-monitor-screenshot-${scanId}-${screenshots.length}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: false });
            screenshots.push(screenshotPath);
          } catch (e) {
            // Screenshot failed, continue
            console.warn('Screenshot failed:', e.message);
          }
        }
        
        await page.close();
        console.log(`[CMS Scanner] Page closed`);
      } catch (pageError) {
        console.error(`[CMS Scanner] Error scanning page ${url}:`, pageError);
        pageResults.push({
          url,
          error: pageError.message,
          scripts: [],
          pixels: [],
          networkRequests: [],
          measurementIds: {},
          widgetMap: {}
        });
      }
    }
    
    console.log(`[CMS Scanner] All pages scanned. Total results: ${pageResults.length}`);
  } catch (scanError) {
    console.error(`[CMS Scanner] Fatal error during scanning:`, scanError);
    throw scanError;
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log(`[CMS Scanner] Browser closed`);
      } catch (closeError) {
        console.warn(`[CMS Scanner] Error closing browser:`, closeError.message);
      }
    }
  }
  
  // Analyze results
  console.log(`[CMS Scanner] Analyzing results...`);
  let duplicates, unauthorized, injectedScripts;
  
  try {
    duplicates = findDuplicates(pageResults);
    console.log(`[CMS Scanner] Duplicates found:`, {
      ids: Object.keys(duplicates.duplicateIds).length,
      scripts: Object.keys(duplicates.duplicateScripts).length,
      libraries: Object.keys(duplicates.duplicateLibraries).length
    });
  } catch (dupError) {
    console.error(`[CMS Scanner] Error finding duplicates:`, dupError);
    duplicates = { duplicateIds: {}, duplicateScripts: {}, duplicateLibraries: {} };
  }
  
  try {
    unauthorized = detectUnauthorizedPartners(pageResults, allowedPartners);
    console.log(`[CMS Scanner] Unauthorized partners found: ${unauthorized.length}`);
  } catch (unauthError) {
    console.error(`[CMS Scanner] Error detecting unauthorized partners:`, unauthError);
    unauthorized = [];
  }
  
  // Find injected/unknown scripts (scripts with macros or suspicious patterns)
  injectedScripts = [];
  try {
    pageResults.forEach(pageResult => {
      (pageResult.scripts || []).forEach(script => {
        if (script.macros && script.macros.length > 0) {
          injectedScripts.push({
            ...script,
            page: pageResult.url,
            reason: 'Contains macros'
          });
        }
        if (script.src && hasSuspiciousParams(script.src)) {
          injectedScripts.push({
            ...script,
            page: pageResult.url,
            reason: 'Suspicious query parameters'
          });
        }
      });
    });
    console.log(`[CMS Scanner] Injected scripts found: ${injectedScripts.length}`);
  } catch (injectError) {
    console.error(`[CMS Scanner] Error finding injected scripts:`, injectError);
  }
  
  const summary = {
    totalPages: pageResults.length,
    totalScripts: pageResults.reduce((sum, r) => sum + (r.scripts?.length || 0), 0),
    totalPixels: pageResults.reduce((sum, r) => sum + (r.pixels?.length || 0), 0),
    duplicateIdsCount: Object.keys(duplicates.duplicateIds || {}).length,
    duplicateScriptsCount: Object.keys(duplicates.duplicateScripts || {}).length,
    unauthorizedCount: unauthorized.length,
    injectedScriptsCount: injectedScripts.length
  };
  
  console.log(`[CMS Scanner] Summary:`, summary);
  console.log(`[CMS Scanner] Scan complete. Scan ID: ${scanId}`);
  
  return {
    scanId,
    scanTimestamp: new Date().toISOString(),
    buildLabel,
    baseUrl,
    pagesScanned: pageResults.map(r => r.url),
    pageResults,
    duplicates,
    unauthorized,
    injectedScripts,
    screenshots,
    summary
  };
}

module.exports = {
  scanCMSOutput,
  scanPage
};

