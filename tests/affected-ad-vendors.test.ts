import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  aggregateAffectedVendors,
  buildEvidencePayload
} = require('../ad-impression-verification/affected-vendors.cjs');

describe('affected ad vendors aggregation', () => {
  const baseEvent = {
    vendor_host: 'securepubads.g.doubleclick.net',
    requestUrl: 'https://securepubads.g.doubleclick.net/gampad/ads?slot=top_banner'
  };

  it('counts duplicate impressions instead of deduping them away', () => {
    const events = [
      { ...baseEvent, ts: 0 },
      { ...baseEvent, ts: 500 },
      { ...baseEvent, ts: 900 }
    ];
    const aggregates = aggregateAffectedVendors('scan1', 'publisher', events);
    expect(aggregates.length).toBe(1);
    const row = aggregates[0];
    expect(row.impressions).toBe(3);
    expect(row.unique_event_fingerprints).toBe(1);
    expect(row.duplicate_event_count).toBe(2);
    expect(row.duplication_rate).toBeCloseTo(2 / 3, 3);
    expect(row.burst_events_1s).toBeGreaterThanOrEqual(3);
  });

  it('retains brand fields as none when no defensible signal exists', () => {
    const aggregates = aggregateAffectedVendors('scan2', 'publisher', [{ ...baseEvent, ts: Date.now() }]);
    expect(aggregates[0].brand_guess).toBeNull();
    expect(aggregates[0].brand_method).toBe('none');
  });

  it('builds AI evidence payload with explicit non-brand semantics', () => {
    const aggregates = aggregateAffectedVendors('scan3', 'publisher', [
      { ...baseEvent, ts: Date.now() },
      { ...baseEvent, ts: Date.now() + 50 }
    ]);
    const evidence = buildEvidencePayload('scan3', 'publisher', aggregates);
    expect(evidence.semantics).toContain('not_brands');
    expect(evidence.provenance.aggregation).toBe('vendor_host + ad_slot_id');
    expect(evidence.summary.total_rows).toBe(aggregates.length);
  });
});

