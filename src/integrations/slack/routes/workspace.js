const express = require('express');
const router = express.Router();
const slackWorkspaceService = require('../services/slackWorkspaceService');

/**
 * Slack Workspace Routes
 *
 * Routes:
 * - GET    /info             - Get workspace info
 * - GET    /channels         - List channels
 * - GET    /channels/:id     - Get channel info
 * - POST   /channels         - Create channel
 * - PUT    /channels/:id     - Update channel
 * - DELETE /channels/:id     - Archive channel
 * - POST   /channels/:id/unarchive - Unarchive channel
 * - POST   /channels/:id/invite    - Invite users to channel
 * - POST   /channels/:id/kick      - Kick user from channel
 * - GET    /channels/:id/members   - Get channel members
 * - GET    /users            - List users
 * - GET    /users/:id        - Get user info
 * - GET    /users/:id/presence - Get user presence
 * - POST   /dm               - Open direct message
 */

/**
 * @route   GET /api/integrations/slack/workspace/info
 * @desc    Get Slack workspace information
 * @access  Private
 */
router.get('/info', async (req, res) => {
  try {
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.getWorkspaceInfo(connectionId);

    res.json(result);
  } catch (error) {
    console.error('Get workspace info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/workspace/channels
 * @desc    List all Slack channels
 * @access  Private
 */
router.get('/channels', async (req, res) => {
  try {
    const { connectionId, types, excludeArchived, limit } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const options = {
      types,
      excludeArchived: excludeArchived !== 'false',
      limit: limit ? parseInt(limit) : undefined
    };

    const result = await slackWorkspaceService.listChannels(connectionId, options);

    res.json(result);
  } catch (error) {
    console.error('List channels error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/workspace/channels/:id
 * @desc    Get Slack channel information
 * @access  Private
 */
router.get('/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.getChannelInfo(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Get channel info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/channels
 * @desc    Create a Slack channel
 * @access  Private
 */
router.post('/channels', async (req, res) => {
  try {
    const { connectionId, name, isPrivate } = req.body;

    if (!connectionId || !name) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and name are required'
      });
    }

    const result = await slackWorkspaceService.createChannel(
      connectionId,
      name,
      isPrivate
    );

    res.json(result);
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/integrations/slack/workspace/channels/:id
 * @desc    Update a Slack channel (rename, topic, purpose)
 * @access  Private
 */
router.put('/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, name, topic, purpose } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    let result;

    if (name) {
      result = await slackWorkspaceService.renameChannel(connectionId, id, name);
    } else if (topic) {
      result = await slackWorkspaceService.setChannelTopic(connectionId, id, topic);
    } else if (purpose) {
      result = await slackWorkspaceService.setChannelPurpose(connectionId, id, purpose);
    } else {
      return res.status(400).json({
        success: false,
        error: 'name, topic, or purpose is required'
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Update channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/slack/workspace/channels/:id
 * @desc    Archive a Slack channel
 * @access  Private
 */
router.delete('/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.archiveChannel(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Archive channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/channels/:id/unarchive
 * @desc    Unarchive a Slack channel
 * @access  Private
 */
router.post('/channels/:id/unarchive', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.unarchiveChannel(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Unarchive channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/channels/:id/invite
 * @desc    Invite users to a Slack channel
 * @access  Private
 */
router.post('/channels/:id/invite', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, users } = req.body;

    if (!connectionId || !users || !Array.isArray(users)) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and users (array) are required'
      });
    }

    const result = await slackWorkspaceService.inviteToChannel(
      connectionId,
      id,
      users
    );

    res.json(result);
  } catch (error) {
    console.error('Invite to channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/channels/:id/kick
 * @desc    Kick a user from a Slack channel
 * @access  Private
 */
router.post('/channels/:id/kick', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, user } = req.body;

    if (!connectionId || !user) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and user are required'
      });
    }

    const result = await slackWorkspaceService.kickFromChannel(
      connectionId,
      id,
      user
    );

    res.json(result);
  } catch (error) {
    console.error('Kick from channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/workspace/channels/:id/members
 * @desc    Get members of a Slack channel
 * @access  Private
 */
router.get('/channels/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId, limit, cursor } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const options = {
      limit: limit ? parseInt(limit) : undefined,
      cursor
    };

    const result = await slackWorkspaceService.getChannelMembers(
      connectionId,
      id,
      options
    );

    res.json(result);
  } catch (error) {
    console.error('Get channel members error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/workspace/users
 * @desc    List all users in Slack workspace
 * @access  Private
 */
router.get('/users', async (req, res) => {
  try {
    const { connectionId, limit, cursor } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const options = {
      limit: limit ? parseInt(limit) : undefined,
      cursor
    };

    const result = await slackWorkspaceService.listUsers(connectionId, options);

    res.json(result);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/workspace/users/:id
 * @desc    Get Slack user information
 * @access  Private
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.getUserInfo(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/integrations/slack/workspace/users/:id/presence
 * @desc    Get Slack user presence
 * @access  Private
 */
router.get('/users/:id/presence', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.query;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.getUserPresence(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Get user presence error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/dm
 * @desc    Open a direct message conversation
 * @access  Private
 */
router.post('/dm', async (req, res) => {
  try {
    const { connectionId, users } = req.body;

    if (!connectionId || !users || !Array.isArray(users)) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and users (array) are required'
      });
    }

    const result = await slackWorkspaceService.openDirectMessage(
      connectionId,
      users
    );

    res.json(result);
  } catch (error) {
    console.error('Open DM error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/channels/:id/join
 * @desc    Join a Slack channel
 * @access  Private
 */
router.post('/channels/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.joinChannel(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Join channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/integrations/slack/workspace/channels/:id/leave
 * @desc    Leave a Slack channel
 * @access  Private
 */
router.post('/channels/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'connectionId is required'
      });
    }

    const result = await slackWorkspaceService.leaveChannel(connectionId, id);

    res.json(result);
  } catch (error) {
    console.error('Leave channel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
