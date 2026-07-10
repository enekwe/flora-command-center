/**
 * Command Center API Routes
 *
 * Exposes Command Center v2.0 services via REST API
 */

const express = require('express');
const router = express.Router();
const contextOptimizationService = require('../services/contextOptimizationService');
const bestPracticesService = require('../services/bestPracticesService');

// Middleware for API key authentication (simple version)
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  // In production, validate against stored API keys
  // For now, just check if it exists
  if (!apiKey && process.env.NODE_ENV === 'production') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required'
    });
  }

  next();
};

// Apply auth middleware to all routes
router.use(authenticateApiKey);

// ============================================================================
// BEST PRACTICES ROUTES
// ============================================================================

/**
 * GET /api/command-center/best-practices
 * Get best practices recommendations
 */
router.get('/best-practices', (req, res) => {
  try {
    const {
      teamComposition = 'solo',
      role = 'developer',
      expertiseLevel = 'intermediate',
      context
    } = req.query;

    const userProfile = {
      teamComposition,
      role,
      expertiseLevel
    };

    const practices = bestPracticesService.getBestPractices(
      userProfile,
      context || null
    );

    res.json({
      success: true,
      practices,
      userProfile
    });
  } catch (error) {
    console.error('Error fetching best practices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch best practices',
      message: error.message
    });
  }
});

/**
 * GET /api/command-center/best-practices/alert
 * Get practice alert for specific action
 */
router.get('/best-practices/alert', (req, res) => {
  try {
    const {
      teamComposition = 'solo',
      role = 'developer',
      expertiseLevel = 'intermediate',
      action
    } = req.query;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: action'
      });
    }

    const userProfile = {
      teamComposition,
      role,
      expertiseLevel
    };

    const alert = bestPracticesService.getAlert(userProfile, action);

    res.json({
      success: true,
      alert
    });
  } catch (error) {
    console.error('Error fetching alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert',
      message: error.message
    });
  }
});

/**
 * GET /api/command-center/best-practices/checklist/:workflow
 * Get workflow checklist
 */
router.get('/best-practices/checklist/:workflow', (req, res) => {
  try {
    const { workflow } = req.params;
    const {
      teamComposition = 'solo',
      role = 'developer',
      expertiseLevel = 'intermediate'
    } = req.query;

    const userProfile = {
      teamComposition,
      role,
      expertiseLevel
    };

    const checklist = bestPracticesService.getWorkflowChecklist(
      userProfile,
      workflow
    );

    res.json({
      success: true,
      workflow,
      checklist
    });
  } catch (error) {
    console.error('Error fetching checklist:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch checklist',
      message: error.message
    });
  }
});

/**
 * POST /api/command-center/best-practices/recommendations
 * Generate skills.md recommendations
 */
router.post('/best-practices/recommendations', (req, res) => {
  try {
    const {
      teamComposition = 'solo',
      role = 'developer',
      expertiseLevel = 'intermediate'
    } = req.body;

    const userProfile = {
      teamComposition,
      role,
      expertiseLevel
    };

    const recommendations = bestPracticesService.generateSkillsRecommendations(userProfile);

    res.json({
      success: true,
      recommendations
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations',
      message: error.message
    });
  }
});

// ============================================================================
// CONTEXT OPTIMIZATION ROUTES
// ============================================================================

/**
 * POST /api/command-center/context/distill
 * Trigger context distillation (NOTE: Requires PAL to be configured)
 */
router.post('/context/distill', async (req, res) => {
  try {
    const {
      siteId,
      chatHistory,
      maxContextTokens = 100000,
      provider = 'anthropic',
      skillsDirectory = process.env.SKILLS_DIRECTORY || './data/skills'
    } = req.body;

    if (!siteId || !chatHistory) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: siteId, chatHistory'
      });
    }

    // Perform distillation
    const result = await contextOptimizationService.optimizeContext({
      siteId,
      chatHistory,
      maxContextTokens,
      provider,
      skillsDirectory
    });

    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error distilling context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to distill context',
      message: error.message
    });
  }
});

/**
 * GET /api/command-center/context/skills/:siteId
 * Get skills content for a site
 */
router.get('/context/skills/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { query = '' } = req.query;
    const skillsDirectory = process.env.SKILLS_DIRECTORY || './data/skills';

    const skillsContent = await contextOptimizationService.getRelevantSkills(
      siteId,
      query,
      skillsDirectory
    );

    res.json({
      success: true,
      siteId,
      content: skillsContent
    });
  } catch (error) {
    console.error('Error fetching skills:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch skills',
      message: error.message
    });
  }
});

/**
 * POST /api/command-center/context/estimate-tokens
 * Estimate token count for text
 */
router.post('/context/estimate-tokens', (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: text'
      });
    }

    const tokens = contextOptimizationService.estimateTokens(text);

    res.json({
      success: true,
      tokens,
      text_length: text.length
    });
  } catch (error) {
    console.error('Error estimating tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to estimate tokens',
      message: error.message
    });
  }
});

/**
 * POST /api/command-center/context/should-distill
 * Check if chat should be distilled
 */
router.post('/context/should-distill', (req, res) => {
  try {
    const { chatHistory, maxContextTokens = 100000 } = req.body;

    if (!chatHistory) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: chatHistory'
      });
    }

    const shouldDistill = contextOptimizationService.shouldDistill(
      chatHistory,
      maxContextTokens
    );

    const totalTokens = chatHistory.reduce((sum, msg) => {
      return sum + contextOptimizationService.estimateTokens(msg.content || '');
    }, 0);

    res.json({
      success: true,
      shouldDistill,
      totalTokens,
      maxContextTokens,
      percentUsed: (totalTokens / maxContextTokens) * 100
    });
  } catch (error) {
    console.error('Error checking distillation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check distillation',
      message: error.message
    });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * GET /api/command-center/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'command-center',
    version: '2.0',
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

module.exports = router;
