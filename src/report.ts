import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from './rules.js';

export interface Artifact {
  type: string;
  vendor?: string;
  ids?: string[];
  domain?: string;
  url?: string;
  fingerprint?: string;
  evidence?: string;
}

export interface ScanSummary {
  url: string;
  startedAt: string;
  durationMs: number;
  findings: Finding[];
  artifacts: Artifact[];
  beaconCounts: Record<string, number>;
  partnerDomains: Record<string, number>;
}

export function writeJsonReport(summary: ScanSummary, outfile: string): void {
  fs.writeFileSync(outfile, JSON.stringify(summary, null, 2));
}

export function writeHtmlReport(summary: ScanSummary, outfile: string): void {
  const html = `<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8" />
  <title>Cybertect Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; background: #f8fafc; color: #0f172a; }
    h1 { margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
    .badge { padding: 4px 10px; border-radius: 999px; font-size: 0.8rem; background: #e2e8f0; display: inline-block; }
    .severity-high { background: #fee2e2; color: #991b1b; }
    .severity-critical { background: #fecaca; color: #7f1d1d; }
    .severity-medium { background: #fef3c7; color: #92400e; }
  </style>
  </head>
  <body>
    <h1>Cybertect CMS Scan</h1>
    <p><strong>Target:</strong> ${summary.url}</p>
    <p><strong>Started:</strong> ${summary.startedAt} · <strong>Duration:</strong> ${summary.durationMs}ms</p>

    <h2>Findings</h2>
    <table>
      <thead><tr><th>Severity</th><th>Type</th><th>Detail</th></tr></thead>
      <tbody>
        ${summary.findings
          .map(
            (f) =>
              `<tr><td><span class="badge severity-${f.severity}">${f.severity.toUpperCase()}</span></td><td>${f.type}</td><td>${f.detail}</td></tr>`,
          )
          .join('') || '<tr><td colspan="3">No findings</td></tr>'}
      </tbody>
    </table>

    <h2>Partner Domains</h2>
    <table>
      <thead><tr><th>Domain</th><th>Requests</th></tr></thead>
      <tbody>
        ${Object.entries(summary.partnerDomains)
          .map(([domain, count]) => `<tr><td>${domain}</td><td>${count}</td></tr>`)
          .join('') || '<tr><td colspan="2">None</td></tr>'}
      </tbody>
    </table>
  </body>
  </html>`;
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, html);
}
