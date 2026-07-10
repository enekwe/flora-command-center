const mongoose = require('mongoose');

const TokenUsageLogSchema = new mongoose.Schema({
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    required: [true, 'Site ID is required'],
    index: true
  },

  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudioCompany',
    required: [true, 'Company ID is required'],
    index: true
  },

  platformIntegrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlatformIntegration',
    index: true
  },

  provider: {
    type: String,
    required: [true, 'Provider is required'],
    enum: {
      values: ['openai', 'anthropic', 'azure_openai'],
      message: '{VALUE} is not a valid provider'
    },
    index: true
  },

  model: {
    type: String,
    required: [true, 'Model is required'],
    index: true
  },

  usage: {
    promptTokens: {
      type: Number,
      required: [true, 'Prompt tokens is required'],
      min: [0, 'Prompt tokens must be non-negative']
    },
    completionTokens: {
      type: Number,
      required: [true, 'Completion tokens is required'],
      min: [0, 'Completion tokens must be non-negative']
    },
    totalTokens: {
      type: Number,
      required: [true, 'Total tokens is required'],
      min: [0, 'Total tokens must be non-negative']
    }
  },

  cost: {
    type: Number,
    required: [true, 'Cost is required'],
    min: [0, 'Cost must be non-negative']
  },

  requestType: {
    type: String,
    enum: {
      values: ['code_generation', 'chat', 'analysis', 'image', 'other'],
      message: '{VALUE} is not a valid request type'
    }
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  collection: 'token_usage_logs'
});

// Indexes for analytics queries
TokenUsageLogSchema.index({ companyId: 1, createdAt: -1 });
TokenUsageLogSchema.index({ siteId: 1, createdAt: -1 });
TokenUsageLogSchema.index({ createdAt: -1 });
TokenUsageLogSchema.index({ provider: 1, model: 1, createdAt: -1 });

// Static method: Get usage by site for date range
TokenUsageLogSchema.statics.getUsageBySite = function(siteId, startDate, endDate) {
  const query = { siteId };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = startDate;
    if (endDate) query.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$requestType',
        totalTokens: { $sum: '$usage.totalTokens' },
        count: { $sum: 1 }
      }
    }
  ]);
};

// Static method: Get usage by company for date range
TokenUsageLogSchema.statics.getUsageByCompany = function(companyId, startDate, endDate) {
  const query = { companyId };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = startDate;
    if (endDate) query.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$siteId',
        totalTokens: { $sum: '$usage.totalTokens' },
        count: { $sum: 1 }
      }
    }
  ]);
};

const TokenUsageLog = mongoose.model('TokenUsageLog', TokenUsageLogSchema);

module.exports = TokenUsageLog;
