const mongoose = require('mongoose');

/**
 * TokenUsageTracker Model
 * Tracks token usage, rate limits, and cost accumulation for LLM provider sessions
 *
 * Thread-safe token tracking with atomic operations for concurrent request handling
 * Supports real-time rate limit monitoring and handoff trigger detection
 */

const tokenUsageTrackerSchema = new mongoose.Schema({
  // Session Identification
  sessionId: {
    type: String,
    required: [true, 'Session ID is required'],
    index: true,
    trim: true
  },

  // ZDR-E3-S1: Tenant isolation — required companyId (G6)
  companyId: {
    type: String,
    index: true,
    trim: true,
    description: 'Tenant identifier for cross-tenant isolation (ZDR guarantee G6)'
  },

  // Provider Information
  provider: {
    type: String,
    required: [true, 'Provider name is required'],
    enum: {
      values: ['anthropic', 'openai', 'gemini', 'opensource'],
      message: '{VALUE} is not a supported provider'
    },
    index: true
  },

  model: {
    type: String,
    required: [true, 'Model name is required'],
    trim: true,
    index: true
  },

  // Token Tracking
  tokensUsed: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Tokens used cannot be negative']
  },

  maxTokens: {
    type: Number,
    required: [true, 'Max tokens is required'],
    min: [1, 'Max tokens must be at least 1']
  },

  inputTokens: {
    type: Number,
    default: 0,
    min: [0, 'Input tokens cannot be negative']
  },

  outputTokens: {
    type: Number,
    default: 0,
    min: [0, 'Output tokens cannot be negative']
  },

  // Rate Limit Tracking
  rateLimitRemaining: {
    type: Number,
    default: null,
    min: 0,
    description: 'Remaining requests in current rate limit window'
  },

  rateLimitReset: {
    type: Date,
    default: null,
    description: 'When the rate limit window resets'
  },

  rateLimitTotal: {
    type: Number,
    default: null,
    min: 0,
    description: 'Total requests allowed in rate limit window'
  },

  tokensPerMinute: {
    type: Number,
    default: null,
    min: 0,
    description: 'Token rate limit per minute'
  },

  tokensPerMinuteRemaining: {
    type: Number,
    default: null,
    min: 0,
    description: 'Remaining tokens in current TPM window'
  },

  // Cost Tracking
  costAccumulated: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Cost cannot be negative'],
    description: 'Total cost accumulated in USD'
  },

  inputCost: {
    type: Number,
    default: 0,
    min: [0, 'Input cost cannot be negative']
  },

  outputCost: {
    type: Number,
    default: 0,
    min: [0, 'Output cost cannot be negative']
  },

  // Request Tracking
  requestCount: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Request count cannot be negative']
  },

  successfulRequests: {
    type: Number,
    default: 0,
    min: [0, 'Successful requests cannot be negative']
  },

  failedRequests: {
    type: Number,
    default: 0,
    min: [0, 'Failed requests cannot be negative']
  },

  // Performance Metrics
  averageLatency: {
    type: Number,
    default: 0,
    min: [0, 'Average latency cannot be negative'],
    description: 'Average response time in milliseconds'
  },

  totalLatency: {
    type: Number,
    default: 0,
    min: [0, 'Total latency cannot be negative']
  },

  // Handoff Triggers
  handoffWarningIssued: {
    type: Boolean,
    default: false,
    description: 'Warning issued at 90% capacity'
  },

  handoffTriggered: {
    type: Boolean,
    default: false,
    description: 'Handoff triggered at 95% capacity'
  },

  handoffReason: {
    type: String,
    enum: ['CONTEXT_CAP', 'RATE_LIMIT', 'COST_LIMIT', 'ERROR_THRESHOLD', 'MANUAL', null],
    default: null
  },

  handoffTriggeredAt: {
    type: Date,
    default: null
  },

  // Session Window
  windowStart: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },

  windowEnd: {
    type: Date,
    default: null
  },

  // Status
  status: {
    type: String,
    enum: {
      values: ['active', 'warning', 'critical', 'completed', 'handoff_required'],
      message: '{VALUE} is not a valid status'
    },
    default: 'active',
    index: true
  },

  // Metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Rate Limit Headers (last known values)
  lastRateLimitHeaders: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
    description: 'Last known rate limit headers from provider'
  },

  // Timing
  lastUpdated: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'token_usage_trackers'
});

// Compound Indexes for efficient queries
tokenUsageTrackerSchema.index({ sessionId: 1, provider: 1 });
tokenUsageTrackerSchema.index({ sessionId: 1, status: 1 });
tokenUsageTrackerSchema.index({ companyId: 1, sessionId: 1 }); // ZDR-E3-S1: tenant-scoped lookups
tokenUsageTrackerSchema.index({ provider: 1, status: 1, lastUpdated: -1 });
tokenUsageTrackerSchema.index({ status: 1, handoffTriggered: 1 });
tokenUsageTrackerSchema.index({ windowStart: 1, windowEnd: 1 });

// Sparse indexes
tokenUsageTrackerSchema.index({ handoffTriggeredAt: 1 }, { sparse: true });
tokenUsageTrackerSchema.index({ rateLimitReset: 1 }, { sparse: true });

// Virtual: Usage Percentage
tokenUsageTrackerSchema.virtual('usagePercentage').get(function() {
  if (!this.maxTokens || this.maxTokens === 0) return 0;
  return (this.tokensUsed / this.maxTokens) * 100;
});

// Virtual: Rate Limit Percentage
tokenUsageTrackerSchema.virtual('rateLimitPercentage').get(function() {
  if (!this.rateLimitTotal || this.rateLimitTotal === 0) return 0;
  if (this.rateLimitRemaining === null) return 0;

  const used = this.rateLimitTotal - this.rateLimitRemaining;
  return (used / this.rateLimitTotal) * 100;
});

// Virtual: Cost per Request
tokenUsageTrackerSchema.virtual('costPerRequest').get(function() {
  if (this.requestCount === 0) return 0;
  return this.costAccumulated / this.requestCount;
});

// Virtual: Average Tokens per Request
tokenUsageTrackerSchema.virtual('averageTokensPerRequest').get(function() {
  if (this.requestCount === 0) return 0;
  return this.tokensUsed / this.requestCount;
});

// Virtual: Success Rate
tokenUsageTrackerSchema.virtual('successRate').get(function() {
  if (this.requestCount === 0) return 0;
  return (this.successfulRequests / this.requestCount) * 100;
});

// Virtual: Is Approaching Limit (90%)
tokenUsageTrackerSchema.virtual('isApproachingLimit').get(function() {
  return this.usagePercentage >= 90 || this.rateLimitPercentage >= 90;
});

// Virtual: Should Trigger Handoff (95%)
tokenUsageTrackerSchema.virtual('shouldTriggerHandoff').get(function() {
  return this.usagePercentage >= 95 || this.rateLimitPercentage >= 95;
});

// Pre-save middleware
tokenUsageTrackerSchema.pre('save', function(next) {
  this.lastUpdated = new Date();

  // Update status based on usage
  if (this.handoffTriggered) {
    this.status = 'handoff_required';
  } else if (this.usagePercentage >= 95 || this.rateLimitPercentage >= 95) {
    this.status = 'critical';
  } else if (this.usagePercentage >= 90 || this.rateLimitPercentage >= 90) {
    this.status = 'warning';
  } else if (this.windowEnd) {
    this.status = 'completed';
  } else {
    this.status = 'active';
  }

  next();
});

// Instance Methods

/**
 * Record token usage (thread-safe atomic operation)
 */
tokenUsageTrackerSchema.methods.recordUsage = async function(inputTokens, outputTokens, cost, latency = 0, success = true) {
  const totalTokens = inputTokens + outputTokens;

  // Use atomic operations for thread safety
  const update = {
    $inc: {
      tokensUsed: totalTokens,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      costAccumulated: cost,
      inputCost: cost * (inputTokens / (inputTokens + outputTokens || 1)),
      outputCost: cost * (outputTokens / (inputTokens + outputTokens || 1)),
      requestCount: 1,
      successfulRequests: success ? 1 : 0,
      failedRequests: success ? 0 : 1,
      totalLatency: latency
    },
    $set: {
      lastUpdated: new Date(),
      averageLatency: this.requestCount > 0
        ? (this.totalLatency + latency) / (this.requestCount + 1)
        : latency
    }
  };

  const updated = await this.constructor.findByIdAndUpdate(
    this._id,
    update,
    { new: true }
  );

  // Copy updated values back to this instance
  Object.assign(this, updated.toObject());

  return this;
};

/**
 * Update rate limit information from API headers
 */
tokenUsageTrackerSchema.methods.updateRateLimits = async function(headers) {
  const update = {
    $set: {
      lastUpdated: new Date(),
      lastRateLimitHeaders: headers
    }
  };

  // Parse common rate limit headers
  if (headers['x-ratelimit-remaining'] !== undefined) {
    update.$set.rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10);
  }

  if (headers['x-ratelimit-limit'] !== undefined) {
    update.$set.rateLimitTotal = parseInt(headers['x-ratelimit-limit'], 10);
  }

  if (headers['x-ratelimit-reset']) {
    // Handle both Unix timestamp and ISO date formats
    const resetValue = headers['x-ratelimit-reset'];
    const timestamp = parseInt(resetValue, 10);
    if (!isNaN(timestamp)) {
      update.$set.rateLimitReset = new Date(timestamp * 1000);
    } else {
      const date = new Date(resetValue);
      if (!isNaN(date.getTime())) {
        update.$set.rateLimitReset = date;
      }
    }
  }

  // Anthropic-specific headers
  if (headers['anthropic-ratelimit-requests-remaining'] !== undefined) {
    update.$set.rateLimitRemaining = parseInt(headers['anthropic-ratelimit-requests-remaining'], 10);
  }

  if (headers['anthropic-ratelimit-requests-limit'] !== undefined) {
    update.$set.rateLimitTotal = parseInt(headers['anthropic-ratelimit-requests-limit'], 10);
  }

  if (headers['anthropic-ratelimit-tokens-remaining'] !== undefined) {
    update.$set.tokensPerMinuteRemaining = parseInt(headers['anthropic-ratelimit-tokens-remaining'], 10);
  }

  if (headers['anthropic-ratelimit-tokens-limit'] !== undefined) {
    update.$set.tokensPerMinute = parseInt(headers['anthropic-ratelimit-tokens-limit'], 10);
  }

  // OpenAI-specific headers
  if (headers['x-ratelimit-remaining-tokens']) {
    update.$set.tokensPerMinuteRemaining = parseInt(headers['x-ratelimit-remaining-tokens'], 10);
  }

  const updated = await this.constructor.findByIdAndUpdate(
    this._id,
    update,
    { new: true }
  );

  Object.assign(this, updated.toObject());

  return this;
};

/**
 * Check if approaching limit (90% threshold)
 */
tokenUsageTrackerSchema.methods.checkApproachingLimit = function(threshold = 90) {
  const usagePercent = this.usagePercentage;
  const rateLimitPercent = this.rateLimitPercentage;

  return usagePercent >= threshold || rateLimitPercent >= threshold;
};

/**
 * Check if should trigger handoff (95% threshold)
 */
tokenUsageTrackerSchema.methods.checkShouldTriggerHandoff = function(threshold = 95) {
  const usagePercent = this.usagePercentage;
  const rateLimitPercent = this.rateLimitPercentage;

  return usagePercent >= threshold || rateLimitPercent >= threshold;
};

/**
 * Issue warning for approaching limit
 */
tokenUsageTrackerSchema.methods.issueWarning = async function() {
  if (this.handoffWarningIssued) return this;

  const updated = await this.constructor.findByIdAndUpdate(
    this._id,
    {
      $set: {
        handoffWarningIssued: true,
        status: 'warning',
        lastUpdated: new Date()
      }
    },
    { new: true }
  );

  Object.assign(this, updated.toObject());

  return this;
};

/**
 * Trigger handoff
 */
tokenUsageTrackerSchema.methods.triggerHandoff = async function(reason = 'CONTEXT_CAP') {
  if (this.handoffTriggered) return this;

  const updated = await this.constructor.findByIdAndUpdate(
    this._id,
    {
      $set: {
        handoffTriggered: true,
        handoffReason: reason,
        handoffTriggeredAt: new Date(),
        status: 'handoff_required',
        lastUpdated: new Date()
      }
    },
    { new: true }
  );

  Object.assign(this, updated.toObject());

  return this;
};

/**
 * Complete session
 */
tokenUsageTrackerSchema.methods.completeSession = async function() {
  const updated = await this.constructor.findByIdAndUpdate(
    this._id,
    {
      $set: {
        windowEnd: new Date(),
        status: 'completed',
        lastUpdated: new Date()
      }
    },
    { new: true }
  );

  Object.assign(this, updated.toObject());

  return this;
};

/**
 * Get remaining capacity
 */
tokenUsageTrackerSchema.methods.getRemainingCapacity = function() {
  return {
    tokensRemaining: Math.max(0, this.maxTokens - this.tokensUsed),
    tokensRemainingPercentage: Math.max(0, 100 - this.usagePercentage),
    rateLimitRemaining: this.rateLimitRemaining,
    rateLimitRemainingPercentage: this.rateLimitRemaining && this.rateLimitTotal
      ? (this.rateLimitRemaining / this.rateLimitTotal) * 100
      : null,
    rateLimitResetIn: this.rateLimitReset
      ? Math.max(0, this.rateLimitReset - Date.now())
      : null,
    status: this.status,
    canContinue: this.status === 'active' || this.status === 'warning'
  };
};

// Static Methods

/**
 * Create or get tracker for session (ZDR-E3-S1: scoped by companyId)
 */
tokenUsageTrackerSchema.statics.getOrCreateTracker = async function(sessionId, provider, model, maxTokens, companyId = null) {
  const query = {
    sessionId,
    provider,
    status: { $in: ['active', 'warning', 'critical'] }
  };
  if (companyId) query.companyId = companyId;

  let tracker = await this.findOne(query);

  if (!tracker) {
    tracker = new this({
      sessionId,
      provider,
      model,
      maxTokens,
      companyId,
      tokensUsed: 0,
      costAccumulated: 0,
      requestCount: 0
    });
    await tracker.save();
  }

  return tracker;
};

/**
 * Find active tracker by session (ZDR-E3-S1: scoped by companyId)
 */
tokenUsageTrackerSchema.statics.findActiveBySession = async function(sessionId, provider = null, companyId = null) {
  const query = {
    sessionId,
    status: { $in: ['active', 'warning', 'critical'] }
  };

  if (provider) {
    query.provider = provider;
  }
  if (companyId) {
    query.companyId = companyId;
  }

  return this.findOne(query).sort({ lastUpdated: -1 });
};

/**
 * Find all trackers requiring handoff
 */
tokenUsageTrackerSchema.statics.findRequiringHandoff = async function() {
  return this.find({
    handoffTriggered: true,
    status: 'handoff_required'
  }).sort({ handoffTriggeredAt: 1 });
};

/**
 * Get session analytics
 */
tokenUsageTrackerSchema.statics.getSessionAnalytics = async function(sessionId) {
  const trackers = await this.find({ sessionId });

  if (trackers.length === 0) {
    return null;
  }

  const analytics = trackers.reduce((acc, tracker) => {
    acc.totalTokens += tracker.tokensUsed;
    acc.totalCost += tracker.costAccumulated;
    acc.totalRequests += tracker.requestCount;
    acc.totalLatency += tracker.totalLatency;
    acc.providers[tracker.provider] = {
      tokens: tracker.tokensUsed,
      cost: tracker.costAccumulated,
      requests: tracker.requestCount
    };
    return acc;
  }, {
    totalTokens: 0,
    totalCost: 0,
    totalRequests: 0,
    totalLatency: 0,
    providers: {}
  });

  analytics.averageLatency = analytics.totalRequests > 0
    ? analytics.totalLatency / analytics.totalRequests
    : 0;
  analytics.averageCostPerRequest = analytics.totalRequests > 0
    ? analytics.totalCost / analytics.totalRequests
    : 0;

  return analytics;
};

/**
 * Cleanup completed sessions older than specified days
 */
tokenUsageTrackerSchema.statics.cleanupOldSessions = async function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

  const result = await this.deleteMany({
    status: 'completed',
    windowEnd: { $lt: cutoffDate }
  });

  return result.deletedCount;
};

module.exports = mongoose.model('TokenUsageTracker', tokenUsageTrackerSchema);
