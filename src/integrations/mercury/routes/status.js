const express = require('express');
const router = express.Router();
const logger = require('../../../utils/logger');

/**
 * @route   GET /api/integrations/mercury/status
 * @desc    Check Mercury integration connection status
 * @access  Private (authenticated users)
 */
router.get('/status', async (req, res) => {
  try {
    // Check if Mercury API key is configured
    const mercuryApiKey = process.env.MERCURY_API_KEY;
    const isConnected = !!(mercuryApiKey && mercuryApiKey.length > 0 && !mercuryApiKey.startsWith('your_'));

    // TODO: In the future, we could make a test API call to Mercury to verify the key is valid
    // For now, we just check if the environment variable is set

    logger.info('Mercury integration status checked', {
      userId: req.user?.id,
      isConnected
    });

    res.json({
      type: 'mercury',
      isConnected,
      connectionDetails: isConnected ? {
        accountCount: 0, // Placeholder - could be populated from actual Mercury API
        lastSyncedAt: new Date().toISOString()
      } : undefined
    });
  } catch (error) {
    logger.error('Error checking Mercury integration status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check Mercury integration status'
    });
  }
});

module.exports = router;
