import fs from 'node:fs';
import path from 'node:path';

export interface Viewport {
  width: number;
  height: number;
}

export interface RunMetadata {
  runId: string;
  url: string;
  startedAt: number;
  finishedAt: number;
  userAgent: string;
  viewport: Viewport;
  locale?: string;
  template?: string;
  crawlerVersion: string;
  featureFlags?: Record<string, boolean>;
  expectedTags?: Record<string, string[]>;
  notes?: string;
}

export interface IframeRecord {
  id: string;
  src?: string;
  bbox: { x: number; y: number; width: number; height: number };
  zIndex?: number;
  visibility?: string;
  opacity?: number;
  inViewportPct: number;
  areaPctOfViewport: number;
  overlapPctWith?: { otherId: string; pct: number }[];
  isTiny?: boolean;
  isHidden?: boolean;
  isAdIframe?: boolean;
}

export type TagType = 'GTM' | 'GA4' | 'UA' | 'Ads' | 'Custom';

export interface TagRecord {
  id: string;
  type: TagType;
  name?: string;
  containerId?: string;
  triggers?: string[];
  fired?: boolean;
  frameUrl?: string;
  pageUrl?: string;
}

export type GptEventType = 'slotRenderEnded' | 'impressionViewable' | 'adRequested';

export interface GptEvent {
  ts: number;
  type: GptEventType;
  slotId?: string;
  adUnitPath?: string;
  requestId?: string;
  size?: [number, number];
  payload?: Record<string, unknown>;
}

export interface EvidencePackInput {
  runId: string;
  metadata: RunMetadata;
  networkHar?: unknown | string | Buffer;
  domSnapshots?: {
    initial?: string;
    t3?: string;
    t6?: string;
  };
  screenshots?: {
    full?: Buffer | string;
    crops?: Record<string, Buffer | string>;
  };
  iframes?: IframeRecord[];
  tags?: TagRecord[];
  gptEvents?: GptEvent[];
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(target: string, data: unknown) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
}

function writeHar(target: string, data: unknown | string | Buffer) {
  ensureDir(path.dirname(target));
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    fs.writeFileSync(target, data);
  } else {
    fs.writeFileSync(target, JSON.stringify(data, null, 2));
  }
}

function writeText(target: string, data?: string) {
  if (data === undefined) return;
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, data, 'utf-8');
}

function toBuffer(data: Buffer | string) {
  return Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
}

export interface EvidencePackPaths {
  root: string;
  runMetadata: string;
  networkHar: string;
  domInitial: string;
  domT3: string;
  domT6: string;
  screenshotsDir: string;
  fullScreenshot: string;
  iframes: string;
  tags: string;
  gptEvents: string;
}

export function getPackPaths(baseDir: string, runId: string): EvidencePackPaths {
  const root = path.join(baseDir, runId);
  return {
    root,
    runMetadata: path.join(root, 'run_metadata.json'),
    networkHar: path.join(root, 'network.har'),
    domInitial: path.join(root, 'dom_initial.html'),
    domT3: path.join(root, 'dom_t3.html'),
    domT6: path.join(root, 'dom_t6.html'),
    screenshotsDir: path.join(root, 'screenshots'),
    fullScreenshot: path.join(root, 'screenshots', 'full.png'),
    iframes: path.join(root, 'iframes.json'),
    tags: path.join(root, 'tags.json'),
    gptEvents: path.join(root, 'gpt_events.json')
  };
}

export function writeEvidencePack(baseDir: string, pack: EvidencePackInput): EvidencePackPaths {
  const paths = getPackPaths(baseDir, pack.runId);
  ensureDir(paths.root);

  writeJson(paths.runMetadata, pack.metadata);

  if (pack.networkHar !== undefined) {
    writeHar(paths.networkHar, pack.networkHar);
  }

  const dom = pack.domSnapshots ?? {};
  writeText(paths.domInitial, dom.initial);
  writeText(paths.domT3, dom.t3);
  writeText(paths.domT6, dom.t6);

  if (pack.screenshots?.full) {
    ensureDir(paths.screenshotsDir);
    fs.writeFileSync(paths.fullScreenshot, toBuffer(pack.screenshots.full));
  }
  if (pack.screenshots?.crops) {
    ensureDir(paths.screenshotsDir);
    for (const [id, data] of Object.entries(pack.screenshots.crops)) {
      const target = path.join(paths.screenshotsDir, `crop_${id}.png`);
      fs.writeFileSync(target, toBuffer(data));
    }
  }

  if (pack.iframes) {
    writeJson(paths.iframes, { iframes: pack.iframes });
  }
  if (pack.tags) {
    writeJson(paths.tags, { tags: pack.tags });
  }
  if (pack.gptEvents) {
    writeJson(paths.gptEvents, { events: pack.gptEvents });
  }

  return paths;
}

