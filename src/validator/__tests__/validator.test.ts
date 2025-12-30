import { describe, it, expect } from 'vitest';
import { runRules } from '../rules';
import { ValidatorResultSchema } from '../schema';

const atlanticPack = {
  runId: 'atl-1',
  targetUrl: 'https://www.theatlantic.com',
  scannedAt: '2025-01-01T00:00:00Z',
  summaryFlags: {
    multipleGa4Ids: { count: 0, ids: [], evidenceRefs: [{ type: 'analytics', id: 'ga4-1', pointer: 'analytics.ga4.ids[0]' }] },
    multipleGtmContainers: { count: 0, ids: [], evidenceRefs: [] },
    multipleGa4PageView: { count: 0, evidenceRefs: [] },
    duplicateAdImpression: { count: 0, evidenceRefs: [] },
    autoRefreshInflation: { count: 0, evidenceRefs: [] },
    pixelStuffing1x1: { count: 0, evidenceRefs: [] },
    hiddenTinyFrames: { count: 0, evidenceRefs: [] },
    adStacking: { count: 0, evidenceRefs: [] },
    phantomScroll: { count: 0, evidenceRefs: [] },
    sessionInflation: { count: 0, evidenceRefs: [] },
  },
  analytics: { ga4: { ids: ['G-ABC'], events: [{ name: 'zephr_event', ts: '2025-01-01T00:00:00Z', source: 'zephr', evidenceRef: { type: 'analytics', id: 'e1', pointer: 'analytics.ga4.events[0]' } }] } },
};

const lapatillaPack = {
  runId: 'lap-1',
  targetUrl: 'https://www.lapatilla.com',
  scannedAt: '2025-01-01T00:00:00Z',
  summaryFlags: {
    duplicateAdImpression: { count: 12, evidenceRefs: [{ type: 'ads', id: 'd1', pointer: 'summaryFlags.duplicateAdImpression' }] },
    autoRefreshInflation: { count: 2, evidenceRefs: [{ type: 'ads', id: 'd2', pointer: 'summaryFlags.autoRefreshInflation' }] },
    pixelStuffing1x1: { count: 4, evidenceRefs: [{ type: 'dom', id: 'p1', pointer: 'summaryFlags.pixelStuffing1x1' }] },
    hiddenTinyFrames: { count: 6, evidenceRefs: [{ type: 'dom', id: 'h1', pointer: 'summaryFlags.hiddenTinyFrames' }] },
    adStacking: { count: 30, evidenceRefs: [{ type: 'dom', id: 'a1', pointer: 'summaryFlags.adStacking' }] },
    phantomScroll: { count: 0, evidenceRefs: [] },
    sessionInflation: { count: 0, evidenceRefs: [] },
    multipleGa4Ids: { count: 2, ids: ['G-1', 'G-2'], evidenceRefs: [{ type: 'analytics', id: 'g1', pointer: 'summaryFlags.multipleGa4Ids' }] },
    multipleGtmContainers: { count: 1, ids: ['GTM-1'], evidenceRefs: [{ type: 'analytics', id: 't1', pointer: 'summaryFlags.multipleGtmContainers' }] },
    multipleGa4PageView: { count: 1, evidenceRefs: [{ type: 'analytics', id: 'pv1', pointer: 'summaryFlags.multipleGa4PageView' }] },
  },
  dom: { iframes: [{ src: 'ad', width: 1, height: 1, css: {}, bbox: {}, overlappedPct: 0.7, evidenceRef: { type: 'dom', id: 'i1', pointer: 'dom.iframes[0]' } }] },
  ads: { gam: { impressions: [{ slotId: 'slot1', ts: '2025-01-01T00:00:00Z', evidenceRef: { type: 'ads', id: 'g1', pointer: 'ads.gam.impressions[0]' } }, { slotId: 'slot1', ts: '2025-01-01T00:00:01Z', evidenceRef: { type: 'ads', id: 'g2', pointer: 'ads.gam.impressions[1]' } }], requests: [] } },
  analytics: { ga4: { ids: ['G-1', 'G-2'], events: [] } },
};

describe('deterministic rules', () => {
  it('benign instrumentation duplication -> not FAIL', () => {
    const r = runRules(atlanticPack, true);
    expect(['PASS', 'WARN']).toContain(r.verdict);
    expect(r.classification.primary).toBe('INSTRUMENTATION_DUPLICATION');
    expect(r.gates.g1Monetization).toBe(false);
  });

  it('monetized + structural -> allows FAIL', () => {
    const r = runRules(lapatillaPack, true);
    expect(r.features.monetizedInflationSignals).toBe(true);
    expect(r.features.structuralAbuseSignals).toBe(true);
    expect(['FAIL', 'WARN']).toContain(r.verdict);
  });

  it('G1 blocks FAIL when no monetized inflation', () => {
    const clone = {
      ...lapatillaPack,
      summaryFlags: {
        ...lapatillaPack.summaryFlags,
        duplicateAdImpression: { count: 0, evidenceRefs: [] },
        autoRefreshInflation: { count: 0, evidenceRefs: [] },
      },
    };
    const r = runRules(clone, true);
    expect(r.features.monetizedInflationSignals).toBe(false);
    expect(r.verdict).not.toBe('FAIL');
  });

  it('Evidence gate -> INSUFFICIENT_EVIDENCE when refs missing', () => {
    const clone = {
      ...lapatillaPack,
      summaryFlags: {
        ...lapatillaPack.summaryFlags,
        duplicateAdImpression: { count: 5, evidenceRefs: [] },
      },
    };
    const r = runRules(clone, false);
    expect(r.verdict).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('schema validation', () => {
  it('accepts a valid minimal result', () => {
    const res = ValidatorResultSchema.parse({
      verdict: 'PASS',
      score: 20,
      confidence: 60,
      target: {
        domain: 'example.com',
        url: 'https://example.com',
        runId: 'r1',
        scannedAt: '2025-01-01T00:00:00Z',
      },
      classification: { primary: 'UNKNOWN', rationale: 'test', ruleTrace: [] },
      topSignals: [],
      findings: [],
      auditorSafeLanguage: {
        executiveSummary: 'ok',
        methodologyNote: 'ok',
        limitationNote: 'ok',
      },
    });
    expect(res.verdict).toBe('PASS');
  });
});

