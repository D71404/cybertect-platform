/**
 * Google Gemini Provider
 * Uses Google Gemini API for AI validation
 */

const BaseProvider = require('./base-provider.cjs');
const axios = require('axios');

class GeminiProvider extends BaseProvider {
  constructor(apiKey, model = 'gemini-2.0-flash-exp') {
    super('Gemini', model);
    this.apiKey = apiKey;
    this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }
  
  /**
   * Validate case using Google Gemini
   * @param {object} caseBrief - Canonical case brief
   * @param {string} templateId - Validation template ID
   * @param {string} systemPrompt - Template system prompt
   * @param {string} promptVersion - Template prompt version
   * @returns {Promise<object>} - AI validation result
   */
  async validateCase(caseBrief, templateId, systemPrompt, promptVersion) {
    const userPrompt = this.buildUserPrompt(caseBrief);
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    
    // API call function
    const apiCall = async () => {
      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: combinedPrompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.95,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );
      
      if (!response.data || !response.data.candidates || !response.data.candidates[0]) {
        throw new Error('Invalid Gemini API response structure');
      }
      
      const candidate = response.data.candidates[0];
      if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
        throw new Error('Invalid Gemini response content structure');
      }
      
      return candidate.content.parts[0].text;
    };
    
    // Process with retry
    return await this.processWithRetry(caseBrief, systemPrompt, promptVersion, apiCall);
  }
}

module.exports = GeminiProvider;

