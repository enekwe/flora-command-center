const axios = require('axios');
const logger = require('../../utils/logger');
const { getProviderApiKey, getProviderEndpoint } = require('../../utils/palConfig');

/**
 * GLM Provider
 * Integration with Zhipu AI ChatGLM models
 *
 * Supported Models:
 * - glm-4 (128K context, most capable)
 * - glm-4-flash (fast, cost-effective)
 * - glm-3-turbo (balanced performance)
 *
 * Specializations:
 * - Long-context understanding (up to 128K tokens)
 * - Multi-turn conversations
 * - Chinese and English bilingual
 * - Code generation and analysis
 * - Technical documentation
 *
 * API Documentation: https://open.bigmodel.cn/dev/api
 * Cost: $0.07-0.50 per 1M tokens depending on model
 */

class GLMProvider {
  constructor(config) {
    this.provider = 'glm';
    this.config = config;
    // Use palConfig helper to get API key with fallback support
    this.apiKey = config.apiConfig?.apiKey || getProviderApiKey('glm');
    this.endpoint = config.apiConfig?.endpoint || getProviderEndpoint('glm') ||
      'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    this.modelId = config.modelId;

    if (!this.apiKey) {
      throw new Error('GLM API key (Zhipu AI) is required. Set GLM_API_KEY, ZHIPU_API_KEY, or PAL_GLM_API_KEY environment variable.');
    }

    // Rate limiting state
    this.rateLimitState = {
      requestsThisMinute: 0,
      tokensThisMinute: 0,
      lastResetTime: Date.now(),
      concurrentRequests: 0
    };

    this.httpClient = axios.create({
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 120 second timeout for long context
    });
  }

  /**
   * Call the GLM API with unified interface
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
      // Check rate limits before making request
      await this._checkRateLimits(params);

      const request = this._buildRequest(params);
      logger.info('GLM API request', {
        model: this.modelId,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens
      });

      this.rateLimitState.concurrentRequests++;

      const response = await this.httpClient.post(this.endpoint, request);
      const latency = Date.now() - startTime;

      // Update rate limit tracking
      this._updateRateLimits(
        response.data.usage?.prompt_tokens || 0,
        response.data.usage?.completion_tokens || 0
      );

      logger.info('GLM API response', {
        model: this.modelId,
        latency,
        inputTokens: response.data.usage?.prompt_tokens || 0,
        outputTokens: response.data.usage?.completion_tokens || 0
      });

      return this._normalizeResponse(response.data, latency);

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('GLM API error', {
        model: this.modelId,
        error: error.message,
        latency,
        status: error.response?.status,
        data: error.response?.data
      });

      throw this._normalizeError(error);
    } finally {
      this.rateLimitState.concurrentRequests = Math.max(
        0,
        this.rateLimitState.concurrentRequests - 1
      );
    }
  }

  /**
   * Call the GLM API with streaming
   * @param {Object} params - Request parameters
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<Object>} Final normalized response
   */
  async callStreaming(params, onChunk) {
    const startTime = Date.now();

    try {
      // Check rate limits before making request
      await this._checkRateLimits(params);

      const request = this._buildRequest(params);
      request.stream = true;

      logger.info('GLM API streaming request', {
        model: this.modelId,
        promptLength: params.prompt?.length
      });

      this.rateLimitState.concurrentRequests++;

      const response = await this.httpClient.post(this.endpoint, request, {
        responseType: 'stream'
      });

      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = 'stop';

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          try {
            const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              // GLM SSE format
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();

                // Skip [DONE] marker
                if (data === '[DONE]') {
                  continue;
                }

                const parsed = JSON.parse(data);

                // Check for errors
                if (parsed.error) {
                  const error = new Error(parsed.error.message || 'GLM API error');
                  error.code = parsed.error.code;
                  throw error;
                }

                // Extract content from delta
                if (parsed.choices && parsed.choices.length > 0) {
                  const delta = parsed.choices[0].delta;
                  if (delta.content) {
                    fullText += delta.content;

                    if (onChunk) {
                      onChunk({ type: 'content', text: delta.content });
                    }
                  }

                  // Check finish reason
                  if (parsed.choices[0].finish_reason) {
                    finishReason = parsed.choices[0].finish_reason;
                  }
                }

                // Extract usage information
                if (parsed.usage) {
                  inputTokens = parsed.usage.prompt_tokens || inputTokens;
                  outputTokens = parsed.usage.completion_tokens || outputTokens;
                }
              }
            }
          } catch (err) {
            logger.error('Error parsing streaming chunk', {
              error: err.message,
              chunk: chunk.toString()
            });
          }
        });

        response.data.on('end', () => {
          const latency = Date.now() - startTime;

          // If no usage data, estimate tokens
          if (!inputTokens) {
            inputTokens = this.countTokens(params.prompt || '');
            outputTokens = this.countTokens(fullText);
          }

          this._updateRateLimits(inputTokens, outputTokens);

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
            finishReason
          };

          logger.info('GLM streaming complete', {
            model: this.modelId,
            latency,
            inputTokens,
            outputTokens
          });

          this.rateLimitState.concurrentRequests--;
          resolve(normalized);
        });

        response.data.on('error', (error) => {
          this.rateLimitState.concurrentRequests--;
          reject(this._normalizeError(error));
        });
      });

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('GLM streaming error', {
        model: this.modelId,
        error: error.message,
        latency
      });

      this.rateLimitState.concurrentRequests = Math.max(
        0,
        this.rateLimitState.concurrentRequests - 1
      );

      throw this._normalizeError(error);
    }
  }

  /**
   * Count tokens in text (estimation)
   * GLM uses similar tokenization to GPT models, optimized for Chinese
   * @param {string} text - Text to count tokens
   * @returns {number} Estimated token count
   */
  countTokens(text) {
    if (!text) return 0;

    // Check for Chinese characters
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = text.replace(/[\u4e00-\u9fa5]/g, '').split(/\s+/).length;
    const codeSymbols = (text.match(/[{}[\]();,.<>]/g) || []).length;
    const chars = text.length;

    // Weighted estimation for bilingual support
    // Chinese characters: ~1.6 tokens each
    // English words: ~1.3 tokens each
    // Code symbols: ~0.5 tokens each
    return Math.ceil(
      chineseChars * 1.6 +
      englishWords * 1.3 +
      codeSymbols * 0.5 +
      (chars - chineseChars) / 4
    );
  }

  /**
   * Check if the provider is healthy
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const request = {
        model: this.modelId,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        max_tokens: 10
      };

      const response = await this.httpClient.post(this.endpoint, request);
      return response.status === 200 && !response.data.error;
    } catch (error) {
      logger.error('GLM health check failed', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      return false;
    }
  }

  /**
   * Check rate limits before making request
   * @private
   */
  async _checkRateLimits(params) {
    const now = Date.now();
    const timeSinceReset = now - this.rateLimitState.lastResetTime;

    // Reset counters every minute
    if (timeSinceReset >= 60000) {
      this.rateLimitState.requestsThisMinute = 0;
      this.rateLimitState.tokensThisMinute = 0;
      this.rateLimitState.lastResetTime = now;
    }

    const rateLimits = this.config.rateLimits || {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      concurrentRequests: 5
    };

    // Check concurrent requests
    if (this.rateLimitState.concurrentRequests >= rateLimits.concurrentRequests) {
      const error = new Error('Concurrent request limit exceeded');
      error.code = 'RATE_LIMIT_CONCURRENT';
      throw error;
    }

    // Check requests per minute
    if (this.rateLimitState.requestsThisMinute >= rateLimits.requestsPerMinute) {
      const error = new Error('Requests per minute limit exceeded');
      error.code = 'RATE_LIMIT_RPM';
      throw error;
    }

    // Estimate tokens for this request
    const estimatedTokens = this.countTokens(params.prompt || '') +
      (params.maxTokens || this.config.defaultParameters?.maxOutputTokens || 4096);

    // Check tokens per minute
    if (this.rateLimitState.tokensThisMinute + estimatedTokens > rateLimits.tokensPerMinute) {
      const error = new Error('Tokens per minute limit exceeded');
      error.code = 'RATE_LIMIT_TPM';
      throw error;
    }

    // Increment request counter
    this.rateLimitState.requestsThisMinute++;
  }

  /**
   * Update rate limit tracking after successful request
   * @private
   */
  _updateRateLimits(inputTokens, outputTokens) {
    this.rateLimitState.tokensThisMinute += (inputTokens + outputTokens);
  }

  /**
   * Build the GLM API request
   * @private
   */
  _buildRequest(params) {
    const messages = [];

    // Add system prompt if provided
    if (params.systemPrompt && this.config.capabilities.supportsSystemPrompt) {
      messages.push({
        role: 'system',
        content: params.systemPrompt
      });
    }

    // Add conversation history if provided
    if (params.messages && Array.isArray(params.messages)) {
      messages.push(...params.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      })));
    } else if (params.prompt) {
      // Add single user message
      messages.push({
        role: 'user',
        content: params.prompt
      });
    }

    // GLM request format (OpenAI-compatible)
    const request = {
      model: this.modelId,
      messages
    };

    // Add optional parameters
    if (params.maxTokens) {
      request.max_tokens = params.maxTokens;
    } else if (this.config.defaultParameters?.maxOutputTokens) {
      request.max_tokens = this.config.defaultParameters.maxOutputTokens;
    }

    if (params.temperature !== undefined) {
      request.temperature = Math.max(0, Math.min(1, params.temperature));
    } else if (this.config.defaultParameters?.temperature !== undefined) {
      request.temperature = this.config.defaultParameters.temperature;
    }

    if (params.topP !== undefined) {
      request.top_p = Math.max(0, Math.min(1, params.topP));
    } else if (this.config.defaultParameters?.topP !== undefined) {
      request.top_p = this.config.defaultParameters.topP;
    }

    // Stop sequences
    if (params.stopSequences && params.stopSequences.length > 0) {
      request.stop = params.stopSequences;
    } else if (this.config.defaultParameters?.stopSequences?.length > 0) {
      request.stop = this.config.defaultParameters.stopSequences;
    }

    // GLM-specific features
    if (params.tools) {
      request.tools = params.tools;
    }

    if (params.toolChoice) {
      request.tool_choice = params.toolChoice;
    }

    return request;
  }

  /**
   * Normalize the GLM API response
   * @private
   */
  _normalizeResponse(data, latency) {
    // Check for errors
    if (data.error) {
      throw new Error(data.error.message || 'GLM API error');
    }

    // Extract content
    let content = '';
    if (data.choices && data.choices.length > 0) {
      content = data.choices[0].message?.content || '';
    }

    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;

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
      finishReason: data.choices?.[0]?.finish_reason || 'stop',
      rawResponse: data,
      // Additional metadata
      metadata: {
        longContext: true,
        bilingual: true,
        contextWindow: this.config.capabilities?.contextWindow || 128000
      }
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

    // Handle rate limit errors from our internal tracking
    if (error.code === 'RATE_LIMIT_CONCURRENT' ||
        error.code === 'RATE_LIMIT_RPM' ||
        error.code === 'RATE_LIMIT_TPM') {
      normalized.errorType = 'rate_limit_error';
      normalized.retryable = true;
      return normalized;
    }

    // Handle GLM-specific error codes
    if (error.code) {
      if (error.code === 'invalid_api_key' || error.code === '401') {
        normalized.errorType = 'authentication_error';
        normalized.error = 'Invalid API key';
      } else if (error.code === 'rate_limit_reached' || error.code === '429') {
        normalized.errorType = 'rate_limit_error';
        normalized.error = 'Rate limit exceeded';
        normalized.retryable = true;
      } else if (error.code === 'invalid_request_error' || error.code === '400') {
        normalized.errorType = 'invalid_request';
        normalized.error = error.message || 'Invalid request parameters';
      } else if (error.code === '500' || error.code === 'internal_error') {
        normalized.errorType = 'api_error';
        normalized.error = 'GLM API internal error';
        normalized.retryable = true;
      }
    }

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      normalized.httpStatus = status;
      normalized.errorDetails = data;

      // Categorize HTTP errors
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
        normalized.error = 'GLM API error';
        normalized.retryable = true;
      } else if (status === 503) {
        normalized.errorType = 'overloaded_error';
        normalized.error = 'GLM API is overloaded';
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
      specializations: [
        'long_context',
        'multi_turn_conversations',
        'bilingual_chinese_english',
        'code_generation',
        'technical_documentation'
      ],
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
      capabilities: this.getCapabilities(),
      rateLimitStatus: {
        requestsThisMinute: this.rateLimitState.requestsThisMinute,
        tokensThisMinute: this.rateLimitState.tokensThisMinute,
        concurrentRequests: this.rateLimitState.concurrentRequests
      }
    };
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus() {
    const rateLimits = this.config.rateLimits || {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      concurrentRequests: 5
    };

    return {
      requestsUsed: this.rateLimitState.requestsThisMinute,
      requestsLimit: rateLimits.requestsPerMinute,
      tokensUsed: this.rateLimitState.tokensThisMinute,
      tokensLimit: rateLimits.tokensPerMinute,
      concurrentRequests: this.rateLimitState.concurrentRequests,
      concurrentLimit: rateLimits.concurrentRequests,
      resetTime: new Date(this.rateLimitState.lastResetTime + 60000)
    };
  }
}

module.exports = GLMProvider;
