/**
 * Perplexity Provider
 * Uses Perplexity API for AI validation
 */

const BaseProvider = require('./base-provider.cjs');
const axios = require('axios');

class PerplexityProvider extends BaseProvider {
  constructor(apiKey, model = 'llama-3.1-sonar-large-128k-online') {
    super('Perplexity', model);
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.perplexity.ai/chat/completions';
  }
  
  /**
   * Validate case using Perplexity
   * @param {object} caseBrief - Canonical case brief
   * @param {string} templateId - Validation template ID
   * @param {string} systemPrompt - Template system prompt
   * @param {string} promptVersion - Template prompt version
   * @returns {Promise<object>} - AI validation result
   */
  async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
    const userPrompt = this.buildUserPrompt(caseBrief);
    
    // Note: Perplexity doesn't need web search for this task - we're analyzing uploaded artifacts
    // API call function
    const apiCall = async () => {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          temperature: 0.1,
          return_citations: false,
          search_domain_filter: [], // No web search needed
          return_images: false
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );
      
      if (!response.data || !response.data.choices || !response.data.choices[0]) {
        throw new Error('Invalid Perplexity API response structure');
      }
      
      return response.data.choices[0].message.content;
    };
    
    // Process with retry
    return await this.processWithRetry(caseBrief, systemPrompt, promptVersion, apiCall);
  }
}

module.exports = PerplexityProvider;

