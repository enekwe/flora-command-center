const express = require('express');
const router = express.Router();
const gmailSyncService = require('../services/gmailSyncService');
const gmailLabelService = require('../services/gmailLabelService');

/**
 * Gmail Sync and Label Routes
 *
 * Sync Routes:
 * - GET  /history      - Get message history (incremental sync)
 * - POST /batch        - Batch get messages
 *
 * Label Routes:
 * - GET    /labels        - List all labels
 * - GET    /labels/:id    - Get label details
 * - POST   /labels        - Create label
 * - PUT    /labels/:id    - Update label
 * - DELETE /labels/:id    - Delete label
 * - GET    /labels/system - Get system labels
 * - GET    /labels/user   - Get user labels
 */

/**
 * @route   GET /api/integrations/gmail/sync/history
 * @desc    Get Gmail message history (incremental sync)
 * @access  Private
 */
router.get('/history', async (req, res) => {
  try {
    const { connectionId, startHistoryId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.getHistory(
      connectionId,
      startHistoryId
    );

    res.json(result);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/sync/batch
 * @desc    Batch get Gmail messages
 * @access  Private
 */
router.post('/batch', async (req, res) => {
  try {
    const { connectionId, messageIds, format } = req.body;

    if (!connectionId || !messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and messageIds (array) are required'
      });
    }

    const result = await gmailSyncService.batchGetMessages(
      connectionId,
      messageIds,
      format || 'full'
    );

    res.json(result);
  } catch (error) {
    console.error('Batch get messages error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/sync/labels
 * @desc    List all Gmail labels
 * @access  Private
 */
router.get('/labels', async (req, res) => {
  try {
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailLabelService.listLabels(connectionId);

    res.json(result);
  } catch (error) {
    console.error('List labels error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/sync/labels/:id
 * @desc    Get Gmail label details
 * @access  Private
 */
router.get('/labels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailLabelService.getLabel(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Get label error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/sync/labels
 * @desc    Create a Gmail label
 * @access  Private
 */
router.post('/labels', async (req, res) => {
  try {
    const { connectionId, name, messageListVisibility, labelListVisibility, color } = req.body;

    if (!connectionId || !name) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and name are required'
      });
    }

    const labelData = {
      name,
      messageListVisibility,
      labelListVisibility,
      color
    };

    const result = await gmailLabelService.createLabel(connectionId, labelData);

    res.json(result);
  } catch (error) {
    console.error('Create label error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/integrations/gmail/sync/labels/:id
 * @desc    Update a Gmail label
 * @access  Private
 */
router.put('/labels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, name, messageListVisibility, labelListVisibility, color } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const labelData = {
      name,
      messageListVisibility,
      labelListVisibility,
      color
    };

    const result = await gmailLabelService.updateLabel(connectionId, id, labelData);

    res.json(result);
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/gmail/sync/labels/:id
 * @desc    Delete a Gmail label
 * @access  Private
 */
router.delete('/labels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailLabelService.deleteLabel(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Delete label error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/sync/labels/system
 * @desc    Get Gmail system labels
 * @access  Private
 */
router.get('/labels/system', async (req, res) => {
  try {
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailLabelService.getSystemLabels(connectionId);

    res.json(result);
  } catch (error) {
    console.error('Get system labels error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/sync/labels/user
 * @desc    Get user-created Gmail labels
 * @access  Private
 */
router.get('/labels/user', async (req, res) => {
  try {
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailLabelService.getUserLabels(connectionId);

    res.json(result);
  } catch (error) {
    console.error('Get user labels error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
