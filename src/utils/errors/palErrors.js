/**
 * Custom Error Classes for Provider Abstraction Layer (PAL)
 *
 * These errors represent different failure scenarios in the PAL routing system:
 * - SessionHandoffRequiredError: Token/rate limits require human handoff
 * - ProviderChainExhaustedError: All providers in fallback chain failed
 * - RateLimitExceededError: Provider rate limit exceeded
 * - ContextWindowExceededError: Input exceeds model's context window
 */

/**
 * Base error class for PAL-specific errors
 */
class PALError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

/**
 * SessionHandoffRequiredError
 *
 * Thrown when token or rate limits require a session handoff to a human agent.
 * This is NOT a failure - it's a controlled transition to human support.
 *
 * @property {string} handoffId - Unique ID for the handoff session
 * @property {string} reason - Why handoff is required ('token_limit', 'rate_limit', 'cost_limit')
 * @property {Object} sessionContext - Context to pass to human agent
 * @property {string} handoffMessage - User-facing message explaining the handoff
 */
class SessionHandoffRequiredError extends PALError {
  constructor(handoffId, reason, sessionContext, handoffMessage) {
    super(
      `Session handoff required: ${reason}`,
      'SESSION_HANDOFF_REQUIRED',
      {
        handoffId,
        reason,
        sessionContext,
        handoffMessage
      }
    );

    this.handoffId = handoffId;
    this.reason = reason;
    this.sessionContext = sessionContext;
    this.handoffMessage = handoffMessage;
    this.isRecoverable = false; // Cannot retry - requires human intervention
  }

  /**
   * Get user-facing error response
   */
  getUserMessage() {
    return {
      type: 'handoff_required',
      message: this.handoffMessage,
      handoffId: this.handoffId,
      reason: this.reason,
      nextSteps: 'A human agent will continue this conversation shortly.'
    };
  }
}

/**
 * ProviderChainExhaustedError
 *
 * Thrown when all providers in the fallback chain have been tried and failed.
 * This represents a complete system failure - no providers are available.
 *
 * @property {Array} attemptedProviders - List of providers that were tried
 * @property {Array} failures - Detailed failure information for each provider
 * @property {string} agentType - Agent type that was being requested
 */
class ProviderChainExhaustedError extends PALError {
  constructor(agentType, attemptedProviders, failures) {
    const providerNames = attemptedProviders.map(p => p.name || p).join(', ');
    super(
      `All providers exhausted for agent type '${agentType}'. Tried: ${providerNames}`,
      'PROVIDER_CHAIN_EXHAUSTED',
      {
        agentType,
        attemptedProviders,
        failures,
        totalAttempts: attemptedProviders.length
      }
    );

    this.agentType = agentType;
    this.attemptedProviders = attemptedProviders;
    this.failures = failures;
    this.isRecoverable = false; // System-level failure
  }

  /**
   * Get user-facing error response
   */
  getUserMessage() {
    return {
      type: 'service_unavailable',
      message: 'AI services are temporarily unavailable. Please try again in a few moments.',
      agentType: this.agentType,
      details: 'Multiple provider failures detected.',
      retryAfter: 60 // seconds
    };
  }

  /**
   * Get detailed failure report for logging/monitoring
   */
  getFailureReport() {
    return {
      agentType: this.agentType,
      timestamp: this.timestamp,
      attempts: this.failures.map((failure, index) => ({
        order: index + 1,
        provider: this.attemptedProviders[index],
        error: failure.error,
        latency: failure.latency,
        timestamp: failure.timestamp
      })),
      totalLatency: this.failures.reduce((sum, f) => sum + (f.latency || 0), 0)
    };
  }
}

/**
 * RateLimitExceededError
 *
 * Thrown when a provider's rate limit is exceeded.
 * This error is retryable with a different provider or after a delay.
 *
 * @property {string} provider - Provider that rate limited
 * @property {number} retryAfter - Seconds until rate limit resets
 * @property {string} limitType - Type of limit ('requests_per_minute', 'tokens_per_day', etc.)
 */
class RateLimitExceededError extends PALError {
  constructor(provider, limitType, retryAfter = null, details = {}) {
    super(
      `Rate limit exceeded for provider '${provider}': ${limitType}`,
      'RATE_LIMIT_EXCEEDED',
      {
        provider,
        limitType,
        retryAfter,
        ...details
      }
    );

    this.provider = provider;
    this.limitType = limitType;
    this.retryAfter = retryAfter;
    this.isRecoverable = true; // Can retry with different provider
    this.isRetryable = true;
  }

  /**
   * Check if enough time has passed to retry
   */
  canRetry() {
    if (!this.retryAfter) return true;
    const elapsed = (Date.now() - this.timestamp.getTime()) / 1000;
    return elapsed >= this.retryAfter;
  }

  /**
   * Get user-facing error response
   */
  getUserMessage() {
    const message = this.retryAfter
      ? `Service temporarily busy. Retrying with alternate provider...`
      : `Service temporarily busy. Please try again shortly.`;

    return {
      type: 'rate_limit',
      message,
      provider: this.provider,
      retryAfter: this.retryAfter
    };
  }
}

/**
 * ContextWindowExceededError
 *
 * Thrown when input exceeds a model's maximum context window.
 * This error may be recoverable by switching to a model with a larger context window.
 *
 * @property {string} provider - Provider/model that rejected the input
 * @property {number} requestedTokens - Tokens in the request
 * @property {number} maxTokens - Maximum tokens allowed
 * @property {string} modelId - Model that was attempted
 */
class ContextWindowExceededError extends PALError {
  constructor(provider, modelId, requestedTokens, maxTokens, details = {}) {
    super(
      `Context window exceeded for ${provider}:${modelId}. Requested: ${requestedTokens}, Max: ${maxTokens}`,
      'CONTEXT_WINDOW_EXCEEDED',
      {
        provider,
        modelId,
        requestedTokens,
        maxTokens,
        overage: requestedTokens - maxTokens,
        ...details
      }
    );

    this.provider = provider;
    this.modelId = modelId;
    this.requestedTokens = requestedTokens;
    this.maxTokens = maxTokens;
    this.isRecoverable = true; // May be recoverable with larger context model
    this.isRetryable = true;
  }

  /**
   * Check if a different model can handle this request
   */
  canHandleWithModel(modelMaxTokens) {
    return modelMaxTokens >= this.requestedTokens;
  }

  /**
   * Get user-facing error response
   */
  getUserMessage() {
    return {
      type: 'context_too_large',
      message: 'The input is too large for this model. Trying an alternate model with larger capacity...',
      requestedTokens: this.requestedTokens,
      maxTokens: this.maxTokens
    };
  }
}

/**
 * ProviderNotAvailableError
 *
 * Thrown when a specific provider is requested but not available.
 * This could be due to health checks, circuit breaker, or configuration.
 */
class ProviderNotAvailableError extends PALError {
  constructor(provider, reason, details = {}) {
    super(
      `Provider '${provider}' is not available: ${reason}`,
      'PROVIDER_NOT_AVAILABLE',
      {
        provider,
        reason,
        ...details
      }
    );

    this.provider = provider;
    this.reason = reason;
    this.isRecoverable = true; // Can try different provider
    this.isRetryable = true;
  }
}

/**
 * InvalidAgentTypeError
 *
 * Thrown when an invalid or unsupported agent type is requested.
 */
class InvalidAgentTypeError extends PALError {
  constructor(agentType, supportedTypes = []) {
    super(
      `Invalid agent type: '${agentType}'. Supported types: ${supportedTypes.join(', ')}`,
      'INVALID_AGENT_TYPE',
      {
        agentType,
        supportedTypes
      }
    );

    this.agentType = agentType;
    this.supportedTypes = supportedTypes;
    this.isRecoverable = false; // Invalid request
  }
}

/**
 * EgressPolicyViolationError
 *
 * Thrown when fail-closed routing mode prevents fallback to an unapproved provider.
 * This is a security control to prevent Customer Code from being sent to
 * providers outside the tenant's allow-list.
 *
 * @property {string} requestedProvider - Provider that was attempted
 * @property {Array<string>} allowedProviders - Providers allowed for this request
 * @property {string} reason - Why the egress was blocked
 */
class EgressPolicyViolationError extends PALError {
  constructor(requestedProvider, allowedProviders = [], reason = 'Provider not on allow-list') {
    const allowedList = allowedProviders.length > 0
      ? allowedProviders.join(', ')
      : 'none (fail-closed mode enabled)';

    super(
      `Egress policy violation: Cannot route to '${requestedProvider}'. Allowed providers: ${allowedList}`,
      'EGRESS_POLICY_VIOLATION',
      {
        requestedProvider,
        allowedProviders,
        reason
      }
    );

    this.requestedProvider = requestedProvider;
    this.allowedProviders = allowedProviders;
    this.reason = reason;
    this.isRecoverable = false; // Policy violation - no fallback allowed
    this.isRetryable = false;
  }

  /**
   * Get user-facing error response
   */
  getUserMessage() {
    return {
      type: 'egress_policy_violation',
      message: 'The requested AI provider is not approved for your account. Please contact your administrator.',
      requestedProvider: this.requestedProvider,
      reason: this.reason
    };
  }
}

/**
 * Helper function to check if an error should trigger fallback
 */
function shouldRetryWithFallback(error) {
  // Retry on these specific errors
  if (error instanceof RateLimitExceededError) return true;
  if (error instanceof ContextWindowExceededError) return true;
  if (error instanceof ProviderNotAvailableError) return true;

  // Don't retry these
  if (error instanceof SessionHandoffRequiredError) return false;
  if (error instanceof ProviderChainExhaustedError) return false;
  if (error instanceof InvalidAgentTypeError) return false;
  if (error instanceof EgressPolicyViolationError) return false;

  // Check for retryable flag
  if (error.isRetryable !== undefined) {
    return error.isRetryable;
  }

  // Default: retry on network/temporary errors
  const retryableErrors = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'NETWORK_ERROR',
    'SERVICE_UNAVAILABLE',
    'INTERNAL_ERROR'
  ];

  return retryableErrors.some(code =>
    error.code === code ||
    error.message?.includes(code)
  );
}

/**
 * Helper function to convert provider errors to PAL errors
 */
function fromProviderError(error, provider, modelId) {
  // Already a PAL error
  if (error instanceof PALError) {
    return error;
  }

  // Map common provider errors
  if (error.code === 'rate_limit_exceeded' || error.status === 429) {
    return new RateLimitExceededError(
      provider,
      error.limitType || 'requests',
      error.retryAfter,
      { originalError: error.message }
    );
  }

  if (error.code === 'context_length_exceeded' || error.message?.includes('context')) {
    return new ContextWindowExceededError(
      provider,
      modelId,
      error.requestedTokens || 0,
      error.maxTokens || 0,
      { originalError: error.message }
    );
  }

  if (error.code === 'provider_unavailable' || error.status === 503) {
    return new ProviderNotAvailableError(
      provider,
      error.reason || 'Service unavailable',
      { originalError: error.message }
    );
  }

  // Return as generic PAL error
  return new PALError(
    error.message || 'Unknown provider error',
    error.code || 'PROVIDER_ERROR',
    {
      provider,
      modelId,
      originalError: error
    }
  );
}

module.exports = {
  PALError,
  SessionHandoffRequiredError,
  ProviderChainExhaustedError,
  RateLimitExceededError,
  ContextWindowExceededError,
  ProviderNotAvailableError,
  InvalidAgentTypeError,
  EgressPolicyViolationError,
  shouldRetryWithFallback,
  fromProviderError
};
