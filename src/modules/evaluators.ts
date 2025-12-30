import type { LoadedPack, ModuleResult } from './types';

function unique<T>(arr: T[] = []): T[] {
  return Array.from(new Set(arr));
}

function okResult(reasons: string[] = [], level: ModuleResult['level'] = 'Supported', metrics?: Record<string, number>): ModuleResult {
  return { status: 'PASS', reasons, level, metrics };
}

function failResult(reason: string): ModuleResult {
  return { status: 'FAIL', reasons: [reason] };
}

function partialResult(reason: string, level: ModuleResult['level'] = 'Observed', metrics?: Record<string, number>): ModuleResult {
  return { status: 'PARTIAL', reasons: [reason], level, metrics };
}

export function evaluateTagInventory(pack: LoadedPack): ModuleResult {
  if (!pack.tags || pack.tags.length === 0) {
    return failResult('No tags captured');
  }
  const containers = unique(pack.tags.map((t) => t.containerId).filter(Boolean));
  return okResult([`Tags captured: ${pack.tags.length}`, `Containers: ${containers.join(', ')}`], 'Supported', {
    tags: pack.tags.length,
    containers: containers.length
  });
}

export function evaluateCmsDrift(pack: LoadedPack): ModuleResult {
  const expected = pack.metadata.expectedTags;
  if (!pack.tags) return failResult('No tags captured');
  if (!expected) return partialResult('No expected tags provided', 'Observed');

  const key = pack.metadata.locale ?? pack.metadata.template ?? 'default';
  const expectedSet = expected[key] ?? expected['default'] ?? [];
  if (!expectedSet.length) return partialResult('No expected tags for locale/template', 'Observed');

  const observedIds = new Set(pack.tags.map((t) => t.id));
  const missing = expectedSet.filter((id) => !observedIds.has(id));
  const extra = pack.tags.map((t) => t.id).filter((id) => !expectedSet.includes(id));

  if (missing.length === 0 && extra.length === 0) {
    return okResult([`All expected tags present for ${key}`], 'Supported', { expected: expectedSet.length, observed: pack.tags.length });
  }
  return partialResult(
    `Drift detected: missing=${missing.join(', ') || 'none'}, extra=${extra.join(', ') || 'none'}`,
    'Observed',
    { missing: missing.length, extra: extra.length }
  );
}

function overlapPct(a: any, b: any): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const interArea = (x2 - x1) * (y2 - y1);
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea === 0 ? 0 : (interArea / minArea) * 100;
}

export function evaluatePublisherForensics(pack: LoadedPack): ModuleResult {
  if (!pack.iframes) return failResult('No iframe map captured');
  const hasRescans = Boolean(pack.domSnapshots?.t3) && Boolean(pack.domSnapshots?.t6);
  const tiny = pack.iframes.filter((f) => f.isTiny || f.areaPctOfViewport <= 2 || f.bbox.width <= 1 || f.bbox.height <= 1);
  const hidden = pack.iframes.filter((f) => f.isHidden || f.visibility === 'hidden' || (typeof f.opacity === 'number' && f.opacity <= 0.01));

  const overlaps: { a: string; b: string; pct: number }[] = [];
  for (let i = 0; i < pack.iframes.length; i++) {
    for (let j = i + 1; j < pack.iframes.length; j++) {
      const a = pack.iframes[i];
      const b = pack.iframes[j];
      const pct = overlapPct(a.bbox, b.bbox);
      if (pct >= 60) overlaps.push({ a: a.id, b: b.id, pct });
    }
  }

  const reasons = [];
  if (tiny.length) reasons.push(`Tiny frames: ${tiny.map((f) => f.id).join(', ')}`);
  if (hidden.length) reasons.push(`Hidden frames: ${hidden.map((f) => f.id).join(', ')}`);
  if (overlaps.length) reasons.push(`Overlaps >=60%: ${overlaps.map((o) => `${o.a}-${o.b}(${o.pct.toFixed(1)}%)`).join(', ')}`);

  if (!reasons.length) {
    const reason = hasRescans ? 'No risky placements detected' : 'No risky placements detected (no post-load rescan)';
    const level = hasRescans ? 'Supported' : 'Observed';
    return okResult([reason], level, { frames: pack.iframes.length, rescans: hasRescans ? 1 : 0 });
  }

  const level = hasRescans ? 'Supported' : 'Observed';
  return partialResult(reasons.join(' | '), level, {
    frames: pack.iframes.length,
    tiny: tiny.length,
    hidden: hidden.length,
    overlaps: overlaps.length,
    rescans: hasRescans ? 1 : 0
  });
}

function parseAdRequestsFromHar(har: any): number {
  if (!har) return 0;
  const entries = har.log?.entries ?? har.entries ?? [];
  return entries.filter((e: any) => {
    const url = e.request?.url ?? e.url ?? '';
    return url.includes('gampad/ads') || url.includes('securepubads.g.doubleclick.net');
  }).length;
}

export function evaluateAdImpression(pack: LoadedPack): ModuleResult {
  const adRequests = parseAdRequestsFromHar(pack.networkHar);
  const gptEvents = pack.gptEvents ?? [];

  const requested = adRequests + gptEvents.filter((e) => e.type === 'adRequested').length;
  const renders = gptEvents.filter((e) => e.type === 'slotRenderEnded').length;
  const viewables = gptEvents.filter((e) => e.type === 'impressionViewable').length;

  if (requested === 0 && renders === 0 && viewables === 0) {
    return failResult('No ad signals observed');
  }

  if (viewables > 0) {
    return okResult([`Viewable observed (${viewables})`, `Renders=${renders}`, `Requests=${requested}`], 'Confirmed', {
      adRequests: requested,
      renders,
      viewables
    });
  }

  if (renders > 0) {
    return partialResult(`Render observed (${renders}) but no viewable`, 'Supported', {
      adRequests: requested,
      renders,
      viewables
    });
  }

  return partialResult(`Ad requests only (${requested})`, 'Observed', { adRequests: requested });
}

export function evaluateInjectedTelemetry(pack: LoadedPack): ModuleResult {
  // Without explicit mutation logs, avoid false positives.
  const isSuspicious = Boolean(pack.metadata.featureFlags?.telemetryInjected);
  if (isSuspicious) {
    return partialResult('Telemetry injected post-load', 'Supported');
  }
  return okResult(['No injected telemetry detected'], 'Observed');
}

export function evaluateAnalyticsIntegrity(pack: LoadedPack): ModuleResult {
  const tags = pack.tags ?? [];
  const gaTags = tags.filter((t) => t.type === 'GA4' || t.type === 'UA');
  const ids = gaTags.map((t) => t.id);
  const duplicateIds = ids.filter((id, idx) => ids.indexOf(id) !== idx);

  if (gaTags.length === 0) {
    return partialResult('No analytics tags seen', 'Observed');
  }
  if (duplicateIds.length > 0) {
    return partialResult(`Duplicate analytics IDs detected: ${unique(duplicateIds).join(', ')}`, 'Observed', {
      duplicates: unique(duplicateIds).length
    });
  }
  return okResult(['Analytics tags present without duplication'], 'Supported', {
    analyticsTags: gaTags.length
  });
}

