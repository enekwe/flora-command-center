const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * DeepSeek Provider
 * Integration with DeepSeek Coder models - specialized for code generation
 *
 * Supported Models:
 * - deepseek-coder-v2 (33B parameters, 128K context)
 * - deepseek-chat (general purpose chat)
 *
 * Specializations:
 * - Code generation and completion
 * - Code debugging and analysis
 * - Code refactoring and optimization
 * - Technical documentation generation
 *
 * API Documentation: https://platform.deepseek.com/api-docs/
 * API is OpenAI-compatible for easy integration
 */

class DeepSeekProvider {
  constructor(config) {
    this.provider = 'deepseek';
    this.config = config;
    this.apiKey = config.apiConfig?.apiKey;
    this.endpoint = config.apiConfig?.endpoint || 'https://api.deepseek.com/v1';
    this.modelId = config.modelId;

    if (!this.apiKey) {
      throw new Error('DeepSeek API key is required');
    }

    // Rate limiting state
    this.rateLimitState = {
      requestsThisMinute: 0,
      tokensThisMinute: 0,
      lastResetTime: Date.now(),
      concurrentRequests: 0
    };

    this.httpClient = axios.create({
      baseURL: this.endpoint,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 90000 // 90 second timeout for code generation
    });
  }

  /**
   * Call the DeepSeek API with unified interface
   * @param {Object} params - Request parameters
   * @param {string} params.prompt - The user prompt
   * @param {string} params.systemPrompt - Optional system prompt
   * @param {number} params.temperature - Temperature for sampling (0-2)
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
      logger.info('DeepSeek API request', {
        model: this.modelId,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens
      });

      this.rateLimitState.concurrentRequests++;

      const response = await this.httpClient.post('/chat/completions', request);
      const latency = Date.now() - startTime;

      // Update rate limit tracking
      this._updateRateLimits(
        response.data.usage.prompt_tokens,
        response.data.usage.completion_tokens
      );

      logger.info('DeepSeek API response', {
        model: this.modelId,
        latency,
        inputTokens: response.data.usage.prompt_tokens,
        outputTokens: response.data.usage.completion_tokens
      });

      return this._normalizeResponse(response.data, latency);

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('DeepSeek API error', {
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
   * Call the DeepSeek API with streaming
   * @param {Object} params - Request parameters
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<Object>} Final normalized response
   */
  async callStreaming(params, onChunk) {
    const startTime = Date.now();

    try {
      // Check rate limits before making request
      await this._checkRateLimits(params);

      const request = {
        ...this._buildRequest(params),
        stream: true
      };

      logger.info('DeepSeek API streaming request', {
        model: this.modelId,
        promptLength: params.prompt?.length
      });

      this.rateLimitState.concurrentRequests++;

      const response = await this.httpClient.post('/chat/completions', request, {
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
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();

                if (data === '[DONE]') {
                  const latency = Date.now() - startTime;

                  // Estimate tokens for rate limiting
                  inputTokens = this.countTokens(params.prompt || '');
                  outputTokens = this.countTokens(fullText);
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

                  logger.info('DeepSeek streaming complete', {
                    model: this.modelId,
                    latency,
                    estimatedInputTokens: inputTokens,
                    estimatedOutputTokens: outputTokens
                  });

                  this.rateLimitState.concurrentRequests--;
                  resolve(normalized);
                  return;
                }

                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                const reason = parsed.choices?.[0]?.finish_reason;

                if (content) {
                  fullText += content;
                  if (onChunk) {
                    onChunk({ type: 'content', text: content });
                  }
                }

                if (reason) {
                  finishReason = reason;
                }
              }
            }
          } catch (err) {
            logger.error('Error parsing streaming chunk', { error: err.message });
          }
        });

        response.data.on('error', (error) => {
          this.rateLimitState.concurrentRequests--;
          reject(this._normalizeError(error));
        });

        response.data.on('end', () => {
          // Fallback if [DONE] is not received
          if (fullText && !inputTokens) {
            const latency = Date.now() - startTime;
            inputTokens = this.countTokens(params.prompt || '');
            outputTokens = this.countTokens(fullText);
            this._updateRateLimits(inputTokens, outputTokens);

            this.rateLimitState.concurrentRequests--;
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
              finishReason
            });
          }
        });
      });

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('DeepSeek streaming error', {
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
   * DeepSeek uses similar tokenization to GPT models
   * @param {string} text - Text to count tokens
   * @returns {number} Estimated token count
   */
  countTokens(text) {
    if (!text) return 0;
    // Code-optimized estimation: code has more tokens per word
    const words = text.split(/\s+/).length;
    const chars = text.length;
    const codeSymbols = (text.match(/[{}[\]();,.<>]/g) || []).length;

    // Weighted estimation favoring code structures
    return Math.ceil((words * 1.4 + chars / 3.5 + codeSymbols * 0.5) / 2);
  }

  /**
   * Check if the provider is healthy
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await this.httpClient.post('/chat/completions', {
        model: this.modelId,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        max_tokens: 10
      });

      return response.status === 200;
    } catch (error) {
      logger.error('DeepSeek health check failed', {
        error: error.message,
        status: error.response?.status
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
   * Build the DeepSeek API request
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

    const request = {
      model: this.modelId,
      messages,
      max_tokens: params.maxTokens || this.config.defaultParameters.maxOutputTokens || 4096
    };

    // Add optional parameters
    if (params.temperature !== undefined) {
      request.temperature = Math.max(0, Math.min(2, params.temperature));
    } else if (this.config.defaultParameters.temperature !== undefined) {
      request.temperature = this.config.defaultParameters.temperature;
    }

    if (params.topP !== undefined) {
      request.top_p = Math.max(0, Math.min(1, params.topP));
    } else if (this.config.defaultParameters.topP !== undefined) {
      request.top_p = this.config.defaultParameters.topP;
    }

    if (params.stopSequences && params.stopSequences.length > 0) {
      request.stop = params.stopSequences;
    } else if (this.config.defaultParameters.stopSequences?.length > 0) {
      request.stop = this.config.defaultParameters.stopSequences;
    }

    // Add frequency and presence penalties for code generation
    if (params.frequencyPenalty !== undefined) {
      request.frequency_penalty = Math.max(-2, Math.min(2, params.frequencyPenalty));
    }

    if (params.presencePenalty !== undefined) {
      request.presence_penalty = Math.max(-2, Math.min(2, params.presencePenalty));
    }

    return request;
  }

  /**
   * Normalize the DeepSeek API response
   * @private
   */
  _normalizeResponse(data, latency) {
    const choice = data.choices[0];
    const content = choice.message.content;

    return {
      success: true,
      provider: this.provider,
      model: this.modelId,
      content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      },
      latency,
      finishReason: choice.finish_reason || 'stop',
      rawResponse: data,
      // Additional metadata for code specialization
      metadata: {
        codeGeneration: true,
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
        normalized.error = 'DeepSeek API error';
        normalized.retryable = true;
      } else if (status === 503) {
        normalized.errorType = 'overloaded_error';
        normalized.error = 'DeepSeek API is overloaded';
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
        'code_generation',
        'code_debugging',
        'code_refactoring',
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

module.exports = DeepSeekProvider;
