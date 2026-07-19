/**
 * SambaNova Cloud Provider - ZDR-Contracted Inference
 *
 * SambaNova runs open-weight models (Llama, Qwen, DeepSeek) on their custom
 * RDU chips with enterprise DPA and zero-retention guarantees.
 *
 * Trust Tier: zdr_contracted (code doesn't reach OpenAI/Anthropic/Google)
 * API: OpenAI-compatible
 */

const axios = require('axios');
const logger = require('../../utils/logger');
const { ProviderError, RateLimitError, InvalidRequestError } = require('../../utils/errors/palErrors');

class SambanovaProvider {
  constructor(config = {}) {
    this.name = 'sambanova';
    this.apiKey = config.apiKey || process.env.SAMBANOVA_API_KEY;
    this.baseURL = config.baseURL || process.env.SAMBANOVA_API_URL || 'https://api.sambanova.ai/v1';
    this.trustTier = 'zdr_contracted';
    this.residencyZone = 'sambanova_us'; // Update based on their datacenter location
    this.timeout = config.timeout || 120000; // 2 minutes
    this.maxRetries = config.maxRetries || 2;

    if (!this.apiKey) {
      throw new Error('SambaNova API key is required');
    }

    // Supported models
    this.models = {
      'llama-3.1-405b': {
        contextWindow: 128000,
        costPerMToken: { input: 5.0, output: 15.0 }
      },
      'llama-3.1-70b': {
        contextWindow: 128000,
        costPerMToken: { input: 0.60, output: 0.60 }
      },
      'llama-3.1-8b': {
        contextWindow: 128000,
        costPerMToken: { input: 0.20, output: 0.20 }
      },
      'qwen-2.5-coder-32b': {
        contextWindow: 32768,
        costPerMToken: { input: 0.40, output: 0.40 }
      },
      'deepseek-coder-33b': {
        contextWindow: 16384,
        costPerMToken: { input: 0.35, output: 0.35 }
      }
    };

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Call SambaNova API with OpenAI-compatible format
   */
  async call(messages, options = {}) {
    const model = options.model || 'llama-3.1-70b';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens || options.max_tokens || 2000;

    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      // ZDR headers - request zero-retention
      user_data_retention: 'none',
      training_data_use: 'never'
    };

    // Add optional parameters
    if (options.topP !== undefined) requestBody.top_p = options.topP;
    if (options.frequencyPenalty !== undefined) requestBody.frequency_penalty = options.frequencyPenalty;
    if (options.presencePenalty !== undefined) requestBody.presence_penalty = options.presencePenalty;
    if (options.stop) requestBody.stop = options.stop;

    try {
      const startTime = Date.now();

      const response = await this.client.post('/chat/completions', requestBody);

      const latency = Date.now() - startTime;

      const result = {
        text: response.data.choices[0].message.content,
        model: response.data.model,
        usage: {
          promptTokens: response.data.usage.prompt_tokens,
          completionTokens: response.data.usage.completion_tokens,
          totalTokens: response.data.usage.total_tokens
        },
        latency,
        provider: this.name,
        trustTier: this.trustTier,
        residencyZone: this.residencyZone,
        finishReason: response.data.choices[0].finish_reason,
        rawResponse: response.data
      };

      logger.info('SambaNova API call successful', {
        model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latency,
        trustTier: this.trustTier
      });

      return result;

    } catch (error) {
      return this._handleError(error, model);
    }
  }

  /**
   * Stream responses from SambaNova
   */
  async *stream(messages, options = {}) {
    const model = options.model || 'llama-3.1-70b';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens || options.max_tokens || 2000;

    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      user_data_retention: 'none',
      training_data_use: 'never'
    };

    try {
      const response = await this.client.post('/chat/completions', requestBody, {
        responseType: 'stream'
      });

      for await (const chunk of response.data) {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                yield {
                  text: parsed.choices[0].delta.content,
                  model: parsed.model,
                  provider: this.name,
                  trustTier: this.trustTier,
                  finishReason: parsed.choices[0].finish_reason
                };
              }
            } catch (e) {
              logger.warn('Failed to parse SambaNova stream chunk', { error: e.message });
            }
          }
        }
      }
    } catch (error) {
      throw this._handleError(error, model);
    }
  }

  /**
   * Check if model is available
   */
  supportsModel(modelId) {
    return Object.keys(this.models).includes(modelId);
  }

  /**
   * Get model pricing
   */
  getModelCost(modelId) {
    return this.models[modelId]?.costPerMToken || { input: 0, output: 0 };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/models');
      return {
        status: 'healthy',
        provider: this.name,
        trustTier: this.trustTier,
        modelsAvailable: response.data.data?.length || 0
      };
    } catch (error) {
      logger.error('SambaNova health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        provider: this.name,
        error: error.message
      };
    }
  }

  /**
   * Error handling
   */
  _handleError(error, model) {
    const status = error.response?.status;
    const message = error.response?.data?.error?.message || error.message;

    logger.error('SambaNova API error', {
      status,
      message,
      model,
      provider: this.name
    });

    // Rate limiting
    if (status === 429) {
      const retryAfter = error.response?.headers['retry-after'];
      throw new RateLimitError(
        `SambaNova rate limit exceeded for ${model}`,
        { retryAfter, provider: this.name }
      );
    }

    // Invalid request
    if (status === 400 || status === 422) {
      throw new InvalidRequestError(
        `SambaNova invalid request: ${message}`,
        { model, provider: this.name }
      );
    }

    // Authentication
    if (status === 401 || status === 403) {
      throw new ProviderError(
        'SambaNova authentication failed - check API key',
        { provider: this.name, status }
      );
    }

    // Server errors
    if (status >= 500) {
      throw new ProviderError(
        `SambaNova server error: ${message}`,
        { provider: this.name, status, retryable: true }
      );
    }

    // Generic error
    throw new ProviderError(
      `SambaNova API error: ${message}`,
      { provider: this.name, status }
    );
  }

  /**
   * Get provider info for audit ledger
   */
  getProviderInfo() {
    return {
      name: this.name,
      trustTier: this.trustTier,
      residencyZone: this.residencyZone,
      zdrCompliant: true,
      contractedProvider: true,
      endpoint: this.baseURL
    };
  }
}

module.exports = SambanovaProvider;
