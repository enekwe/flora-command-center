const mongoose = require('mongoose');

/**
 * Provider Routing Rule Model
 *
 * Defines intelligent routing rules for selecting LLM providers based on agent type,
 * task requirements, and fallback strategies. Part of the Provider Abstraction Layer (PAL)
 * Phase 2 implementation.
 *
 * This model enables:
 * - Agent-specific provider selection (SpecAgent → Anthropic, CodeAgent → DeepSeek, etc.)
 * - Automatic fallback chains when primary providers fail or are unavailable
 * - Dynamic routing based on task characteristics (cost, latency, streaming needs)
 * - Circuit breaker patterns for provider health management
 *
 * @model ProviderRoutingRule
 * @collection providerroutingrules
 */

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

const ProviderRoutingRuleSchema = new mongoose.Schema({
  // ===== Agent Configuration =====

  /**
   * Type of agent this rule applies to
   * Determines which AI agent should use this routing configuration
   */
  agentType: {
    type: String,
    required: [true, 'Agent type is required'],
    enum: {
      values: ['SpecAgent', 'CodeAgent', 'TestAgent', 'DeployAgent', 'ReviewAgent'],
      message: '{VALUE} is not a supported agent type'
    },
    index: true
  },

  // ===== Provider Selection =====

  /**
   * Primary provider to use for this agent type
   * References the provider identifier from ProviderConfig (e.g., 'anthropic', 'deepseek', 'openai')
   */
  primaryProvider: {
    type: String,
    required: [true, 'Primary provider is required'],
    trim: true,
    lowercase: true,
    index: true
  },

  /**
   * Ordered list of fallback providers to try if primary fails
   * Empty array indicates no fallback (fail fast)
   *
   * Example: ['qwen', 'openai'] - try Qwen first, then OpenAI if Qwen fails
   */
  fallbackChain: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  // ===== Routing Criteria =====

  /**
   * Criteria used to determine optimal provider selection
   * These settings influence when and how routing decisions are made
   */
  routingCriteria: {
    /**
     * Type of task this rule is optimized for
     * Examples: 'code_generation', 'specification_writing', 'testing', 'review'
     */
    taskType: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'general'
    },

    /**
     * Maximum acceptable cost per request in USD (per million tokens)
     * Provider routing will prefer cheaper options if specified
     */
    maxCostPerRequest: {
      type: Number,
      min: [0, 'Cost cannot be negative'],
      default: null
    },

    /**
     * Preferred latency in milliseconds
     * Lower values indicate preference for faster providers
     */
    preferredLatency: {
      type: Number,
      min: [0, 'Latency cannot be negative'],
      default: null
    },

    /**
     * Whether this agent requires streaming support
     * If true, only providers with supportsStreaming=true will be selected
     */
    requiresStreaming: {
      type: Boolean,
      default: false
    },

    /**
     * Minimum required context window size in tokens
     * Ensures provider can handle the agent's typical input size
     */
    minContextWindow: {
      type: Number,
      min: [0, 'Context window cannot be negative'],
      default: 8000
    },

    /**
     * Whether function calling capability is required
     * If true, only providers with supportsFunctionCalling=true will be selected
     */
    requiresFunctionCalling: {
      type: Boolean,
      default: false
    }
  },

  // ===== Fallback Triggers =====

  /**
   * Conditions that trigger fallback to next provider in chain
   * System monitors these conditions and automatically switches providers
   */
  fallbackTriggers: [{
    type: String,
    enum: {
      values: [
        'RATE_LIMIT_EXCEEDED',      // HTTP 429 or rate limit headers detected
        'CONTEXT_WINDOW_EXCEEDED',  // Request exceeds provider's context window
        'PROVIDER_TIMEOUT',         // Request times out after configured duration
        'PROVIDER_ERROR',           // Provider returns 5xx error
        'INVALID_RESPONSE',         // Provider returns malformed response
        'COST_THRESHOLD_EXCEEDED',  // Request would exceed cost budget
        'PROVIDER_UNAVAILABLE',     // Provider health check fails
        'AUTHENTICATION_FAILED'     // API key invalid or missing
      ],
      message: '{VALUE} is not a supported fallback trigger'
    }
  }],

  // ===== Rule Management =====

  /**
   * Whether this routing rule is currently active
   * Inactive rules are ignored during provider selection
   */
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  /**
   * Priority level for rule selection when multiple rules match
   * Higher priority rules are evaluated first (1-100, where 100 is highest)
   */
  priority: {
    type: Number,
    required: [true, 'Priority is required'],
    min: [1, 'Priority must be at least 1'],
    max: [100, 'Priority cannot exceed 100'],
    default: 50,
    index: true
  },

  // ===== Circuit Breaker State =====

  /**
   * Circuit breaker configuration for provider health management
   * Prevents cascading failures by temporarily disabling unhealthy providers
   */
  circuitBreaker: {
    /**
     * Current state of the circuit breaker for this rule
     * - CLOSED: Normal operation, requests flow to provider
     * - OPEN: Provider is unhealthy, requests bypass to fallback
     * - HALF_OPEN: Testing if provider has recovered
     */
    state: {
      type: String,
      enum: ['CLOSED', 'OPEN', 'HALF_OPEN'],
      default: 'CLOSED'
    },

    /**
     * Number of consecutive failures before opening circuit
     */
    failureThreshold: {
      type: Number,
      default: 5,
      min: [1, 'Failure threshold must be at least 1']
    },

    /**
     * Current count of consecutive failures
     */
    failureCount: {
      type: Number,
      default: 0,
      min: [0, 'Failure count cannot be negative']
    },

    /**
     * Timestamp when circuit was last opened
     */
    lastOpenedAt: {
      type: Date,
      default: null
    },

    /**
     * Duration in milliseconds to wait before attempting recovery
     * After this period, circuit moves to HALF_OPEN state
     */
    recoveryTimeout: {
      type: Number,
      default: 60000, // 1 minute
      min: [1000, 'Recovery timeout must be at least 1 second']
    }
  },

  // ===== Metadata =====

  /**
   * Human-readable description of this routing rule
   * Explains the purpose and configuration of the rule
   */
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },

  /**
   * User who created this routing rule
   */
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },

  /**
   * User who last updated this routing rule
   */
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },

  /**
   * Tags for categorization and search
   */
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }]

}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Compound index for active rule lookup by agent type
ProviderRoutingRuleSchema.index({ agentType: 1, isActive: 1, priority: -1 });

// Index for provider-specific queries
ProviderRoutingRuleSchema.index({ primaryProvider: 1, isActive: 1 });

// Index for circuit breaker state monitoring
ProviderRoutingRuleSchema.index({ 'circuitBreaker.state': 1, isActive: 1 });

// Index for rule priority sorting
ProviderRoutingRuleSchema.index({ priority: -1 });

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Get the next provider in the fallback chain
 * @param {String} currentProvider - Current provider that failed
 * @returns {String|null} Next provider to try, or null if no fallback available
 */
ProviderRoutingRuleSchema.methods.getNextFallback = function(currentProvider) {
  // If current provider is primary, return first fallback
  if (currentProvider === this.primaryProvider) {
    return this.fallbackChain.length > 0 ? this.fallbackChain[0] : null;
  }

  // Find current position in fallback chain
  const currentIndex = this.fallbackChain.indexOf(currentProvider);

  // If not in chain or last in chain, no more fallbacks
  if (currentIndex === -1 || currentIndex === this.fallbackChain.length - 1) {
    return null;
  }

  // Return next in chain
  return this.fallbackChain[currentIndex + 1];
};

/**
 * Check if a specific trigger should cause fallback
 * @param {String} trigger - Trigger type to check
 * @returns {Boolean} True if trigger is configured for fallback
 */
ProviderRoutingRuleSchema.methods.shouldFallback = function(trigger) {
  return this.fallbackTriggers.includes(trigger);
};

/**
 * Record a provider failure and update circuit breaker state
 * @returns {Promise<ProviderRoutingRule>}
 */
ProviderRoutingRuleSchema.methods.recordFailure = async function() {
  this.circuitBreaker.failureCount += 1;

  // Open circuit if threshold exceeded
  if (this.circuitBreaker.failureCount >= this.circuitBreaker.failureThreshold) {
    this.circuitBreaker.state = 'OPEN';
    this.circuitBreaker.lastOpenedAt = new Date();
  }

  return this.save();
};

/**
 * Record a successful provider request and reset circuit breaker
 * @returns {Promise<ProviderRoutingRule>}
 */
ProviderRoutingRuleSchema.methods.recordSuccess = async function() {
  // Reset failure count and close circuit
  this.circuitBreaker.failureCount = 0;
  this.circuitBreaker.state = 'CLOSED';
  this.circuitBreaker.lastOpenedAt = null;

  return this.save();
};

/**
 * Check if circuit breaker should transition to HALF_OPEN state
 * @returns {Boolean} True if recovery timeout has elapsed
 */
ProviderRoutingRuleSchema.methods.shouldAttemptRecovery = function() {
  if (this.circuitBreaker.state !== 'OPEN') {
    return false;
  }

  if (!this.circuitBreaker.lastOpenedAt) {
    return false;
  }

  const timeSinceOpen = Date.now() - this.circuitBreaker.lastOpenedAt.getTime();
  return timeSinceOpen >= this.circuitBreaker.recoveryTimeout;
};

/**
 * Transition circuit breaker to HALF_OPEN state for recovery testing
 * @returns {Promise<ProviderRoutingRule>}
 */
ProviderRoutingRuleSchema.methods.attemptRecovery = async function() {
  if (this.shouldAttemptRecovery()) {
    this.circuitBreaker.state = 'HALF_OPEN';
    return this.save();
  }
  return this;
};

/**
 * Check if provider is currently available based on circuit breaker state
 * @returns {Boolean} True if provider can accept requests
 */
ProviderRoutingRuleSchema.methods.isProviderAvailable = function() {
  // Provider is available if circuit is closed or half-open
  return this.circuitBreaker.state === 'CLOSED' ||
         this.circuitBreaker.state === 'HALF_OPEN';
};

/**
 * Get full provider chain (primary + fallbacks)
 * @returns {Array<String>} Ordered list of providers
 */
ProviderRoutingRuleSchema.methods.getProviderChain = function() {
  return [this.primaryProvider, ...this.fallbackChain];
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Find the best matching routing rule for a given agent type
 * Returns highest priority active rule
 *
 * @param {String} agentType - Type of agent requesting routing
 * @returns {Promise<ProviderRoutingRule|null>}
 */
ProviderRoutingRuleSchema.statics.findRuleForAgent = async function(agentType) {
  return this.findOne({
    agentType,
    isActive: true
  })
    .sort({ priority: -1 }) // Highest priority first
    .lean();
};

/**
 * Find all active routing rules sorted by priority
 * @returns {Promise<ProviderRoutingRule[]>}
 */
ProviderRoutingRuleSchema.statics.getAllActiveRules = async function() {
  return this.find({ isActive: true })
    .sort({ priority: -1 })
    .lean();
};

/**
 * Find rules by provider (either primary or in fallback chain)
 * @param {String} provider - Provider identifier
 * @returns {Promise<ProviderRoutingRule[]>}
 */
ProviderRoutingRuleSchema.statics.findByProvider = async function(provider) {
  return this.find({
    $or: [
      { primaryProvider: provider },
      { fallbackChain: provider }
    ],
    isActive: true
  })
    .sort({ priority: -1 })
    .lean();
};

/**
 * Get all rules with open circuit breakers
 * Useful for monitoring provider health
 *
 * @returns {Promise<ProviderRoutingRule[]>}
 */
ProviderRoutingRuleSchema.statics.getOpenCircuits = async function() {
  return this.find({
    'circuitBreaker.state': 'OPEN',
    isActive: true
  })
    .lean();
};

/**
 * Reset all circuit breakers to CLOSED state
 * Useful for manual recovery or testing
 *
 * @returns {Promise<Number>} Number of rules updated
 */
ProviderRoutingRuleSchema.statics.resetAllCircuitBreakers = async function() {
  const result = await this.updateMany(
    { isActive: true },
    {
      $set: {
        'circuitBreaker.state': 'CLOSED',
        'circuitBreaker.failureCount': 0,
        'circuitBreaker.lastOpenedAt': null
      }
    }
  );

  return result.modifiedCount;
};

// ============================================================================
// MIDDLEWARE HOOKS
// ============================================================================

/**
 * Pre-save middleware
 * Validates routing configuration and normalizes data
 */
ProviderRoutingRuleSchema.pre('save', function(next) {
  // Ensure fallbackChain doesn't include primary provider
  if (this.fallbackChain && this.fallbackChain.length > 0) {
    this.fallbackChain = this.fallbackChain.filter(
      provider => provider !== this.primaryProvider
    );
  }

  // Remove duplicate providers from fallback chain
  if (this.fallbackChain) {
    this.fallbackChain = [...new Set(this.fallbackChain)];
  }

  // Set default fallback triggers if none specified
  if (!this.fallbackTriggers || this.fallbackTriggers.length === 0) {
    this.fallbackTriggers = [
      'RATE_LIMIT_EXCEEDED',
      'PROVIDER_TIMEOUT',
      'PROVIDER_ERROR',
      'PROVIDER_UNAVAILABLE'
    ];
  }

  next();
});

// ============================================================================
// VIRTUALS
// ============================================================================

/**
 * Virtual: Total number of providers in routing chain
 */
ProviderRoutingRuleSchema.virtual('totalProviders').get(function() {
  return 1 + (this.fallbackChain ? this.fallbackChain.length : 0);
});

/**
 * Virtual: Whether circuit breaker is healthy
 */
ProviderRoutingRuleSchema.virtual('isHealthy').get(function() {
  return this.circuitBreaker.state === 'CLOSED';
});

// ============================================================================
// CREATE MODEL
// ============================================================================

const ProviderRoutingRule = mongoose.model('ProviderRoutingRule', ProviderRoutingRuleSchema);

module.exports = ProviderRoutingRule;
