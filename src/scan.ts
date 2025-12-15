import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { extractDomArtifacts } from './extract.js';
import { classifyFromText, vendorFromDomain } from './classify.js';
import { loadPolicy } from './policy.js';
import type { Policy } from './policy.js';
import { runRules } from './rules.js';
import { writeHtmlReport, writeJsonReport } from './report.js';
import type { Artifact, ScanSummary } from './report.js';

export interface ScanOptions {
  urls: string[];
  followLinks: boolean;
  maxConcurrency: number;
  rateLimitPerHost: number;
  timeoutMs: number;
  respectRobots: boolean;
  noFire: boolean;
  userAgent: string;
  policyPath?: string;
  baselinePath?: string;
  writeBaselinePath?: string;
  reportDir: string;
  beaconThreshold: number;
}

const TELEMETRY_DOMAINS = [
  /google-analytics\.com/i,
  /analytics\.google\.com/i,
  /googletagmanager\.com\/g\//i,
  /doubleclick\.net/i,
  /facebook\.com\/tr/i,
  /connect\.facebook\.net/i,
  /tiktok\.com/i,
];

const TELEMETRY_PATH_HINTS = /(collect|beacon|pixel|telemetry|events)/i;

function redactedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = parsed.search ? '?redacted' : '';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function respectRobots(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const res = await fetch(robotsUrl, { method: 'GET' });
    if (!res.ok) return true;
    const body = await res.text();
    const lines = body.split(/\r?\n/);
    let applicable = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed) || /^user-agent:\s*CybertectCMSMonitor/i.test(trimmed)) {
        applicable = true;
      } else if (trimmed.startsWith('User-agent')) {
        applicable = false;
      }
      if (applicable && /^disallow:/i.test(trimmed)) {
        const rule = trimmed.split(':')[1]?.trim() ?? '';
        if (rule && parsed.pathname.startsWith(rule)) {
          return false;
        }
      }
    }
  } catch {
    return true;
  }
  return true;
}

function isTelemetry(url: string): boolean {
  return TELEMETRY_DOMAINS.some((regex) => regex.test(url)) || TELEMETRY_PATH_HINTS.test(url);
}

function allowMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

async function handleRateLimit(hostTimer: Map<string, number>, host: string, minIntervalMs: number) {
  const now = Date.now();
  const last = hostTimer.get(host) ?? 0;
  const delta = now - last;
  if (delta < minIntervalMs) {
    await new Promise((resolve) => setTimeout(resolve, minIntervalMs - delta));
  }
  hostTimer.set(host, Date.now());
}

export interface ScanResult extends ScanSummary {}

export async function scanUrls(options: ScanOptions): Promise<ScanResult[]> {
  const policy = loadPolicy(options.policyPath);
  const results: ScanResult[] = [];
  for (const url of options.urls) {
    const res = await scanSingle(url, options, policy);
    results.push(res);
  }
  return results;
}

async function scanSingle(url: string, options: ScanOptions, policy: Policy): Promise<ScanResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  if (options.respectRobots) {
    const allowed = await respectRobots(url);
    if (!allowed) {
      return {
        url,
        startedAt,
        durationMs: Date.now() - startTime,
        findings: [
          {
            type: 'unauthorized_partner',
            severity: 'medium',
            detail: 'Robots.txt disallows scanning; skipping.',
          },
        ],
        artifacts: [],
        beaconCounts: {},
        partnerDomains: {},
      };
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: options.userAgent,
  });
  const page = await context.newPage();
  const hostTimer = new Map<string, number>();

  const partnerDomains: Record<string, number> = {};
  const telemetryCounts: Record<string, number> = {};
  const artifacts: Artifact[] = [];
  const inlinePreviews: string[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const reqUrl = request.url();
    const method = request.method();
    const host = (() => {
      try {
        return new URL(reqUrl).hostname;
      } catch {
        return '';
      }
    })();

    if (!allowMethod(method)) {
      artifacts.push({
        type: 'blocked-request',
        url: redactedUrl(reqUrl),
        evidence: `Blocked non-read method ${method}`,
      });
      await route.abort();
      return;
    }

    if (host) {
      await handleRateLimit(hostTimer, host, Math.ceil(60000 / options.rateLimitPerHost));
      if (!reqUrl.includes(new URL(url).hostname)) {
        partnerDomains[host] = (partnerDomains[host] ?? 0) + 1;
      }
    }

    if (options.noFire && isTelemetry(reqUrl)) {
      const vendor = vendorFromDomain(host);
      telemetryCounts[vendor] = (telemetryCounts[vendor] ?? 0) + 1;
      artifacts.push({
        type: 'telemetry',
        vendor,
        url: redactedUrl(reqUrl),
        evidence: `Blocked telemetry request (${request.resourceType()})`,
      });
      await route.abort();
      return;
    }

    await route.continue();
  });

  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs,
  });
  await page.waitForTimeout(3000);
  if (!response) {
    artifacts.push({
      type: 'navigation',
      evidence: 'No response from server',
    });
  }

  const domArtifacts = await extractDomArtifacts(page);
  domArtifacts.scripts.forEach((script) => artifacts.push({ type: script.type, url: script.src, fingerprint: script.hash, evidence: script.preview }));
  domArtifacts.frames.forEach((frame) => artifacts.push({ type: 'iframe', url: frame.src, evidence: `${frame.width}x${frame.height} hidden=${frame.hidden}` }));
  domArtifacts.pixels.forEach((pixel) => artifacts.push({ type: 'pixel', url: pixel.src, evidence: `${pixel.width}x${pixel.height}` }));
  domArtifacts.noscripts.forEach((block) => artifacts.push({ type: 'noscript', fingerprint: block.hash, evidence: block.preview }));
  inlinePreviews.push(...domArtifacts.scripts.filter((s) => s.type === 'inline-script' && s.preview).map((s) => s.preview ?? ''));

  const domText = domArtifacts.scripts.map((s) => [s.src ?? '', s.preview ?? ''].join('\n')).join('\n');
  const vendorMatches = classifyFromText(domText);

  const findings = runRules({
    vendorMatches,
    beaconCounts: telemetryCounts,
    partnerDomains,
    inlineScriptPreviews: inlinePreviews,
    policy,
    beaconThreshold: options.beaconThreshold,
  });

  await browser.close();

  return {
    url,
    startedAt,
    durationMs: Date.now() - startTime,
    findings,
    artifacts,
    beaconCounts: telemetryCounts,
    partnerDomains,
  };
}

export async function handleBaseline(results: ScanResult[], baselinePath?: string, writeBaselinePath?: string) {
  if (writeBaselinePath) {
    fs.mkdirSync(path.dirname(writeBaselinePath), { recursive: true });
    fs.writeFileSync(writeBaselinePath, JSON.stringify(results, null, 2));
  }

  if (!baselinePath || !fs.existsSync(baselinePath)) return;

  const baseline: ScanResult[] = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  results.forEach((result, idx) => {
    const previous = baseline[idx];
    if (!previous) return;
    const addedPartners = Object.keys(result.partnerDomains).filter((domain) => !previous.partnerDomains[domain]);
    if (addedPartners.length) {
      result.findings.push({
        type: 'unauthorized_partner',
        severity: 'low',
        detail: `New partner domains since baseline: ${addedPartners.join(', ')}`,
      });
    }
  });
}

export async function writeReports(results: ScanResult[], dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const result of results) {
    const safeName = result.url.replace(/[^a-z0-9]+/gi, '_');
    writeJsonReport(result, path.join(dir, `${safeName}.json`));
    writeHtmlReport(result, path.join(dir, `${safeName}.html`));
  }
}
