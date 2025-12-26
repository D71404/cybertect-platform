/**
 * OpenAI Provider
 * Uses OpenAI ChatGPT API for AI validation
 */

const BaseProvider = require('./base-provider.cjs');
const axios = require('axios');

class OpenAIProvider extends BaseProvider {
  constructor(apiKey, model = 'gpt-4o') {
    super('OpenAI', model);
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
  }
  
  /**
   * Validate case using OpenAI ChatGPT
   * @param {object} caseBrief - Canonical case brief
   * @param {string} templateId - Validation template ID
   * @param {string} systemPrompt - Template system prompt
   * @param {string} promptVersion - Template prompt version
   * @returns {Promise<object>} - AI validation result
   */
  async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
    const userPrompt = this.buildUserPrompt(caseBrief);
    
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
          temperature: 0.1, // Low temperature for consistent, deterministic output
          response_format: { type: 'json_object' } // Force JSON mode
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 second timeout
        }
      );
      
      if (!response.data || !response.data.choices || !response.data.choices[0]) {
        throw new Error('Invalid OpenAI API response structure');
      }
      
      return response.data.choices[0].message.content;
    };
    
    // Process with retry
    return await this.processWithRetry(caseBrief, systemPrompt, promptVersion, apiCall);
  }
}

module.exports = OpenAIProvider;

