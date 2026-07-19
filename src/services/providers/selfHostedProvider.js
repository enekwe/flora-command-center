const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Self-Hosted Inference Provider — ZDR-E5-S1
 *
 * Adapter for in-perimeter inference endpoints (vLLM, Ollama, Tabby-class).
 * Labeled trustTier=self_hosted. Wired into PAL._initializeProvider.
 * Health-checked via /health or /v1/models endpoint.
 *
 * Configuration via environment variables:
 *   SELF_HOSTED_ENDPOINT — Base URL (e.g., http://inference.flora.internal:8000)
 *   SELF_HOSTED_MODEL — Default model name (e.g., qwen-coder-32b)
 *   SELF_HOSTED_API_KEY — Optional auth token for the endpoint
 *   SELF_HOSTED_TIMEOUT_MS — Request timeout (default 60000)
 *
 * The endpoint must expose an OpenAI-compatible /v1/chat/completions API.
 */

class SelfHostedProvider {
  constructor() {
    this.endpoint = process.env.SELF_HOSTED_ENDPOINT || null;
    this.model = process.env.SELF_HOSTED_MODEL || 'qwen2.5-coder-32b-instruct';
    this.apiKey = process.env.SELF_HOSTED_API_KEY || null;
    this.timeoutMs = parseInt(process.env.SELF_HOSTED_TIMEOUT_MS || '60000', 10);

    this.config = {
      provider: 'self_hosted',
      modelId: this.model,
      modelName: `Self-Hosted ${this.model}`,
      trustTier: 'self_hosted',
      residencyZone: 'customer_perimeter',
      capabilities: {
        maxTokens: 8192,
        supportsVision: false,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsSystemPrompt: true,
        contextWindow: 32768
      },
      pricing: {
        inputTokenCost: 0,
        outputTokenCost: 0,
        currency: 'USD'
      }
    };
  }

  /**
   * Check if the self-hosted endpoint is configured.
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.endpoint;
  }

  /**
   * Health check — verify the inference endpoint is reachable.
   * @returns {Promise<{healthy: boolean, latency: number, models?: string[]}>}
   */
  async healthCheck() {
    if (!this.isConfigured()) {
      return { healthy: false, latency: 0, error: 'Self-hosted endpoint not configured' };
    }

    const start = Date.now();
    try {
      const response = await axios.get(`${this.endpoint}/v1/models`, {
        timeout: 5000,
        headers: this._headers()
      });

      const models = (response.data?.data || []).map(m => m.id);
      return {
        healthy: true,
        latency: Date.now() - start,
        models
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error.message
      };
    }
  }

  /**
   * Call the self-hosted model (non-streaming).
   *
   * @param {object} params - { prompt, systemPrompt, messages, temperature, maxTokens }
   * @returns {Promise<object>} - { content, usage, latency }
   */
  async call(params) {
    if (!this.isConfigured()) {
      throw new Error('Self-hosted inference endpoint not configured');
    }

    const start = Date.now();
    const messages = this._buildMessages(params);

    const requestBody = {
      model: this.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      stream: false
    };

    try {
      const response = await axios.post(
        `${this.endpoint}/v1/chat/completions`,
        requestBody,
        {
          timeout: this.timeoutMs,
          headers: this._headers()
        }
      );

      const latency = Date.now() - start;
      const choice = response.data.choices?.[0];

      return {
        content: choice?.message?.content || '',
        usage: {
          inputTokens: response.data.usage?.prompt_tokens || 0,
          outputTokens: response.data.usage?.completion_tokens || 0
        },
        latency,
        provider: 'self_hosted',
        model: this.model,
        trustTier: 'self_hosted'
      };
    } catch (error) {
      logger.error('Self-hosted provider call failed', {
        error: error.message,
        status: error.response?.status,
        endpoint: this.endpoint
      });
      throw error;
    }
  }

  /**
   * Call the self-hosted model with streaming.
   *
   * @param {object} params - { prompt, systemPrompt, messages, temperature, maxTokens }
   * @param {function} onChunk - Callback for each streamed chunk
   * @returns {Promise<object>} - Aggregated response
   */
  async callStreaming(params, onChunk) {
    if (!this.isConfigured()) {
      throw new Error('Self-hosted inference endpoint not configured');
    }

    const start = Date.now();
    const messages = this._buildMessages(params);

    const requestBody = {
      model: this.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      stream: true
    };

    try {
      const response = await axios.post(
        `${this.endpoint}/v1/chat/completions`,
        requestBody,
        {
          timeout: this.timeoutMs,
          headers: this._headers(),
          responseType: 'stream'
        }
      );

      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;

      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  fullContent += delta;
                  if (onChunk) onChunk(delta);
                }

                if (parsed.usage) {
                  inputTokens = parsed.usage.prompt_tokens || inputTokens;
                  outputTokens = parsed.usage.completion_tokens || outputTokens;
                }
              } catch {
                // Skip malformed SSE lines
              }
            }
          }
        });

        response.data.on('end', resolve);
        response.data.on('error', reject);
      });

      return {
        content: fullContent,
        usage: { inputTokens, outputTokens },
        latency: Date.now() - start,
        provider: 'self_hosted',
        model: this.model,
        trustTier: 'self_hosted'
      };
    } catch (error) {
      logger.error('Self-hosted streaming call failed', {
        error: error.message,
        endpoint: this.endpoint
      });
      throw error;
    }
  }

  /**
   * Call with BYOK (Bring Your Own Key) — for self-hosted, the key is the endpoint auth.
   */
  async callWithBYOK(params, apiKey) {
    const originalKey = this.apiKey;
    this.apiKey = apiKey;
    try {
      return await this.call(params);
    } finally {
      this.apiKey = originalKey;
    }
  }

  async callStreamingWithBYOK(params, apiKey, onChunk) {
    const originalKey = this.apiKey;
    this.apiKey = apiKey;
    try {
      return await this.callStreaming(params, onChunk);
    } finally {
      this.apiKey = originalKey;
    }
  }

  /**
   * Build OpenAI-compatible message array from params.
   * @private
   */
  _buildMessages(params) {
    const messages = [];

    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    if (params.messages && Array.isArray(params.messages)) {
      messages.push(...params.messages);
    } else if (params.prompt) {
      messages.push({ role: 'user', content: params.prompt });
    }

    return messages;
  }

  /**
   * Build request headers.
   * @private
   */
  _headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
}

let instance = null;

function getSelfHostedProvider() {
  if (!instance) {
    instance = new SelfHostedProvider();
  }
  return instance;
}

module.exports = {
  SelfHostedProvider,
  getSelfHostedProvider
};
