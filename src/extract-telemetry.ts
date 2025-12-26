import type { Page } from 'playwright';
import { upsertOccurrence, type IdType, type SourceType } from './db/analytics-index.js';
import { URL } from 'node:url';

export interface TelemetryOccurrence {
  id_type: IdType;
  id_value: string;
  source: SourceType;
  evidence: string;
  confidence: number;
}

// Regex patterns for ID extraction
const UA_REGEX = /UA-\d{4,10}-\d{1,4}/gi;
const GA4_REGEX = /G-[A-Z0-9]{6,}/gi;
const GTM_REGEX = /GTM-[A-Z0-9]+/gi;
const FBQ_INIT_REGEX = /fbq\(['"]init['"],\s*['"]?(\d{8,18})/gi;
const FB_PIXEL_URL_REGEX = /facebook\.com\/tr\?[^"'\\s]*[?&]id=(\d{8,18})/gi;
const AW_REGEX = /AW-\d+/gi;

/**
 * Extract telemetry IDs from HTML content and scripts
 */
export function extractFromHtml(html: string, url: string): TelemetryOccurrence[] {
  const occurrences: TelemetryOccurrence[] = [];

  // Extract UA IDs
  let match;
  while ((match = UA_REGEX.exec(html)) !== null) {
    const normalized = normalizeUA(match[0]);
    if (normalized) {
      occurrences.push({
        id_type: 'UA',
        id_value: normalized,
        source: 'html',
        evidence: extractContext(html, match.index, 100),
        confidence: 0.8,
      });
    }
  }

  // Extract GA4 IDs
  GA4_REGEX.lastIndex = 0;
  while ((match = GA4_REGEX.exec(html)) !== null) {
    const normalized = normalizeGA4(match[0]);
    if (normalized) {
      occurrences.push({
        id_type: 'GA4',
        id_value: normalized,
        source: 'html',
        evidence: extractContext(html, match.index, 100),
        confidence: 0.8,
      });
    }
  }

  // Extract GTM IDs
  GTM_REGEX.lastIndex = 0;
  while ((match = GTM_REGEX.exec(html)) !== null) {
    const normalized = normalizeGTM(match[0]);
    if (normalized) {
      occurrences.push({
        id_type: 'GTM',
        id_value: normalized,
        source: 'script',
        evidence: extractContext(html, match.index, 100),
        confidence: 0.85,
      });
    }
  }

  // Extract Facebook Pixel IDs from fbq('init', ...)
  FBQ_INIT_REGEX.lastIndex = 0;
  while ((match = FBQ_INIT_REGEX.exec(html)) !== null) {
    const pixelId = match[1];
    if (pixelId) {
      occurrences.push({
        id_type: 'FBP',
        id_value: pixelId,
        source: 'script',
        evidence: extractContext(html, match.index, 100),
        confidence: 0.85,
      });
    }
  }

  // Extract Facebook Pixel IDs from URLs
  FB_PIXEL_URL_REGEX.lastIndex = 0;
  while ((match = FB_PIXEL_URL_REGEX.exec(html)) !== null) {
    const pixelId = match[1];
    if (pixelId) {
      occurrences.push({
        id_type: 'FBP',
        id_value: pixelId,
        source: 'html',
        evidence: extractContext(html, match.index, 100),
        confidence: 0.8,
      });
    }
  }

  // Extract Google Ads IDs
  AW_REGEX.lastIndex = 0;
  while ((match = AW_REGEX.exec(html)) !== null) {
    const normalized = normalizeAW(match[0]);
    if (normalized) {
      occurrences.push({
        id_type: 'AW',
        id_value: normalized,
        source: 'html',
        evidence: extractContext(html, match.index, 100),
        confidence: 0.8,
      });
    }
  }

  return deduplicateOccurrences(occurrences);
}

/**
 * Extract telemetry IDs from network request URLs
 */
export function extractFromNetworkUrl(requestUrl: string): TelemetryOccurrence[] {
  const occurrences: TelemetryOccurrence[] = [];
  const urlLower = requestUrl.toLowerCase();

  try {
    const url = new URL(requestUrl);
    const searchParams = url.searchParams;

    // Google Analytics / GA4 collect endpoints
    if (urlLower.includes('google-analytics.com') || urlLower.includes('doubleclick.net')) {
      // Extract tid parameter (tracking ID)
      const tid = searchParams.get('tid') || searchParams.get('t');
      if (tid) {
        if (tid.startsWith('G-')) {
          const normalized = normalizeGA4(tid);
          if (normalized) {
            occurrences.push({
              id_type: 'GA4',
              id_value: normalized,
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
              source: 'network',
              evidence: truncateUrl(requestUrl, 200),
              confidence: 0.95,
            });
          }
        }
      }
    }

    // GTM container ID from gtm.js URL
    if (urlLower.includes('googletagmanager.com/gtm.js')) {
      const id = searchParams.get('id');
      if (id) {
        const normalized = normalizeGTM(id);
        if (normalized) {
          occurrences.push({
            id_type: 'GTM',
            id_value: normalized,
            source: 'network',
            evidence: truncateUrl(requestUrl, 200),
            confidence: 0.95,
          });
        }
      }
    }

    // Facebook Pixel from /tr endpoint
    if (urlLower.includes('facebook.com/tr') || urlLower.includes('connect.facebook.net')) {
      const pixelId = searchParams.get('id');
      if (pixelId && /^\d{8,18}$/.test(pixelId)) {
        occurrences.push({
          id_type: 'FBP',
          id_value: pixelId,
          source: 'network',
          evidence: truncateUrl(requestUrl, 200),
          confidence: 0.95,
        });
      }
    }

    // Google Ads from aw- URLs
    if (urlLower.includes('aw-')) {
      const awMatch = requestUrl.match(/aw-(\d+)/i);
      if (awMatch) {
        const normalized = normalizeAW(`AW-${awMatch[1]}`);
        if (normalized) {
          occurrences.push({
            id_type: 'AW',
            id_value: normalized,
            source: 'network',
            evidence: truncateUrl(requestUrl, 200),
            confidence: 0.95,
          });
        }
      }
    }
  } catch (e) {
    // Invalid URL, skip
  }

  return deduplicateOccurrences(occurrences);
}

/**
 * Extract IDs from GTM container JavaScript
 */
export async function extractFromGtmJs(gtmContainerId: string, page: Page): Promise<TelemetryOccurrence[]> {
  const occurrences: TelemetryOccurrence[] = [];
  
  try {
    const gtmUrl = `https://www.googletagmanager.com/gtm.js?id=${gtmContainerId}`;
    const response = await page.goto(gtmUrl, { waitUntil: 'networkidle' }).catch(() => null);
    
    if (!response || !response.ok()) {
      return occurrences;
    }

    const gtmJs = await response.text();
    
    // Extract GA4/UA from GTM JS
    let match;
    GA4_REGEX.lastIndex = 0;
    while ((match = GA4_REGEX.exec(gtmJs)) !== null) {
      const normalized = normalizeGA4(match[0]);
      if (normalized) {
        occurrences.push({
          id_type: 'GA4',
          id_value: normalized,
          source: 'gtm_js',
          evidence: extractContext(gtmJs, match.index, 100),
          confidence: 0.9,
        });
      }
    }

    UA_REGEX.lastIndex = 0;
    while ((match = UA_REGEX.exec(gtmJs)) !== null) {
      const normalized = normalizeUA(match[0]);
      if (normalized) {
        occurrences.push({
          id_type: 'UA',
          id_value: normalized,
          source: 'gtm_js',
          evidence: extractContext(gtmJs, match.index, 100),
          confidence: 0.9,
        });
      }
    }

    AW_REGEX.lastIndex = 0;
    while ((match = AW_REGEX.exec(gtmJs)) !== null) {
      const normalized = normalizeAW(match[0]);
      if (normalized) {
        occurrences.push({
          id_type: 'AW',
          id_value: normalized,
          source: 'gtm_js',
          evidence: extractContext(gtmJs, match.index, 100),
          confidence: 0.9,
        });
      }
    }
  } catch (e) {
    // Failed to fetch GTM JS, skip
  }

  return deduplicateOccurrences(occurrences);
}

/**
 * Main extraction function that processes page HTML and network requests
 */
export async function extractTelemetryIds(
  page: Page,
  html: string,
  url: string,
  networkRequests: string[]
): Promise<TelemetryOccurrence[]> {
  const allOccurrences: TelemetryOccurrence[] = [];
  const debug = process.env.REVERSE_SEARCH_DEBUG === 'true';

  // Extract from HTML
  const htmlOccurrences = extractFromHtml(html, url);
  if (debug) {
    console.log(`[extractTelemetryIds] Found ${htmlOccurrences.length} IDs in HTML`);
  }
  allOccurrences.push(...htmlOccurrences);

  // Extract from network requests
  const networkOccurrences: TelemetryOccurrence[] = [];
  for (const requestUrl of networkRequests) {
    const extracted = extractFromNetworkUrl(requestUrl);
    networkOccurrences.push(...extracted);
  }
  if (debug) {
    console.log(`[extractTelemetryIds] Found ${networkOccurrences.length} IDs in network requests`);
  }
  allOccurrences.push(...networkOccurrences);

  // Extract from GTM containers (if any GTM IDs found)
  const gtmIds = allOccurrences
    .filter(o => o.id_type === 'GTM')
    .map(o => o.id_value);
  
  const uniqueGtmIds = [...new Set(gtmIds)];
  for (const gtmId of uniqueGtmIds) {
    const gtmOccurrences = await extractFromGtmJs(gtmId, page);
    if (debug) {
      console.log(`[extractTelemetryIds] Found ${gtmOccurrences.length} IDs in GTM ${gtmId}`);
    }
    allOccurrences.push(...gtmOccurrences);
  }

  return deduplicateOccurrences(allOccurrences);
}

/**
 * Normalize and validate UA ID
 */
function normalizeUA(id: string): string | null {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^UA-\d{8,10}-\d{1,2}$/.test(upper) ? upper : null;
}

/**
 * Normalize and validate GA4 ID
 */
function normalizeGA4(id: string): string | null {
  if (!id) return null;
  const upper = id.toUpperCase();
  // GA4 IDs are G- followed by exactly 10 alphanumeric characters
  return /^G-[A-Z0-9]{10}$/.test(upper) ? upper : null;
}

/**
 * Normalize and validate GTM ID
 */
function normalizeGTM(id: string): string | null {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^GTM-[A-Z0-9]{4,10}$/.test(upper) ? upper : null;
}

/**
 * Normalize and validate AW (Google Ads) ID
 */
function normalizeAW(id: string): string | null {
  if (!id) return null;
  const upper = id.toUpperCase();
  return /^AW-\d{6,}$/.test(upper) ? upper : null;
}

/**
 * Extract context around a match position
 */
function extractContext(text: string, index: number, contextLength: number): string {
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + contextLength);
  return text.substring(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Truncate URL to safe length
 */
function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

/**
 * Deduplicate occurrences by (id_type, id_value, source)
 */
function deduplicateOccurrences(occurrences: TelemetryOccurrence[]): TelemetryOccurrence[] {
  const seen = new Set<string>();
  const unique: TelemetryOccurrence[] = [];

  for (const occ of occurrences) {
    const key = `${occ.id_type}:${occ.id_value}:${occ.source}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(occ);
    }
  }

  return unique;
}

