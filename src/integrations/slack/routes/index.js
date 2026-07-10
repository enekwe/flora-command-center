const express = require('express');
const router = express.Router();

// Import sub-routers
const oauthRoutes = require('./oauth');
const messageRoutes = require('./messages');
const workspaceRoutes = require('./workspace');

/**
 * Slack Integration Routes
 *
 * Base path: /api/integrations/slack
 *
 * Routes:
 * - /           - OAuth routes (connect, callback, disconnect, etc.)
 * - /messages   - Message operations (send, reply, update, delete, etc.)
 * - /workspace  - Workspace operations (channels, users, info, etc.)
 */

// Mount OAuth routes at root level
router.use('/', oauthRoutes);

// Mount message routes
router.use('/messages', messageRoutes);

// Mount workspace routes
router.use('/workspace', workspaceRoutes);

module.exports = router;
