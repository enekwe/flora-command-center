const express = require('express');
const router = express.Router();
const gmailAuthService = require('../services/gmailAuthService');

/**
 * Gmail OAuth Routes
 *
 * Routes:
 * - GET  /connect     - Initiate OAuth flow
 * - GET  /callback    - OAuth callback handler
 * - POST /disconnect  - Disconnect Gmail connection
 * - POST /test        - Test connection
 * - POST /refresh     - Refresh access token
 * - GET  /connections - List connections
 * - GET  /:id         - Get connection details
 */

/**
 * @route   GET /api/integrations/gmail/connect
 * @desc    Initiate Gmail OAuth flow
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

    const authUrl = gmailAuthService.getAuthorizationUrl(
      userId,
      organizationId,
      customScopes
    );

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    console.error('Gmail OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/callback
 * @desc    Handle Gmail OAuth callback
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
    const { userId, organizationId, tokens, userInfo } = await gmailAuthService.exchangeCodeForToken(
      code,
      state
    );

    // Save connection
    const connection = await gmailAuthService.saveConnection(
      userId,
      organizationId,
      tokens,
      userInfo
    );

    // Redirect to frontend success page
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}/settings/integrations/gmail/success?connectionId=${connection._id}`);
  } catch (error) {
    console.error('Gmail OAuth callback error:', error);

    // Redirect to frontend error page
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}/settings/integrations/gmail/error?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * @route   POST /api/integrations/gmail/disconnect
 * @desc    Disconnect Gmail connection
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
      // Revoke access with Google and disconnect
      result = await gmailAuthService.revokeAccess(connectionId);
    } else {
      // Just disconnect locally
      result = await gmailAuthService.disconnect(connectionId);
    }

    res.json({
      success: true,
      message: 'Gmail connection disconnected successfully',
      revoked: !!revoke
    });
  } catch (error) {
    console.error('Gmail disconnect error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/test
 * @desc    Test Gmail connection
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

    const result = await gmailAuthService.testConnection(connectionId);

    res.json(result);
  } catch (error) {
    console.error('Gmail test connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/refresh
 * @desc    Refresh Gmail access token
 * @access  Private
 */
router.post('/refresh', async (req, res) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const connection = await gmailAuthService.refreshAccessToken(connectionId);

    res.json({
      success: true,
      connection
    });
  } catch (error) {
    console.error('Gmail refresh token error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/connections
 * @desc    List Gmail connections for organization
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

    const connections = await gmailAuthService.getConnections(
      organizationId,
      includeInactive === 'true'
    );

    res.json({
      success: true,
      connections,
      total: connections.length
    });
  } catch (error) {
    console.error('Gmail list connections error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/:id
 * @desc    Get Gmail connection details
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await gmailAuthService.getConnection(id);

    res.json({
      success: true,
      connection
    });
  } catch (error) {
    console.error('Gmail get connection error:', error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
