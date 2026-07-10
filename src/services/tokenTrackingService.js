// services/tokenTrackingService.js
const mongoose = require('mongoose');
const TokenUsageLog = require('../models/TokenUsageLog');
const monolithClient = require('../clients/monolithApiClient');
const logger = require('../utils/logger');

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

    // Update site metrics via monolith API
    if (siteId) {
      try {
        await monolithClient.incrementSiteMetrics(siteId, {
          'metrics.totalTokensUsed': totalTokens,
          'metrics.totalRequests': 1,
          'tokenConfig.budgetUsed': totalTokens,
          'metrics.lastActivityAt': new Date()
        });
      } catch (error) {
        logger.error('Failed to update site metrics', { siteId, error: error.message });
        // Don't throw - metrics update failure shouldn't break token logging
      }
    }

    // Update company metrics (if exists)
    if (companyId) {
      try {
        await monolithClient.incrementCompanyTokens(companyId, totalTokens);
      } catch (error) {
        logger.error('Failed to update company tokens', { companyId, error: error.message });
        // Don't throw - metrics update failure shouldn't break token logging
      }
    }

    // Trigger milestone checks after token usage
    if (siteId) {
      try {
        await monolithClient.checkMilestones(siteId);
      } catch (error) {
        logger.error('Failed to check milestones', { siteId, error: error.message });
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
    const site = await monolithClient.getSite(siteId);

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
