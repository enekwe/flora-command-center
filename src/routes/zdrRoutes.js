const express = require('express');
const router = express.Router();
const { getZDRService } = require('../services/zdrService');
const { tenantContext, tenantIsolation } = require('../middleware/tenantIsolation');
const SessionHandoff = require('../models/SessionHandoff');
const logger = require('../utils/logger');

/**
 * ZDR Routes — Zero Data Retention API endpoints
 *
 * Mounted under /api/command-center/zdr/
 * All routes require tenant context (companyId).
 */

// Apply tenant context to all ZDR routes
router.use(tenantContext);

/**
 * ZDR-E2-S2: Pre-flight secret detection
 * POST /api/command-center/zdr/preflight
 *
 * Scans content for secrets before egress. Returns 409 if secrets detected
 * and proceed is not explicitly set to true.
 */
router.post('/preflight', async (req, res, next) => {
  try {
    const { content, proceed, autoRedact, threshold } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required for pre-flight scan',
        code: 'VALIDATION_ERROR'
      });
    }

    const zdrService = getZDRService();
    const result = zdrService.preflightScan(content, {
      threshold: threshold || 1,
      autoRedact: autoRedact || false
    });

    if (result.hasSecrets && !proceed) {
      return res.status(409).json({
        success: false,
        error: result.message,
        code: result.code,
        details: {
          secretTypes: result.secretTypes,
          count: result.count,
          autoRedact: result.autoRedact
        }
      });
    }

    res.json({
      success: true,
      data: {
        hasSecrets: result.hasSecrets,
        proceed: true,
        secretTypes: result.secretTypes,
        count: result.count,
        message: proceed && result.hasSecrets
          ? 'Proceeding with known secrets (explicit override)'
          : result.message
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * ZDR-E7-S1: Query audit ledger
 * GET /api/command-center/zdr/audit-log
 *
 * Returns paginated audit entries for the calling tenant.
 */
router.get('/audit-log', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        error: 'Company identification required',
        code: 'MISSING_COMPANY_ID'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const sessionId = req.query.sessionId || null;

    const zdrService = getZDRService();
    const result = await zdrService.getAuditLog(companyId, { page, limit, sessionId });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * ZDR-E7-S2: Generate deletion attestation
 * POST /api/command-center/zdr/attestation
 *
 * Generates a signed attestation proving no Customer Code was retained.
 */
router.post('/attestation', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const { sessionId } = req.body;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        error: 'Company identification required',
        code: 'MISSING_COMPANY_ID'
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required',
        code: 'VALIDATION_ERROR'
      });
    }

    const zdrService = getZDRService();
    const attestation = await zdrService.generateAttestation(sessionId, companyId);

    if (!attestation) {
      return res.status(404).json({
        success: false,
        error: 'No audit entries found for session',
        code: 'NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: attestation
    });
  } catch (error) {
    next(error);
  }
});

/**
 * ZDR-E8-S2: Get ZDR policy for tenant
 * GET /api/command-center/zdr/policy
 *
 * Returns the effective ZDR policy for the calling tenant.
 */
router.get('/policy', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        error: 'Company identification required',
        code: 'MISSING_COMPANY_ID'
      });
    }

    const zdrService = getZDRService();
    const isZDR = zdrService.isZDRTenant(companyId);

    res.json({
      success: true,
      data: {
        companyId,
        isZDR,
        requiredTier: isZDR ? 'self_hosted' : 'standard_hosted',
        retention: isZDR ? 0 : null,
        hardEraseEnabled: require('../config').zdr.hardEraseEnabled,
        failClosedRouting: isZDR,
        redactionEnforced: true
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * ZDR-E3-S2: Verify tenant ownership of a session handoff
 * GET /api/command-center/zdr/handoff/:sessionId
 *
 * Returns handoff data scoped to the calling tenant's companyId.
 * Cross-tenant access returns 403.
 */
router.get(
  '/handoff/:sessionId',
  tenantIsolation('sessionId', { model: SessionHandoff, idField: 'sessionId', companyIdField: 'companyId' }),
  async (req, res, next) => {
    try {
      const handoff = await SessionHandoff.findOne({
        sessionId: req.params.sessionId,
        companyId: req.companyId
      }).lean();

      if (!handoff) {
        return res.status(404).json({
          success: false,
          error: 'Session handoff not found',
          code: 'NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: handoff
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ZDR-E10-S1: Chain integrity verification (admin only)
 * POST /api/command-center/zdr/verify-chain
 */
router.post('/verify-chain', async (req, res, next) => {
  try {
    const ZDRAuditLedger = require('../models/ZDRAuditLedger');
    const result = await ZDRAuditLedger.verifyChainIntegrity();

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
