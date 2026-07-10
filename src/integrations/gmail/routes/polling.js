const express = require('express');
const router = express.Router();
const gmailPollingService = require('../services/gmailPollingService');
const GmailConnection = require('../models/GmailConnection');

/**
 * Gmail Polling Routes
 *
 * Routes:
 * - POST /start       - Start polling for a connection
 * - POST /stop        - Stop polling for a connection
 * - GET  /status/:id  - Get polling status for a connection
 * - GET  /active      - Get all active polling connections
 */

/**
 * @route   POST /api/integrations/gmail/polling/start
 * @desc    Start email polling for a Gmail connection
 * @access  Private
 */
router.post('/start', async (req, res) => {
  try {
    const { connectionId, intervalMs } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    // Verify connection exists
    const connection = await GmailConnection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
    }

    if (!connection.isActive || connection.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Connection is not active'
      });
    }

    // Start polling with custom interval or default 60s
    const interval = intervalMs || 60000;
    await gmailPollingService.startPolling(connectionId, interval);

    res.json({
      success: true,
      message: 'Email polling started successfully',
      connectionId,
      intervalMs: interval,
      status: gmailPollingService.getPollingStatus(connectionId)
    });
  } catch (error) {
    console.error('Start polling error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/polling/stop
 * @desc    Stop email polling for a Gmail connection
 * @access  Private
 */
router.post('/stop', async (req, res) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    gmailPollingService.stopPolling(connectionId);

    res.json({
      success: true,
      message: 'Email polling stopped successfully',
      connectionId
    });
  } catch (error) {
    console.error('Stop polling error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/polling/status/:id
 * @desc    Get polling status for a connection
 * @access  Private
 */
router.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await GmailConnection.findById(id);
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
    }

    const status = gmailPollingService.getPollingStatus(id);

    res.json({
      success: true,
      connectionId: id,
      email: connection.email,
      connectionStatus: connection.status,
      polling: status
    });
  } catch (error) {
    console.error('Get polling status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/polling/active
 * @desc    Get all active polling connections
 * @access  Private
 */
router.get('/active', async (req, res) => {
  try {
    const activeConnectionIds = gmailPollingService.getActivePollingConnections();

    // Get connection details
    const connections = await Promise.all(
      activeConnectionIds.map(async (id) => {
        const connection = await GmailConnection.findById(id);
        if (!connection) return null;

        return {
          connectionId: id,
          email: connection.email,
          organizationId: connection.organizationId,
          status: gmailPollingService.getPollingStatus(id)
        };
      })
    );

    res.json({
      success: true,
      total: connections.filter(c => c !== null).length,
      connections: connections.filter(c => c !== null)
    });
  } catch (error) {
    console.error('Get active polling connections error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/polling/check-now
 * @desc    Manually trigger email check for a connection
 * @access  Private
 */
router.post('/check-now', async (req, res) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    // Verify connection exists
    const connection = await GmailConnection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
    }

    // Manually trigger check
    await gmailPollingService.checkForNewEmails(connectionId);

    res.json({
      success: true,
      message: 'Email check completed',
      connectionId,
      lastSyncAt: connection.lastSyncAt
    });
  } catch (error) {
    console.error('Manual check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
