const crypto = require('crypto');
const { persistAggregates, clearForScan } = require('../src/db/affected-ad-vendors.cjs');

function stripCacheBusters(url) {
  try {
    const parsed = new URL(url);
    const cachebusterParams = ['cb', 'cachebust', '_', 'ord', 'rnd', 't', 'timestamp', 'nocache', 'r'];
    cachebusterParams.forEach((param) => parsed.searchParams.delete(param));
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (e) {
    return url;
  }
}

function deriveAdSlotId(beacon) {
  const candidates = [
    beacon.slotId,
    beacon.adUnitPath,
    beacon.placement,
    beacon?.identifiers?.placement,
    beacon?.identifiers?.creativeId,
    beacon.creativeId
  ].filter(Boolean);

  if (candidates.length > 0) {
    const first = candidates.find((c) => String(c).toLowerCase() !== 'unknown');
    if (first) return String(first);
  }

  // Fallback to stable fingerprint of URL + vendor
  const fingerprint = crypto
    .createHash('sha1')
    .update(`${beacon.vendor_host || ''}|${beacon.requestUrl || ''}`)
    .digest('hex')
    .slice(0, 12);
  return `slot-${fingerprint}`;
}

function fingerprintEvent(beacon) {
  return `${beacon.vendor_host || ''}|${deriveAdSlotId(beacon)}|${stripCacheBusters(beacon.requestUrl || '')}`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeGroupMetrics(events, stackingSuspected = false) {
  if (!events.length) return null;
  const timestamps = events.map((e) => e.ts).sort((a, b) => a - b);
  const fingerprints = new Set(events.map((e) => e.fingerprint));

  const impressions = events.length;
  const unique_event_fingerprints = fingerprints.size;
  const duplicate_event_count = impressions - unique_event_fingerprints;
  const duplication_rate = impressions > 0 ? duplicate_event_count / impressions : 0;

  // per-second burst
  const perSecond = new Map();
  timestamps.forEach((ts) => {
    const bucket = Math.floor(ts / 1000);
    perSecond.set(bucket, (perSecond.get(bucket) || 0) + 1);
  });
  const max_impressions_per_second = Math.max(...perSecond.values());

  // sliding window burst (any 1s window)
  let burst_events_1s = 0;
  let left = 0;
  for (let right = 0; right < timestamps.length; right++) {
    while (timestamps[right] - timestamps[left] > 1000) {
      left++;
    }
    burst_events_1s = Math.max(burst_events_1s, right - left + 1);
  }

  // median inter-event
  const deltas = [];
  for (let i = 1; i < timestamps.length; i++) {
    deltas.push(timestamps[i] - timestamps[i - 1]);
  }
  const median_inter_event_ms = deltas.length ? median(deltas) : null;

  const first_seen_ts = new Date(timestamps[0]).toISOString();
  const last_seen_ts = new Date(timestamps[timestamps.length - 1]).toISOString();

  // geometry-based signals unavailable => default to 0 / false until we capture
  const tiny_frame_count = events.reduce((acc, ev) => acc + (ev.tiny_frame ? 1 : 0), 0);

  return {
    impressions,
    unique_event_fingerprints,
    duplicate_event_count,
    duplication_rate,
    max_impressions_per_second,
    median_inter_event_ms,
    burst_events_1s,
    first_seen_ts,
    last_seen_ts,
    tiny_frame_count,
    stacking_suspected: stackingSuspected ? 1 : 0,
    brand_guess: null,
    brand_confidence: null,
    brand_method: 'none'
  };
}

function aggregateAffectedVendors(scanId, publisherId, rawEvents, options = {}) {
  if (!scanId || !publisherId) return [];
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return [];

  const grouped = new Map();

  rawEvents.forEach((ev) => {
    const vendor_host = ev.vendor_host || '';
    const ad_slot_id = deriveAdSlotId(ev);
    const fingerprint = ev.fingerprint || fingerprintEvent(ev);
    const key = `${vendor_host}|${ad_slot_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push({ ...ev, vendor_host, ad_slot_id, fingerprint });
  });

  const aggregates = [];
  grouped.forEach((events, key) => {
    const metrics = computeGroupMetrics(events, options.stackingSuspected);
    if (!metrics) return;
    aggregates.push({
      vendor_host: events[0].vendor_host,
      ad_slot_id: events[0].ad_slot_id,
      ...metrics
    });
  });

  return aggregates;
}

function persistAffectedVendorsFromEvents(scanId, publisherId, rawEvents, options = {}) {
  const aggregates = aggregateAffectedVendors(scanId, publisherId, rawEvents, options);
  clearForScan(scanId, publisherId);
  if (aggregates.length > 0) {
    persistAggregates(scanId, publisherId, aggregates);
  }
  return aggregates;
}

function buildEvidencePayload(scanId, publisherId, rows) {
  const total_impressions = rows.reduce((sum, r) => sum + (r.impressions || 0), 0);
  const total_rows = rows.length;
  const firstSeen = rows.reduce((min, r) => (r.first_seen_ts && (!min || r.first_seen_ts < min) ? r.first_seen_ts : min), null);
  const lastSeen = rows.reduce((max, r) => (r.last_seen_ts && (!max || r.last_seen_ts > max) ? r.last_seen_ts : max), null);

  return {
    evidence_type: 'affected_ad_vendors_hosts',
    semantics: 'ad_tech_platforms_not_brands',
    scan_id: scanId,
    publisher: { id: publisherId, domain: publisherId },
    window: { start_ts: firstSeen, end_ts: lastSeen },
    summary: {
      total_rows,
      total_impressions,
      vendors: rows.map((r) => ({
        vendor_host: r.vendor_host,
        impressions: r.impressions,
        duplication_rate: r.duplication_rate
      }))
    },
    rows: rows.map((r) => ({
      vendor_host: r.vendor_host,
      ad_slot_id: r.ad_slot_id,
      impressions: r.impressions,
      duplication_rate: r.duplication_rate,
      burst_events_1s: r.burst_events_1s,
      max_impressions_per_second: r.max_impressions_per_second,
      stacking_suspected: !!r.stacking_suspected,
      brand_guess: r.brand_guess,
      brand_confidence: r.brand_confidence,
      brand_method: r.brand_method
    })),
    provenance: {
      source: 'confirmed_impression_events',
      aggregation: 'vendor_host + ad_slot_id',
      generated_at: new Date().toISOString()
    }
  };
}

module.exports = {
  aggregateAffectedVendors,
  persistAffectedVendorsFromEvents,
  buildEvidencePayload
};

