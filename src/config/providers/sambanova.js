/**
 * SambaNova Cloud Provider Configuration
 *
 * Trust Tier: zdr_contracted
 * DPA Status: Pending negotiation
 *
 * Model catalog reflects SambaNova Cloud's current live offering as of this
 * writing (https://docs.sambanova.ai — get-started/supported-models and
 * get-started/pricing). SambaNova runs open-weight models on their own RDU
 * chips; the lineup changes as they add/retire models, so re-check those
 * pages before adding a model that isn't listed here.
 */

module.exports = {
  id: 'sambanova',
  name: 'SambaNova Cloud',
  description: 'Enterprise AI inference on custom RDU chips with zero-retention DPA',
  enabled: process.env.SAMBANOVA_ENABLED === 'true',

  // ZDR Configuration
  trustTier: 'zdr_contracted',
  residencyZone: 'sambanova_us',
  zdrCompliant: true,

  // API Configuration — OpenAI-compatible; POST {baseURL}/chat/completions
  apiKey: process.env.SAMBANOVA_API_KEY,
  baseURL: process.env.SAMBANOVA_API_URL || 'https://api.sambanova.ai/v1',

  // Zero-Retention Contract
  // NOTE: this tracks Flora's own compliance/legal status for the SambaNova
  // relationship. It is NOT enforced by any SambaNova API parameter — their
  // OpenAI-compatible endpoint has no documented request-level retention
  // flag, so zero-retention is a contractual (DPA) guarantee, not something
  // this code can request per-call. Update dpaStatus/zeroRetentionVerified
  // once the DPA is actually signed and verified.
  dpaStatus: 'pending', // Update to 'active' once signed
  dpaEvidenceLink: process.env.SAMBANOVA_DPA_URL || null,
  zeroRetentionVerified: false, // Update to true once verified

  // Supported Models (SambaNova Cloud, current catalog)
  models: [
    {
      id: 'Meta-Llama-3.3-70B-Instruct',
      name: 'Llama 3.3 70B Instruct',
      contextWindow: 128000,
      capabilities: ['chat', 'completion', 'reasoning', 'code'],
      costPerMToken: { input: 0.60, output: 1.20 }
    },
    {
      id: 'DeepSeek-V3.1',
      name: 'DeepSeek V3.1',
      contextWindow: 128000,
      capabilities: ['chat', 'completion', 'reasoning', 'code'],
      costPerMToken: { input: 3.00, output: 4.50 }
    },
    {
      id: 'DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      contextWindow: 32000,
      capabilities: ['chat', 'completion', 'reasoning', 'code'],
      costPerMToken: { input: 3.00, output: 4.50 }
    },
    {
      id: 'gpt-oss-120b',
      name: 'GPT-OSS 120B',
      contextWindow: 128000,
      capabilities: ['chat', 'completion', 'reasoning'],
      costPerMToken: { input: 0.22, output: 0.59 }
    },
    {
      id: 'gemma-4-31B-it',
      name: 'Gemma 4 31B (Vision)',
      contextWindow: 128000,
      capabilities: ['chat', 'completion', 'vision'],
      costPerMToken: { input: 0.22, output: 0.59 }
      // Supports text, image, and video input. Audio input is NOT supported.
    },
    {
      id: 'MiniMax-M2.7',
      name: 'MiniMax M2.7',
      contextWindow: 192000,
      capabilities: ['chat', 'completion'],
      costPerMToken: { input: 0.60, output: 2.40 },
      recommended: true // Cheapest cached-input pricing; strong default for high-volume chat
    }
  ],

  // Default Model Selection — matches SambaNova's own quickstart example
  defaultModel: 'Meta-Llama-3.3-70B-Instruct',

  // Rate Limits (adjust based on SambaNova contract)
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000
  },

  // Timeout Configuration
  timeout: 120000, // 2 minutes
  maxRetries: 2,

  // Health Check
  healthCheckInterval: 60000, // 1 minute
  healthCheckEndpoint: '/models',

  // Monitoring
  metrics: {
    enabled: true,
    logLevel: 'info'
  }
};
