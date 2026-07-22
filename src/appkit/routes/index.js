/**
 * Flora App Kit — Command Center routes
 * Mounted at /api/command-center/appkit  (APP_KIT_PROJECT_CONTRACT.md §4)
 *
 *   POST   /requests        kick off a build for an EXISTING CC project (CC → devops)
 *   POST   /status          build-status callback  → project timeline
 *   POST   /tokens          mint a scoped app token (called by devops at deploy)
 *   DELETE /tokens/:buildId  revoke a build's tokens
 *   POST   /data            the governed runtime data broker (scoped-token auth)
 *   POST   /generate         call the provider brain to generate app code (`generating` phase)
 */

const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const router = express.Router();
const config = require('../../config');
const logger = require('../../utils/logger');

const tokenService = require('../services/appKitTokenService');
const brokerService = require('../services/appKitBrokerService');
const codeGenService = require('../services/appKitCodeGenService');
const AppKitBuildLink = require('../models/AppKitBuildLink');

/**
 * User/project-facing auth — mirrors commandCenterRoutes.js's
 * authenticateApiKey exactly (this endpoint sits alongside that same class of
 * CC-facing API, unlike /status,/tokens,/generate below which are
 * devops-internal service-to-service calls authenticated separately).
 */
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ success: false, error: 'API key required' });
  }

  next();
}

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

// POST /requests — kick off an App Kit build for an EXISTING Command Center
// project (the UI/project-driven flow, as distinct from flora-mcp-server's
// app_kit/build tool, which mints an ad-hoc projectId for IDE/CLI-originated
// requests that have no pre-existing CC project). This is CC acting as the
// true intake for its own project: it proxies to devops's POST /api/appkit/
// builds on the caller's behalf, with callbackUrl pointed at CC's own
// /status endpoint below, so the build's phase history lands in the SAME
// AppKitBuildLink/project-timeline mechanism regardless of origin.
router.post('/requests', authenticateApiKey, async (req, res, next) => {
  try {
    const {
      projectId, userId, organizationId, companyId, appName, prompt, manifest, deployTarget
    } = req.body || {};

    if (!projectId || !userId || !organizationId || !appName || !prompt) {
      return res.status(400).json({
        success: false,
        error: 'projectId, userId, organizationId, appName and prompt are required'
      });
    }

    const requestId = `cc-req-${crypto.randomUUID()}`;

    const response = await axios.post(
      `${config.appKit.devopsApiUrl}/api/appkit/builds`,
      {
        projectId,
        requestId,
        userId,
        organizationId,
        companyId,
        appName,
        prompt,
        manifest,
        deployTarget,
        callbackUrl: `${config.appKit.selfBaseUrl}/api/command-center/appkit/status`
      },
      {
        timeout: 15000,
        headers: {
          'X-Service-Name': 'flora-command-center',
          // devops now requires this on every /api/appkit/* call — same shared
          // secret this service already expects on its OWN /status,/tokens,
          // /generate endpoints (see authenticateService above). Must be set
          // to the same value on both services.
          ...(process.env.APP_KIT_SERVICE_KEY ? { 'X-API-Key': process.env.APP_KIT_SERVICE_KEY } : {})
        }
      }
    );

    logger.info('App Kit build request proxied to devops', {
      buildId: response.data?.buildId, projectId, requestId, appName
    });

    res.status(202).json({
      success: true,
      buildId: response.data?.buildId,
      status: response.data?.status,
      phase: response.data?.phase,
      projectId,
      requestId
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status || 502).json({
        success: false,
        error: error.response.data?.error || 'App Kit build request failed at flora-devops'
      });
    }
    next(error);
  }
});

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
    const {
      buildId, projectId, requestId, organizationId, userId, companyId, scope, deployTarget
    } = req.body || {};
    if (!buildId || !organizationId || !userId || !deployTarget) {
      return res.status(400).json({
        success: false,
        error: 'buildId, organizationId, userId and deployTarget are required'
      });
    }
    const result = await tokenService.mint({
      buildId, projectId, requestId, organizationId, userId, companyId, scope, deployTarget
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
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

// POST /generate — call the provider brain to generate app code for the
// devops build pipeline's `generating` phase (FLORA_APP_KIT_ARCHITECTURE.md §4.2).
router.post('/generate', authenticateService, async (req, res, next) => {
  try {
    const { buildId, appName, prompt, manifest } = req.body || {};
    if (!buildId || !appName || !prompt) {
      return res.status(400).json({
        success: false,
        error: 'buildId, appName and prompt are required'
      });
    }

    const result = await codeGenService.generate({ buildId, appName, prompt, manifest });
    res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
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
