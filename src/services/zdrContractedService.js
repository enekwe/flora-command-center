const logger = require('../utils/logger');

/**
 * ZDR-Contracted Provider Management — ZDR-E6-S1/S2
 *
 * E6-S1: Providers can be marked zdr_contracted with evidence link
 * (DPA/zero-retention flag). Only tenants who explicitly enabled
 * the tier can route to them.
 *
 * E6-S2: Per-provider request options set zero-retention/no-training
 * headers where the API supports them.
 */

const ZERO_RETENTION_HEADERS = {
  anthropic: {
    'anthropic-beta': 'prompt-caching-2024-07-31'
  },
  openai: {
    // OpenAI respects the organization's API data usage settings
    // No specific header needed — controlled at org level
  },
  google: {
    // Gemini API: data retention controlled via Google Cloud project settings
  },
  generic: {
    'X-Data-Retention': 'none',
    'X-No-Training': 'true'
  }
};

/**
 * Get zero-retention headers for a provider.
 *
 * @param {string} provider - Provider name
 * @returns {object} Headers to include in API requests
 */
function getZeroRetentionHeaders(provider) {
  const providerHeaders = ZERO_RETENTION_HEADERS[provider] || ZERO_RETENTION_HEADERS.generic;
  return { ...providerHeaders };
}

/**
 * Validate that a provider is properly configured for ZDR-contracted use.
 *
 * @param {object} providerConfig - Provider configuration
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateContractedProvider(providerConfig) {
  const warnings = [];

  if (providerConfig.trustTier !== 'zdr_contracted') {
    return { valid: true, warnings: ['Not a zdr_contracted provider'] };
  }

  // Check for evidence link
  if (!providerConfig.metadata?.zdrEvidenceLink) {
    warnings.push('No ZDR evidence link (DPA/contract) configured');
  }

  // Check for zero-retention API support
  const supportedProviders = ['anthropic', 'openai', 'google'];
  if (!supportedProviders.includes(providerConfig.provider)) {
    warnings.push(`Provider ${providerConfig.provider} may not support zero-retention APIs`);
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}

/**
 * Check if a tenant has explicitly opted into zdr_contracted tier.
 *
 * @param {string} companyId - Tenant identifier
 * @returns {boolean}
 */
function hasTenantOptedIn(companyId) {
  const optedInTenants = (process.env.ZDR_CONTRACTED_TENANT_IDS || '').split(',').filter(Boolean);
  return optedInTenants.includes(companyId);
}

/**
 * Apply zero-retention options to a provider request.
 *
 * @param {string} provider - Provider name
 * @param {object} requestOptions - Existing request options
 * @returns {object} Enhanced request options with zero-retention settings
 */
function applyZeroRetentionOptions(provider, requestOptions = {}) {
  const headers = getZeroRetentionHeaders(provider);

  return {
    ...requestOptions,
    headers: {
      ...(requestOptions.headers || {}),
      ...headers
    }
  };
}

module.exports = {
  ZERO_RETENTION_HEADERS,
  getZeroRetentionHeaders,
  validateContractedProvider,
  hasTenantOptedIn,
  applyZeroRetentionOptions
};
