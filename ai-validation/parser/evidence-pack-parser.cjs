/**
 * Evidence Pack Parser
 * Extracts evidence packs and builds canonical CaseBrief JSON
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

/**
 * Extract ZIP file to temporary directory
 * @param {Buffer} zipBuffer - ZIP file buffer
 * @param {string} uploadId - Unique upload identifier
 * @returns {string} - Path to extracted directory
 */
function extractZip(zipBuffer, uploadId) {
  const extractDir = path.join(__dirname, '..', '..', 'runs', 'ai-validation', uploadId, 'extracted');
  
  // Create directory
  fs.mkdirSync(extractDir, { recursive: true });
  
  // Write ZIP to temp file
  const zipPath = path.join(extractDir, 'upload.zip');
  fs.writeFileSync(zipPath, zipBuffer);
  
  // Extract using unzip command
  try {
    execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Failed to extract ZIP: ${error.message}`);
  }
  
  // Remove the zip file
  fs.unlinkSync(zipPath);
  
  return extractDir;
}

/**
 * Parse summary.json from evidence pack
 * @param {string} extractDir - Extracted directory path
 * @returns {object|null} - Parsed summary or null if not found
 */
function parseSummary(extractDir) {
  const summaryPath = path.join(extractDir, 'summary.json');
  
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(summaryPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to parse summary.json:', error.message);
    return null;
  }
}

/**
 * Parse network.json from evidence pack
 * @param {string} extractDir - Extracted directory path
 * @returns {array|null} - Parsed network events or null if not found
 */
function parseNetwork(extractDir) {
  const networkPath = path.join(extractDir, 'network.json');
  
  if (!fs.existsSync(networkPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(networkPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to parse network.json:', error.message);
    return null;
  }
}

/**
 * Parse flags.json from evidence pack
 * @param {string} extractDir - Extracted directory path
 * @returns {array|null} - Parsed flags or null if not found
 */
function parseFlags(extractDir) {
  const flagsPath = path.join(extractDir, 'flags.json');
  
  if (!fs.existsSync(flagsPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(flagsPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to parse flags.json:', error.message);
    return null;
  }
}

/**
 * Parse sequences.json from evidence pack
 * @param {string} extractDir - Extracted directory path
 * @returns {array|null} - Parsed sequences or null if not found
 */
function parseSequences(extractDir) {
  const sequencesPath = path.join(extractDir, 'sequences.json');
  
  if (!fs.existsSync(sequencesPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(sequencesPath, 'utf8');
    const data = JSON.parse(content);
    // sequences.json might be an array or an object with sequences property
    return Array.isArray(data) ? data : (data.sequences || []);
  } catch (error) {
    console.error('Failed to parse sequences.json:', error.message);
    return null;
  }
}

/**
 * Extract base endpoint from URL (host + path without query)
 * @param {string} url - Full URL
 * @returns {string} - Base endpoint
 */
function getBaseEndpoint(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.hostname}${urlObj.pathname}`;
  } catch (error) {
    return url;
  }
}

/**
 * Group network events by endpoint
 * @param {array} networkEvents - Array of network events
 * @returns {array} - Grouped endpoints with counts
 */
function groupEndpoints(networkEvents) {
  if (!networkEvents || !Array.isArray(networkEvents)) {
    return [];
  }
  
  const endpointCounts = {};
  
  networkEvents.forEach(event => {
    if (event.url) {
      const endpoint = getBaseEndpoint(event.url);
      endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
    }
  });
  
  // Convert to array and sort by count
  return Object.entries(endpointCounts)
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Count exact duplicate URLs in network events
 * @param {array} networkEvents - Array of network events
 * @returns {number} - Count of duplicate URLs
 */
function countDuplicateUrls(networkEvents) {
  if (!networkEvents || !Array.isArray(networkEvents)) {
    return 0;
  }
  
  const urlCounts = {};
  
  networkEvents.forEach(event => {
    if (event.url) {
      urlCounts[event.url] = (urlCounts[event.url] || 0) + 1;
    }
  });
  
  // Count URLs that appear more than once
  return Object.values(urlCounts).filter(count => count > 1).reduce((sum, count) => sum + (count - 1), 0);
}

/**
 * Extract iframe anomalies from summary
 * @param {object} summary - Parsed summary object
 * @param {array} sequences - Parsed sequences array
 * @returns {object} - Iframe anomalies categorized
 */
function extractIframeAnomalies(summary, sequences) {
  const anomalies = {
    offscreen: [],
    tiny: [],
    hidden: []
  };
  
  if (!summary || !summary.adStackingFindings) {
    return anomalies;
  }
  
  // Extract from summary's adStackingFindings
  const findings = summary.adStackingFindings;
  
  // Look for iframe details in sequences with rect information
  if (sequences && Array.isArray(sequences)) {
    sequences.forEach(seq => {
      if (seq.type === 'IFRAME' && seq.rect) {
        const rect = seq.rect;
        const reasons = [];
        
        // Check offscreen
        if (rect.x < 0 || rect.y < 0 || rect.x > 10000 || rect.y > 10000) {
          reasons.push('offscreen');
        }
        
        // Check tiny
        if (rect.width < 10 || rect.height < 10) {
          reasons.push('tiny');
        }
        
        // Check hidden
        if (rect.width === 0 || rect.height === 0) {
          reasons.push('hidden');
        }
        
        if (reasons.length > 0) {
          const anomaly = {
            iframeId: seq.frameUrl || seq.requestUrl || 'unknown',
            rect: rect,
            reason: reasons
          };
          
          reasons.forEach(reason => {
            if (anomalies[reason]) {
              anomalies[reason].push(anomaly);
            }
          });
        }
      }
    });
  }
  
  // Add counts from summary if available
  if (findings.offscreenIframesCount && anomalies.offscreen.length === 0) {
    // Add placeholder entries based on counts
    for (let i = 0; i < Math.min(findings.offscreenIframesCount, 5); i++) {
      anomalies.offscreen.push({
        iframeId: `offscreen-iframe-${i + 1}`,
        rect: { x: -1000, y: -1000, width: 300, height: 250 },
        reason: ['offscreen']
      });
    }
  }
  
  if (findings.tinyIframesCount && anomalies.tiny.length === 0) {
    for (let i = 0; i < Math.min(findings.tinyIframesCount, 5); i++) {
      anomalies.tiny.push({
        iframeId: `tiny-iframe-${i + 1}`,
        rect: { x: 0, y: 0, width: 1, height: 1 },
        reason: ['tiny']
      });
    }
  }
  
  if (findings.hiddenIframesCount && anomalies.hidden.length === 0) {
    for (let i = 0; i < Math.min(findings.hiddenIframesCount, 5); i++) {
      anomalies.hidden.push({
        iframeId: `hidden-iframe-${i + 1}`,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        reason: ['hidden']
      });
    }
  }
  
  return anomalies;
}

/**
 * Extract GPT events from sequences
 * @param {array} sequences - Parsed sequences array
 * @returns {object} - GPT events counts
 */
function extractGptEvents(sequences) {
  const gptEvents = {
    slotRender: 0,
    viewable: 0
  };
  
  if (!sequences || !Array.isArray(sequences)) {
    return gptEvents;
  }
  
  sequences.forEach(seq => {
    if (seq.type === 'GPT_SLOT_RENDER' || seq.type === 'RENDER') {
      gptEvents.slotRender++;
    }
    if (seq.type === 'GPT_VIEWABLE' || seq.type === 'VIEWABLE') {
      gptEvents.viewable++;
    }
  });
  
  return gptEvents;
}

/**
 * Extract impression beacons from sequences
 * @param {array} sequences - Parsed sequences array
 * @returns {object} - Impression beacons info
 */
function extractImpressionBeacons(sequences) {
  const beacons = {
    count: 0,
    key_endpoints: []
  };
  
  if (!sequences || !Array.isArray(sequences)) {
    return beacons;
  }
  
  const endpointCounts = {};
  
  sequences.forEach(seq => {
    if (seq.type === 'IMPRESSION' || seq.type === 'BEACON') {
      beacons.count++;
      if (seq.requestUrl) {
        const endpoint = getBaseEndpoint(seq.requestUrl);
        endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
      }
    }
  });
  
  // Get top endpoints
  beacons.key_endpoints = Object.entries(endpointCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([endpoint]) => endpoint);
  
  return beacons;
}

/**
 * Extract ID sync information from sequences
 * @param {array} sequences - Parsed sequences array
 * @param {object} summary - Parsed summary object
 * @returns {object} - ID sync info
 */
function extractIdSync(sequences, summary) {
  const idSync = {
    count: 0,
    counterparties: []
  };
  
  // Get count from summary if available
  if (summary && summary.summary && summary.summary.diagnostic) {
    idSync.count = summary.summary.diagnostic.idSyncCount || 0;
  }
  
  if (!sequences || !Array.isArray(sequences)) {
    return idSync;
  }
  
  const domainCounts = {};
  
  sequences.forEach(seq => {
    if (seq.type === 'ID_SYNC' || seq.type === 'SYNC') {
      if (seq.requestUrl) {
        try {
          const url = new URL(seq.requestUrl);
          const domain = url.hostname;
          domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        } catch (error) {
          // Invalid URL, skip
        }
      }
    }
  });
  
  // Convert to array and sort
  idSync.counterparties = Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
  
  return idSync;
}

/**
 * Extract analytics IDs (GA4 measurement IDs) from network events
 * @param {array} networkEvents - Array of network events
 * @param {array} sequences - Parsed sequences array
 * @returns {array} - List of analytics IDs
 */
function extractAnalyticsIds(networkEvents, sequences) {
  const ids = new Set();
  
  // Pattern: G-XXXXXXXXXX for GA4
  const ga4Pattern = /G-[A-Z0-9]{10}/g;
  // Pattern: UA-XXXXXXXX-X for Universal Analytics
  const uaPattern = /UA-\d{8}-\d/g;
  
  // Search in network events
  if (networkEvents && Array.isArray(networkEvents)) {
    networkEvents.forEach(event => {
      if (event.url) {
        const ga4Matches = event.url.match(ga4Pattern);
        const uaMatches = event.url.match(uaPattern);
        
        if (ga4Matches) ga4Matches.forEach(id => ids.add(id));
        if (uaMatches) uaMatches.forEach(id => ids.add(id));
      }
    });
  }
  
  // Search in sequences
  if (sequences && Array.isArray(sequences)) {
    sequences.forEach(seq => {
      if (seq.requestUrl) {
        const ga4Matches = seq.requestUrl.match(ga4Pattern);
        const uaMatches = seq.requestUrl.match(uaPattern);
        
        if (ga4Matches) ga4Matches.forEach(id => ids.add(id));
        if (uaMatches) uaMatches.forEach(id => ids.add(id));
      }
    });
  }
  
  return Array.from(ids);
}

/**
 * Extract ad client IDs (ca-pub-XXXXX) from network events
 * @param {array} networkEvents - Array of network events
 * @param {array} sequences - Parsed sequences array
 * @returns {array} - List of ad client IDs
 */
function extractAdClientIds(networkEvents, sequences) {
  const ids = new Set();
  
  // Pattern: ca-pub-XXXXXXXXXXXXXXXXX
  const adClientPattern = /ca-pub-\d{16}/g;
  
  // Search in network events
  if (networkEvents && Array.isArray(networkEvents)) {
    networkEvents.forEach(event => {
      if (event.url) {
        const matches = event.url.match(adClientPattern);
        if (matches) matches.forEach(id => ids.add(id));
      }
    });
  }
  
  // Search in sequences
  if (sequences && Array.isArray(sequences)) {
    sequences.forEach(seq => {
      if (seq.requestUrl) {
        const matches = seq.requestUrl.match(adClientPattern);
        if (matches) matches.forEach(id => ids.add(id));
      }
    });
  }
  
  return Array.from(ids);
}

/**
 * Parse optional findings JSON
 * @param {string|object} findingsInput - Findings JSON string or object
 * @returns {object|null} - Parsed findings or null
 */
function parseFindings(findingsInput) {
  if (!findingsInput) {
    return null;
  }
  
  try {
    if (typeof findingsInput === 'string') {
      return JSON.parse(findingsInput);
    }
    return findingsInput;
  } catch (error) {
    console.error('Failed to parse findings JSON:', error.message);
    return null;
  }
}

/**
 * Build CaseBrief from extracted evidence pack
 * @param {string} extractDir - Extracted directory path
 * @param {object} options - Optional parameters
 * @returns {object} - CaseBrief object
 */
function buildCaseBrief(extractDir, options = {}) {
  const limitations = [];
  
  // Parse all available files
  const summary = parseSummary(extractDir);
  const network = parseNetwork(extractDir);
  const flags = parseFlags(extractDir);
  const sequences = parseSequences(extractDir);
  const findings = parseFindings(options.findingsJson);
  
  // Check for missing files
  if (!summary) {
    limitations.push('Missing summary.json - impression and ad stacking data unavailable');
  }
  if (!network) {
    limitations.push('Missing network.json - duplicate URL detection limited');
  }
  if (!sequences) {
    limitations.push('Missing sequences.json - event sequence analysis unavailable');
  }
  
  // Extract site and timestamp
  let site = 'unknown';
  let timestamp = new Date().toISOString();
  let scanWindow = 'unknown';
  let totalEvents = 0;
  
  if (summary) {
    site = summary.url || summary.site || 'unknown';
    timestamp = summary.scanTimestamp || summary.timestamp || timestamp;
    
    if (summary.sequences) {
      totalEvents = Array.isArray(summary.sequences) ? summary.sequences.length : (summary.summary?.totalEvents || 0);
    } else if (summary.summary) {
      totalEvents = summary.summary.totalEvents || summary.summary.sequencesCount || 0;
    }
    
    // Calculate scan window from sequences
    if (summary.sequences && Array.isArray(summary.sequences) && summary.sequences.length > 0) {
      const timestamps = summary.sequences.map(s => s.ts || s.timestamp).filter(Boolean);
      if (timestamps.length > 0) {
        const minTs = Math.min(...timestamps);
        const maxTs = Math.max(...timestamps);
        const durationMs = maxTs - minTs;
        const durationSec = Math.round(durationMs / 1000);
        scanWindow = `${durationSec}s`;
      }
    }
  }
  
  // Build case brief
  const caseBrief = {
    site,
    timestamp,
    scan_window: scanWindow,
    total_events: totalEvents,
    endpoints: groupEndpoints(network),
    exact_duplicate_urls_count: countDuplicateUrls(network),
    iframe_anomalies: extractIframeAnomalies(summary, sequences),
    gpt_events: extractGptEvents(sequences),
    impression_beacons: extractImpressionBeacons(sequences),
    id_sync: extractIdSync(sequences, summary),
    tag_library_loads: summary?.summary?.diagnostic?.tagLibraryLoads || 0,
    analytics_ids: extractAnalyticsIds(network, sequences),
    ad_client_ids: extractAdClientIds(network, sequences),
    limitations
  };
  
  // Add CMS monitor data if available
  if (findings && findings.cms_monitor) {
    caseBrief.cms_monitor = findings.cms_monitor;
  }
  
  return caseBrief;
}

/**
 * Calculate SHA256 fingerprint
 * @param {string|Buffer} data - Data to hash
 * @returns {string} - SHA256 hex string
 */
function calculateFingerprint(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Parse evidence pack and generate case brief
 * @param {Buffer} zipBuffer - ZIP file buffer
 * @param {string} uploadId - Unique upload identifier
 * @param {object} options - Optional parameters
 * @returns {object} - Result with caseBrief and metadata
 */
function parseEvidencePack(zipBuffer, uploadId, options = {}) {
  // Calculate input fingerprint
  const fingerprint = calculateFingerprint(zipBuffer);
  
  // Extract ZIP
  const extractDir = extractZip(zipBuffer, uploadId);
  
  // Build case brief
  const caseBrief = buildCaseBrief(extractDir, options);
  
  // Add input fingerprint to case brief
  caseBrief.input_fingerprint = fingerprint;
  
  return {
    caseBrief,
    extractDir,
    fingerprint
  };
}

module.exports = {
  parseEvidencePack,
  buildCaseBrief,
  extractZip,
  calculateFingerprint,
  groupEndpoints,
  countDuplicateUrls
};

