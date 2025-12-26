# AI Validation Quick Reference

## 🚀 Quick Start (30 seconds)

```bash
# 1. Set API key
export OPENAI_API_KEY="sk-your-key-here"

# 2. Start server
npm run start:server

# 3. Open browser
open http://localhost:3000/ai-validation
```

## 📋 API Cheat Sheet

### Upload Evidence Pack
```bash
curl -X POST http://localhost:3000/api/ai-validation/upload \
  -F "evidencePack=@evidence-pack.zip"
```

### Run Validation
```bash
curl -X POST http://localhost:3000/api/ai-validation/run \
  -H "Content-Type: application/json" \
  -d '{
    "uploadId": "ai-validation-1234567890",
    "provider": "openai",
    "template": "ad-impression-inflation",
    "redaction": false
  }'
```

### Get Result
```bash
curl http://localhost:3000/api/ai-validation/result/ai-validation-1234567890
```

### List Templates
```bash
curl http://localhost:3000/api/ai-validation/templates
```

### List Providers
```bash
curl http://localhost:3000/api/ai-validation/providers
```

## 🎯 Templates

| ID | Name | Use Case |
|----|------|----------|
| `ad-impression-inflation` | Ad Impression Inflation | Hidden iframes, impression gaps |
| `analytics-inflation` | Analytics Inflation | Duplicate pageviews, events |
| `consent-tag-governance` | Consent & Tag Governance | Unauthorized scripts |
| `id-sync-storm` | ID Sync Storm | Excessive ID syncing |

## 🤖 Providers

| ID | Name | Model | Env Var |
|----|------|-------|---------|
| `openai` | OpenAI ChatGPT | gpt-4o | `OPENAI_API_KEY` |
| `gemini` | Google Gemini | gemini-2.0-flash-exp | `GEMINI_API_KEY` |
| `perplexity` | Perplexity | llama-3.1-sonar-large-128k-online | `PERPLEXITY_API_KEY` |

## 📦 Evidence Pack Structure

```
evidence-pack.zip
├── summary.json      # Required: Scan summary
├── network.json      # Required: Network events
├── sequences.json    # Required: Event sequences
├── flags.json        # Optional: Flagged events
└── *.png            # Optional: Screenshots
```

## 📄 Output Files

```
runs/ai-validation/<runId>/
├── case_brief.json         # Canonical evidence summary
├── ai_validation.json      # AI output (schema-valid)
├── evidence_summary.pdf    # One-page PDF
└── metadata.json           # Run metadata
```

## 🔧 Programmatic Usage

### Parse Evidence Pack
```javascript
const { parseEvidencePack } = require('./ai-validation/parser/evidence-pack-parser.cjs');
const fs = require('fs');

const zipBuffer = fs.readFileSync('evidence-pack.zip');
const { caseBrief } = parseEvidencePack(zipBuffer, 'upload-123');
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
```

### Use Provider Directly
```javascript
const { createProvider } = require('./ai-validation/providers/provider-factory.cjs');
const { getTemplate } = require('./ai-validation/templates/registry.cjs');

const provider = createProvider('openai');
const template = getTemplate('ad-impression-inflation');

const result = await provider.validateCase(
  caseBrief,
  'ad-impression-inflation',
  template.systemPrompt,
  template.promptVersion
);
```

## 🧪 Testing

```bash
# Run all AI validation tests
npm test -- ai-validation

# Run specific test file
npm test -- ai-validation-parser.test.js

# Run with coverage
npm test -- --coverage ai-validation
```

## 🐛 Common Issues

### API Key Not Found
```bash
# Check if set
echo $OPENAI_API_KEY

# Set it
export OPENAI_API_KEY="sk-your-key-here"
```

### Module Not Found
```bash
# Install dependencies
npm install ajv ajv-formats pdfkit
```

### Port Already in Use
```bash
# Use different port
PORT=3001 npm run start:server
```

### Schema Validation Failed
- AI returned invalid JSON (retried automatically)
- Check API key has credits
- Try different provider

## 📊 Verdict Labels

| Label | Confidence | Meaning |
|-------|-----------|---------|
| `PASS` | 0-49% | Low confidence, insufficient evidence |
| `WARN` | 50-79% | Medium confidence, suspicious patterns |
| `FAIL` | 80-100% | High confidence, fraud detected |

## 🎨 Risk Levels

| Risk | Color | When to Use |
|------|-------|-------------|
| `HIGH` | 🔴 Red | Severe fraud indicators |
| `MEDIUM` | 🟡 Yellow | Suspicious patterns |
| `LOW` | 🟢 Green | Minor issues or informational |

## 🔒 Redaction Mode

**Allowlisted params:** `id`, `type`, `format`, `v`, `version`

**Example:**
```
Before: https://api.com/track?token=abc123&id=5
After:  https://api.com/track?token=[REDACTED]&id=5
```

## 📝 Adding New Template

Edit `ai-validation/templates/registry.cjs`:

```javascript
'my-template': {
  id: 'my-template',
  name: 'My Template',
  description: 'What this validates',
  systemPrompt: `Your system prompt here...`,
  promptVersion: 'v1.0.0'
}
```

No restart needed - templates load dynamically!

## 📚 Documentation

| File | Purpose |
|------|---------|
| `README.md` | Full documentation |
| `SETUP.md` | Step-by-step setup |
| `IMPLEMENTATION_SUMMARY.md` | Technical details |
| `QUICK_REFERENCE.md` | This file |

## 🔗 Useful Links

- **OpenAI API Keys**: https://platform.openai.com/api-keys
- **Gemini API Keys**: https://aistudio.google.com/app/apikey
- **Perplexity API Keys**: https://www.perplexity.ai/settings/api
- **JSON Schema Docs**: https://json-schema.org/
- **PDFKit Docs**: https://pdfkit.org/

## 💡 Tips

1. **Start with OpenAI**: Most reliable for structured JSON output
2. **Use Redaction**: Enable for production evidence packs
3. **Check Limitations**: Review `limitations` array in output
4. **Verify Fingerprints**: Use for audit trail and reproducibility
5. **Monitor Costs**: AI API calls cost money - track usage
6. **Test Templates**: Validate new templates with known cases
7. **Batch Process**: Use programmatic API for multiple packs
8. **Save Results**: Archive JSON and PDF for compliance

## 🎯 Best Practices

- ✅ Always check `verdict.confidence` score
- ✅ Review `findings` array for details
- ✅ Compare `input_fingerprint` for duplicate detection
- ✅ Include `findingsJson` for CMS monitor data
- ✅ Use `redactionMode` for sensitive URLs
- ✅ Archive PDFs for evidence trail
- ✅ Test with sample packs before production
- ✅ Monitor API rate limits

## 🚨 Troubleshooting One-Liners

```bash
# Check server is running
curl http://localhost:3000/api/health

# Verify dependencies
node -e "console.log(require('ajv'), require('pdfkit'))"

# Test provider
node -e "const {createProvider}=require('./ai-validation/providers/provider-factory.cjs'); console.log(createProvider('openai',{apiKey:'test'}))"

# List templates
node -e "console.log(require('./ai-validation/templates/registry.cjs').listTemplates())"

# Check runs directory
ls -la runs/ai-validation/

# View latest result
cat runs/ai-validation/*/metadata.json | jq .
```

## 📞 Getting Help

1. Check this quick reference
2. Read `README.md` for details
3. Review `SETUP.md` for troubleshooting
4. Check test files for examples
5. Review server logs: `npm run start:server`

---

**Remember:** At least one provider API key must be set!

```bash
export OPENAI_API_KEY="sk-..."
# or
export GEMINI_API_KEY="..."
# or
export PERPLEXITY_API_KEY="pplx-..."
```

