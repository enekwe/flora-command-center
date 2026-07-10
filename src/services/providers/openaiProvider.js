const axios = require('axios');
const logger = require('../../utils/logger');
const byokService = require('../byokService');
const tokenTrackingService = require('../tokenTrackingService');

/**
 * OpenAI Provider
 * Integration with OpenAI GPT models
 *
 * Supported Models:
 * - gpt-4-turbo-preview (latest GPT-4 Turbo)
 * - gpt-4-1106-preview (GPT-4 Turbo with 128k context)
 * - gpt-4 (GPT-4)
 * - gpt-3.5-turbo-0125 (latest GPT-3.5)
 * - gpt-3.5-turbo (GPT-3.5)
 */

class OpenAIProvider {
  constructor(config) {
    this.provider = 'openai';
    this.config = config;
    this.apiKey = config.apiConfig?.apiKey;
    this.organization = config.apiConfig?.organization;
    this.endpoint = config.apiConfig?.endpoint || 'https://api.openai.com/v1/chat/completions';
    this.modelId = config.modelId;

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    this.httpClient = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers,
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
    const headers = {
      'Authorization': `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json'
    };

    if (credentials.orgId) {
      headers['OpenAI-Organization'] = credentials.orgId;
    }

    return axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers,
      timeout: 60000
    });
  }

  /**
   * Call the OpenAI API with BYOK routing and token tracking
   * @param {Object} params - Request parameters
   * @param {string} params.siteId - Site ID for BYOK routing and token tracking
   * @param {string} params.companyId - Company ID for token tracking
   * @param {string} params.prompt - The user prompt
   * @param {string} params.systemPrompt - Optional system prompt
   * @param {number} params.temperature - Temperature for sampling (0-2)
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
    if (credentials.provider !== 'openai') {
      throw new Error(`Expected OpenAI provider but got ${credentials.provider}`);
    }

    // 2. Create HTTP client with BYOK or Passbook credentials
    const httpClient = this._createHttpClientWithCredentials(credentials);

    // 3. Make the API request
    const startTime = Date.now();

    try {
      const request = this._buildRequest(params);
      logger.info('OpenAI API request (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens,
        siteId
      });

      const response = await httpClient.post('/chat/completions', request);
      const latency = Date.now() - startTime;

      logger.info('OpenAI API response (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        latency,
        inputTokens: response.data.usage.prompt_tokens,
        outputTokens: response.data.usage.completion_tokens,
        siteId
      });

      const normalized = this._normalizeResponse(response.data, latency);

      // 4. Log token usage
      const cost = this._calculateCost(
        response.data.usage.prompt_tokens,
        response.data.usage.completion_tokens
      );

      await tokenTrackingService.logTokenUsage({
        companyId,
        siteId,
        platformIntegrationId,
        provider: 'openai',
        model: this.modelId,
        promptTokens: response.data.usage.prompt_tokens,
        completionTokens: response.data.usage.completion_tokens,
        totalTokens: response.data.usage.total_tokens,
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
      logger.error('OpenAI API error (BYOK)', {
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
   * Call the OpenAI API with unified interface
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
    // If siteId is provided, use BYOK routing
    if (params.siteId) {
      return this.callWithBYOK(params);
    }

    // Otherwise, use default credentials (legacy mode)
    const startTime = Date.now();

    try {
      const request = this._buildRequest(params);
      logger.info('OpenAI API request', {
        model: this.modelId,
        promptLength: params.prompt?.length,
        maxTokens: params.maxTokens
      });

      const response = await this.httpClient.post('/chat/completions', request);
      const latency = Date.now() - startTime;

      logger.info('OpenAI API response', {
        model: this.modelId,
        latency,
        inputTokens: response.data.usage.prompt_tokens,
        outputTokens: response.data.usage.completion_tokens
      });

      return this._normalizeResponse(response.data, latency);

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('OpenAI API error', {
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
   * Call the OpenAI API with streaming
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

      logger.info('OpenAI API streaming request', {
        model: this.modelId,
        promptLength: params.prompt?.length
      });

      const response = await this.httpClient.post('/chat/completions', request, {
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
                const data = line.slice(6).trim();

                if (data === '[DONE]') {
                  const latency = Date.now() - startTime;
                  // Estimate tokens (OpenAI doesn't provide usage in streaming)
                  inputTokens = this.countTokens(params.prompt || '');
                  outputTokens = this.countTokens(fullText);

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

                  logger.info('OpenAI streaming complete', {
                    model: this.modelId,
                    latency,
                    estimatedInputTokens: inputTokens,
                    estimatedOutputTokens: outputTokens
                  });

                  resolve(normalized);
                  return;
                }

                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;

                if (content) {
                  fullText += content;
                  if (onChunk) {
                    onChunk({ type: 'content', text: content });
                  }
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
      logger.error('OpenAI streaming error', {
        model: this.modelId,
        error: error.message,
        latency
      });

      throw this._normalizeError(error);
    }
  }

  /**
   * Call the OpenAI API with streaming, BYOK routing and token tracking
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
    if (credentials.provider !== 'openai') {
      throw new Error(`Expected OpenAI provider but got ${credentials.provider}`);
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

      logger.info('OpenAI API streaming request (BYOK)', {
        model: this.modelId,
        source: credentials.source,
        promptLength: params.prompt?.length,
        siteId
      });

      const response = await httpClient.post('/chat/completions', request, {
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
                const data = line.slice(6).trim();

                if (data === '[DONE]') {
                  const latency = Date.now() - startTime;
                  // Estimate tokens (OpenAI doesn't provide usage in streaming)
                  inputTokens = this.countTokens(params.prompt || '');
                  outputTokens = this.countTokens(fullText);

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

                  logger.info('OpenAI streaming complete (BYOK)', {
                    model: this.modelId,
                    source: credentials.source,
                    latency,
                    estimatedInputTokens: inputTokens,
                    estimatedOutputTokens: outputTokens,
                    siteId
                  });

                  // Log token usage
                  const cost = this._calculateCost(inputTokens, outputTokens);
                  tokenTrackingService.logTokenUsage({
                    companyId,
                    siteId,
                    platformIntegrationId,
                    provider: 'openai',
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
                  return;
                }

                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;

                if (content) {
                  fullText += content;
                  if (onChunk) {
                    onChunk({ type: 'content', text: content });
                  }
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
      logger.error('OpenAI streaming error (BYOK)', {
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
   * Count tokens in text (estimation using GPT tokenizer logic)
   * @param {string} text - Text to count tokens
   * @returns {number} Estimated token count
   */
  countTokens(text) {
    if (!text) return 0;
    // Rough estimation: ~4 characters per token for English
    // More accurate: use tiktoken library, but this is good enough for estimation
    const words = text.split(/\s+/).length;
    const chars = text.length;
    // Average of word-based and char-based estimation
    return Math.ceil((words * 1.3 + chars / 4) / 2);
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
      logger.error('OpenAI health check failed', {
        error: error.message,
        status: error.response?.status
      });
      return false;
    }
  }

  /**
   * Build the OpenAI API request
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

    // Add user identifier if provided (for OpenAI's monitoring)
    if (params.metadata?.userId) {
      request.user = params.metadata.userId;
    }

    // Add function calling support if provided
    if (params.functions && this.config.capabilities.supportsFunctionCalling) {
      request.functions = params.functions;
      if (params.functionCall) {
        request.function_call = params.functionCall;
      }
    }

    return request;
  }

  /**
   * Normalize the OpenAI API response
   * @private
   */
  _normalizeResponse(data, latency) {
    const choice = data.choices[0];
    const content = choice.message.content;

    const normalized = {
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
      rawResponse: data
    };

    // Add function call if present
    if (choice.message.function_call) {
      normalized.functionCall = {
        name: choice.message.function_call.name,
        arguments: JSON.parse(choice.message.function_call.arguments)
      };
    }

    return normalized;
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
        normalized.error = 'OpenAI API error';
        normalized.retryable = true;
      } else if (status === 503) {
        normalized.errorType = 'overloaded_error';
        normalized.error = 'OpenAI API is overloaded';
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
   * Calculate cost for OpenAI request
   * @param {number} promptTokens - Input tokens
   * @param {number} completionTokens - Output tokens
   * @returns {number} Cost in USD
   * @private
   */
  _calculateCost(promptTokens, completionTokens) {
    // OpenAI pricing (as of April 2026)
    const pricing = {
      'gpt-4-turbo-preview': { input: 0.01, output: 0.03 }, // per 1K tokens
      'gpt-4-1106-preview': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo-0125': { input: 0.0005, output: 0.0015 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 }
    };

    const modelPricing = pricing[this.modelId] || pricing['gpt-3.5-turbo'];
    const inputCost = (promptTokens / 1000) * modelPricing.input;
    const outputCost = (completionTokens / 1000) * modelPricing.output;

    return parseFloat((inputCost + outputCost).toFixed(6));
  }
}

module.exports = OpenAIProvider;
