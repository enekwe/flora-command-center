const { getRedactionService } = require('./dataRedactionService');
const { getContextSessionManager } = require('./contextSession');
const ZDRAuditLedger = require('../models/ZDRAuditLedger');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * ZDR Service — orchestrates Zero Data Retention controls.
 *
 * Provides:
 * - Pre-flight secret detection (E2-S2)
 * - Audit ledger recording (E7-S1)
 * - Deletion attestation (E7-S2)
 * - Context session lifecycle (E1-S1)
 */
class ZDRService {
  constructor() {
    this.redactionService = getRedactionService();
    this.contextManager = getContextSessionManager();
  }

  /**
   * ZDR-E2-S2: Pre-flight secret scan.
   * When detections exceed threshold, returns a response requiring
   * explicit proceed=true to continue.
   *
   * @param {string|object} content - Content to scan
   * @param {object} options - { autoRedact: boolean, threshold: number }
   * @returns {object} { hasSecrets, proceed, secretTypes, count, message }
   */
  preflightScan(content, options = {}) {
    const { threshold = 1, autoRedact = false } = options;
    const scan = this.redactionService.scanForSecrets(content);

    if (scan.count >= threshold) {
      return {
        hasSecrets: true,
        proceed: false,
        secretTypes: scan.secretTypes,
        count: scan.count,
        autoRedact,
        message: `Detected ${scan.count} potential secret(s) (${scan.secretTypes.join(', ')}). ` +
                 `Set proceed=true to ${autoRedact ? 'auto-redact and continue' : 'continue with warning'}.`,
        code: 'SECRETS_DETECTED_PREFLIGHT'
      };
    }

    return {
      hasSecrets: false,
      proceed: true,
      secretTypes: [],
      count: 0,
      message: 'No secrets detected'
    };
  }

  /**
   * ZDR-E7-S1: Record a request in the audit ledger.
   * Contains NO Customer Content — only metadata.
   *
   * @param {object} data - { requestId, companyId, endpoint, provider, trustTier, ... }
   * @returns {Promise<object>} Ledger entry
   */
  async recordAuditEntry(data) {
    try {
      const entry = await ZDRAuditLedger.appendEntry({
        requestId: data.requestId,
        companyId: data.companyId,
        endpoint: data.endpoint,
        provider: data.provider,
        model: data.model,
        trustTier: data.trustTier || 'standard_hosted',
        residencyZone: data.residencyZone,
        redactionCount: data.redactionCount || 0,
        redactionTypes: data.redactionTypes || [],
        bytesEgressed: data.bytesEgressed || 0,
        tokensInput: data.tokensInput || 0,
        tokensOutput: data.tokensOutput || 0,
        sessionId: data.sessionId,
        agentType: data.agentType,
        status: 'recorded'
      });

      logger.info('ZDR audit entry recorded', {
        requestId: data.requestId,
        trustTier: data.trustTier,
        redactionCount: data.redactionCount
      });

      return entry;
    } catch (error) {
      logger.error('Failed to record ZDR audit entry', { error: error.message });
      throw error;
    }
  }

  /**
   * ZDR-E7-S1: Mark an audit entry as purged.
   *
   * @param {string} requestId
   * @param {string} purgeMethod - 'crypto_erase' | 'no_write' | 'ttl_expiry'
   */
  async markPurged(requestId, purgeMethod = 'no_write') {
    try {
      await ZDRAuditLedger.findOneAndUpdate(
        { requestId },
        {
          $set: {
            purgedAt: new Date(),
            purgeMethod,
            status: 'purged'
          }
        }
      );
    } catch (error) {
      logger.error('Failed to mark audit entry as purged', { requestId, error: error.message });
    }
  }

  /**
   * ZDR-E7-S2: Generate deletion attestation for a session.
   *
   * @param {string} sessionId
   * @param {string} companyId
   * @returns {Promise<object|null>} Signed attestation
   */
  async generateAttestation(sessionId, companyId) {
    try {
      const attestation = await ZDRAuditLedger.getSessionAttestation(sessionId, companyId);

      if (attestation) {
        // Mark all entries as attested
        await ZDRAuditLedger.updateMany(
          { sessionId, companyId },
          { $set: { status: 'attested' } }
        );
      }

      return attestation;
    } catch (error) {
      logger.error('Failed to generate attestation', {
        sessionId,
        companyId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get audit ledger entries for a company (paginated).
   *
   * @param {string} companyId
   * @param {object} options - { page, limit, sessionId }
   * @returns {Promise<object>} Paginated results
   */
  async getAuditLog(companyId, options = {}) {
    const { page = 1, limit = 20, sessionId } = options;
    const skip = (page - 1) * limit;

    const query = { companyId };
    if (sessionId) query.sessionId = sessionId;

    const [entries, total] = await Promise.all([
      ZDRAuditLedger.find(query)
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ZDRAuditLedger.countDocuments(query)
    ]);

    return {
      data: entries,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalCount: total,
        limit,
        hasNextPage: skip + limit < total,
        hasPrevPage: page > 1
      }
    };
  }

  /**
   * Check if a companyId is a ZDR tenant.
   * @param {string} companyId
   * @returns {boolean}
   */
  isZDRTenant(companyId) {
    if (!companyId) return false;
    return (config.zdr.tenantIds || []).includes(companyId);
  }
}

let instance = null;

function getZDRService() {
  if (!instance) {
    instance = new ZDRService();
  }
  return instance;
}

module.exports = {
  ZDRService,
  getZDRService
};
