const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Google Gemini Provider
 * Integration with Google Gemini models
 *
 * Supported Models:
 * - gemini-1.5-pro (latest, 1M token context)
 * - gemini-1.5-flash (faster, optimized)
 * - gemini-pro (stable)
 * - gemini-pro-vision (multimodal)
 */

class GeminiProvider {
  constructor(config) {
    this.provider = 'gemini';
    this.config = config;
    this.apiKey = config.apiConfig?.apiKey;
    this.projectId = config.apiConfig?.projectId;
    this.modelId = config.modelId;

    if (!this.apiKey) {
      throw new Error('Google Gemini API key is required');
    }

    this.baseUrl = config.apiConfig?.endpoint ||
      `https://generativelanguage.googleapis.com/v1beta/models`;

    this.httpClient = axios.create({
      timeout: 60000 // 60 second timeout
    });
  }

  /**
   * Call the Gemini API with unified interface
   * @param {Object} params - Request parameters
   * @param {string} params.prompt - The user prompt
   * @param {string} params.systemPrompt - Optional system prompt
   * @param {number} params.temperature - Temperature for sampling (0-1)
   * @param {number} params.maxTokens - Maximum output tokens
   * @param {Array} params.stopSequences - Stop sequences
   * @param {Object} params.metadata - Request metadata
   * @returns {Promise<Object>} Normalized response
   */
  async call(params) {
    const startTime = Date.now();

    try {
      const request = this._buildRequest(params);
      const url = `${this.baseUrl}/${this.modelId}:generateContent?key=${this.apiKey}`;

      logger.info('Gemini API request', {
        model: this.modelId,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens
      });

      const response = await this.httpClient.post(url, request);
      const latency = Date.now() - startTime;

      logger.info('Gemini API response', {
        model: this.modelId,
        latency,
        inputTokens: response.data.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.data.usageMetadata?.candidatesTokenCount || 0
      });

      return this._normalizeResponse(response.data, latency);

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Gemini API error', {
        model: this.modelId,
        error: error.message,
        latency,
        status: error.response?.status,
        data: error.response?.data
      });

      throw this._normalizeError(error);
    }
  }

  /**
   * Call the Gemini API with streaming
   * @param {Object} params - Request parameters
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<Object>} Final normalized response
   */
  async callStreaming(params, onChunk) {
    const startTime = Date.now();

    try {
      const request = this._buildRequest(params);
      const url = `${this.baseUrl}/${this.modelId}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

      logger.info('Gemini API streaming request', {
        model: this.modelId,
        promptLength: params.prompt?.length
      });

      const response = await this.httpClient.post(url, request, {
        responseType: 'stream'
      });

      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          try {
            const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6));

                if (data.candidates && data.candidates[0]) {
                  const content = data.candidates[0].content;
                  if (content?.parts) {
                    const text = content.parts
                      .filter(part => part.text)
                      .map(part => part.text)
                      .join('');

                    fullText += text;

                    if (onChunk && text) {
                      onChunk({ type: 'content', text });
                    }
                  }

                  // Update token counts if provided
                  if (data.usageMetadata) {
                    inputTokens = data.usageMetadata.promptTokenCount || inputTokens;
                    outputTokens = data.usageMetadata.candidatesTokenCount || outputTokens;
                  }

                  // Check if generation is complete
                  if (data.candidates[0].finishReason) {
                    const latency = Date.now() - startTime;
                    const normalized = {
                      success: true,
                      provider: this.provider,
                      model: this.modelId,
                      content: fullText,
                      usage: {
                        inputTokens,
                        outputTokens,
                        totalTokens: inputTokens + outputTokens
                      },
                      latency,
                      finishReason: data.candidates[0].finishReason
                    };

                    logger.info('Gemini streaming complete', {
                      model: this.modelId,
                      latency,
                      inputTokens,
                      outputTokens
                    });

                    resolve(normalized);
                  }
                }
              }
            }
          } catch (err) {
            logger.error('Error parsing streaming chunk', { error: err.message });
          }
        });

        response.data.on('end', () => {
          // If we haven't resolved yet, resolve now
          const latency = Date.now() - startTime;
          resolve({
            success: true,
            provider: this.provider,
            model: this.modelId,
            content: fullText,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens
            },
            latency,
            finishReason: 'stop'
          });
        });

        response.data.on('error', (error) => {
          reject(this._normalizeError(error));
        });
      });

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Gemini streaming error', {
        model: this.modelId,
        error: error.message,
        latency
      });

      throw this._normalizeError(error);
    }
  }

  /**
   * Count tokens in text (estimation)
   * @param {string} text - Text to count tokens
   * @returns {number} Estimated token count
   */
  countTokens(text) {
    if (!text) return 0;
    // Gemini uses similar tokenization to GPT
    // Rough estimation: ~4 characters per token
    const words = text.split(/\s+/).length;
    const chars = text.length;
    return Math.ceil((words * 1.3 + chars / 4) / 2);
  }

  /**
   * Check if the provider is healthy
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const url = `${this.baseUrl}/${this.modelId}:generateContent?key=${this.apiKey}`;
      const response = await this.httpClient.post(url, {
        contents: [
          {
            parts: [
              {
                text: 'Hello'
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 10
        }
      });

      return response.status === 200;
    } catch (error) {
      logger.error('Gemini health check failed', {
        error: error.message,
        status: error.response?.status
      });
      return false;
    }
  }

  /**
   * Build the Gemini API request
   * @private
   */
  _buildRequest(params) {
    const contents = [];

    // Build conversation history
    if (params.messages && Array.isArray(params.messages)) {
      contents.push(...params.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      })));
    } else if (params.prompt) {
      contents.push({
        role: 'user',
        parts: [{ text: params.prompt }]
      });
    }

    const request = {
      contents
    };

    // Add system instruction if provided (Gemini 1.5+ feature)
    if (params.systemPrompt && this.config.capabilities.supportsSystemPrompt) {
      request.systemInstruction = {
        parts: [{ text: params.systemPrompt }]
      };
    }

    // Generation configuration
    const generationConfig = {
      maxOutputTokens: params.maxTokens ||
        this.config.defaultParameters.maxOutputTokens || 4096
    };

    if (params.temperature !== undefined) {
      generationConfig.temperature = Math.max(0, Math.min(1, params.temperature));
    } else if (this.config.defaultParameters.temperature !== undefined) {
      generationConfig.temperature = this.config.defaultParameters.temperature;
    }

    if (params.topP !== undefined) {
      generationConfig.topP = Math.max(0, Math.min(1, params.topP));
    } else if (this.config.defaultParameters.topP !== undefined) {
      generationConfig.topP = this.config.defaultParameters.topP;
    }

    if (params.stopSequences && params.stopSequences.length > 0) {
      generationConfig.stopSequences = params.stopSequences;
    } else if (this.config.defaultParameters.stopSequences?.length > 0) {
      generationConfig.stopSequences = this.config.defaultParameters.stopSequences;
    }

    request.generationConfig = generationConfig;

    // Safety settings (optional)
    if (params.safetySettings) {
      request.safetySettings = params.safetySettings;
    }

    return request;
  }

  /**
   * Normalize the Gemini API response
   * @private
   */
  _normalizeResponse(data, latency) {
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No candidates in response');
    }

    const candidate = data.candidates[0];
    const content = candidate.content.parts
      .filter(part => part.text)
      .map(part => part.text)
      .join('\n');

    const inputTokens = data.usageMetadata?.promptTokenCount || 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

    return {
      success: true,
      provider: this.provider,
      model: this.modelId,
      content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      latency,
      finishReason: candidate.finishReason || 'STOP',
      safetyRatings: candidate.safetyRatings,
      rawResponse: data
    };
  }

  /**
   * Normalize errors to a consistent format
   * @private
   */
  _normalizeError(error) {
    const normalized = {
      success: false,
      provider: this.provider,
      model: this.modelId,
      error: error.message,
      errorType: 'unknown',
      retryable: false
    };

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      normalized.httpStatus = status;
      normalized.errorDetails = data;

      // Categorize errors
      if (status === 400) {
        normalized.errorType = 'invalid_request';
        normalized.error = data.error?.message || 'Invalid request';
      } else if (status === 401) {
        normalized.errorType = 'authentication_error';
        normalized.error = 'Invalid API key';
      } else if (status === 403) {
        normalized.errorType = 'permission_error';
        normalized.error = 'Permission denied';
      } else if (status === 404) {
        normalized.errorType = 'not_found';
        normalized.error = 'Model not found';
      } else if (status === 429) {
        normalized.errorType = 'rate_limit_error';
        normalized.error = 'Rate limit exceeded';
        normalized.retryable = true;
      } else if (status === 500) {
        normalized.errorType = 'api_error';
        normalized.error = 'Gemini API error';
        normalized.retryable = true;
      } else if (status === 503) {
        normalized.errorType = 'overloaded_error';
        normalized.error = 'Gemini API is overloaded';
        normalized.retryable = true;
      }
    } else if (error.code === 'ECONNABORTED') {
      normalized.errorType = 'timeout_error';
      normalized.error = 'Request timeout';
      normalized.retryable = true;
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      normalized.errorType = 'connection_error';
      normalized.error = 'Connection error';
      normalized.retryable = true;
    }

    return normalized;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      provider: this.provider,
      model: this.modelId,
      ...this.config.capabilities
    };
  }

  /**
   * Get provider info
   */
  getInfo() {
    return {
      provider: this.provider,
      model: this.modelId,
      modelName: this.config.modelName,
      status: this.config.status,
      capabilities: this.getCapabilities()
    };
  }
}

module.exports = GeminiProvider;
