const TokenUsageTracker = require('../models/TokenUsageTracker');
const ProviderConfig = require('../models/ProviderConfig');
const logger = require('../utils/logger');

/**
 * TokenTrackingService
 * Manages token usage tracking, rate limit monitoring, and handoff triggers
 *
 * Thread-safe operations using atomic updates
 * Real-time rate limit tracking with API header parsing
 * Automatic warning and handoff trigger detection
 */
class TokenTrackingService {
  constructor() {
    this.warningThreshold = 90; // 90% usage triggers warning
    this.handoffThreshold = 95; // 95% usage triggers handoff
    this.costLimitDefault = 10.0; // Default $10 cost limit per session
  }

  /**
   * Track usage for a request
   * @param {string} sessionId - Session identifier
   * @param {string} provider - Provider name (anthropic, openai, etc.)
   * @param {number} inputTokens - Number of input tokens used
   * @param {number} outputTokens - Number of output tokens used
   * @param {number} cost - Cost of the request in USD
   * @param {number} latency - Request latency in milliseconds
   * @param {boolean} success - Whether the request was successful
   * @param {object} headers - Response headers from provider
   * @returns {Promise<object>} Updated tracker with status
   */
  async trackUsage(sessionId, provider, inputTokens, outputTokens, cost, latency = 0, success = true, headers = {}) {
    try {
      // Get provider config to determine max tokens
      const providerConfig = await ProviderConfig.findOne({
        provider,
        status: 'active',
        isDeleted: false
      });

      if (!providerConfig) {
        throw new Error(`Provider config not found for ${provider}`);
      }

      const model = providerConfig.modelId;
      const maxTokens = providerConfig.capabilities.contextWindow;

      // Get or create tracker
      const tracker = await TokenUsageTracker.getOrCreateTracker(
        sessionId,
        provider,
        model,
        maxTokens
      );

      // Record usage atomically
      await tracker.recordUsage(inputTokens, outputTokens, cost, latency, success);

      // Update rate limits if headers provided
      if (headers && Object.keys(headers).length > 0) {
        await tracker.updateRateLimits(headers);
      }

      // Check for warning threshold
      const isApproaching = tracker.checkApproachingLimit(this.warningThreshold);
      if (isApproaching && !tracker.handoffWarningIssued) {
        await tracker.issueWarning();
        logger.warn('Token usage warning', {
          sessionId,
          provider,
          usagePercentage: tracker.usagePercentage.toFixed(2),
          rateLimitPercentage: tracker.rateLimitPercentage.toFixed(2)
        });
      }

      // Check for handoff threshold
      const shouldHandoff = tracker.checkShouldTriggerHandoff(this.handoffThreshold);
      if (shouldHandoff && !tracker.handoffTriggered) {
        const reason = tracker.usagePercentage >= this.handoffThreshold
          ? 'CONTEXT_CAP'
          : 'RATE_LIMIT';

        await tracker.triggerHandoff(reason);
        logger.error('Handoff triggered', {
          sessionId,
          provider,
          reason,
          usagePercentage: tracker.usagePercentage.toFixed(2),
          rateLimitPercentage: tracker.rateLimitPercentage.toFixed(2)
        });
      }

      // Update provider config usage stats
      await providerConfig.recordUsage(inputTokens, outputTokens);

      return {
        success: true,
        tracker: tracker.toObject({ virtuals: true }),
        warning: isApproaching,
        handoffRequired: shouldHandoff
      };
    } catch (error) {
      logger.error('Error tracking token usage', {
        sessionId,
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get remaining capacity for a session
   * @param {string} sessionId - Session identifier
   * @param {string} provider - Provider name (optional)
   * @returns {Promise<object>} Remaining capacity information
   */
  async getRemainingCapacity(sessionId, provider = null) {
    try {
      const tracker = await TokenUsageTracker.findActiveBySession(sessionId, provider);

      if (!tracker) {
        return {
          available: true,
          message: 'No active tracking found for session',
          capacity: null
        };
      }

      const capacity = tracker.getRemainingCapacity();

      return {
        available: capacity.canContinue,
        capacity,
        tracker: {
          sessionId: tracker.sessionId,
          provider: tracker.provider,
          model: tracker.model,
          status: tracker.status
        }
      };
    } catch (error) {
      logger.error('Error getting remaining capacity', {
        sessionId,
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if session is approaching limit
   * @param {string} sessionId - Session identifier
   * @param {string} provider - Provider name (optional)
   * @param {number} threshold - Warning threshold percentage (default: 90)
   * @returns {Promise<object>} Warning status
   */
  async isApproachingLimit(sessionId, provider = null, threshold = null) {
    try {
      const warningThreshold = threshold || this.warningThreshold;
      const tracker = await TokenUsageTracker.findActiveBySession(sessionId, provider);

      if (!tracker) {
        return {
          approaching: false,
          message: 'No active tracking found for session'
        };
      }

      const isApproaching = tracker.checkApproachingLimit(warningThreshold);

      if (isApproaching && !tracker.handoffWarningIssued) {
        await tracker.issueWarning();
      }

      return {
        approaching: isApproaching,
        usagePercentage: tracker.usagePercentage,
        rateLimitPercentage: tracker.rateLimitPercentage,
        threshold: warningThreshold,
        details: {
          tokensUsed: tracker.tokensUsed,
          maxTokens: tracker.maxTokens,
          rateLimitRemaining: tracker.rateLimitRemaining,
          rateLimitTotal: tracker.rateLimitTotal,
          costAccumulated: tracker.costAccumulated,
          requestCount: tracker.requestCount
        }
      };
    } catch (error) {
      logger.error('Error checking if approaching limit', {
        sessionId,
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if handoff should be triggered
   * @param {string} sessionId - Session identifier
   * @param {string} provider - Provider name (optional)
   * @param {number} threshold - Handoff threshold percentage (default: 95)
   * @returns {Promise<object>} Handoff trigger status
   */
  async shouldTriggerHandoff(sessionId, provider = null, threshold = null) {
    try {
      const handoffThreshold = threshold || this.handoffThreshold;
      const tracker = await TokenUsageTracker.findActiveBySession(sessionId, provider);

      if (!tracker) {
        return {
          shouldTrigger: false,
          message: 'No active tracking found for session'
        };
      }

      const shouldTrigger = tracker.checkShouldTriggerHandoff(handoffThreshold);

      let reason = null;
      if (shouldTrigger) {
        if (tracker.usagePercentage >= handoffThreshold) {
          reason = 'CONTEXT_CAP';
        } else if (tracker.rateLimitPercentage >= handoffThreshold) {
          reason = 'RATE_LIMIT';
        } else if (tracker.costAccumulated >= this.costLimitDefault) {
          reason = 'COST_LIMIT';
        }

        if (!tracker.handoffTriggered) {
          await tracker.triggerHandoff(reason);
        }
      }

      return {
        shouldTrigger,
        reason,
        usagePercentage: tracker.usagePercentage,
        rateLimitPercentage: tracker.rateLimitPercentage,
        costAccumulated: tracker.costAccumulated,
        threshold: handoffThreshold,
        handoffTriggered: tracker.handoffTriggered,
        handoffTriggeredAt: tracker.handoffTriggeredAt,
        details: {
          tokensUsed: tracker.tokensUsed,
          maxTokens: tracker.maxTokens,
          rateLimitRemaining: tracker.rateLimitRemaining,
          rateLimitTotal: tracker.rateLimitTotal,
          requestCount: tracker.requestCount,
          successRate: tracker.successRate
        }
      };
    } catch (error) {
      logger.error('Error checking if should trigger handoff', {
        sessionId,
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Reset session tracking
   * @param {string} sessionId - Session identifier
   * @param {string} provider - Provider name (optional)
   * @returns {Promise<object>} Reset status
   */
  async resetSession(sessionId, provider = null) {
    try {
      const query = { sessionId };
      if (provider) {
        query.provider = provider;
      }

      const trackers = await TokenUsageTracker.find(query);

      if (trackers.length === 0) {
        return {
          success: true,
          message: 'No trackers found to reset',
          resetCount: 0
        };
      }

      // Complete all active sessions
      const resetPromises = trackers.map(tracker => {
        if (tracker.status !== 'completed') {
          return tracker.completeSession();
        }
        return Promise.resolve(tracker);
      });

      await Promise.all(resetPromises);

      logger.info('Session tracking reset', {
        sessionId,
        provider,
        resetCount: trackers.length
      });

      return {
        success: true,
        message: `Reset ${trackers.length} tracker(s)`,
        resetCount: trackers.length
      };
    } catch (error) {
      logger.error('Error resetting session', {
        sessionId,
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Parse rate limit headers from provider response
   * @param {object} headers - HTTP response headers
   * @param {string} provider - Provider name
   * @returns {object} Parsed rate limit information
   */
  parseRateLimitHeaders(headers, provider) {
    const rateLimitInfo = {
      remaining: null,
      limit: null,
      reset: null,
      tokensRemaining: null,
      tokensLimit: null
    };

    if (!headers) return rateLimitInfo;

    // Normalize header keys to lowercase
    const normalizedHeaders = {};
    Object.keys(headers).forEach(key => {
      normalizedHeaders[key.toLowerCase()] = headers[key];
    });

    switch (provider) {
      case 'anthropic':
        rateLimitInfo.remaining = this._parseIntHeader(
          normalizedHeaders['anthropic-ratelimit-requests-remaining']
        );
        rateLimitInfo.limit = this._parseIntHeader(
          normalizedHeaders['anthropic-ratelimit-requests-limit']
        );
        rateLimitInfo.reset = this._parseDateHeader(
          normalizedHeaders['anthropic-ratelimit-requests-reset']
        );
        rateLimitInfo.tokensRemaining = this._parseIntHeader(
          normalizedHeaders['anthropic-ratelimit-tokens-remaining']
        );
        rateLimitInfo.tokensLimit = this._parseIntHeader(
          normalizedHeaders['anthropic-ratelimit-tokens-limit']
        );
        break;

      case 'openai':
        rateLimitInfo.remaining = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-remaining-requests']
        );
        rateLimitInfo.limit = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-limit-requests']
        );
        rateLimitInfo.reset = this._parseDateHeader(
          normalizedHeaders['x-ratelimit-reset-requests']
        );
        rateLimitInfo.tokensRemaining = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-remaining-tokens']
        );
        rateLimitInfo.tokensLimit = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-limit-tokens']
        );
        break;

      case 'gemini':
        // Google uses different header format
        rateLimitInfo.remaining = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-remaining']
        );
        rateLimitInfo.limit = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-limit']
        );
        rateLimitInfo.reset = this._parseDateHeader(
          normalizedHeaders['x-ratelimit-reset']
        );
        break;

      default:
        // Generic rate limit headers
        rateLimitInfo.remaining = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-remaining']
        );
        rateLimitInfo.limit = this._parseIntHeader(
          normalizedHeaders['x-ratelimit-limit']
        );
        rateLimitInfo.reset = this._parseDateHeader(
          normalizedHeaders['x-ratelimit-reset']
        );
    }

    return rateLimitInfo;
  }

  /**
   * Get session analytics
   * @param {string} sessionId - Session identifier
   * @returns {Promise<object>} Session analytics
   */
  async getSessionAnalytics(sessionId) {
    try {
      const analytics = await TokenUsageTracker.getSessionAnalytics(sessionId);

      if (!analytics) {
        return {
          found: false,
          message: 'No tracking data found for session'
        };
      }

      return {
        found: true,
        sessionId,
        analytics
      };
    } catch (error) {
      logger.error('Error getting session analytics', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all sessions requiring handoff
   * @returns {Promise<Array>} List of sessions requiring handoff
   */
  async getSessionsRequiringHandoff() {
    try {
      const trackers = await TokenUsageTracker.findRequiringHandoff();

      return trackers.map(tracker => ({
        sessionId: tracker.sessionId,
        provider: tracker.provider,
        model: tracker.model,
        reason: tracker.handoffReason,
        triggeredAt: tracker.handoffTriggeredAt,
        usagePercentage: tracker.usagePercentage,
        rateLimitPercentage: tracker.rateLimitPercentage,
        costAccumulated: tracker.costAccumulated,
        requestCount: tracker.requestCount
      }));
    } catch (error) {
      logger.error('Error getting sessions requiring handoff', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Cleanup old completed sessions
   * @param {number} daysOld - Number of days old to clean up (default: 30)
   * @returns {Promise<object>} Cleanup result
   */
  async cleanupOldSessions(daysOld = 30) {
    try {
      const deletedCount = await TokenUsageTracker.cleanupOldSessions(daysOld);

      logger.info('Cleaned up old token tracking sessions', {
        daysOld,
        deletedCount
      });

      return {
        success: true,
        deletedCount,
        daysOld
      };
    } catch (error) {
      logger.error('Error cleaning up old sessions', {
        daysOld,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate cost for token usage
   * @param {string} provider - Provider name
   * @param {number} inputTokens - Number of input tokens
   * @param {number} outputTokens - Number of output tokens
   * @returns {Promise<number>} Cost in USD
   */
  async calculateCost(provider, inputTokens, outputTokens) {
    try {
      const providerConfig = await ProviderConfig.findOne({
        provider,
        status: 'active',
        isDeleted: false
      });

      if (!providerConfig) {
        throw new Error(`Provider config not found for ${provider}`);
      }

      const inputCost = (inputTokens / 1000000) * providerConfig.pricing.inputTokenCost;
      const outputCost = (outputTokens / 1000000) * providerConfig.pricing.outputTokenCost;

      return inputCost + outputCost;
    } catch (error) {
      logger.error('Error calculating cost', {
        provider,
        inputTokens,
        outputTokens,
        error: error.message
      });
      throw error;
    }
  }

  // Private helper methods

  _parseIntHeader(value) {
    if (value === undefined || value === null) return null;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  _parseDateHeader(value) {
    if (value === undefined || value === null) return null;

    // Handle Unix timestamp (number or string)
    const timestamp = parseInt(value, 10);
    if (!isNaN(timestamp)) {
      return new Date(timestamp * 1000);
    }

    // Handle ISO date string
    try {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
}

// Export singleton instance
module.exports = new TokenTrackingService();
