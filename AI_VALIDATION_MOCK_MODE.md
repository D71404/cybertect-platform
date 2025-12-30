# AI Validation Mock Mode Setup

## Overview

The AI Validation module includes a **Mock Mode** that allows you to test the entire AI validation workflow without requiring API keys or making actual API calls to OpenAI, Gemini, or Perplexity.

This is perfect for:
- ✅ Development and testing
- ✅ Demo environments
- ✅ CI/CD pipelines
- ✅ Cost-free validation testing

---

## Quick Start

### 1. Enable Mock Mode

Set the environment variable before starting the server:

```bash
export AI_VALIDATION_MOCK_MODE=true
node server.cjs
```

Or inline:

```bash
AI_VALIDATION_MOCK_MODE=true node server.cjs
```

### 2. Verify Mock Mode is Active

When the server starts, you'll see:

```
🚀 CyberTect Server is running!
📡 Local: http://localhost:3000
🧪 Mock Mode: ENABLED
```

### 3. Test the Mock Provider

```bash
curl -X POST http://localhost:3000/api/ai-validation/run \
  -H "Content-Type: application/json" \
  -d '{
    "caseBrief": {"site": "test.com", "ga4_ids": ["G-TEST"]},
    "provider": "openai",
    "template": "ad-impression-inflation"
  }'
```

---

## How Mock Mode Works

### Provider Behavior

When mock mode is enabled:
- **All providers** (OpenAI, Gemini, Perplexity) return mock responses
- No API keys are required
- No external API calls are made
- Responses are deterministic and schema-valid

### Mock Response Structure

The mock provider generates realistic AI validation responses:

```json
{
  "verdict": {
    "label": "WARN",
    "confidence": 75,
    "rationale": "Mock validation detected potential issues..."
  },
  "findings": [
    {
      "title": "Mock Finding: Suspicious Pattern",
      "mechanism": "Mock analysis identified...",
      "evidence": {
        "counts": {"suspicious_events": 10},
        "examples": ["example1", "example2"]
      },
      "risk": "MEDIUM",
      "recommended_next_steps": ["Review logs", "Check configuration"]
    }
  ],
  "duplicates": {
    "exact_url_duplicates": 5,
    "top_endpoints": [
      {"endpoint": "analytics.example.com", "count": 15}
    ]
  },
  "limitations": ["Mock mode - not real AI analysis"],
  "model_used": {
    "provider": "openai (mock)",
    "model": "gpt-4o",
    "run_at": "2025-12-24T17:55:00.000Z"
  },
  "prompt_version": "v1.0",
  "input_fingerprint": "mock-input-abc123",
  "output_fingerprint": "mock-output-def456"
}
```

---

## Frontend Integration

### Scanner Page

The static HTML scanner (`public/index.html`) automatically detects mock mode and displays a banner:

```
🧪 Mock Mode Active
```

This banner appears when:
1. Mock mode is enabled on the server
2. The "Send to AI Validator" button is clicked

### React AI Validation Page

The React component (`src/components/AIValidation.jsx`) can also detect mock mode by checking the provider names returned from `/api/ai-validation/providers`:

```javascript
// Providers in mock mode have " (Mock)" suffix
const providers = await fetch('/api/ai-validation/providers').then(r => r.json());
// Example: "OpenAI ChatGPT (Mock)"
```

---

## Switching to Real AI Providers

### Step 1: Get API Keys

- **OpenAI**: https://platform.openai.com/api-keys
- **Gemini**: https://aistudio.google.com/app/apikey
- **Perplexity**: https://www.perplexity.ai/settings/api

### Step 2: Set Environment Variables

Create a `.env` file in the project root:

```bash
# .env
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
PERPLEXITY_API_KEY=pplx-...
```

Or export them:

```bash
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AI...
export PERPLEXITY_API_KEY=pplx-...
```

### Step 3: Disable Mock Mode

**Option A:** Remove the environment variable:

```bash
unset AI_VALIDATION_MOCK_MODE
node server.cjs
```

**Option B:** Set it to false:

```bash
AI_VALIDATION_MOCK_MODE=false node server.cjs
```

### Step 4: Verify Real Providers

When the server starts without mock mode:

```
🚀 CyberTect Server is running!
📡 Local: http://localhost:3000
🧪 Mock Mode: DISABLED
```

---

## Testing

### Unit Tests

Run the AI validation tests (including mock provider tests):

```bash
npm test tests/ai-validation-providers.test.js
```

### Manual Testing

1. **Start server in mock mode:**
   ```bash
   AI_VALIDATION_MOCK_MODE=true node server.cjs
   ```

2. **Open the scanner:**
   ```
   http://localhost:3000
   ```

3. **Scan a website:**
   - Enter a URL (e.g., `https://example.com`)
   - Click "Scan"

4. **Send to AI Validator:**
   - Click the "Send to AI Validator" button in the scan results
   - See mock responses from all 3 providers (OpenAI, Gemini, Perplexity)

---

## Architecture

### Mock Provider Implementation

Location: `ai-validation/providers/mock-provider.cjs`

```javascript
class MockProvider extends BaseProvider {
  async validateCase(caseBrief, template) {
    // Returns deterministic mock response
    // Includes realistic findings based on caseBrief
    // Always passes schema validation
  }
}
```

### Provider Factory

Location: `ai-validation/providers/provider-factory.cjs`

```javascript
function createProvider(providerName, config = {}) {
  const mockMode = process.env.AI_VALIDATION_MOCK_MODE === 'true';
  
  if (mockMode) {
    return new MockProvider(providerName, config.model);
  }
  
  // ... real provider instantiation
}
```

---

## Troubleshooting

### Mock Mode Not Working

**Symptom:** Server still requires API keys

**Solution:**
```bash
# Ensure the environment variable is set BEFORE starting the server
export AI_VALIDATION_MOCK_MODE=true
node server.cjs
```

### Mock Banner Not Showing

**Symptom:** No "Mock Mode Active" banner in the UI

**Solution:**
- Check that the server is running in mock mode (see server startup logs)
- Refresh the browser page
- Check browser console for errors

### Real Providers Still Being Called

**Symptom:** API errors even with mock mode enabled

**Solution:**
- Restart the server (environment variables are loaded at startup)
- Verify `AI_VALIDATION_MOCK_MODE=true` is set in the same terminal session
- Check server logs for "🧪 Mock mode enabled for AI validation."

---

## Production Deployment

### Recommended Setup

```bash
# Production: Use real providers
AI_VALIDATION_MOCK_MODE=false
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
PERPLEXITY_API_KEY=pplx-...

# Staging/Demo: Use mock mode
AI_VALIDATION_MOCK_MODE=true
```

### Docker Example

```dockerfile
# Dockerfile
ENV AI_VALIDATION_MOCK_MODE=false
ENV OPENAI_API_KEY=${OPENAI_API_KEY}
ENV GEMINI_API_KEY=${GEMINI_API_KEY}
ENV PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}
```

---

## Next Steps

1. ✅ **Test mock mode** - Verify the entire workflow works
2. ✅ **Get API keys** - Sign up for real AI providers
3. ✅ **Switch to real mode** - Set API keys and disable mock mode
4. ✅ **Monitor costs** - Track API usage in provider dashboards

---

## Support

For issues or questions:
- See `ai-validation/README.md` for full documentation
- Check `ai-validation/SETUP.md` for API key setup
- Review `tests/ai-validation-providers.test.js` for examples



