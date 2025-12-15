## Cybertect Scan

`cybertect-scan` is a read-only Playwright-based monitor for CMS-driven analytics inflation. It observes publisher URLs, blocks telemetry beacons by default (no-fire mode), and reports cloned tags, rogue partners, and suspicious inline scripts.

### Safety defaults

- **Read only**: Only GET/HEAD/OPTIONS requests are allowed.
- **No-fire telemetry**: GA/Facebook/etc beacons are logged then aborted.
- **Respect robots.txt**: Enabled by default (`--no-respect-robots` to override).
- **Polite limits**: `--maxConcurrency 1`, `--rateLimitPerHost 15`, `--timeoutMs 60000`.
- Clear UA: `CybertectCMSMonitor/1.0`.

### Install

```bash
npm install
npm run build
npx cybertect-scan scan --url https://example.com
```

To develop with TypeScript:

```bash
npm run dev -- scan --url https://example.com
```

### CLI

```
cybertect-scan scan --url <URL> [--urls urls.txt] \
  [--policy policy.yaml] [--baseline baseline.json] [--write-baseline out.json] \
  [--report-dir reports] [--fire] [--no-respect-robots]
```

### Policy

Policy YAML lets you declare allowlists:

```yaml
env: live
allowedVendors:
  - google-analytics
allowedIds:
  google-analytics:
    - G-12345
allowedDomains:
  - analytics.example.com
```

### Reports

Each scan writes:

- `reports/<host>.json` – structured output with artifacts and findings.
- `reports/<host>.html` – portable summary including tables and severity badges.

### Baselines

Use `--write-baseline baseline.json` to snapshot a known-good state, then pass `--baseline baseline.json` to detect new partners or IDs.

### Tests

```bash
npm test
```

### Docker

```
docker build -t cybertect-scan .
docker run --rm cybertect-scan scan --url https://example.com
```
