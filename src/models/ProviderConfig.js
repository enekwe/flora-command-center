const mongoose = require('mongoose');

/**
 * ProviderConfig Model
 * Stores LLM provider configurations for the Provider Abstraction Layer (PAL)
 *
 * Supports multiple LLM providers:
 * - Anthropic Claude (claude-3-opus, claude-3-sonnet, claude-3-haiku)
 * - OpenAI GPT (gpt-4, gpt-3.5-turbo)
 * - Google Gemini (gemini-pro, gemini-pro-vision)
 * - Open Source (local models via API)
 */

const providerConfigSchema = new mongoose.Schema({
  // Provider Identity
  provider: {
    type: String,
    required: [true, 'Provider name is required'],
    enum: {
      values: ['anthropic', 'openai', 'gemini', 'opensource', 'deepseek', 'qwen', 'glm', 'sambanova', 'self_hosted'],
      message: '{VALUE} is not a supported provider'
    },
    index: true
  },

  // Model Configuration
  modelId: {
    type: String,
    required: [true, 'Model ID is required'],
    trim: true,
    index: true
  },

  modelName: {
    type: String,
    required: [true, 'Model name is required'],
    trim: true
  },

  // API Configuration
  apiConfig: {
    endpoint: {
      type: String,
      trim: true
    },
    apiKey: {
      type: String,
      select: false, // Never return in queries for security
      required: function() {
        return this.provider !== 'opensource';
      }
    },
    organization: {
      type: String, // For OpenAI organization ID
      trim: true
    },
    projectId: {
      type: String, // For Google Cloud project ID
      trim: true
    },
    version: {
      type: String, // API version
      trim: true,
      default: 'latest'
    }
  },

  // Model Capabilities
  capabilities: {
    maxTokens: {
      type: Number,
      required: true,
      min: [1, 'Max tokens must be at least 1']
    },
    supportsVision: {
      type: Boolean,
      default: false
    },
    supportsStreaming: {
      type: Boolean,
      default: true
    },
    supportsFunctionCalling: {
      type: Boolean,
      default: false
    },
    supportsSystemPrompt: {
      type: Boolean,
      default: true
    },
    contextWindow: {
      type: Number,
      required: true,
      min: [1, 'Context window must be at least 1']
    },
    contextWindowSize: {
      type: Number,
      description: 'Context window size in tokens (alias for contextWindow)',
      get: function() { return this.contextWindow; },
      set: function(v) { this.contextWindow = v; }
    }
  },

  // Cost Configuration
  pricing: {
    inputTokenCost: {
      type: Number,
      required: true,
      min: [0, 'Input token cost cannot be negative'],
      description: 'Cost per 1M input tokens in USD'
    },
    outputTokenCost: {
      type: Number,
      required: true,
      min: [0, 'Output token cost cannot be negative'],
      description: 'Cost per 1M output tokens in USD'
    },
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP']
    },
    costPerMillionTokens: {
      type: Number,
      description: 'Average cost per 1M tokens (calculated from input/output costs)',
      get: function() {
        // Average of input and output costs
        return (this.inputTokenCost + this.outputTokenCost) / 2;
      }
    }
  },

  // Default Parameters
  defaultParameters: {
    temperature: {
      type: Number,
      default: 1.0,
      min: [0, 'Temperature must be at least 0'],
      max: [2, 'Temperature must be at most 2']
    },
    topP: {
      type: Number,
      default: 1.0,
      min: [0, 'Top P must be at least 0'],
      max: [1, 'Top P must be at most 1']
    },
    maxOutputTokens: {
      type: Number,
      default: 4096,
      min: [1, 'Max output tokens must be at least 1']
    },
    stopSequences: [{
      type: String
    }]
  },

  // Provider-Specific Configuration
  providerSpecificConfig: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ZDR-E0-S3: Trust Tier for Egress Control (Guarantee G5)
  trustTier: {
    type: String,
    enum: {
      values: ['self_hosted', 'zdr_contracted', 'standard_hosted'],
      message: '{VALUE} is not a valid trust tier'
    },
    default: 'standard_hosted',
    required: true,
    index: true,
    description: 'Provider trust tier for ZDR egress control: self_hosted (in-perimeter), zdr_contracted (contractual zero-retention), standard_hosted (public cloud)'
  },

  // Data Residency Zone
  residencyZone: {
    type: String,
    enum: {
      values: ['customer_perimeter', 'flora_perimeter', 'us_east', 'us_west', 'eu_west', 'ap_southeast', 'china', 'sambanova_us'],
      message: '{VALUE} is not a valid residency zone'
    },
    default: 'flora_perimeter',
    description: 'Where provider actually runs (customer perimeter vs cloud region). ' +
      '"sambanova_us" is a distinct zone (not a generic AWS region) because SambaNova is a ' +
      'zdr_contracted third party running on their own US-based RDU infrastructure, not ' +
      'Flora-owned cloud capacity.'
  },

  // Status and Control
  status: {
    type: String,
    enum: {
      values: ['active', 'inactive', 'deprecated', 'testing'],
      message: '{VALUE} is not a valid status'
    },
    default: 'active',
    index: true
  },

  // Priority for provider selection
  priority: {
    type: Number,
    default: 50,
    min: [0, 'Priority must be at least 0'],
    max: [100, 'Priority must be at most 100'],
    description: 'Higher priority = preferred provider for tasks'
  },

  // Rate Limiting
  rateLimits: {
    requestsPerMinute: {
      type: Number,
      default: 60,
      min: [1, 'RPM must be at least 1']
    },
    tokensPerMinute: {
      type: Number,
      default: 100000,
      min: [1, 'TPM must be at least 1']
    },
    concurrentRequests: {
      type: Number,
      default: 5,
      min: [1, 'Concurrent requests must be at least 1']
    }
  },

  // Health Monitoring
  health: {
    lastHealthCheck: {
      type: Date,
      default: Date.now
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
      min: [0, 'Consecutive failures cannot be negative']
    },
    lastFailure: {
      type: Date
    },
    lastFailureReason: {
      type: String
    },
    averageLatency: {
      type: Number,
      default: 0,
      min: [0, 'Average latency cannot be negative'],
      description: 'Average response time in milliseconds'
    }
  },

  // Usage Statistics
  usage: {
    totalRequests: {
      type: Number,
      default: 0,
      min: [0, 'Total requests cannot be negative']
    },
    totalInputTokens: {
      type: Number,
      default: 0,
      min: [0, 'Total input tokens cannot be negative']
    },
    totalOutputTokens: {
      type: Number,
      default: 0,
      min: [0, 'Total output tokens cannot be negative']
    },
    totalCost: {
      type: Number,
      default: 0,
      min: [0, 'Total cost cannot be negative'],
      description: 'Total cost in USD'
    },
    lastUsed: {
      type: Date
    }
  },

  // Metadata
  description: {
    type: String,
    trim: true
  },

  tags: [{
    type: String,
    trim: true
  }],

  // Specializations (e.g., code generation, multi-lingual, vision)
  specializations: [{
    type: String,
    trim: true,
    enum: [
      'code_generation',
      'code_debugging',
      'code_refactoring',
      'technical_documentation',
      'multi_lingual',
      'multi_lingual_code',
      'chinese_language',
      'vision',
      'function_calling',
      'general_purpose',
      'creative_writing',
      'analysis',
      'reasoning'
    ]
  }],

  isDefault: {
    type: Boolean,
    default: false,
    description: 'Is this the default provider for the model type'
  },

  // Audit Trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },

  deletedAt: {
    type: Date
  },

  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  collection: 'provider_configs'
});

// Indexes
providerConfigSchema.index({ provider: 1, status: 1 });
providerConfigSchema.index({ provider: 1, modelId: 1 }, { unique: true });
providerConfigSchema.index({ status: 1, priority: -1 });
providerConfigSchema.index({ isDefault: 1, status: 1 });
providerConfigSchema.index({ trustTier: 1, status: 1 }); // ZDR-E0-S3: Trust tier filtering

// Virtual: Health Status
providerConfigSchema.virtual('healthStatus').get(function() {
  if (this.status !== 'active') {
    return 'inactive';
  }

  if (this.health.consecutiveFailures >= 10) {
    return 'critical';
  }

  if (this.health.consecutiveFailures >= 3) {
    return 'warning';
  }

  return 'healthy';
});

// Virtual: Cost per Request
providerConfigSchema.virtual('costMetrics').get(function() {
  const avgInputTokens = this.usage.totalRequests > 0
    ? this.usage.totalInputTokens / this.usage.totalRequests
    : 0;
  const avgOutputTokens = this.usage.totalRequests > 0
    ? this.usage.totalOutputTokens / this.usage.totalRequests
    : 0;

  return {
    averageInputTokens: Math.round(avgInputTokens),
    averageOutputTokens: Math.round(avgOutputTokens),
    averageCostPerRequest: this.usage.totalRequests > 0
      ? (this.usage.totalCost / this.usage.totalRequests).toFixed(4)
      : 0
  };
});

// Instance Methods

/**
 * Soft delete the provider config
 */
providerConfigSchema.methods.softDelete = function(userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.status = 'inactive';
  return this.save();
};

/**
 * Activate the provider config
 */
providerConfigSchema.methods.activate = function(userId) {
  this.status = 'active';
  this.updatedBy = userId;
  return this.save();
};

/**
 * Deactivate the provider config
 */
providerConfigSchema.methods.deactivate = function(userId) {
  this.status = 'inactive';
  this.updatedBy = userId;
  return this.save();
};

/**
 * Update health status
 */
providerConfigSchema.methods.updateHealth = function(success, latency = 0, errorMessage = null) {
  this.health.lastHealthCheck = new Date();

  if (success) {
    this.health.consecutiveFailures = 0;
    // Update rolling average latency
    if (this.usage.totalRequests > 0) {
      this.health.averageLatency =
        (this.health.averageLatency * 0.9) + (latency * 0.1);
    } else {
      this.health.averageLatency = latency;
    }
  } else {
    this.health.consecutiveFailures += 1;
    this.health.lastFailure = new Date();
    this.health.lastFailureReason = errorMessage;

    // Auto-deactivate after 10 consecutive failures
    if (this.health.consecutiveFailures >= 10) {
      this.status = 'inactive';
    }
  }

  return this.save();
};

/**
 * Record usage metrics
 */
providerConfigSchema.methods.recordUsage = function(inputTokens, outputTokens) {
  this.usage.totalRequests += 1;
  this.usage.totalInputTokens += inputTokens;
  this.usage.totalOutputTokens += outputTokens;
  this.usage.lastUsed = new Date();

  // Calculate cost
  const inputCost = (inputTokens / 1000000) * this.pricing.inputTokenCost;
  const outputCost = (outputTokens / 1000000) * this.pricing.outputTokenCost;
  this.usage.totalCost += inputCost + outputCost;

  return this.save();
};

/**
 * Check if provider is available
 */
providerConfigSchema.methods.isAvailable = function() {
  return this.status === 'active' &&
         !this.isDeleted &&
         this.health.consecutiveFailures < 10;
};

/**
 * Get sanitized config (without sensitive data)
 */
providerConfigSchema.methods.getSanitized = function() {
  const obj = this.toObject({ virtuals: true });
  delete obj.apiConfig.apiKey;
  return obj;
};

// Static Methods

/**
 * Find active providers by type
 */
providerConfigSchema.statics.findActiveByProvider = async function(provider) {
  return this.find({
    provider,
    status: 'active',
    isDeleted: false
  }).sort({ priority: -1 });
};

/**
 * Find default provider for a model type
 */
providerConfigSchema.statics.findDefault = async function(provider) {
  return this.findOne({
    provider,
    isDefault: true,
    status: 'active',
    isDeleted: false
  });
};

/**
 * Find providers needing health check
 */
providerConfigSchema.statics.findNeedingHealthCheck = async function() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.find({
    status: { $in: ['active', 'testing'] },
    isDeleted: false,
    'health.lastHealthCheck': { $lt: fiveMinutesAgo }
  });
};

/**
 * Get best available provider
 */
providerConfigSchema.statics.getBestAvailable = async function(provider, minTokens = 0) {
  return this.findOne({
    provider,
    status: 'active',
    isDeleted: false,
    'capabilities.maxTokens': { $gte: minTokens },
    'health.consecutiveFailures': { $lt: 3 }
  }).sort({
    priority: -1,
    'health.consecutiveFailures': 1,
    'health.averageLatency': 1
  });
};

// Query Helpers
providerConfigSchema.query.active = function() {
  return this.where({ status: 'active', isDeleted: false });
};

providerConfigSchema.query.byProvider = function(provider) {
  return this.where({ provider });
};

providerConfigSchema.query.healthy = function() {
  return this.where({ 'health.consecutiveFailures': { $lt: 3 } });
};

const ProviderConfig = mongoose.model('ProviderConfig', providerConfigSchema);

module.exports = ProviderConfig;
