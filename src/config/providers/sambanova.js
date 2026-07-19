/**
 * SambaNova Cloud Provider Configuration
 *
 * Trust Tier: zdr_contracted
 * DPA Status: Pending negotiation
 * Models: Llama 3.1, Qwen-Coder, DeepSeek-Coder
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

  // API Configuration
  apiKey: process.env.SAMBANOVA_API_KEY,
  baseURL: process.env.SAMBANOVA_API_URL || 'https://api.sambanova.ai/v1',

  // Zero-Retention Contract
  dpaStatus: 'pending', // Update to 'active' once signed
  dpaEvidenceLink: process.env.SAMBANOVA_DPA_URL || null,
  zeroRetentionVerified: false, // Update to true once verified

  // Supported Models
  models: [
    {
      id: 'llama-3.1-405b',
      name: 'Llama 3.1 405B',
      contextWindow: 128000,
      capabilities: ['chat', 'completion', 'reasoning'],
      costPerMToken: { input: 5.0, output: 15.0 }
    },
    {
      id: 'llama-3.1-70b',
      name: 'Llama 3.1 70B',
      contextWindow: 128000,
      capabilities: ['chat', 'completion', 'code'],
      costPerMToken: { input: 0.60, output: 0.60 }
    },
    {
      id: 'llama-3.1-8b',
      name: 'Llama 3.1 8B',
      contextWindow: 128000,
      capabilities: ['chat', 'completion'],
      costPerMToken: { input: 0.20, output: 0.20 }
    },
    {
      id: 'qwen-2.5-coder-32b',
      name: 'Qwen 2.5 Coder 32B',
      contextWindow: 32768,
      capabilities: ['code', 'chat', 'completion'],
      costPerMToken: { input: 0.40, output: 0.40 },
      recommended: true // Best for code generation
    },
    {
      id: 'deepseek-coder-33b',
      name: 'DeepSeek Coder 33B',
      contextWindow: 16384,
      capabilities: ['code', 'completion'],
      costPerMToken: { input: 0.35, output: 0.35 }
    }
  ],

  // Default Model Selection
  defaultModel: 'qwen-2.5-coder-32b', // Best for Flora's code use case

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
