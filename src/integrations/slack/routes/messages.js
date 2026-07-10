const express = require('express');
const router = express.Router();
const slackMessageService = require('../services/slackMessageService');

/**
 * Slack Message Routes
 *
 * Routes:
 * - POST /send         - Send a message
 * - POST /send-blocks  - Send a formatted message with blocks
 * - POST /reply        - Reply to a thread
 * - PUT  /update       - Update a message
 * - DELETE /delete     - Delete a message
 * - GET  /history      - Get message history
 * - GET  /thread       - Get thread replies
 * - POST /upload       - Upload a file
 * - POST /reaction     - Add a reaction
 * - DELETE /reaction   - Remove a reaction
 * - GET  /search       - Search messages
 * - POST /schedule     - Schedule a message
 * - GET  /permalink    - Get message permalink
 */

/**
 * @route   POST /api/integrations/slack/messages/send
 * @desc    Send a message to a Slack channel
 * @access  Private
 */
router.post('/send', async (req, res) => {
  try {
    const { connectionId, channel, text, ...options } = req.body;

    if (!connectionId || !channel || !text) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, and text are required'
      });
    }

    const result = await slackMessageService.sendMessage(
      connectionId,
      channel,
      text,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Send Slack message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/messages/send-blocks
 * @desc    Send a formatted message with Slack Block Kit blocks
 * @access  Private
 */
router.post('/send-blocks', async (req, res) => {
  try {
    const { connectionId, channel, blocks, fallbackText } = req.body;

    if (!connectionId || !channel || !blocks) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, and blocks are required'
      });
    }

    const result = await slackMessageService.sendBlockMessage(
      connectionId,
      channel,
      blocks,
      fallbackText
    );

    res.json(result);
  } catch (error) {
    console.error('Send block message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/messages/reply
 * @desc    Reply to a Slack thread
 * @access  Private
 */
router.post('/reply', async (req, res) => {
  try {
    const { connectionId, channel, threadTs, text, ...options } = req.body;

    if (!connectionId || !channel || !threadTs || !text) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, threadTs, and text are required'
      });
    }

    const result = await slackMessageService.replyToThread(
      connectionId,
      channel,
      threadTs,
      text,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Reply to thread error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/integrations/slack/messages/update
 * @desc    Update an existing Slack message
 * @access  Private
 */
router.put('/update', async (req, res) => {
  try {
    const { connectionId, channel, ts, text, ...options } = req.body;

    if (!connectionId || !channel || !ts || !text) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, ts, and text are required'
      });
    }

    const result = await slackMessageService.updateMessage(
      connectionId,
      channel,
      ts,
      text,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Update message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/slack/messages/delete
 * @desc    Delete a Slack message
 * @access  Private
 */
router.delete('/delete', async (req, res) => {
  try {
    const { connectionId, channel, ts } = req.body;

    if (!connectionId || !channel || !ts) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, and ts are required'
      });
    }

    const result = await slackMessageService.deleteMessage(
      connectionId,
      channel,
      ts
    );

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
 * @route   GET /api/integrations/slack/messages/history
 * @desc    Get message history from a channel
 * @access  Private
 */
router.get('/history', async (req, res) => {
  try {
    const { connectionId, channel, limit, oldest, latest, inclusive } = req.query;

    if (!connectionId || !channel) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and channel are required'
      });
    }

    const options = {
      limit: limit ? parseInt(limit) : undefined,
      oldest,
      latest,
      inclusive: inclusive !== 'false'
    };

    const result = await slackMessageService.getHistory(
      connectionId,
      channel,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Get message history error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/messages/thread
 * @desc    Get replies to a Slack thread
 * @access  Private
 */
router.get('/thread', async (req, res) => {
  try {
    const { connectionId, channel, ts, limit, oldest, latest } = req.query;

    if (!connectionId || !channel || !ts) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, and ts are required'
      });
    }

    const options = {
      limit: limit ? parseInt(limit) : undefined,
      oldest,
      latest
    };

    const result = await slackMessageService.getReplies(
      connectionId,
      channel,
      ts,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Get thread replies error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/messages/upload
 * @desc    Upload a file to Slack
 * @access  Private
 */
router.post('/upload', async (req, res) => {
  try {
    const { connectionId, channels, file, filename, title, initialComment } = req.body;

    if (!connectionId || !channels || !file) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channels, and file are required'
      });
    }

    const result = await slackMessageService.uploadFile(connectionId, {
      channels,
      file,
      filename,
      title,
      initialComment
    });

    res.json(result);
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/messages/reaction
 * @desc    Add a reaction to a message
 * @access  Private
 */
router.post('/reaction', async (req, res) => {
  try {
    const { connectionId, channel, timestamp, reaction } = req.body;

    if (!connectionId || !channel || !timestamp || !reaction) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, timestamp, and reaction are required'
      });
    }

    const result = await slackMessageService.addReaction(
      connectionId,
      channel,
      timestamp,
      reaction
    );

    res.json(result);
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/slack/messages/reaction
 * @desc    Remove a reaction from a message
 * @access  Private
 */
router.delete('/reaction', async (req, res) => {
  try {
    const { connectionId, channel, timestamp, reaction } = req.body;

    if (!connectionId || !channel || !timestamp || !reaction) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, timestamp, and reaction are required'
      });
    }

    const result = await slackMessageService.removeReaction(
      connectionId,
      channel,
      timestamp,
      reaction
    );

    res.json(result);
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/messages/search
 * @desc    Search for messages in Slack
 * @access  Private
 */
router.get('/search', async (req, res) => {
  try {
    const { connectionId, query, count, page, sort, sortDir } = req.query;

    if (!connectionId || !query) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and query are required'
      });
    }

    const options = {
      count: count ? parseInt(count) : undefined,
      page: page ? parseInt(page) : undefined,
      sort,
      sortDir
    };

    const result = await slackMessageService.searchMessages(
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

/**
 * @route   POST /api/integrations/slack/messages/schedule
 * @desc    Schedule a message for later delivery
 * @access  Private
 */
router.post('/schedule', async (req, res) => {
  try {
    const { connectionId, channel, text, postAt, ...options } = req.body;

    if (!connectionId || !channel || !text || !postAt) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, text, and postAt are required'
      });
    }

    const result = await slackMessageService.scheduleMessage(
      connectionId,
      channel,
      text,
      postAt,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Schedule message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/messages/permalink
 * @desc    Get permalink for a message
 * @access  Private
 */
router.get('/permalink', async (req, res) => {
  try {
    const { connectionId, channel, messageTs } = req.query;

    if (!connectionId || !channel || !messageTs) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, channel, and messageTs are required'
      });
    }

    const result = await slackMessageService.getPermalink(
      connectionId,
      channel,
      messageTs
    );

    res.json(result);
  } catch (error) {
    console.error('Get permalink error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
