const express = require('express');
const router = express.Router();

// Import sub-routers
const oauthRoutes = require('./oauth');
const messageRoutes = require('./messages');
const syncRoutes = require('./sync');
const pollingRoutes = require('./polling');

/**
 * Gmail Integration Routes
 *
 * Base path: /api/integrations/gmail
 *
 * Routes:
 * - /          - OAuth routes (connect, callback, disconnect, etc.)
 * - /messages  - Message operations (list, get, send, modify, etc.)
 * - /sync      - Sync and label operations (history, batch, labels)
 * - /polling   - Email polling operations (start, stop, status)
 */

// Mount OAuth routes at root level
router.use('/', oauthRoutes);

// Mount message routes
router.use('/messages', messageRoutes);

// Mount sync routes
router.use('/sync', syncRoutes);

// Mount polling routes
router.use('/polling', pollingRoutes);

module.exports = router;
