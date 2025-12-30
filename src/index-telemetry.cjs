// CommonJS wrapper for telemetry indexing
// This can be used from scanner.cjs

const { chromium } = require('playwright');
const path = require('path');
const { URL } = require('url');

// Import the compiled TypeScript modules (will be available after build)
// For now, we'll implement a simplified version directly here

const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'analytics-index.db');
const fs = require('fs');

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS analytics_id_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_type TEXT NOT NULL CHECK(id_type IN ('UA', 'GA4', 'GTM', 'FBP', 'AW', 'OTHER')),
      id_value TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('html', 'script', 'gtm_js', 'network')),
      evidence TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 0.9,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(id_type, id_value, domain, source)
    );

    CREATE INDEX IF NOT EXISTS idx_id_lookup ON analytics_id_occurrences(id_type, id_value);
    CREATE INDEX IF NOT EXISTS idx_domain ON analytics_id_occurrences(domain);
    CREATE INDEX IF NOT EXISTS idx_last_seen ON analytics_id_occurrences(last_seen_at DESC);
  `);
}

function upsertOccurrence(params) {
  const database = getDb();
  const now = new Date().toISOString();
  const confidence = params.confidence ?? (params.source === 'network' ? 0.95 : params.source === 'html' ? 0.8 : 0.9);

  // Truncate evidence to safe length (500 chars)
  const evidence = params.evidence.length > 500 
    ? params.evidence.substring(0, 497) + '...' 
    : params.evidence;

  const stmt = database.prepare(`
    INSERT INTO analytics_id_occurrences 
      (id_type, id_value, domain, url, source, evidence, first_seen_at, last_seen_at, seen_count, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id_type, id_value, domain, source) 
    DO UPDATE SET
      last_seen_at = ?,
      seen_count = seen_count + 1,
      url = CASE WHEN ? > last_seen_at THEN ? ELSE url END,
      evidence = CASE WHEN ? > last_seen_at THEN ? ELSE evidence END
  `);

  stmt.run(
    params.id_type,
    params.id_value,
    params.domain,
    params.url,
    params.source,
    evidence,
    now,
    now,
    confidence,
    now,
    now,
    params.url,
    now,
    evidence
  );
}

function getHostname(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, '');
    return hostname; // Return full hostname
  } catch (e) {
    return urlString;
  }
}

/**
 * Index telemetry IDs from scan results
 * @param {Object} scanResult - Result from scanWebsite
 * @param {string} scanResult.url - The scanned URL
 * @param {Object} scanResult.tagInventoryDetailed - Detailed tag inventory
 * @param {Array} networkRequests - Array of network request URLs
 */
function indexTelemetryFromScan(scanResult, networkRequests = []) {
  const debug = process.env.REVERSE_SEARCH_DEBUG === 'true';
  const url = scanResult.url;
  const domain = getHostname(url);
  const tagInventoryDetailed = scanResult.tagInventoryDetailed || {};

  if (debug) {
    console.log(`[indexTelemetryFromScan] Indexing telemetry for ${url} (domain: ${domain})`);
  }

  // Index GA4 IDs
  const ga4Verified = (tagInventoryDetailed.ga4 || []).filter(item => (item.classification || 'verified') === 'verified');
  for (const item of ga4Verified) {
    if (item && item.id) {
      upsertOccurrence({
        id_type: 'GA4',
        id_value: item.id.toUpperCase(),
        domain,
        url,
        source: mapSourceToDbSource(item.source || 'script'),
        evidence: `GA4 ID found via ${item.source || 'script'}`,
        confidence: item.source === 'network_collect' ? 0.95 : 0.85,
      });
    }
  }

  // Index UA IDs
  const uaIds = tagInventoryDetailed.ua || [];
  for (const item of uaIds) {
    if (item && item.id) {
      upsertOccurrence({
        id_type: 'UA',
        id_value: item.id.toUpperCase(),
        domain,
        url,
        source: mapSourceToDbSource(item.source || 'script'),
        evidence: `UA ID found via ${item.source || 'script'}`,
        confidence: item.source === 'network_collect' ? 0.95 : 0.85,
      });
    }
  }

  // Index GTM IDs
  const gtmIds = tagInventoryDetailed.gtm || [];
  for (const item of gtmIds) {
    if (item && item.id) {
      upsertOccurrence({
        id_type: 'GTM',
        id_value: item.id.toUpperCase(),
        domain,
        url,
        source: mapSourceToDbSource(item.source || 'script'),
        evidence: `GTM container found via ${item.source || 'script'}`,
        confidence: item.source === 'network_script_src' ? 0.95 : 0.85,
      });
    }
  }

  // Index Facebook Pixel IDs
  const fbIds = tagInventoryDetailed.fb || [];
  for (const item of fbIds) {
    if (item && item.id) {
      upsertOccurrence({
        id_type: 'FBP',
        id_value: String(item.id),
        domain,
        url,
        source: mapSourceToDbSource(item.source || 'script'),
        evidence: `Facebook Pixel found via ${item.source || 'script'}`,
        confidence: item.source === 'network_collect' ? 0.95 : 0.85,
      });
    }
  }

  // Index Google Ads IDs
  const awIds = tagInventoryDetailed.aw || [];
  for (const item of awIds) {
    if (item && item.id) {
      upsertOccurrence({
        id_type: 'AW',
        id_value: item.id.toUpperCase(),
        domain,
        url,
        source: mapSourceToDbSource(item.source || 'script'),
        evidence: `Google Ads ID found via ${item.source || 'script'}`,
        confidence: item.source === 'network_collect' ? 0.95 : 0.85,
      });
    }
  }

  // Index from network requests (additional extraction)
  const networkOccurrences = extractFromNetworkRequests(networkRequests, url, domain);
  for (const occ of networkOccurrences) {
    upsertOccurrence(occ);
  }

  if (debug) {
    console.log(`[indexTelemetryFromScan] Indexed ${ga4Ids.length + uaIds.length + gtmIds.length + fbIds.length + awIds.length} IDs`);
  }
}

function mapSourceToDbSource(source) {
  // Map scanner.cjs source types to DB source types
  if (source.includes('network')) return 'network';
  if (source.includes('gtm')) return 'gtm_js';
  if (source.includes('script')) return 'script';
  return 'html';
}

function extractFromNetworkRequests(networkRequests, url, domain) {
  const occurrences = [];
  const seen = new Set();

  for (const requestUrl of networkRequests) {
    try {
      const urlObj = new URL(requestUrl);
      const searchParams = urlObj.searchParams;
      const urlLower = requestUrl.toLowerCase();

      // GA4/UA from collect endpoints
      if (urlLower.includes('google-analytics.com') || urlLower.includes('doubleclick.net')) {
        const tid = searchParams.get('tid') || searchParams.get('t');
        if (tid) {
          const key = `GA:${tid.toUpperCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            if (tid.startsWith('G-')) {
              const normalized = normalizeGA4(tid);
              if (normalized) {
                occurrences.push({
                  id_type: 'GA4',
                  id_value: normalized,
                  domain,
                  url,
                  source: 'network',
                  evidence: truncateUrl(requestUrl, 200),
                  confidence: 0.95,
                });
              }
            } else if (tid.startsWith('UA-')) {
              const normalized = normalizeUA(tid);
              if (normalized) {
                occurrences.push({
                  id_type: 'UA',
                  id_value: normalized,
                  domain,
                  url,
                  source: 'network',
                  evidence: truncateUrl(requestUrl, 200),
                  confidence: 0.95,
                });
              }
            }
          }
        }
      }

      // GTM from gtm.js
      if (urlLower.includes('googletagmanager.com/gtm.js')) {
        const id = searchParams.get('id');
        if (id) {
          const normalized = normalizeGTM(id);
          if (normalized) {
            const key = `GTM:${normalized}`;
            if (!seen.has(key)) {
              seen.add(key);
              occurrences.push({
                id_type: 'GTM',
                id_value: normalized,
                domain,
                url,
                source: 'network',
                evidence: truncateUrl(requestUrl, 200),
                confidence: 0.95,
              });
            }
          }
        }
      }

      // Facebook Pixel
      if (urlLower.includes('facebook.com/tr') || urlLower.includes('connect.facebook.net')) {
        const pixelId = searchParams.get('id');
        if (pixelId && /^\d{8,18}$/.test(pixelId)) {
          const key = `FBP:${pixelId}`;
          if (!seen.has(key)) {
            seen.add(key);
            occurrences.push({
              id_type: 'FBP',
              id_value: pixelId,
              domain,
              url,
              source: 'network',
              evidence: truncateUrl(requestUrl, 200),
              confidence: 0.95,
            });
          }
        }
      }
    } catch (e) {
      // Skip invalid URLs
    }
  }

  return occurrences;
}

function normalizeUA(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^UA-\d{8,10}-\d{1,2}$/.test(upper) ? upper : null;
}

function normalizeGA4(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^G-[A-Z0-9]{8,12}$/.test(upper) ? upper : null;
}

function normalizeGTM(id) {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^GTM-[A-Z0-9]{4,10}$/.test(upper) ? upper : null;
}

function truncateUrl(url, maxLength) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

function queryById(idType, idValue) {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM analytics_id_occurrences
    WHERE id_type = ? AND id_value = ?
    ORDER BY last_seen_at DESC
  `);
  return stmt.all(idType, idValue);
}

function queryByDomain(domain, limit = 10) {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM analytics_id_occurrences
    WHERE domain = ?
    ORDER BY last_seen_at DESC
    LIMIT ?
  `);
  return stmt.all(domain, limit);
}

function getDistinctDomains(idType, idValue) {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT DISTINCT domain FROM analytics_id_occurrences
    WHERE id_type = ? AND id_value = ?
    ORDER BY domain
  `);
  const rows = stmt.all(idType, idValue);
  return rows.map(r => r.domain);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  indexTelemetryFromScan,
  upsertOccurrence,
  getDb,
  closeDb,
  queryById,
  queryByDomain,
  getDistinctDomains,
};

