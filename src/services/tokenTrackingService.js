// services/tokenTrackingService.js
const mongoose = require('mongoose');
const TokenUsageLog = require('../models/TokenUsageLog');
const logger = require('../utils/logger');

// Site, StudioCompany, and milestoneService are handled by the main app
// This microservice focuses on token tracking only

class TokenTrackingService {
  /**
   * Log token usage for an AI request
   */
  async logTokenUsage({
    companyId,
    siteId,
    platformIntegrationId,
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    requestType,
    metadata
  }) {
    const log = new TokenUsageLog({
      companyId,
      siteId,
      platformIntegrationId,
      provider,
      model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens
      },
      cost,
      requestType,
      metadata
    });

    await log.save();

    // Update site metrics
    if (siteId) {
      await Site.findByIdAndUpdate(siteId, {
        $inc: {
          'metrics.totalTokensUsed': totalTokens,
          'metrics.totalRequests': 1,
          'tokenConfig.budgetUsed': totalTokens
        },
        'metrics.lastActivityAt': new Date()
      });
    }

    // Update company metrics (if exists)
    if (companyId) {
      await StudioCompany.findByIdAndUpdate(companyId, {
        $inc: {
          'tokenBudget.usedTokens': totalTokens
        }
      });
    }

    // Trigger milestone checks after token usage
    if (siteId) {
      try {
        await milestoneService.updateMilestones(siteId);
      } catch (error) {
        logger.error('Failed to update milestones', { siteId, error: error.message });
        // Don't throw - milestone check failure shouldn't break token logging
      }
    }

    logger.info('Token usage logged', {
      companyId,
      siteId,
      totalTokens,
      provider,
      model
    });

    return log;
  }

  /**
   * Get aggregated usage for platform
   */
  async getPlatformUsage(startDate, endDate) {
    const pipeline = [
      {
        $match: {
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$usage.totalTokens' },
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' },
          avgTokensPerRequest: { $avg: '$usage.totalTokens' }
        }
      }
    ];

    const result = await TokenUsageLog.aggregate(pipeline);
    return result[0] || { totalTokens: 0, totalRequests: 0, totalCost: 0 };
  }

  /**
   * Get aggregated usage by company
   */
  async getCompanyUsage(companyId, startDate, endDate) {
    const pipeline = [
      {
        $match: {
          companyId: mongoose.Types.ObjectId(companyId),
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      {
        $group: {
          _id: '$siteId',
          totalTokens: { $sum: '$usage.totalTokens' },
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' }
        }
      }
    ];

    return await TokenUsageLog.aggregate(pipeline);
  }

  /**
   * Get usage breakdown by provider/model
   */
  async getUsageBreakdown(companyId, siteId, startDate, endDate) {
    const match = {
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    };

    if (companyId) match.companyId = mongoose.Types.ObjectId(companyId);
    if (siteId) match.siteId = mongoose.Types.ObjectId(siteId);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { provider: '$provider', model: '$model' },
          totalTokens: { $sum: '$usage.totalTokens' },
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' }
        }
      }
    ];

    return await TokenUsageLog.aggregate(pipeline);
  }

  /**
   * Check if budget exceeded
   */
  async checkBudgetStatus(siteId) {
    const site = await Site.findById(siteId);

    if (!site) {
      throw new Error('Site not found');
    }

    const { mode, budgetAllocated, budgetUsed, budgetWarningThreshold } = site.tokenConfig;

    if (mode === 'site_byok' || mode === 'company_byok') {
      return { exceeded: false, warning: false }; // BYOK has no budget limit
    }

    const percentUsed = (budgetUsed / budgetAllocated) * 100;

    return {
      exceeded: budgetUsed >= budgetAllocated,
      warning: percentUsed >= budgetWarningThreshold,
      percentUsed,
      remaining: budgetAllocated - budgetUsed
    };
  }
}

module.exports = new TokenTrackingService();
