import { describe, expect, it } from 'vitest';
import {
  evaluateAdImpression,
  evaluateAnalyticsIntegrity,
  evaluateCmsDrift,
  evaluateInjectedTelemetry,
  evaluatePublisherForensics,
  evaluateTagInventory
} from '../../src/modules/evaluators';
import type { LoadedPack } from '../../src/modules/types';

const basePack: LoadedPack = {
  metadata: {
    runId: 'test',
    url: 'https://example.com',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    userAgent: 'test',
    viewport: { width: 800, height: 600 },
    crawlerVersion: '1.0.0'
  }
};

describe('Tag inventory', () => {
  it('passes when tags exist', () => {
    const res = evaluateTagInventory({ ...basePack, tags: [{ id: 'GTM-1', type: 'GTM' }] });
    expect(res.status).toBe('PASS');
  });
  it('fails when tags missing', () => {
    const res = evaluateTagInventory({ ...basePack, tags: [] });
    expect(res.status).toBe('FAIL');
  });
});

describe('CMS drift', () => {
  it('passes when expected tags match observed', () => {
    const res = evaluateCmsDrift({
      ...basePack,
      metadata: { ...basePack.metadata, expectedTags: { default: ['A'] } },
      tags: [{ id: 'A', type: 'GA4' }]
    });
    expect(res.status).toBe('PASS');
  });
  it('partials when tags missing', () => {
    const res = evaluateCmsDrift({
      ...basePack,
      metadata: { ...basePack.metadata, expectedTags: { default: ['A'] } },
      tags: [{ id: 'B', type: 'GA4' }]
    });
    expect(res.status).toBe('PARTIAL');
  });
});

describe('Publisher forensics', () => {
  it('partials on tiny/hidden/overlap', () => {
    const res = evaluatePublisherForensics({
      ...basePack,
      iframes: [
        {
          id: 'a',
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          inViewportPct: 0,
          areaPctOfViewport: 0.1
        },
        {
          id: 'b',
          bbox: { x: 0, y: 0, width: 100, height: 100 },
          inViewportPct: 90,
          areaPctOfViewport: 10
        },
        {
          id: 'c',
          bbox: { x: 10, y: 10, width: 100, height: 100 },
          inViewportPct: 90,
          areaPctOfViewport: 10
        }
      ]
    });
    expect(res.status).toBe('PARTIAL');
  });
  it('passes when clean', () => {
    const res = evaluatePublisherForensics({
      ...basePack,
      iframes: [
        {
          id: 'a',
          bbox: { x: 0, y: 0, width: 300, height: 250 },
          inViewportPct: 90,
          areaPctOfViewport: 8
        }
      ]
    });
    expect(res.status).toBe('PASS');
  });
});

describe('Ad impression verification', () => {
  it('confirmed when viewable present', () => {
    const res = evaluateAdImpression({
      ...basePack,
      gptEvents: [
        { ts: 1, type: 'adRequested' },
        { ts: 2, type: 'slotRenderEnded' },
        { ts: 3, type: 'impressionViewable' }
      ]
    });
    expect(res.status).toBe('PASS');
    expect(res.level).toBe('Confirmed');
  });
  it('observed when only requests', () => {
    const res = evaluateAdImpression({
      ...basePack,
      gptEvents: [{ ts: 1, type: 'adRequested' }]
    });
    expect(res.status).toBe('PARTIAL');
    expect(res.level).toBe('Observed');
  });
  it('fails when nothing seen', () => {
    const res = evaluateAdImpression({ ...basePack });
    expect(res.status).toBe('FAIL');
  });
});

describe('Injected telemetry', () => {
  it('passes baseline', () => {
    const res = evaluateInjectedTelemetry({ ...basePack });
    expect(res.status).toBe('PASS');
  });
  it('partials when flagged injected', () => {
    const res = evaluateInjectedTelemetry({
      ...basePack,
      metadata: { ...basePack.metadata, featureFlags: { telemetryInjected: true } }
    });
    expect(res.status).toBe('PARTIAL');
  });
});

describe('Analytics integrity', () => {
  it('partials when duplicates exist', () => {
    const res = evaluateAnalyticsIntegrity({
      ...basePack,
      tags: [
        { id: 'GA-1', type: 'GA4' },
        { id: 'GA-1', type: 'GA4' }
      ]
    });
    expect(res.status).toBe('PARTIAL');
  });
  it('passes when clean', () => {
    const res = evaluateAnalyticsIntegrity({
      ...basePack,
      tags: [{ id: 'GA-1', type: 'GA4' }]
    });
    expect(res.status).toBe('PASS');
  });
});

