# AI Validation Module

The AI Validation module provides automated validation of evidence packs using AI models (OpenAI ChatGPT, Google Gemini, Perplexity). It generates schema-validated JSON results and deterministic PDF evidence summaries.

## Features

- **Multi-Provider Support**: OpenAI ChatGPT, Google Gemini, and Perplexity
- **Schema Validation**: Strict JSON schema enforcement for all AI outputs
- **Deterministic PDF Generation**: One-page evidence summaries generated from structured JSON (not prose)
- **Evidence Pack Parsing**: Automatic extraction and analysis of ZIP evidence packs
- **Fingerprinting**: SHA256 fingerprints for input and output traceability
- **Redaction Mode**: Optional URL token/ID removal for privacy
- **Template System**: Extensible validation templates for different fraud types
- **Full Test Coverage**: Unit tests for all components

## Architecture

```
ai-validation/
├── schemas/                    # JSON schemas
│   ├── ai_validation.schema.json
│   └── case_brief.schema.json
├── parser/                     # Evidence pack parser
│   └── evidence-pack-parser.cjs
├── providers/                  # AI provider implementations
│   ├── base-provider.cjs
│   ├── openai-provider.cjs
│   ├── gemini-provider.cjs
│   ├── perplexity-provider.cjs
│   └── provider-factory.cjs
├── templates/                  # Validation templates
│   └── registry.cjs
├── pdf/                        # PDF generator
│   └── generator.cjs
├── orchestrator.cjs           # Main workflow orchestrator
└── README.md
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

Required packages:
- `ajv` and `ajv-formats` - JSON schema validation
- `pdfkit` - PDF generation
- `axios` - HTTP client for AI APIs

### 2. Set Environment Variables

```bash
# Choose one or more providers
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
export PERPLEXITY_API_KEY="pplx-..."
```

### 3. Start the Server

```bash
npm run start:server
```

### 4. Access the UI

Navigate to: `http://localhost:3000/ai-validation`

## API Endpoints

### Upload Evidence Pack

```http
POST /api/ai-validation/upload
Content-Type: multipart/form-data

evidencePack: <ZIP file>
```

**Response:**
```json
{
  "success": true,
  "uploadId": "ai-validation-1234567890",
  "filename": "evidence-pack.zip",
  "size": 1048576
}
```

### Run Validation

```http
POST /api/ai-validation/run
Content-Type: application/json

{
  "uploadId": "ai-validation-1234567890",
  "provider": "openai",
  "template": "ad-impression-inflation",
  "redaction": false,
  "findingsJson": "{...}" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "runId": "ai-validation-1234567890",
  "status": "processing"
}
```

### Get Result

```http
GET /api/ai-validation/result/:runId
```

**Response:**
```json
{
  "success": true,
  "runId": "ai-validation-1234567890",
  "metadata": {
    "verdict": "FAIL",
    "confidence": 85,
    "findingsCount": 3,
    "provider": "openai",
    "template": "ad-impression-inflation",
    "timestamp": "2024-01-01T00:00:00Z",
    "inputFingerprint": "abc123...",
    "outputFingerprint": "def456..."
  },
  "files": {
    "aiValidation": "/api/ai-validation/download/.../ai_validation.json",
    "pdf": "/api/ai-validation/download/.../evidence_summary.pdf",
    "caseBrief": "/api/ai-validation/download/.../case_brief.json"
  }
}
```

### List Templates

```http
GET /api/ai-validation/templates
```

**Response:**
```json
{
  "success": true,
  "templates": [
    {
      "id": "ad-impression-inflation",
      "name": "Ad Impression Inflation",
      "description": "Validates evidence of ad impression inflation..."
    }
  ]
}
```

### List Providers

```http
GET /api/ai-validation/providers
```

**Response:**
```json
{
  "success": true,
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI ChatGPT",
      "defaultModel": "gpt-4o"
    }
  ]
}
```

## Evidence Pack Format

Evidence packs should be ZIP files containing:

### Required Files

- `summary.json` - Scan summary with metrics and findings
- `network.json` - Network events log
- `sequences.json` - Event sequences

### Optional Files

- `flags.json` - Flagged events
- `cms_monitor.json` - CMS monitor results
- Screenshots (PNG files)

### Example Evidence Pack Structure

```
evidence-pack.zip
├── summary.json
├── network.json
├── sequences.json
├── flags.json
└── initial_load.png
```

## Validation Templates

### Ad Impression Inflation

**ID:** `ad-impression-inflation`

Detects ad impression inflation via:
- Hidden/offscreen/tiny iframes
- Impression beacon gaps
- Served vs viewable discrepancies

**Confidence Rubric:**
- **HIGH (80-100%)**: Multiple offscreen iframes + impression gap
- **MEDIUM (50-79%)**: One strong signal
- **LOW (0-49%)**: Weak or missing signals

### Analytics Inflation

**ID:** `analytics-inflation`

Detects analytics inflation via:
- Duplicate analytics beacons
- Session multiplication
- Multiple measurement IDs

### Consent & Tag Governance

**ID:** `consent-tag-governance`

Validates:
- Unauthorized script detection
- Pre-consent beacons
- Third-party injections

### ID Sync Storm

**ID:** `id-sync-storm`

Detects excessive ID sync activity:
- High sync counts (>100 excessive, >300 severe)
- Multiple counterparties
- High sync-to-event ratio

## Adding New Templates

1. Edit `ai-validation/templates/registry.cjs`
2. Add new template object to `TEMPLATES`:

```javascript
'my-new-template': {
  id: 'my-new-template',
  name: 'My New Template',
  description: 'Description of what this validates',
  systemPrompt: `Your detailed system prompt here...
  
  Include:
  - What to look for
  - Confidence rubric
  - Output format requirements
  `,
  promptVersion: 'v1.0.0'
}
```

3. No code changes needed - templates are loaded dynamically

## Output Schema

### AI Validation Result

```json
{
  "verdict": {
    "label": "PASS" | "WARN" | "FAIL",
    "confidence": 0-100,
    "rationale": "Explanation"
  },
  "findings": [
    {
      "title": "Finding title",
      "mechanism": "How it works",
      "evidence": {
        "counts": {"key": value},
        "examples": [{"detail": "..."}]
      },
      "risk": "HIGH" | "MEDIUM" | "LOW",
      "recommended_next_steps": ["Action 1", "Action 2"]
    }
  ],
  "duplicates": {
    "exact_url_duplicates": 42,
    "top_endpoints": [
      {"endpoint": "example.com/api", "count": 15}
    ]
  },
  "limitations": ["Limitation 1"],
  "model_used": {
    "provider": "OpenAI",
    "model": "gpt-4o",
    "run_at": "2024-01-01T00:00:00Z"
  },
  "prompt_version": "v1.0.0",
  "input_fingerprint": "sha256...",
  "output_fingerprint": "sha256..."
}
```

### Case Brief

```json
{
  "site": "https://example.com",
  "timestamp": "2024-01-01T00:00:00Z",
  "scan_window": "30s",
  "total_events": 100,
  "endpoints": [
    {"endpoint": "example.com/api", "count": 50}
  ],
  "exact_duplicate_urls_count": 10,
  "iframe_anomalies": {
    "offscreen": [...],
    "tiny": [...],
    "hidden": [...]
  },
  "gpt_events": {
    "slotRender": 5,
    "viewable": 3
  },
  "impression_beacons": {
    "count": 20,
    "key_endpoints": ["example.com/beacon"]
  },
  "id_sync": {
    "count": 30,
    "counterparties": [
      {"domain": "sync.example.com", "count": 15}
    ]
  },
  "tag_library_loads": 10,
  "analytics_ids": ["G-ABCDEFGHIJ"],
  "ad_client_ids": ["ca-pub-1234567890123456"],
  "cms_monitor": {
    "total_scripts": 50,
    "unauthorized_count": 5,
    "injected_scripts_count": 2
  },
  "limitations": []
}
```

## PDF Output

The PDF evidence summary is a deterministic one-page document containing:

1. **Header**: Property, scan window, total events, timestamp
2. **Verdict**: Label, confidence, rationale
3. **Key Indicators**: Top 6 findings with risk levels
4. **Concrete Examples**: 2-5 specific examples (iframes, endpoints)
5. **Duplicates**: Duplicate URL counts and top endpoints
6. **Corroboration**: CMS monitor data if available
7. **Limitations**: Any data gaps or constraints
8. **Footer**: Provider, model, prompt version, fingerprints, timestamp

## Redaction Mode

When enabled, redaction mode:
- Removes query parameters from URLs (except allowlisted: id, type, format, v, version)
- Replaces removed parameters with `[REDACTED]`
- Adds limitation note to output

**Allowlist:** `id`, `type`, `format`, `v`, `version`

Example:
```
Before: https://example.com/api?token=abc123&id=5
After:  https://example.com/api?token=[REDACTED]&id=5
```

## Testing

Run all AI validation tests:

```bash
npm test -- ai-validation
```

Test suites:
- `ai-validation-parser.test.js` - Evidence pack parsing
- `ai-validation-schema.test.js` - Schema validation
- `ai-validation-providers.test.js` - Provider implementations
- `ai-validation-pdf.test.js` - PDF generation

## Programmatic Usage

### Parse Evidence Pack

```javascript
const { parseEvidencePack } = require('./ai-validation/parser/evidence-pack-parser.cjs');

const zipBuffer = fs.readFileSync('evidence-pack.zip');
const { caseBrief, fingerprint } = parseEvidencePack(zipBuffer, 'upload-123');

console.log(caseBrief.site);
console.log(caseBrief.total_events);
```

### Run Validation

```javascript
const { runValidation } = require('./ai-validation/orchestrator.cjs');

const result = await runValidation({
  zipBuffer: fs.readFileSync('evidence-pack.zip'),
  uploadId: 'upload-123',
  provider: 'openai',
  template: 'ad-impression-inflation',
  redactionMode: false
});

console.log(result.metadata.verdict);
console.log(result.paths.pdf);
```

### Use Provider Directly

```javascript
const { createProvider } = require('./ai-validation/providers/provider-factory.cjs');
const { getTemplate } = require('./ai-validation/templates/registry.cjs');

const provider = createProvider('openai', { apiKey: 'sk-...' });
const template = getTemplate('ad-impression-inflation');

const aiValidation = await provider.validateCase(
  caseBrief,
  'ad-impression-inflation',
  template.systemPrompt,
  template.promptVersion
);

console.log(aiValidation.verdict);
```

## Troubleshooting

### "API key not provided" Error

Set the appropriate environment variable:
```bash
export OPENAI_API_KEY="sk-..."
# or
export GEMINI_API_KEY="..."
# or
export PERPLEXITY_API_KEY="pplx-..."
```

### "Schema validation failed" Error

The AI returned invalid JSON. This is automatically retried once. If it persists:
- Check your API key is valid
- Try a different provider
- Check the model is available

### "Upload not found" Error

The upload ID is invalid or the file was cleaned up. Re-upload the evidence pack.

### PDF Generation Fails

Ensure `pdfkit` is installed:
```bash
npm install pdfkit
```

### Parser Can't Extract ZIP

Ensure `unzip` command is available on your system:
```bash
which unzip
```

## Performance

- **Upload**: < 1 second for typical evidence packs (< 10MB)
- **Parsing**: 1-3 seconds for evidence pack extraction
- **AI Validation**: 10-30 seconds depending on provider and model
- **PDF Generation**: < 1 second

## Security

- Evidence packs are stored in `runs/ai-validation/<uploadId>/`
- API keys are never logged or exposed
- Redaction mode available for sensitive URLs
- Input/output fingerprints provide audit trail
- Schema validation prevents injection attacks

## Limitations

- Evidence packs must be < 10MB (configurable in server.cjs)
- AI responses are non-deterministic (same input may produce slightly different outputs)
- Provider rate limits apply
- Requires internet connection for AI API calls

## Future Enhancements

- [ ] Support for additional AI providers (Claude, Llama)
- [ ] Multi-page PDF reports
- [ ] Batch validation of multiple evidence packs
- [ ] Historical comparison and trending
- [ ] Custom model selection per provider
- [ ] Webhook notifications on completion
- [ ] Evidence pack validation before upload

## Support

For issues or questions:
1. Check this README
2. Review test files for examples
3. Check server logs for error details
4. Verify API keys and environment variables

## License

Part of the CyberTect/DeDuper.io project.

