const axios = require('axios');
const logger = require('../../utils/logger');
const byokService = require('../byokService');
const tokenTrackingService = require('../tokenTrackingService');

/**
 * Anthropic Provider
 * Integration with Anthropic Claude models (Claude 3 family)
 *
 * Supported Models:
 * - claude-3-opus-20240229 (most capable)
 * - claude-3-sonnet-20240229 (balanced)
 * - claude-3-haiku-20240307 (fastest)
 * - claude-3-5-sonnet-20240620 (latest)
 */

class AnthropicProvider {
  constructor(config) {
    this.provider = 'anthropic';
    this.config = config;
    this.apiKey = config.apiConfig?.apiKey;
    this.endpoint = config.apiConfig?.endpoint || 'https://api.anthropic.com/v1/messages';
    this.apiVersion = config.apiConfig?.version || '2023-06-01';
    this.modelId = config.modelId;

    if (!this.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.httpClient = axios.create({
      baseURL: 'https://api.anthropic.com',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout
    });
  }

  /**
   * Create HTTP client with BYOK credentials
   * @param {Object} credentials - BYOK credentials from byokService
   * @returns {Object} Axios HTTP client
   * @private
   */
  _createHttpClientWithCredentials(credentials) {
    return axios.create({
      baseURL: 'https://api.anthropic.com',
      headers: {
        'x-api-key': credentials.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
  }

  /**
   * Call the Anthropic API with BYOK routing and token tracking
   * @param {Object} params - Request parameters
   * @param {string} params.siteId - Site ID for BYOK routing and token tracking
   * @param {string} params.companyId - Company ID for token tracking
   * @param {string} params.prompt - The user prompt
   * @param {string} params.systemPrompt - Optional system prompt
   * @param {number} params.temperature - Temperature for sampling (0-1)
   * @param {number} params.maxTokens - Maximum output tokens
   * @param {Array} params.stopSequences - Stop sequences
   * @param {Object} params.metadata - Request metadata
   * @returns {Promise<Object>} Normalized response
   */
  async callWithBYOK(params) {
    const { siteId, companyId, platformIntegrationId, requestType = 'chat_completion' } = params;

    if (!siteId) {
      throw new Error('siteId is required for BYOK routing and token tracking');
    }

    // 1. Get credentials from byokService
    const credentials = await byokService.getCredentials(siteId);

    // Verify provider matches
    if (credentials.provider !== 'anthropic') {
      throw new Error(`Expected Anthropic provider but got ${credentials.provider}`);
    }

    // 2. Create HTTP client with BYOK or Passbook credentials
    const httpClient = this._createHttpClientWithCredentials(credentials);

    // 3. Make the API request
    const startTime = Date.now();

    try {
      const request = this._buildRequest(params);
      logger.info('Anthropic API request (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens,
        siteId
      });

      const response = await httpClient.post('/v1/messages', request);
      const latency = Date.now() - startTime;

      logger.info('Anthropic API response (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        latency,
        inputTokens: response.data.usage.input_tokens,
        outputTokens: response.data.usage.output_tokens,
        siteId
      });

      const normalized = this._normalizeResponse(response.data, latency);

      // 4. Log token usage
      const cost = this._calculateCost(
        response.data.usage.input_tokens,
        response.data.usage.output_tokens
      );

      await tokenTrackingService.logTokenUsage({
        companyId,
        siteId,
        platformIntegrationId,
        provider: 'anthropic',
        model: this.modelId,
        promptTokens: response.data.usage.input_tokens,
        completionTokens: response.data.usage.output_tokens,
        totalTokens: response.data.usage.input_tokens + response.data.usage.output_tokens,
        cost,
        requestType,
        metadata: {
          source: credentials.source,
          latency,
          ...params.metadata
        }
      });

      // 5. Return normalized response
      return {
        ...normalized,
        byokSource: credentials.source
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Anthropic API error (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        error: error.message,
        latency,
        status: error.response?.status,
        data: error.response?.data,
        siteId
      });

      throw this._normalizeError(error);
    }
  }

  /**
   * Call the Anthropic API with unified interface
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
    // If siteId is provided, use BYOK routing
    if (params.siteId) {
      return this.callWithBYOK(params);
    }

    // Otherwise, use default credentials (legacy mode)
    const startTime = Date.now();

    try {
      const request = this._buildRequest(params);
      logger.info('Anthropic API request', {
        model: this.modelId,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens
      });

      const response = await this.httpClient.post('/v1/messages', request);
      const latency = Date.now() - startTime;

      logger.info('Anthropic API response', {
        model: this.modelId,
        latency,
        inputTokens: response.data.usage.input_tokens,
        outputTokens: response.data.usage.output_tokens
      });

      return this._normalizeResponse(response.data, latency);

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Anthropic API error', {
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
   * Call the Anthropic API with streaming
   * @param {Object} params - Request parameters
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<Object>} Final normalized response
   */
  async callStreaming(params, onChunk) {
    // If siteId is provided, use BYOK routing
    if (params.siteId) {
      return this.callStreamingWithBYOK(params, onChunk);
    }

    // Otherwise, use default credentials (legacy mode)
    const startTime = Date.now();

    try {
      const request = {
        ...this._buildRequest(params),
        stream: true
      };

      logger.info('Anthropic API streaming request', {
        model: this.modelId,
        promptLength: params.prompt?.length
      });

      const response = await this.httpClient.post('/v1/messages', request, {
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

                if (data.type === 'message_start') {
                  inputTokens = data.message.usage.input_tokens;
                } else if (data.type === 'content_block_delta') {
                  const text = data.delta.text || '';
                  fullText += text;
                  if (onChunk) {
                    onChunk({ type: 'content', text });
                  }
                } else if (data.type === 'message_delta') {
                  outputTokens = data.usage.output_tokens;
                } else if (data.type === 'message_stop') {
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
                    finishReason: 'stop'
                  };

                  logger.info('Anthropic streaming complete', {
                    model: this.modelId,
                    latency,
                    inputTokens,
                    outputTokens
                  });

                  resolve(normalized);
                }
              }
            }
          } catch (err) {
            logger.error('Error parsing streaming chunk', { error: err.message });
          }
        });

        response.data.on('error', (error) => {
          reject(this._normalizeError(error));
        });
      });

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Anthropic streaming error', {
        model: this.modelId,
        error: error.message,
        latency
      });

      throw this._normalizeError(error);
    }
  }

  /**
   * Call the Anthropic API with streaming, BYOK routing and token tracking
   * @param {Object} params - Request parameters
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<Object>} Final normalized response
   */
  async callStreamingWithBYOK(params, onChunk) {
    const { siteId, companyId, platformIntegrationId, requestType = 'chat_completion' } = params;

    if (!siteId) {
      throw new Error('siteId is required for BYOK routing and token tracking');
    }

    // 1. Get credentials from byokService
    const credentials = await byokService.getCredentials(siteId);

    // Verify provider matches
    if (credentials.provider !== 'anthropic') {
      throw new Error(`Expected Anthropic provider but got ${credentials.provider}`);
    }

    // 2. Create HTTP client with BYOK or Passbook credentials
    const httpClient = this._createHttpClientWithCredentials(credentials);

    // 3. Make the API request
    const startTime = Date.now();

    try {
      const request = {
        ...this._buildRequest(params),
        stream: true
      };

      logger.info('Anthropic API streaming request (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        promptLength: params.prompt?.length,
        siteId
      });

      const response = await httpClient.post('/v1/messages', request, {
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

                if (data.type === 'message_start') {
                  inputTokens = data.message.usage.input_tokens;
                } else if (data.type === 'content_block_delta') {
                  const text = data.delta.text || '';
                  fullText += text;
                  if (onChunk) {
                    onChunk({ type: 'content', text });
                  }
                } else if (data.type === 'message_delta') {
                  outputTokens = data.usage.output_tokens;
                } else if (data.type === 'message_stop') {
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
                    finishReason: 'stop',
                    byokSource: credentials.source
                  };

                  logger.info('Anthropic streaming complete (BYOK)', {
                    model: this.modelId,
                    source: credentials.source,
                    latency,
                    inputTokens,
                    outputTokens,
                    siteId
                  });

                  // Log token usage
                  const cost = this._calculateCost(inputTokens, outputTokens);
                  tokenTrackingService.logTokenUsage({
                    companyId,
                    siteId,
                    platformIntegrationId,
                    provider: 'anthropic',
                    model: this.modelId,
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    cost,
                    requestType,
                    metadata: {
                      source: credentials.source,
                      latency,
                      streaming: true,
                      ...params.metadata
                    }
                  }).catch(err => {
                    logger.error('Failed to log token usage for streaming request', {
                      error: err.message,
                      siteId
                    });
                  });

                  resolve(normalized);
                }
              }
            }
          } catch (err) {
            logger.error('Error parsing streaming chunk', { error: err.message });
          }
        });

        response.data.on('error', (error) => {
          reject(this._normalizeError(error));
        });
      });

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Anthropic streaming error (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        error: error.message,
        latency,
        siteId
      });

      throw this._normalizeError(error);
    }
  }

  /**
   * Count tokens in text (estimation)
   * Anthropic uses ~4 characters per token as a rough estimate
   * @param {string} text - Text to count tokens
   * @returns {number} Estimated token count
   */
  countTokens(text) {
    if (!text) return 0;
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if the provider is healthy
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await this.httpClient.post('/v1/messages', {
        model: this.modelId,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      });

      return response.status === 200;
    } catch (error) {
      logger.error('Anthropic health check failed', {
        error: error.message,
        status: error.response?.status
      });
      return false;
    }
  }

  /**
   * Build the Anthropic API request
   * @private
   */
  _buildRequest(params) {
    const request = {
      model: this.modelId,
      max_tokens: params.maxTokens || this.config.defaultParameters.maxOutputTokens || 4096,
      messages: []
    };

    // Add system prompt if provided
    if (params.systemPrompt && this.config.capabilities.supportsSystemPrompt) {
      request.system = params.systemPrompt;
    }

    // Add user message
    if (params.prompt) {
      request.messages.push({
        role: 'user',
        content: params.prompt
      });
    }

    // Add conversation history if provided
    if (params.messages && Array.isArray(params.messages)) {
      request.messages = params.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
    }

    // Add optional parameters
    if (params.temperature !== undefined) {
      request.temperature = Math.max(0, Math.min(1, params.temperature));
    } else if (this.config.defaultParameters.temperature !== undefined) {
      request.temperature = this.config.defaultParameters.temperature;
    }

    if (params.topP !== undefined) {
      request.top_p = Math.max(0, Math.min(1, params.topP));
    } else if (this.config.defaultParameters.topP !== undefined) {
      request.top_p = this.config.defaultParameters.topP;
    }

    if (params.stopSequences && params.stopSequences.length > 0) {
      request.stop_sequences = params.stopSequences;
    } else if (this.config.defaultParameters.stopSequences?.length > 0) {
      request.stop_sequences = this.config.defaultParameters.stopSequences;
    }

    // Add metadata if provided
    if (params.metadata) {
      request.metadata = {
        user_id: params.metadata.userId
      };
    }

    return request;
  }

  /**
   * Normalize the Anthropic API response
   * @private
   */
  _normalizeResponse(data, latency) {
    const content = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return {
      success: true,
      provider: this.provider,
      model: this.modelId,
      content,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      },
      latency,
      finishReason: data.stop_reason || 'stop',
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
        normalized.error = 'Anthropic API error';
        normalized.retryable = true;
      } else if (status === 529) {
        normalized.errorType = 'overloaded_error';
        normalized.error = 'Anthropic API is overloaded';
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

  /**
   * Calculate cost for Anthropic request
   * @param {number} inputTokens - Input tokens
   * @param {number} outputTokens - Output tokens
   * @returns {number} Cost in USD
   * @private
   */
  _calculateCost(inputTokens, outputTokens) {
    // Anthropic pricing (as of April 2026)
    const pricing = {
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 }, // per 1K tokens
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
      'claude-3-5-sonnet-20240620': { input: 0.003, output: 0.015 }
    };

    const modelPricing = pricing[this.modelId] || pricing['claude-3-haiku-20240307'];
    const inputCost = (inputTokens / 1000) * modelPricing.input;
    const outputCost = (outputTokens / 1000) * modelPricing.output;

    return parseFloat((inputCost + outputCost).toFixed(6));
  }
}

module.exports = AnthropicProvider;
