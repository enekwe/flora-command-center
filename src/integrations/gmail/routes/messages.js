const express = require('express');
const router = express.Router();
const gmailSyncService = require('../services/gmailSyncService');

/**
 * Gmail Message Routes
 *
 * Routes:
 * - GET    /list       - List messages
 * - GET    /:id        - Get message details
 * - POST   /send       - Send a message
 * - PUT    /:id        - Modify message labels
 * - DELETE /:id        - Delete message
 * - POST   /:id/trash  - Trash message
 * - POST   /:id/untrash - Untrash message
 * - GET    /threads/list - List threads
 * - GET    /threads/:id  - Get thread details
 * - PUT    /threads/:id  - Modify thread
 * - GET    /profile     - Get user profile
 * - GET    /search      - Search messages
 */

/**
 * @route   GET /api/integrations/gmail/messages/list
 * @desc    List Gmail messages
 * @access  Private
 */
router.get('/list', async (req, res) => {
  try {
    const { connectionId, maxResults, labelIds, query, pageToken, includeSpamTrash } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const options = {
      maxResults: maxResults ? parseInt(maxResults) : undefined,
      labelIds: labelIds ? labelIds.split(',') : undefined,
      query,
      pageToken,
      includeSpamTrash: includeSpamTrash === 'true'
    };

    const result = await gmailSyncService.listMessages(connectionId, options);

    res.json(result);
  } catch (error) {
    console.error('List messages error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/messages/:id
 * @desc    Get Gmail message details
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, format } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.getMessage(
      connectionId,
      id,
      format || 'full'
    );

    res.json(result);
  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/messages/send
 * @desc    Send a Gmail message
 * @access  Private
 */
router.post('/send', async (req, res) => {
  try {
    const { connectionId, to, subject, body, cc, bcc, isHtml, threadId, replyTo } = req.body;

    if (!connectionId || !to || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, to, subject, and body are required'
      });
    }

    const emailData = {
      to,
      subject,
      body,
      cc,
      bcc,
      isHtml: isHtml !== false,
      threadId,
      replyTo
    };

    const result = await gmailSyncService.sendMessage(connectionId, emailData);

    res.json(result);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/integrations/gmail/messages/:id
 * @desc    Modify Gmail message labels
 * @access  Private
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, addLabelIds, removeLabelIds } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.modifyMessage(
      connectionId,
      id,
      addLabelIds || [],
      removeLabelIds || []
    );

    res.json(result);
  } catch (error) {
    console.error('Modify message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/gmail/messages/:id
 * @desc    Delete Gmail message permanently
 * @access  Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.deleteMessage(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/messages/:id/trash
 * @desc    Trash a Gmail message
 * @access  Private
 */
router.post('/:id/trash', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.trashMessage(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Trash message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/gmail/messages/:id/untrash
 * @desc    Untrash a Gmail message
 * @access  Private
 */
router.post('/:id/untrash', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.untrashMessage(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Untrash message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/messages/threads/list
 * @desc    List Gmail threads
 * @access  Private
 */
router.get('/threads/list', async (req, res) => {
  try {
    const { connectionId, maxResults, labelIds, query, pageToken, includeSpamTrash } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const options = {
      maxResults: maxResults ? parseInt(maxResults) : undefined,
      labelIds: labelIds ? labelIds.split(',') : undefined,
      query,
      pageToken,
      includeSpamTrash: includeSpamTrash === 'true'
    };

    const result = await gmailSyncService.listThreads(connectionId, options);

    res.json(result);
  } catch (error) {
    console.error('List threads error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/messages/threads/:id
 * @desc    Get Gmail thread details
 * @access  Private
 */
router.get('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, format } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.getThread(
      connectionId,
      id,
      format || 'full'
    );

    res.json(result);
  } catch (error) {
    console.error('Get thread error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/integrations/gmail/messages/threads/:id
 * @desc    Modify Gmail thread labels
 * @access  Private
 */
router.put('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, addLabelIds, removeLabelIds } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.modifyThread(
      connectionId,
      id,
      addLabelIds || [],
      removeLabelIds || []
    );

    res.json(result);
  } catch (error) {
    console.error('Modify thread error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/messages/profile
 * @desc    Get Gmail user profile
 * @access  Private
 */
router.get('/profile', async (req, res) => {
  try {
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await gmailSyncService.getProfile(connectionId);

    res.json(result);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/gmail/messages/search
 * @desc    Search Gmail messages
 * @access  Private
 */
router.get('/search', async (req, res) => {
  try {
    const { connectionId, query, maxResults, pageToken } = req.query;

    if (!connectionId || !query) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and query are required'
      });
    }

    const options = {
      maxResults: maxResults ? parseInt(maxResults) : undefined,
      pageToken
    };

    const result = await gmailSyncService.searchMessages(
      connectionId,
      query,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
