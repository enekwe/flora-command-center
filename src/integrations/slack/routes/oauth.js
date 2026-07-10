const express = require('express');
const router = express.Router();
const slackAuthService = require('../services/slackAuthService');

/**
 * Slack OAuth Routes
 *
 * Routes:
 * - GET  /connect     - Initiate OAuth flow
 * - GET  /callback    - OAuth callback handler
 * - POST /disconnect  - Disconnect Slack connection
 * - POST /test        - Test connection
 * - GET  /connections - List connections
 * - GET  /:id         - Get connection details
 */

/**
 * @route   GET /api/integrations/slack/connect
 * @desc    Initiate Slack OAuth flow
 * @access  Private
 */
router.get('/connect', async (req, res) => {
  try {
    const { userId, organizationId, scopes } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'userId and organizationId are required'
      });
    }

    const customScopes = scopes ? scopes.split(',') : null;

    const authUrl = slackAuthService.getAuthorizationUrl(
      userId,
      organizationId,
      customScopes
    );

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    console.error('Slack OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/callback
 * @desc    Handle Slack OAuth callback
 * @access  Public
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      return res.status(400).json({
        success: false,
        error: `OAuth error: ${error}`
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state parameter'
      });
    }

    // Exchange code for token
    const { userId, organizationId, tokenData } = await slackAuthService.exchangeCodeForToken(
      code,
      state
    );

    // Save connection
    const connection = await slackAuthService.saveConnection(
      userId,
      organizationId,
      tokenData
    );

    // Redirect to frontend success page
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}/settings/integrations/slack/success?connectionId=${connection._id}`);
  } catch (error) {
    console.error('Slack OAuth callback error:', error);

    // Redirect to frontend error page
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}/settings/integrations/slack/error?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * @route   POST /api/integrations/slack/disconnect
 * @desc    Disconnect Slack connection
 * @access  Private
 */
router.post('/disconnect', async (req, res) => {
  try {
    const { connectionId, revoke } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    let result;

    if (revoke) {
      // Revoke access with Slack and disconnect
      result = await slackAuthService.revokeAccess(connectionId);
    } else {
      // Just disconnect locally
      result = await slackAuthService.disconnect(connectionId);
    }

    res.json({
      success: true,
      message: 'Slack connection disconnected successfully',
      revoked: !!revoke
    });
  } catch (error) {
    console.error('Slack disconnect error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/test
 * @desc    Test Slack connection
 * @access  Private
 */
router.post('/test', async (req, res) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackAuthService.testConnection(connectionId);

    res.json(result);
  } catch (error) {
    console.error('Slack test connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/connections
 * @desc    List Slack connections for organization
 * @access  Private
 */
router.get('/connections', async (req, res) => {
  try {
    const { organizationId, includeInactive } = req.query;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId is required'
      });
    }

    const connections = await slackAuthService.getConnections(
      organizationId,
      includeInactive === 'true'
    );

    res.json({
      success: true,
      connections,
      total: connections.length
    });
  } catch (error) {
    console.error('Slack list connections error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/:id
 * @desc    Get Slack connection details
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await slackAuthService.getConnection(id);

    res.json({
      success: true,
      connection
    });
  } catch (error) {
    console.error('Slack get connection error:', error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
