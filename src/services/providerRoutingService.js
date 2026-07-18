const ProviderRoutingRule = require('../models/ProviderRoutingRule');
const ProviderConfig = require('../models/ProviderConfig');
const logger = require('../utils/logger');

/**
 * Provider Routing Service
 *
 * Intelligent routing system for selecting optimal LLM providers based on:
 * - Agent type (SpecAgent, CodeAgent, TestAgent, DeployAgent, ReviewAgent)
 * - Task requirements (cost, latency, streaming, context window)
 * - Provider availability and health (circuit breaker pattern)
 * - Fallback chains for resilience
 *
 * Part of Provider Abstraction Layer (PAL) Phase 2 implementation.
 *
 * Key Features:
 * - In-memory caching of routing rules for fast lookups
 * - Circuit breaker pattern to prevent cascading failures
 * - Automatic fallback to secondary providers
 * - Provider health monitoring and recovery
 * - Cost-aware routing decisions
 *
 * @class ProviderRoutingService
 */
class ProviderRoutingService {
  constructor() {
    /**
     * In-memory cache of routing rules
     * Keyed by agentType for O(1) lookups
     */
    this.routingRulesCache = new Map();

    /**
     * Provider health status tracking
     * Keyed by provider identifier, stores health metrics
     */
    this.providerHealth = new Map();

    /**
     * Provider configurations cache
     * Keyed by provider identifier
     */
    this.providerConfigsCache = new Map();

    /**
     * Last time routing rules were loaded
     */
    this.lastCacheRefresh = null;

    /**
     * Cache TTL in milliseconds (5 minutes)
     */
    this.cacheTTL = 5 * 60 * 1000;

    /**
     * Provider request statistics
     */
    this.stats = {
      totalRequests: 0,
      successfulRoutes: 0,
      fallbacksTriggered: 0,
      circuitBreakersOpened: 0,
      providerFailures: new Map() // provider -> failure count
    };
  }

  // ==========================================================================
  // CORE ROUTING METHODS
  // ==========================================================================

  /**
   * Select the optimal provider for a given agent type and context
   *
   * This is the primary entry point for provider selection.
   * It considers routing rules, provider health, and task requirements.
   *
   * @param {String} agentType - Type of agent requesting a provider
   * @param {Object} context - Request context for routing decisions
   * @param {String} context.taskType - Type of task (e.g., 'code_generation', 'review')
   * @param {Number} context.estimatedTokens - Estimated input tokens
   * @param {Boolean} context.requiresStreaming - Whether streaming is required
   * @param {Number} context.maxCost - Maximum acceptable cost
   * @returns {Promise<Object>} Selected provider configuration
   * @throws {Error} If no suitable provider found
   */
  async selectProvider(agentType, context = {}) {
    this.stats.totalRequests++;

    try {
      // Ensure routing rules are loaded
      await this.ensureRulesLoaded();

      // Get routing rule for agent type
      const rule = this.routingRulesCache.get(agentType);
      if (!rule) {
        throw new Error(`No routing rule found for agent type: ${agentType}`);
      }

      // Check if rule is active
      if (!rule.isActive) {
        throw new Error(`Routing rule for ${agentType} is inactive`);
      }

      // Get provider chain (primary + fallbacks)
      let providerChain = this.getProviderChain(rule);

      // ZDR-E4-S2: Filter chain by trust tier before cost/latency optimization (G5)
      const requiredTier = context.requiredTrustTier || null;
      if (requiredTier) {
        const tierOrder = { self_hosted: 3, zdr_contracted: 2, standard_hosted: 1 };
        const requiredLevel = tierOrder[requiredTier] || 0;

        const filteredChain = [];
        for (const pid of providerChain) {
          const pc = await this.getProviderConfig(pid);
          if (pc && pc.trustTier) {
            const providerLevel = tierOrder[pc.trustTier] || 0;
            if (providerLevel >= requiredLevel) {
              filteredChain.push(pid);
            } else {
              logger.info(`Provider ${pid} excluded: trustTier ${pc.trustTier} < required ${requiredTier}`);
            }
          } else {
            filteredChain.push(pid);
          }
        }

        if (filteredChain.length === 0) {
          throw new Error(
            `No provider meets required trust tier ${requiredTier} for ${agentType}. ` +
            `All ${providerChain.length} candidates filtered out — fail closed.`
          );
        }

        providerChain = filteredChain;
      }

      // Try each provider in order
      for (const providerId of providerChain) {
        // Check if provider meets requirements
        const providerConfig = await this.getProviderConfig(providerId);
        if (!providerConfig) {
          logger.warn(`Provider ${providerId} not found in configuration`);
          continue;
        }

        // Check circuit breaker state
        if (!this.isProviderHealthy(providerId, rule)) {
          logger.warn(`Provider ${providerId} circuit breaker is open, skipping`);
          continue;
        }

        // Validate provider capabilities against requirements
        if (!this.meetsRequirements(providerConfig, rule, context)) {
          logger.warn(`Provider ${providerId} does not meet requirements`);
          continue;
        }

        // Provider is suitable, return it
        this.stats.successfulRoutes++;
        logger.info(`Selected provider ${providerId} for ${agentType}`);

        // ZDR-E0-S5: Add score and selectionReason to match expected return shape
        const isFallback = providerId !== rule.primaryProvider;
        const selectionReason = isFallback
          ? `Fallback provider (primary: ${rule.primaryProvider})`
          : 'Primary provider from routing rule';

        // Calculate score based on provider health and position in chain
        const healthStatus = this.providerHealth.get(providerId);
        let score = 100; // Base score

        // Reduce score if fallback
        if (isFallback) {
          const chain = this.getProviderChain(rule);
          const position = chain.indexOf(providerId);
          score -= position * 10; // Reduce by 10 for each position away from primary
        }

        // Reduce score based on failure count
        if (healthStatus?.failureCount) {
          score -= healthStatus.failureCount * 5;
        }

        // Ensure score stays in valid range
        score = Math.max(0, Math.min(100, score));

        return {
          provider: providerId,
          config: providerConfig,
          rule: rule,
          isFallback,
          score,
          selectionReason
        };
      }

      // No suitable provider found
      throw new Error(`No available provider found for ${agentType}`);

    } catch (error) {
      logger.error(`Provider selection failed for ${agentType}:`, error);
      throw error;
    }
  }

  /**
   * Get the next fallback provider when current provider fails
   *
   * @param {String} currentProvider - Current provider that failed
   * @param {String} agentType - Type of agent
   * @param {String} reason - Reason for fallback (trigger type)
   * @returns {Promise<Object|null>} Next provider config or null if no fallback
   */
  async getFallbackProvider(currentProvider, agentType, reason) {
    try {
      this.stats.fallbacksTriggered++;

      // Ensure routing rules are loaded
      await this.ensureRulesLoaded();

      // Get routing rule for agent type
      const rule = this.routingRulesCache.get(agentType);
      if (!rule) {
        logger.error(`No routing rule found for agent type: ${agentType}`);
        return null;
      }

      // Check if this trigger should cause fallback
      if (!rule.fallbackTriggers.includes(reason)) {
        logger.warn(`Trigger ${reason} not configured for fallback in ${agentType} rule`);
        return null;
      }

      // Get next provider in chain
      const nextProvider = this.getNextInChain(currentProvider, rule);
      if (!nextProvider) {
        logger.warn(`No fallback provider available after ${currentProvider}`);
        return null;
      }

      // Get provider configuration
      const providerConfig = await this.getProviderConfig(nextProvider);
      if (!providerConfig) {
        logger.error(`Fallback provider ${nextProvider} not found in configuration`);
        return null;
      }

      logger.info(`Falling back from ${currentProvider} to ${nextProvider} (reason: ${reason})`);

      return {
        provider: nextProvider,
        config: providerConfig,
        rule: rule,
        isFallback: true,
        fallbackReason: reason
      };

    } catch (error) {
      logger.error(`Fallback provider selection failed:`, error);
      return null;
    }
  }

  /**
   * Check if a provider can be used based on requirements and health
   *
   * @param {String} provider - Provider identifier
   * @param {Object} requirements - Requirements to check
   * @param {Number} requirements.minContextWindow - Minimum context window needed
   * @param {Boolean} requirements.requiresStreaming - Streaming support required
   * @param {Boolean} requirements.requiresFunctionCalling - Function calling required
   * @param {Number} requirements.maxCost - Maximum acceptable cost
   * @returns {Promise<Boolean>} True if provider can be used
   */
  async canUseProvider(provider, requirements = {}) {
    try {
      // Get provider configuration
      const config = await this.getProviderConfig(provider);
      if (!config) {
        return false;
      }

      // Check if provider is active
      if (config.status !== 'active') {
        return false;
      }

      // Check context window
      if (requirements.minContextWindow &&
          config.capabilities.contextWindow < requirements.minContextWindow) {
        return false;
      }

      // Check streaming support
      if (requirements.requiresStreaming && !config.capabilities.supportsStreaming) {
        return false;
      }

      // Check function calling support
      if (requirements.requiresFunctionCalling && !config.capabilities.supportsFunctionCalling) {
        return false;
      }

      // Check cost constraints
      if (requirements.maxCost) {
        const estimatedCost = this.estimateCost(config, requirements.estimatedTokens || 1000);
        if (estimatedCost > requirements.maxCost) {
          return false;
        }
      }

      // Check provider health
      const healthStatus = this.providerHealth.get(provider);
      if (healthStatus && healthStatus.circuitState === 'OPEN') {
        return false;
      }

      return true;

    } catch (error) {
      logger.error(`Error checking provider availability:`, error);
      return false;
    }
  }

  /**
   * Load routing rules from database into memory cache
   *
   * @param {Boolean} force - Force refresh even if cache is fresh
   * @returns {Promise<void>}
   */
  async loadRoutingRules(force = false) {
    try {
      // Check if cache refresh is needed
      if (!force && this.lastCacheRefresh) {
        const cacheAge = Date.now() - this.lastCacheRefresh;
        if (cacheAge < this.cacheTTL) {
          logger.debug('Routing rules cache is fresh, skipping reload');
          return;
        }
      }

      logger.info('Loading routing rules from database...');

      // Fetch all active rules
      const rules = await ProviderRoutingRule.find({ isActive: true })
        .sort({ priority: -1 })
        .lean();

      // Clear existing cache
      this.routingRulesCache.clear();

      // Populate cache
      for (const rule of rules) {
        // Use highest priority rule for each agent type
        if (!this.routingRulesCache.has(rule.agentType)) {
          this.routingRulesCache.set(rule.agentType, rule);
        }
      }

      // Load provider configurations
      await this.loadProviderConfigs();

      this.lastCacheRefresh = Date.now();
      logger.info(`Loaded ${this.routingRulesCache.size} routing rules into cache`);

    } catch (error) {
      logger.error('Failed to load routing rules:', error);
      throw error;
    }
  }

  /**
   * Load provider configurations from database into cache
   *
   * @returns {Promise<void>}
   */
  async loadProviderConfigs() {
    try {
      const configs = await ProviderConfig.find({ status: 'active' })
        .select('+apiConfig.apiKey') // Include API key for runtime use
        .lean();

      this.providerConfigsCache.clear();

      for (const config of configs) {
        this.providerConfigsCache.set(config.provider, config);
      }

      logger.info(`Loaded ${this.providerConfigsCache.size} provider configurations`);

    } catch (error) {
      logger.error('Failed to load provider configs:', error);
      throw error;
    }
  }

  // ==========================================================================
  // CIRCUIT BREAKER METHODS
  // ==========================================================================

  /**
   * Record a provider failure and update circuit breaker state
   *
   * @param {String} provider - Provider that failed
   * @param {String} agentType - Agent type using the provider
   * @param {String} errorType - Type of error that occurred
   * @returns {Promise<void>}
   */
  async recordProviderFailure(provider, agentType, errorType) {
    try {
      // Update statistics
      const currentFailures = this.stats.providerFailures.get(provider) || 0;
      this.stats.providerFailures.set(provider, currentFailures + 1);

      // Get routing rule
      const rule = this.routingRulesCache.get(agentType);
      if (!rule) {
        return;
      }

      // Update database rule
      const dbRule = await ProviderRoutingRule.findById(rule._id);
      if (dbRule) {
        await dbRule.recordFailure();

        // Update cache with new state
        const updatedRule = await ProviderRoutingRule.findById(rule._id).lean();
        this.routingRulesCache.set(agentType, updatedRule);

        // Update provider health tracking
        this.providerHealth.set(provider, {
          circuitState: updatedRule.circuitBreaker.state,
          failureCount: updatedRule.circuitBreaker.failureCount,
          lastFailure: new Date(),
          lastError: errorType
        });

        if (updatedRule.circuitBreaker.state === 'OPEN') {
          this.stats.circuitBreakersOpened++;
          logger.warn(`Circuit breaker OPENED for ${provider} (${agentType})`);
        }
      }

    } catch (error) {
      logger.error(`Error recording provider failure:`, error);
    }
  }

  /**
   * Record a successful provider request
   *
   * @param {String} provider - Provider that succeeded
   * @param {String} agentType - Agent type using the provider
   * @returns {Promise<void>}
   */
  async recordProviderSuccess(provider, agentType) {
    try {
      // Get routing rule
      const rule = this.routingRulesCache.get(agentType);
      if (!rule) {
        return;
      }

      // Only update if there were previous failures
      if (rule.circuitBreaker.failureCount > 0 || rule.circuitBreaker.state !== 'CLOSED') {
        // Update database rule
        const dbRule = await ProviderRoutingRule.findById(rule._id);
        if (dbRule) {
          await dbRule.recordSuccess();

          // Update cache
          const updatedRule = await ProviderRoutingRule.findById(rule._id).lean();
          this.routingRulesCache.set(agentType, updatedRule);

          // Update provider health tracking
          this.providerHealth.set(provider, {
            circuitState: 'CLOSED',
            failureCount: 0,
            lastSuccess: new Date()
          });

          logger.info(`Circuit breaker CLOSED for ${provider} (${agentType}) after successful request`);
        }
      }

    } catch (error) {
      logger.error(`Error recording provider success:`, error);
    }
  }

  /**
   * Check if provider is healthy (circuit breaker not open)
   *
   * @param {String} provider - Provider to check
   * @param {Object} rule - Routing rule containing circuit breaker state
   * @returns {Boolean} True if provider is healthy
   */
  isProviderHealthy(provider, rule) {
    // Check circuit breaker state
    if (rule.circuitBreaker.state === 'OPEN') {
      // Check if we should attempt recovery
      const timeSinceOpen = Date.now() - new Date(rule.circuitBreaker.lastOpenedAt).getTime();
      if (timeSinceOpen >= rule.circuitBreaker.recoveryTimeout) {
        // Transition to HALF_OPEN for recovery attempt
        logger.info(`Attempting recovery for ${provider}, transitioning to HALF_OPEN`);
        return true; // Allow one request to test recovery
      }
      return false;
    }

    return true; // CLOSED or HALF_OPEN states allow requests
  }

  /**
   * Manually reset circuit breaker for a provider
   *
   * @param {String} provider - Provider to reset
   * @param {String} agentType - Agent type
   * @returns {Promise<Boolean>} True if reset successful
   */
  async resetCircuitBreaker(provider, agentType) {
    try {
      const rule = this.routingRulesCache.get(agentType);
      if (!rule) {
        return false;
      }

      const dbRule = await ProviderRoutingRule.findById(rule._id);
      if (dbRule) {
        await dbRule.recordSuccess();
        await this.loadRoutingRules(true); // Force cache refresh
        logger.info(`Manually reset circuit breaker for ${provider} (${agentType})`);
        return true;
      }

      return false;

    } catch (error) {
      logger.error(`Error resetting circuit breaker:`, error);
      return false;
    }
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Ensure routing rules are loaded in cache
   *
   * @returns {Promise<void>}
   */
  async ensureRulesLoaded() {
    if (this.routingRulesCache.size === 0 || !this.lastCacheRefresh) {
      await this.loadRoutingRules();
    }
  }

  /**
   * Get provider configuration from cache or database
   *
   * @param {String} provider - Provider identifier
   * @returns {Promise<Object|null>} Provider configuration
   */
  async getProviderConfig(provider) {
    // Check cache first
    if (this.providerConfigsCache.has(provider)) {
      return this.providerConfigsCache.get(provider);
    }

    // Fetch from database
    try {
      const config = await ProviderConfig.findOne({
        provider: provider,
        status: 'active'
      })
        .select('+apiConfig.apiKey')
        .lean();

      if (config) {
        this.providerConfigsCache.set(provider, config);
      }

      return config;

    } catch (error) {
      logger.error(`Error fetching provider config for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Get full provider chain from routing rule
   *
   * @param {Object} rule - Routing rule
   * @returns {Array<String>} Provider chain (primary + fallbacks)
   */
  getProviderChain(rule) {
    return [rule.primaryProvider, ...(rule.fallbackChain || [])];
  }

  /**
   * Get next provider in fallback chain
   *
   * @param {String} currentProvider - Current provider
   * @param {Object} rule - Routing rule
   * @returns {String|null} Next provider or null
   */
  getNextInChain(currentProvider, rule) {
    const chain = this.getProviderChain(rule);
    const currentIndex = chain.indexOf(currentProvider);

    if (currentIndex === -1 || currentIndex === chain.length - 1) {
      return null;
    }

    return chain[currentIndex + 1];
  }

  /**
   * Check if provider meets requirements
   *
   * @param {Object} config - Provider configuration
   * @param {Object} rule - Routing rule
   * @param {Object} context - Request context
   * @returns {Boolean} True if requirements met
   */
  meetsRequirements(config, rule, context) {
    const criteria = rule.routingCriteria || {};

    // Check streaming requirement
    if (criteria.requiresStreaming && !config.capabilities.supportsStreaming) {
      return false;
    }

    // Check context window
    if (context.estimatedTokens &&
        config.capabilities.contextWindow < context.estimatedTokens) {
      return false;
    }

    if (criteria.minContextWindow &&
        config.capabilities.contextWindow < criteria.minContextWindow) {
      return false;
    }

    // Check function calling requirement
    if (criteria.requiresFunctionCalling && !config.capabilities.supportsFunctionCalling) {
      return false;
    }

    // Check cost constraint
    if (criteria.maxCostPerRequest || context.maxCost) {
      const maxCost = context.maxCost || criteria.maxCostPerRequest;
      const estimatedTokens = context.estimatedTokens || 1000;
      const cost = this.estimateCost(config, estimatedTokens);

      if (cost > maxCost) {
        return false;
      }
    }

    return true;
  }

  /**
   * Estimate cost for a request
   *
   * @param {Object} config - Provider configuration
   * @param {Number} estimatedTokens - Estimated token count
   * @returns {Number} Estimated cost in USD
   */
  estimateCost(config, estimatedTokens) {
    // Estimate 70% input, 30% output split
    const inputTokens = estimatedTokens * 0.7;
    const outputTokens = estimatedTokens * 0.3;

    const inputCost = (inputTokens / 1000000) * config.pricing.inputTokenCost;
    const outputCost = (outputTokens / 1000000) * config.pricing.outputTokenCost;

    return inputCost + outputCost;
  }

  /**
   * Get routing statistics
   *
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      ...this.stats,
      providerFailures: Object.fromEntries(this.stats.providerFailures),
      cachedRules: this.routingRulesCache.size,
      cachedProviders: this.providerConfigsCache.size,
      lastCacheRefresh: this.lastCacheRefresh,
      cacheAge: this.lastCacheRefresh ? Date.now() - this.lastCacheRefresh : null
    };
  }

  /**
   * Get health status for all providers
   *
   * @returns {Object} Provider health map
   */
  getProviderHealth() {
    return Object.fromEntries(this.providerHealth);
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.routingRulesCache.clear();
    this.providerConfigsCache.clear();
    this.providerHealth.clear();
    this.lastCacheRefresh = null;
    logger.info('Routing service caches cleared');
  }
}

// Create singleton instance
const providerRoutingService = new ProviderRoutingService();

module.exports = providerRoutingService;
