const config = require('../config');
const logger = require('../utils/logger');

/**
 * Per-Tenant ZDR Policy Engine — ZDR-E11-S1
 *
 * Extends the existing per-company custom-PII mechanism to cover:
 * - Endpoint allow-lists per tenant
 * - Retention overrides per tenant
 * - Custom redaction patterns per tenant
 * - Required trust tier per tenant
 *
 * Enforced at the egress gate (PAL._callWithFallback).
 */

class ZDRPolicyEngine {
  constructor() {
    this._policies = new Map();
  }

  /**
   * Get or create the ZDR policy for a tenant.
   *
   * @param {string} companyId
   * @returns {object} Effective policy
   */
  getPolicy(companyId) {
    if (this._policies.has(companyId)) {
      return this._policies.get(companyId);
    }

    const isZDR = (config.zdr.tenantIds || []).includes(companyId);
    const policy = {
      companyId,
      isZDR,
      requiredTrustTier: isZDR ? 'self_hosted' : 'standard_hosted',
      allowedEndpoints: isZDR ? [] : null, // empty = use global allow-list
      retentionDays: isZDR ? 0 : null, // null = use platform default
      customRedactionPatterns: [],
      failClosed: isZDR,
      enablePreflight: true,
      hardEraseEnabled: isZDR && config.zdr.hardEraseEnabled
    };

    this._policies.set(companyId, policy);
    return policy;
  }

  /**
   * Update a tenant's ZDR policy.
   *
   * @param {string} companyId
   * @param {object} updates - Partial policy updates
   * @returns {object} Updated policy
   */
  updatePolicy(companyId, updates) {
    const current = this.getPolicy(companyId);
    const updated = { ...current, ...updates, companyId };

    // Validation: hard erase can only be enabled if global flag is set
    if (updated.hardEraseEnabled && !config.zdr.hardEraseEnabled) {
      logger.warn('Hard erase requested but disabled globally', { companyId });
      updated.hardEraseEnabled = false;
    }

    // Validation: requiredTrustTier must be a valid tier
    const validTiers = ['self_hosted', 'zdr_contracted', 'standard_hosted'];
    if (updated.requiredTrustTier && !validTiers.includes(updated.requiredTrustTier)) {
      throw new Error(`Invalid trust tier: ${updated.requiredTrustTier}`);
    }

    this._policies.set(companyId, updated);

    logger.info('ZDR policy updated', {
      companyId,
      requiredTrustTier: updated.requiredTrustTier,
      failClosed: updated.failClosed,
      hardEraseEnabled: updated.hardEraseEnabled
    });

    return updated;
  }

  /**
   * Check if a provider is allowed for a tenant.
   *
   * @param {string} companyId
   * @param {string} providerName
   * @param {string} providerTrustTier
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkProviderAllowed(companyId, providerName, providerTrustTier) {
    const policy = this.getPolicy(companyId);

    // Check trust tier
    const tierOrder = { self_hosted: 3, zdr_contracted: 2, standard_hosted: 1 };
    const requiredLevel = tierOrder[policy.requiredTrustTier] || 0;
    const providerLevel = tierOrder[providerTrustTier] || 0;

    if (providerLevel < requiredLevel) {
      return {
        allowed: false,
        reason: `Provider ${providerName} trust tier (${providerTrustTier}) below required (${policy.requiredTrustTier})`
      };
    }

    // Check endpoint allow-list (if specified)
    if (policy.allowedEndpoints && policy.allowedEndpoints.length > 0) {
      if (!policy.allowedEndpoints.includes(providerName)) {
        return {
          allowed: false,
          reason: `Provider ${providerName} not on tenant allow-list`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Get custom redaction patterns for a tenant.
   *
   * @param {string} companyId
   * @returns {Array<{name: string, pattern: RegExp, replacement: string}>}
   */
  getCustomRedactionPatterns(companyId) {
    const policy = this.getPolicy(companyId);
    return policy.customRedactionPatterns || [];
  }

  /**
   * Clear cached policies (for testing or config reload).
   */
  clearCache() {
    this._policies.clear();
  }
}

let instance = null;

function getZDRPolicyEngine() {
  if (!instance) {
    instance = new ZDRPolicyEngine();
  }
  return instance;
}

module.exports = {
  ZDRPolicyEngine,
  getZDRPolicyEngine
};
