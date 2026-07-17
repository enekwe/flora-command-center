const express = require('express');
const router = express.Router();

// Import sub-routers
const statusRoutes = require('./status');

/**
 * Mercury Integration Routes
 *
 * Base path: /api/integrations/mercury
 *
 * Routes:
 * - /status - Get Mercury integration connection status
 */

// Mount status routes
router.use('/', statusRoutes);

module.exports = router;
