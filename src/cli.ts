#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import pino from 'pino';
import { scanUrls, handleBaseline, writeReports } from './scan.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const program = new Command();
program.name('cybertect-scan').description('Cybertect CMS telemetry monitor');

program
  .command('scan')
  .option('--url <url...>', 'One or more URLs to scan')
  .option('--urls <file>', 'File with URLs (one per line)')
  .option('--follow-links', 'Follow intra-domain links', false)
  .option('--maxConcurrency <n>', 'Maximum concurrency', (v) => parseInt(v, 10), 1)
  .option('--rateLimitPerHost <n>', 'Requests per minute per host', (v) => parseInt(v, 10), 15)
  .option('--timeoutMs <n>', 'Timeout per URL', (v) => parseInt(v, 10), 60000)
  .option('--respect-robots', 'Respect robots.txt rules (default on)', true)
  .option('--fire', 'Allow telemetry beacons to fire', false)
  .option('--user-agent <ua>', 'Custom user agent', 'CybertectCMSMonitor/1.0')
  .option('--policy <file>', 'Policy YAML file')
  .option('--baseline <file>', 'Baseline JSON to diff')
  .option('--write-baseline <file>', 'Write baseline to file')
  .option('--report-dir <dir>', 'Directory for reports', 'reports')
  .option('--beacon-threshold <n>', 'Telemetry burst threshold', (v) => parseInt(v, 10), 8)
  .action(async (cmd) => {
    try {
      const urls = gatherUrls((cmd.url as string[]) ?? [], cmd.urls);
      if (!urls.length) {
        console.error(chalk.red('No URLs provided. Use --url or --urls file.'));
        process.exit(1);
      }
      const options = {
        urls,
        followLinks: cmd.followLinks ?? false,
        maxConcurrency: cmd.maxConcurrency,
        rateLimitPerHost: cmd.rateLimitPerHost,
        timeoutMs: cmd.timeoutMs,
        respectRobots: cmd.respectRobots !== false,
        noFire: !cmd.fire,
        userAgent: cmd.userAgent,
        policyPath: cmd.policy,
        baselinePath: cmd.baseline,
        writeBaselinePath: cmd.writeBaseline,
        reportDir: cmd.reportDir,
        beaconThreshold: cmd.beaconThreshold,
      };
      const results = await scanUrls(options);
      await handleBaseline(results, cmd.baseline, cmd.writeBaseline);
      await writeReports(results, cmd.reportDir);

      const findings = results.flatMap((r) => r.findings);
      const highestSeverity = severityScore(findings);
      if (highestSeverity >= 4) process.exit(5);
      if (highestSeverity >= 2) process.exit(2);
      process.exit(0);
    } catch (err) {
      logger.error(err);
      process.exit(1);
    }
  });

await program.parseAsync(process.argv);

function gatherUrls(cliUrls: string[], filePath?: string): string[] {
  let urls = [...cliUrls];
  if (filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    urls = urls.concat(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  return Array.from(new Set(urls));
}

function severityScore(findings: { severity: string }[]): number {
  const order: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return findings.reduce((acc, f) => Math.max(acc, order[f.severity] ?? 0), 0);
}
