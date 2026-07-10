/**
 * PAL Configuration Utilities
 * Helper functions for Provider Abstraction Layer configuration
 *
 * MICROSERVICE VERSION: Uses environment variables only
 */

const logger = require('./logger');

/**
 * Get API key for a provider with environment variable fallback
 * @param {string} provider - Provider name (qwen, glm, anthropic, openai, gemini)
 * @param {object} config - Provider config object (optional)
 * @returns {string} API key
 */
function getProviderApiKey(provider, config = null) {
  // If config object has API key, use it
  if (config?.apiConfig?.apiKey) {
    return config.apiConfig.apiKey;
  }

  // Otherwise, try environment variables
  const envVarMap = {
    qwen: 'QWEN_API_KEY',
    glm: 'GLM_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY'
  };

  const envVar = envVarMap[provider.toLowerCase()];
  if (!envVar) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}. Set ${envVar} environment variable.`);
  }

  return apiKey;
}

/**
 * Get API endpoint for a provider
 * @param {string} provider - Provider name
 * @param {object} config - Provider config object (optional)
 * @returns {string} API endpoint URL
 */
function getProviderEndpoint(provider, config = null) {
  // If config object has custom endpoint, use it
  if (config?.apiConfig?.endpoint) {
    return config.apiConfig.endpoint;
  }

  // Default endpoints
  const defaultEndpoints = {
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    glm: 'https://open.bigmodel.cn/api/paas/v4',
    anthropic: 'https://api.anthropic.com/v1',
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1'
  };

  const endpoint = defaultEndpoints[provider.toLowerCase()];
  if (!endpoint) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Allow environment variable override for endpoint
  const envEndpointVar = `${provider.toUpperCase()}_API_ENDPOINT`;
  return process.env[envEndpointVar] || endpoint;
}

/**
 * Get organization ID for a provider (if applicable)
 * @param {string} provider - Provider name
 * @param {object} config - Provider config object (optional)
 * @returns {string|null} Organization ID or null
 */
function getProviderOrgId(provider, config = null) {
  // If config object has org ID, use it
  if (config?.apiConfig?.orgId) {
    return config.apiConfig.orgId;
  }

  // Try environment variable
  const envVar = `${provider.toUpperCase()}_ORG_ID`;
  return process.env[envVar] || null;
}

/**
 * Check if provider is configured
 * @param {string} provider - Provider name
 * @returns {boolean} True if provider has API key configured
 */
function isProviderConfigured(provider) {
  try {
    getProviderApiKey(provider);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  getProviderApiKey,
  getProviderEndpoint,
  getProviderOrgId,
  isProviderConfigured
};
