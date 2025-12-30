import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'node:url';
import type { GptEvent, IframeRecord, TagRecord } from '../evidence/pack-writer';
import type { LoadedPack } from './types';

function safeReadJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

function normalizeIframes(raw?: { iframes?: any[] }): IframeRecord[] | undefined {
  if (!raw?.iframes) return undefined;
  return raw.iframes.map((f, idx) => {
    const bbox = f.bbox ?? f.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
    const areaPct = f.areaPctOfViewport ?? f.viewportCoveragePct ?? 0;
    return {
      id: f.id ?? f.name ?? `frame-${idx}`,
      src: f.src,
      bbox: {
        x: bbox.x ?? 0,
        y: bbox.y ?? 0,
        width: bbox.width ?? 0,
        height: bbox.height ?? 0
      },
      zIndex: f.zIndex,
      visibility: f.visibility,
      opacity: f.opacity,
      inViewportPct: f.inViewportPct ?? (f.inViewport ? 100 : 0),
      areaPctOfViewport: areaPct,
      overlapPctWith: f.overlapPctWith ?? f.overlapPairs,
      isTiny: f.isTiny ?? f.tinyFlag,
      isHidden: f.isHidden ?? f.hiddenFlag ?? f.offscreenFlag,
      isAdIframe: f.isAdIframe ?? f.classification === 'ad'
    };
  });
}

function normalizeTags(raw?: { tags?: any[] }): TagRecord[] | undefined {
  if (!raw?.tags) return undefined;
  return raw.tags.map((t, idx) => ({
    id: t.id ?? t.name ?? `tag-${idx}`,
    type: t.type ?? t.kind ?? 'Custom',
    name: t.name,
    containerId: t.containerId,
    triggers: t.triggers,
    fired: t.fired,
    frameUrl: t.frameUrl ?? t.pageUrl,
    pageUrl: t.pageUrl
  }));
}

function normalizeGptEvents(raw?: { events?: any[] }): GptEvent[] | undefined {
  if (!raw?.events) return undefined;
  return raw.events.map((e) => ({
    ts: e.ts ?? e.timestamp ?? e.time ?? 0,
    type: e.type ?? e.event ?? 'adRequested',
    slotId: e.slotId,
    adUnitPath: e.adUnit ?? e.adUnitPath,
    requestId: e.requestId,
    size: Array.isArray(e.size)
      ? (e.size as [number, number])
      : typeof e.size === 'string' && e.size.includes('x')
        ? (e.size.split('x').map((n: string) => Number(n)) as [number, number])
        : undefined,
    payload: e.payload
  }));
}

function maybeReadText(file: string) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
}

function parseHarMaybe(file: string) {
  if (!fs.existsSync(file)) return undefined;
  const content = fs.readFileSync(file, 'utf-8');
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function loadEvidencePack(packPath: string): LoadedPack | undefined {
  const meta = safeReadJson(path.join(packPath, 'run_metadata.json'));
  if (!meta) return undefined;

  const iframes = normalizeIframes(safeReadJson(path.join(packPath, 'iframes.json')));
  const tags = normalizeTags(safeReadJson(path.join(packPath, 'tags.json')));
  const gptEvents = normalizeGptEvents(safeReadJson(path.join(packPath, 'gpt_events.json')));
  const domSnapshots = {
    initial: maybeReadText(path.join(packPath, 'dom_initial.html')),
    t3: maybeReadText(path.join(packPath, 'dom_t3.html')),
    t6: maybeReadText(path.join(packPath, 'dom_t6.html'))
  };
  const networkHar = parseHarMaybe(path.join(packPath, 'network.har'));

  return {
    metadata: meta,
    iframes,
    tags,
    gptEvents,
    domSnapshots,
    networkHar
  };
}

