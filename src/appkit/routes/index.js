/**
 * Flora App Kit — Command Center routes
 * Mounted at /api/command-center/appkit  (APP_KIT_PROJECT_CONTRACT.md §4)
 *
 *   POST   /status          build-status callback  → project timeline
 *   POST   /tokens          mint a scoped app token (called by devops at deploy)
 *   DELETE /tokens/:buildId  revoke a build's tokens
 *   POST   /data            the governed runtime data broker (scoped-token auth)
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

const tokenService = require('../services/appKitTokenService');
const brokerService = require('../services/appKitBrokerService');
const AppKitBuildLink = require('../models/AppKitBuildLink');

/**
 * Service-to-service auth for internal endpoints (status/tokens).
 * Uses a dedicated App Kit service key when configured; otherwise requires any
 * API key in production (consistent with the existing command-center routes).
 */
function authenticateService(req, res, next) {
  const provided = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const expected = process.env.APP_KIT_SERVICE_KEY;

  if (expected) {
    if (provided !== expected) {
      return res.status(401).json({ success: false, error: 'Invalid service key' });
    }
    return next();
  }

  if (!provided && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ success: false, error: 'Service key required' });
  }
  next();
}

/**
 * Scoped-token auth for the runtime data broker.
 */
async function authenticateApp(req, res, next) {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'App token required' });
    }
    req.appClaims = await tokenService.verify(token);
    next();
  } catch (err) {
    res.status(err.statusCode || 401).json({ success: false, error: err.message });
  }
}

// POST /status — record a build phase transition into the project timeline.
router.post('/status', authenticateService, async (req, res, next) => {
  try {
    const { buildId, projectId, requestId, phase } = req.body || {};
    if (!buildId || !projectId || !phase) {
      return res.status(400).json({
        success: false,
        error: 'buildId, projectId and phase are required'
      });
    }

    const event = {
      phase,
      driftScore: req.body.driftScore,
      driftStatus: req.body.driftStatus,
      deployUrl: req.body.deployUrl,
      repo: req.body.repo,
      error: req.body.error,
      at: new Date()
    };

    await AppKitBuildLink.findOneAndUpdate(
      { buildId },
      {
        $setOnInsert: { buildId, projectId, requestId, companyId: req.body.companyId },
        $set: { currentPhase: phase },
        $push: { timeline: event }
      },
      { upsert: true, new: true }
    );

    logger.info('App Kit build status recorded', { buildId, phase });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /tokens — mint a scoped app token for a build.
router.post('/tokens', authenticateService, async (req, res, next) => {
  try {
    const { buildId, projectId, requestId, organizationId, userId, companyId, scope } = req.body || {};
    if (!buildId || !organizationId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'buildId, organizationId and userId are required'
      });
    }
    const result = await tokenService.mint({
      buildId, projectId, requestId, organizationId, userId, companyId, scope
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// DELETE /tokens/:buildId — revoke all tokens for a build.
router.delete('/tokens/:buildId', authenticateService, async (req, res, next) => {
  try {
    const count = await tokenService.revokeBuild(req.params.buildId);
    res.json({ success: true, revoked: count });
  } catch (error) {
    next(error);
  }
});

// POST /data — governed runtime data broker for built apps.
router.post('/data', authenticateApp, async (req, res, next) => {
  try {
    const result = await brokerService.execute(req.appClaims, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
});

module.exports = router;
