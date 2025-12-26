# AI Validation Setup Guide

This guide will help you set up the AI Validation module from scratch.

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- At least one AI provider API key (OpenAI, Gemini, or Perplexity)

## Step 1: Install Dependencies

```bash
npm install
```

This will install all required packages including:
- `ajv` and `ajv-formats` for JSON schema validation
- `pdfkit` for PDF generation
- `axios` for HTTP requests

## Step 2: Configure API Keys

### Option A: Environment Variables (Recommended)

Create a `.env` file in the project root (or copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```bash
# Choose one or more providers
OPENAI_API_KEY=sk-your-key-here
GEMINI_API_KEY=your-key-here
PERPLEXITY_API_KEY=pplx-your-key-here
```

Then load the environment variables:

```bash
# On macOS/Linux
source .env

# Or use a package like dotenv
npm install dotenv
```

### Option B: Export in Shell

```bash
export OPENAI_API_KEY="sk-your-key-here"
export GEMINI_API_KEY="your-key-here"
export PERPLEXITY_API_KEY="pplx-your-key-here"
```

### Getting API Keys

**OpenAI ChatGPT:**
1. Go to https://platform.openai.com/api-keys
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)

**Google Gemini:**
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API key"
4. Copy the key

**Perplexity:**
1. Go to https://www.perplexity.ai/settings/api
2. Sign in or create an account
3. Generate an API key
4. Copy the key (starts with `pplx-`)

## Step 3: Verify Installation

Check that all modules are accessible:

```bash
node -e "console.log(require('./ai-validation/orchestrator.cjs'))"
```

Should output: `{ runValidation: [Function], getValidationResult: [Function] }`

## Step 4: Start the Server

```bash
npm run start:server
```

You should see:

```
🚀 DeDuper.io Fraud Scanner API running on http://localhost:3000
📡 Endpoints:
   ...
   POST /api/ai-validation/upload - Upload evidence pack for AI validation
   POST /api/ai-validation/run - Run AI validation
   GET  /api/ai-validation/result/:runId - Get validation result
```

## Step 5: Access the UI

Open your browser and navigate to:

```
http://localhost:3000/ai-validation
```

You should see the AI Validation interface.

## Step 6: Test with Sample Evidence Pack

### Create a Test Evidence Pack

If you have an existing ad impression verification run, you can use its evidence pack:

```bash
ls runs/ad-impression-verification/*/evidence-pack-*.zip
```

Or create a minimal test pack:

```bash
mkdir test-evidence
cd test-evidence

# Create minimal summary.json
cat > summary.json << 'EOF'
{
  "url": "https://example.com",
  "scanTimestamp": "2024-01-01T00:00:00Z",
  "summary": {
    "totalEvents": 100,
    "diagnostic": {
      "tagLibraryLoads": 10,
      "idSyncCount": 50
    },
    "adStackingFindings": {
      "offscreenIframesCount": 3,
      "tinyIframesCount": 2
    }
  }
}
EOF

# Create minimal network.json
cat > network.json << 'EOF'
[
  {"url": "https://example.com/api/beacon", "timestamp": 1000},
  {"url": "https://example.com/api/beacon", "timestamp": 2000}
]
EOF

# Create ZIP
zip test-evidence-pack.zip summary.json network.json

cd ..
```

### Upload and Validate

1. Go to http://localhost:3000/ai-validation
2. Click "Click to upload evidence pack" and select `test-evidence/test-evidence-pack.zip`
3. Select template: "Ad Impression Inflation"
4. Select provider: "OpenAI ChatGPT" (or your configured provider)
5. Click "Send for AI Validation"
6. Wait for processing (10-30 seconds)
7. Download the results:
   - AI Validation JSON
   - Evidence Summary PDF
   - Case Brief JSON

## Step 7: Run Tests

Verify everything works:

```bash
npm test -- ai-validation
```

All tests should pass:
- ✓ Evidence Pack Parser tests
- ✓ Schema validation tests
- ✓ Provider tests
- ✓ PDF generation tests

## Troubleshooting

### "API key not provided" Error

**Problem:** Environment variable not set

**Solution:**
```bash
# Check if variable is set
echo $OPENAI_API_KEY

# If empty, export it
export OPENAI_API_KEY="sk-your-key-here"

# Restart the server
npm run start:server
```

### "Cannot find module 'ajv'" Error

**Problem:** Dependencies not installed

**Solution:**
```bash
npm install ajv ajv-formats pdfkit
```

### "ENOENT: no such file or directory, open 'runs/ai-validation/...'"

**Problem:** Runs directory doesn't exist

**Solution:**
```bash
mkdir -p runs/ai-validation
```

### "Schema validation failed" Error

**Problem:** AI returned invalid JSON

**Solution:**
- This is automatically retried once
- Try a different provider
- Check your API key is valid and has credits
- Check the model is available

### "Failed to extract ZIP" Error

**Problem:** `unzip` command not found

**Solution:**
```bash
# macOS
brew install unzip

# Ubuntu/Debian
sudo apt-get install unzip

# Or use Node.js unzip library (alternative)
npm install adm-zip
```

### PDF Generation Fails

**Problem:** `pdfkit` not installed or missing fonts

**Solution:**
```bash
npm install pdfkit

# If font issues persist, install system fonts
# macOS - fonts should be available by default
# Ubuntu/Debian
sudo apt-get install fonts-liberation
```

### Port 3000 Already in Use

**Problem:** Another service is using port 3000

**Solution:**
```bash
# Use a different port
PORT=3001 npm run start:server

# Or kill the process using port 3000
lsof -ti:3000 | xargs kill
```

## Next Steps

1. **Create Custom Templates**: Edit `ai-validation/templates/registry.cjs` to add your own validation templates
2. **Integrate with Workflow**: Use the API endpoints to integrate AI validation into your existing workflows
3. **Automate**: Create scripts to automatically validate evidence packs as they're generated
4. **Monitor**: Set up logging and monitoring for AI validation runs

## Advanced Configuration

### Custom Models

You can specify custom models when creating providers programmatically:

```javascript
const { createProvider } = require('./ai-validation/providers/provider-factory.cjs');

const provider = createProvider('openai', {
  apiKey: 'sk-...',
  model: 'gpt-4-turbo-preview' // Custom model
});
```

### Batch Processing

Process multiple evidence packs:

```javascript
const { runValidation } = require('./ai-validation/orchestrator.cjs');
const fs = require('fs');
const path = require('path');

const evidenceDir = 'evidence-packs';
const files = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.zip'));

for (const file of files) {
  const zipBuffer = fs.readFileSync(path.join(evidenceDir, file));
  const uploadId = `batch-${Date.now()}-${file}`;
  
  await runValidation({
    zipBuffer,
    uploadId,
    provider: 'openai',
    template: 'ad-impression-inflation',
    redactionMode: false
  });
  
  console.log(`Processed: ${file}`);
}
```

### Custom Redaction Rules

Modify the allowlist in `ai-validation/orchestrator.cjs`:

```javascript
// In redactCaseBrief function
const allowlist = ['id', 'type', 'format', 'v', 'version', 'custom_param'];
```

## Support

For issues or questions:
1. Check this setup guide
2. Review the main README: `ai-validation/README.md`
3. Check test files for examples
4. Review server logs for error details

## Resources

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [Perplexity API Documentation](https://docs.perplexity.ai/)
- [JSON Schema Documentation](https://json-schema.org/)
- [PDFKit Documentation](https://pdfkit.org/)

