/**
 * Provider Factory
 * Creates AI provider instances based on provider name
 */

const OpenAIProvider = require('./openai-provider.cjs');
const GeminiProvider = require('./gemini-provider.cjs');
const PerplexityProvider = require('./perplexity-provider.cjs');
const MockProvider = require('./mock-provider.cjs');

// Enable mock mode if no API keys are available or MOCK_MODE is set
const MOCK_MODE = process.env.MOCK_MODE === 'true' || 
                  (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY && !process.env.PERPLEXITY_API_KEY);

/**
 * Create provider instance
 * @param {string} providerName - Provider name (openai, gemini, perplexity)
 * @param {object} config - Provider configuration
 * @returns {BaseProvider} - Provider instance
 */
function createProvider(providerName, config = {}) {
  const normalizedName = providerName.toLowerCase();
  
  // If in mock mode, return mock providers
  if (MOCK_MODE || config.mock === true) {
    console.log(`🧪 Mock mode enabled for ${providerName}`);
    switch (normalizedName) {
      case 'openai':
      case 'chatgpt':
        return new MockProvider('ChatGPT (Mock)', 'gpt-4o-mock');
      case 'gemini':
      case 'google':
        return new MockProvider('Gemini (Mock)', 'gemini-2.0-mock');
      case 'perplexity':
        return new MockProvider('Perplexity (Mock)', 'sonar-mock');
      default:
        return new MockProvider('MockAI', 'mock-1.0');
    }
  }
  
  // Real provider mode - require API keys
  switch (normalizedName) {
    case 'openai':
    case 'chatgpt':
      const openaiKey = config.apiKey || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        throw new Error('OpenAI API key not provided. Set OPENAI_API_KEY environment variable.');
      }
      return new OpenAIProvider(openaiKey, config.model);
    
    case 'gemini':
    case 'google':
      const geminiKey = config.apiKey || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        throw new Error('Gemini API key not provided. Set GEMINI_API_KEY environment variable.');
      }
      return new GeminiProvider(geminiKey, config.model);
    
    case 'perplexity':
      const perplexityKey = config.apiKey || process.env.PERPLEXITY_API_KEY;
      if (!perplexityKey) {
        throw new Error('Perplexity API key not provided. Set PERPLEXITY_API_KEY environment variable.');
      }
      return new PerplexityProvider(perplexityKey, config.model);
    
    default:
      throw new Error(`Unknown provider: ${providerName}. Supported: openai, gemini, perplexity`);
  }
}

/**
 * List available providers
 * @returns {array} - Array of provider names
 */
function listProviders() {
  const mockSuffix = MOCK_MODE ? ' (Mock Mode)' : '';
  return [
    { id: 'openai', name: `OpenAI ChatGPT${mockSuffix}`, defaultModel: 'gpt-4o', mock: MOCK_MODE },
    { id: 'gemini', name: `Google Gemini${mockSuffix}`, defaultModel: 'gemini-2.0-flash-exp', mock: MOCK_MODE },
    { id: 'perplexity', name: `Perplexity${mockSuffix}`, defaultModel: 'llama-3.1-sonar-large-128k-online', mock: MOCK_MODE }
  ];
}

/**
 * Check if mock mode is enabled
 * @returns {boolean} - True if mock mode is active
 */
function isMockMode() {
  return MOCK_MODE;
}

module.exports = {
  createProvider,
  listProviders,
  isMockMode
};

