const fs = require('fs').promises;
const path = require('path');
const ProviderConfig = require('../models/ProviderConfig');
const AnthropicProvider = require('./providers/anthropicProvider');
const OpenAIProvider = require('./providers/openaiProvider');
const GeminiProvider = require('./providers/geminiProvider');
const QwenProvider = require('./providers/qwenProvider');
const GLMProvider = require('./providers/glmProvider');
const DeepSeekProvider = require('./providers/deepseekProvider');
const logger = require('../utils/logger');

// Phase 4: Routing Integration
const providerRoutingService = require('./providerRoutingService');
const tokenTrackingService = require('./tokenTrackingService');
const { getHandoffService } = require('./sessionHandoffService');
const { getRedactionService } = require('./dataRedactionService');
const {
  SessionHandoffRequiredError,
  ProviderChainExhaustedError,
  RateLimitExceededError,
  ContextWindowExceededError,
  EgressPolicyViolationError,
  shouldRetryWithFallback,
  fromProviderError
} = require('../utils/errors/palErrors');

/**
 * Provider Abstraction Layer (PAL)
 * Unified interface for calling multiple LLM providers
 *
 * Key Features:
 * - Model-agnostic interface with callModel()
 * - Automatic provider selection based on configuration
 * - Per-skill prompt template management
 * - Token counting and cost tracking
 * - Response normalization across providers
 * - Automatic fallback and retry logic
 * - Health monitoring and circuit breaking
 */

class ProviderAbstractionLayer {
  constructor() {
    this.providers = new Map();
    this.skillPrompts = new Map();
    this.skillsDirectory = path.join(__dirname, '../../skills');

    // Phase 4: Routing Integration
    this.routingService = providerRoutingService;
    this.tokenTracker = tokenTrackingService;
    this.handoffService = getHandoffService();
    this.routingEnabled = true; // Can be disabled for backward compatibility

    // ZDR-E0-S2: Data Redaction Service
    this.redactionService = getRedactionService();
  }

  /**
   * Initialize the PAL service
   * Load all provider configurations and skill prompts
   */
  async initialize() {
    try {
      logger.info('Initializing Provider Abstraction Layer');

      // Load all active provider configurations
      const configs = await ProviderConfig.find()
        .active()
        .sort({ priority: -1 });

      logger.info(`Loaded ${configs.length} active provider configurations`);

      // Initialize providers
      for (const config of configs) {
        try {
          await this._initializeProvider(config);
        } catch (error) {
          logger.error(`Failed to initialize provider ${config.provider}:${config.modelId}`, {
            error: error.message
          });
        }
      }

      // Load all skill prompts
      await this._loadAllSkillPrompts();

      // Phase 4: Initialize routing services
      if (this.routingEnabled) {
        try {
          await this.routingService.loadRoutingRules();
          await this.handoffService.initialize();
          logger.info('Routing services initialized successfully');
        } catch (error) {
          logger.warn('Routing services initialization failed, using legacy selection', {
            error: error.message
          });
          this.routingEnabled = false; // Fall back to legacy mode
        }
      }

      logger.info('Provider Abstraction Layer initialized successfully', {
        providers: this.providers.size,
        skills: this.skillPrompts.size,
        routingEnabled: this.routingEnabled
      });

    } catch (error) {
      logger.error('Failed to initialize Provider Abstraction Layer', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Main unified interface: Call an LLM model
   * @param {string} skillRef - Skill reference (e.g., 'mudbook-gate', 'deal-flow')
   * @param {Object} input - Input data for the skill
   * @param {Object} config - Configuration options
   * @param {string} config.provider - Preferred provider (optional)
   * @param {string} config.model - Preferred model (optional)
   * @param {string} config.agentType - Agent type for routing (optional)
   * @param {string} config.sessionId - Session ID for tracking (optional)
   * @param {Object} config.sessionContext - Full session context for handoffs (optional)
   * @param {number} config.temperature - Temperature override (optional)
   * @param {number} config.maxTokens - Max tokens override (optional)
   * @param {boolean} config.streaming - Enable streaming (optional)
   * @param {Function} config.onChunk - Streaming callback (optional)
   * @param {boolean} config.enableFallback - Enable automatic fallback (default: true)
   * @param {boolean} config.failClosed - Enable fail-closed routing mode (default: false, true for ZDR tenants)
   * @param {Array<string>} config.allowedProviders - Providers allowed for this request (required if failClosed)
   * @returns {Promise<Object>} Normalized response with content, usage, and metadata
   */
  async callModel(skillRef, input, config = {}) {
    const startTime = Date.now();

    try {
      logger.info('PAL callModel request', {
        skillRef,
        provider: config.provider,
        model: config.model,
        agentType: config.agentType,
        sessionId: config.sessionId,
        streaming: config.streaming,
        routingEnabled: this.routingEnabled
      });

      // Phase 4: Check if session should trigger handoff BEFORE making request
      if (this.routingEnabled && config.sessionId) {
        const handoffCheck = await this.tokenTracker.shouldTriggerHandoff(config.sessionId);
        if (handoffCheck.shouldTrigger) {
          // Create handoff
          const handoff = await this.handoffService.createHandoff(
            config.sessionContext || {
              sessionId: config.sessionId,
              userId: input.userId,
              agentType: config.agentType || this._inferAgentType(skillRef, config),
              conversationHistory: input.messages || [],
              currentTask: { skillRef, input }
            },
            handoffCheck.reason,
            {
              tokensUsed: handoffCheck.details.tokensUsed,
              costAccumulated: handoffCheck.costAccumulated,
              requestCount: handoffCheck.details.requestCount
            }
          );

          throw new SessionHandoffRequiredError(
            handoff.handoffId,
            handoffCheck.reason,
            config.sessionContext || { sessionId: config.sessionId },
            this.handoffService.formatHandoffMessage(handoff)
          );
        }
      }

      // 1. Infer agent type from skillRef or config
      const agentType = config.agentType || this._inferAgentType(skillRef, config);

      // 2. Select provider (with routing if enabled)
      let provider;
      if (this.routingEnabled && !config.provider) {
        // Use routing service for intelligent provider selection
        const routingContext = {
          sessionId: config.sessionId,
          taskType: config.taskType,
          estimatedTokens: config.estimatedTokens,
          preferences: config.preferences
        };

        const availableProviders = Array.from(this.providers.values());
        const routingResult = await this.routingService.selectProvider(
          agentType,
          routingContext,
          availableProviders
        );

        provider = {
          provider: routingResult.config.provider,
          config: routingResult.config
        };

        // Find the provider instance
        const providerKey = `${routingResult.config.provider}:${routingResult.config.modelId}`;
        const providerInstance = this.providers.get(providerKey);
        if (providerInstance) {
          provider = providerInstance;
        }

        logger.info('Provider selected via routing', {
          agentType,
          provider: provider.config.provider,
          model: provider.config.modelId,
          score: routingResult.score,
          reason: routingResult.selectionReason
        });

      } else {
        // Use legacy provider selection
        provider = await this._selectProvider(config);
      }

      // 3. Call with fallback chain
      return await this._callWithFallback(provider, agentType, skillRef, input, config);

    } catch (error) {
      const latency = Date.now() - startTime;

      // Don't log SessionHandoffRequiredError as error - it's a controlled handoff
      if (error instanceof SessionHandoffRequiredError) {
        logger.info('Session handoff triggered', {
          skillRef,
          sessionId: config.sessionId,
          reason: error.reason,
          handoffId: error.handoffId
        });
      } else {
        logger.error('PAL callModel failed', {
          skillRef,
          error: error.message,
          latency
        });
      }

      throw error;
    }
  }

  /**
   * Get available providers
   * @returns {Array<Object>} List of available providers
   */
  getAvailableProviders() {
    return Array.from(this.providers.values()).map(p => ({
      provider: p.config.provider,
      model: p.config.modelId,
      modelName: p.config.modelName,
      status: p.config.status,
      capabilities: p.provider.getCapabilities(),
      health: {
        status: p.config.healthStatus,
        consecutiveFailures: p.config.health.consecutiveFailures,
        averageLatency: p.config.health.averageLatency
      },
      usage: {
        totalRequests: p.config.usage.totalRequests,
        totalCost: p.config.usage.totalCost
      }
    }));
  }

  /**
   * Get available skills
   * @returns {Array<Object>} List of available skills
   */
  getAvailableSkills() {
    return Array.from(this.skillPrompts.entries()).map(([skillRef, prompts]) => ({
      skillRef,
      providers: Object.keys(prompts),
      hasGeneric: prompts.generic !== undefined
    }));
  }

  /**
   * Reload a specific provider configuration
   * @param {string} provider - Provider name
   * @param {string} modelId - Model ID
   */
  async reloadProvider(provider, modelId) {
    const key = `${provider}:${modelId}`;
    const config = await ProviderConfig.findOne({ provider, modelId })
      .select('+apiConfig.apiKey');

    if (!config) {
      throw new Error(`Provider configuration not found: ${key}`);
    }

    await this._initializeProvider(config);
    logger.info(`Provider reloaded: ${key}`);
  }

  /**
   * Reload all skill prompts
   */
  async reloadSkills() {
    this.skillPrompts.clear();
    await this._loadAllSkillPrompts();
    logger.info(`Reloaded ${this.skillPrompts.size} skills`);
  }

  /**
   * Perform health check on all providers
   * @returns {Promise<Object>} Health check results
   */
  async performHealthChecks() {
    const results = {
      timestamp: new Date(),
      providers: []
    };

    for (const [key, { provider, config }] of this.providers) {
      try {
        const startTime = Date.now();
        const isHealthy = await provider.healthCheck();
        const latency = Date.now() - startTime;

        await config.updateHealth(isHealthy, latency, isHealthy ? null : 'Health check failed');

        results.providers.push({
          provider: config.provider,
          model: config.modelId,
          healthy: isHealthy,
          latency,
          status: config.status
        });

      } catch (error) {
        await config.updateHealth(false, 0, error.message);

        results.providers.push({
          provider: config.provider,
          model: config.modelId,
          healthy: false,
          error: error.message,
          status: config.status
        });
      }
    }

    return results;
  }

  // Private Methods

  /**
   * Initialize a provider instance
   * @private
   */
  async _initializeProvider(config) {
    const key = `${config.provider}:${config.modelId}`;

    let providerInstance;
    switch (config.provider) {
      case 'anthropic':
        providerInstance = new AnthropicProvider(config);
        break;
      case 'openai':
        providerInstance = new OpenAIProvider(config);
        break;
      case 'gemini':
        providerInstance = new GeminiProvider(config);
        break;
      case 'qwen':
        providerInstance = new QwenProvider(config);
        break;
      case 'glm':
        providerInstance = new GLMProvider(config);
        break;
      case 'deepseek':
        providerInstance = new DeepSeekProvider(config);
        break;
      case 'opensource':
        // ZDR-E0-S5: 'opensource' is a valid enum value but not a specific provider
        // It's a category for self-hosted/open-source models
        // For now, log a warning and skip initialization
        logger.warn(`Skipping initialization of 'opensource' provider - requires specific provider implementation`, {
          modelId: config.modelId,
          provider: config.provider
        });
        return; // Skip adding to providers map
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    this.providers.set(key, {
      provider: providerInstance,
      config
    });

    logger.info(`Initialized provider: ${key}`);
  }

  /**
   * Load all skill prompts from the skills directory
   * @private
   */
  async _loadAllSkillPrompts() {
    try {
      const skillDirs = await fs.readdir(this.skillsDirectory);

      for (const skillDir of skillDirs) {
        const skillPath = path.join(this.skillsDirectory, skillDir);
        const stat = await fs.stat(skillPath);

        if (stat.isDirectory()) {
          await this._loadSkillPrompts(skillDir, skillPath);
        }
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('Skills directory not found, creating it', {
          path: this.skillsDirectory
        });
        await fs.mkdir(this.skillsDirectory, { recursive: true });
      } else {
        throw error;
      }
    }
  }

  /**
   * Load prompts for a specific skill
   * @private
   */
  async _loadSkillPrompts(skillRef, skillPath) {
    try {
      const promptsPath = path.join(skillPath, 'prompts');
      const prompts = {};

      // Load provider-specific prompts
      const providers = ['anthropic', 'openai', 'gemini', 'qwen', 'glm', 'generic'];
      for (const provider of providers) {
        const promptFile = path.join(promptsPath, `${provider}.md`);
        try {
          const content = await fs.readFile(promptFile, 'utf-8');
          prompts[provider] = this._parsePromptFile(content);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            logger.warn(`Failed to load prompt for ${skillRef}:${provider}`, {
              error: error.message
            });
          }
        }
      }

      if (Object.keys(prompts).length > 0) {
        this.skillPrompts.set(skillRef, prompts);
        logger.info(`Loaded prompts for skill: ${skillRef}`, {
          providers: Object.keys(prompts)
        });
      }

    } catch (error) {
      logger.error(`Failed to load skill prompts: ${skillRef}`, {
        error: error.message
      });
    }
  }

  /**
   * Parse a prompt file
   * @private
   */
  _parsePromptFile(content) {
    const lines = content.split('\n');
    let systemPrompt = '';
    let userPrompt = '';
    let currentSection = null;
    let metadata = {};

    for (const line of lines) {
      if (line.startsWith('# SYSTEM')) {
        currentSection = 'system';
      } else if (line.startsWith('# USER')) {
        currentSection = 'user';
      } else if (line.startsWith('# METADATA')) {
        currentSection = 'metadata';
      } else if (line.startsWith('---')) {
        continue;
      } else {
        if (currentSection === 'system') {
          systemPrompt += line + '\n';
        } else if (currentSection === 'user') {
          userPrompt += line + '\n';
        } else if (currentSection === 'metadata') {
          const match = line.match(/^(\w+):\s*(.+)$/);
          if (match) {
            metadata[match[1]] = match[2].trim();
          }
        }
      }
    }

    return {
      systemPrompt: systemPrompt.trim(),
      userPromptTemplate: userPrompt.trim(),
      metadata
    };
  }

  /**
   * Get skill prompt for a specific provider
   * @private
   */
  async _getSkillPrompt(skillRef, preferredProvider = null) {
    const skillPrompts = this.skillPrompts.get(skillRef);

    if (!skillPrompts) {
      throw new Error(`Skill not found: ${skillRef}`);
    }

    // Try preferred provider first
    if (preferredProvider && skillPrompts[preferredProvider]) {
      return skillPrompts[preferredProvider];
    }

    // Fall back to generic
    if (skillPrompts.generic) {
      return skillPrompts.generic;
    }

    // Use any available prompt
    const available = Object.values(skillPrompts)[0];
    if (available) {
      return available;
    }

    throw new Error(`No prompt template found for skill: ${skillRef}`);
  }

  /**
   * Select the best provider based on configuration
   * @private
   */
  async _selectProvider(config) {
    // If specific provider and model requested
    if (config.provider && config.model) {
      const key = `${config.provider}:${config.model}`;
      const provider = this.providers.get(key);

      if (!provider) {
        throw new Error(`Provider not found: ${key}`);
      }

      if (!provider.config.isAvailable()) {
        throw new Error(`Provider not available: ${key}`);
      }

      return provider;
    }

    // If only provider requested
    if (config.provider) {
      const available = Array.from(this.providers.values())
        .filter(p =>
          p.config.provider === config.provider &&
          p.config.isAvailable()
        )
        .sort((a, b) => b.config.priority - a.config.priority);

      if (available.length === 0) {
        throw new Error(`No available providers for: ${config.provider}`);
      }

      return available[0];
    }

    // Select best available provider
    const available = Array.from(this.providers.values())
      .filter(p => p.config.isAvailable())
      .sort((a, b) => {
        // Sort by: priority DESC, failures ASC, latency ASC
        if (a.config.priority !== b.config.priority) {
          return b.config.priority - a.config.priority;
        }
        if (a.config.health.consecutiveFailures !== b.config.health.consecutiveFailures) {
          return a.config.health.consecutiveFailures - b.config.health.consecutiveFailures;
        }
        return a.config.health.averageLatency - b.config.health.averageLatency;
      });

    if (available.length === 0) {
      throw new Error('No available providers');
    }

    return available[0];
  }

  /**
   * Build prompt from template and input
   * @private
   */
  _buildPromptFromTemplate(template, input) {
    let userPrompt = template.userPromptTemplate;

    // Replace template variables
    if (input.variables) {
      for (const [key, value] of Object.entries(input.variables)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        userPrompt = userPrompt.replace(regex, value);
      }
    }

    return {
      systemPrompt: template.systemPrompt,
      userPrompt,
      version: template.metadata?.version
    };
  }

  /**
   * Calculate cost for a request
   * @private
   */
  _calculateCost(config, usage) {
    const inputCost = (usage.inputTokens / 1000000) * config.pricing.inputTokenCost;
    const outputCost = (usage.outputTokens / 1000000) * config.pricing.outputTokenCost;
    return {
      input: parseFloat(inputCost.toFixed(6)),
      output: parseFloat(outputCost.toFixed(6)),
      total: parseFloat((inputCost + outputCost).toFixed(6)),
      currency: config.pricing.currency
    };
  }

  /**
   * Record usage metrics
   * @private
   */
  async _recordUsage(config, response, latency) {
    try {
      await config.recordUsage(response.usage.inputTokens, response.usage.outputTokens);
      await config.updateHealth(true, latency);
    } catch (error) {
      logger.error('Failed to record usage metrics', {
        provider: config.provider,
        model: config.modelId,
        error: error.message
      });
    }
  }

  /**
   * Call provider with automatic fallback chain
   * Phase 4: Enhanced with circuit breaker and fallback logic
   * ZDR-E0-S1: Added fail-closed routing mode to prevent egress policy violations
   * @private
   */
  async _callWithFallback(provider, agentType, skillRef, input, config) {
    const startTime = Date.now();
    const attemptedProviders = [];
    const failures = [];

    // ZDR-E0-S1: Fail-closed mode validation
    const failClosed = config.failClosed || false;
    const allowedProviders = config.allowedProviders || [];

    // Validate primary provider against allow-list if fail-closed mode enabled
    if (failClosed && allowedProviders.length > 0) {
      const primaryProviderName = provider.config.provider;
      if (!allowedProviders.includes(primaryProviderName)) {
        logger.error('Egress policy violation: Primary provider not on allow-list', {
          requestedProvider: primaryProviderName,
          allowedProviders,
          failClosed
        });

        throw new EgressPolicyViolationError(
          primaryProviderName,
          allowedProviders,
          'Provider not on tenant allow-list'
        );
      }
    }

    // Build list of providers to try
    const providersToTry = [provider];

    // Add fallback providers if routing is enabled
    if (this.routingEnabled && config.enableFallback !== false) {
      // Get fallback chain from routing service
      let availableProviders = Array.from(this.providers.values())
        .filter(p => p.config.provider !== provider.config.provider);

      // ZDR-E0-S1: Filter by allow-list if fail-closed mode enabled
      if (failClosed && allowedProviders.length > 0) {
        availableProviders = availableProviders.filter(p =>
          allowedProviders.includes(p.config.provider)
        );

        logger.info('Fail-closed mode: Filtered fallback providers by allow-list', {
          originalCount: Array.from(this.providers.values()).length - 1,
          filteredCount: availableProviders.length,
          allowedProviders
        });
      }

      // Limit to 3 total attempts
      while (providersToTry.length < 3 && availableProviders.length > 0) {
        const nextProvider = availableProviders.shift();
        if (nextProvider) {
          providersToTry.push(nextProvider);
        }
      }

      // ZDR-E0-S1: Fail-closed mode with no fallback candidates available
      if (failClosed && providersToTry.length === 1 && config.enableFallback !== false) {
        logger.warn('Fail-closed mode: No fallback providers available on allow-list', {
          primaryProvider: provider.config.provider,
          allowedProviders
        });
      }
    }

    // Try each provider in the chain
    for (const currentProvider of providersToTry) {
      const attemptStart = Date.now();
      const providerKey = `${currentProvider.config.provider}:${currentProvider.config.modelId}`;

      try {
        logger.info('Attempting provider', {
          provider: providerKey,
          attempt: attemptedProviders.length + 1,
          totalProviders: providersToTry.length
        });

        // Check rate limits if routing enabled
        if (this.routingEnabled) {
          const rateLimitCheck = await this.tokenTracker.checkProviderRateLimits(providerKey);
          if (!rateLimitCheck.withinLimits) {
            throw new RateLimitExceededError(
              currentProvider.config.provider,
              rateLimitCheck.limitType,
              rateLimitCheck.retryAfter
            );
          }
        }

        // 1. Load skill prompt template
        const promptTemplate = await this._getSkillPrompt(skillRef, currentProvider.config.provider);

        // 2. Build prompt from template and input
        const prompt = this._buildPromptFromTemplate(promptTemplate, input);

        // 3. Prepare request parameters
        const params = {
          prompt: prompt.userPrompt,
          systemPrompt: prompt.systemPrompt,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          stopSequences: config.stopSequences,
          messages: input.messages,
          metadata: {
            skillRef,
            agentType,
            userId: input.userId,
            requestId: input.requestId,
            sessionId: config.sessionId
          }
        };

        // ZDR-E0-S2: Redact sensitive data BEFORE provider call (Guarantee G4)
        let redactionResult = { redactionCount: 0, redactionDetails: [] };

        if (config.enableRedaction !== false) { // Default: enabled
          // Redact user prompt
          if (params.prompt) {
            const redacted = this.redactionService.redact(params.prompt);
            params.prompt = redacted.redactedContent;
            redactionResult.redactionCount += redacted.redactionCount;
            redactionResult.redactionDetails.push(...redacted.redactionDetails);
          }

          // Redact system prompt
          if (params.systemPrompt) {
            const redacted = this.redactionService.redact(params.systemPrompt);
            params.systemPrompt = redacted.redactedContent;
            redactionResult.redactionCount += redacted.redactionCount;
            redactionResult.redactionDetails.push(...redacted.redactionDetails);
          }

          // Redact messages (if present)
          if (params.messages && Array.isArray(params.messages)) {
            params.messages = params.messages.map(msg => {
              if (msg.content) {
                const redacted = this.redactionService.redact(msg.content);
                redactionResult.redactionCount += redacted.redactionCount;
                redactionResult.redactionDetails.push(...redacted.redactionDetails);
                return { ...msg, content: redacted.redactedContent };
              }
              return msg;
            });
          }

          logger.info('Content redacted before provider call', {
            provider: providerKey,
            redactionCount: redactionResult.redactionCount,
            types: redactionResult.redactionDetails.map(d => d.type)
          });
        }

        // 4. Call the provider
        let response;
        if (config.streaming && currentProvider.provider.config.capabilities.supportsStreaming) {
          response = await currentProvider.provider.callStreaming(params, config.onChunk);
        } else {
          response = await currentProvider.provider.call(params);
        }

        const latency = Date.now() - attemptStart;

        // 5. Record success metrics
        await this._recordUsage(currentProvider.config, response, latency);

        // Record provider success for circuit breaker
        this._recordProviderAttempt(providerKey, true, latency);

        // Track token usage for session
        if (this.routingEnabled && config.sessionId) {
          await this.tokenTracker.trackUsage(
            config.sessionId,
            currentProvider.config.provider,
            response.usage.inputTokens,
            response.usage.outputTokens,
            this._calculateCost(currentProvider.config, response.usage).total,
            latency,
            true,
            response.headers || {}
          );
        }

        // 6. Return normalized response
        const result = {
          ...response,
          skillRef,
          agentType,
          promptTemplate: {
            skill: skillRef,
            provider: currentProvider.config.provider,
            version: promptTemplate.version || '1.0'
          },
          cost: this._calculateCost(currentProvider.config, response.usage),
          totalLatency: Date.now() - startTime,
          provider: {
            name: currentProvider.config.provider,
            model: currentProvider.config.modelId,
            attemptNumber: attemptedProviders.length + 1,
            fallbacksUsed: attemptedProviders.length
          },
          // ZDR-E0-S2: Include redaction metadata (Guarantee G4)
          redaction: {
            count: redactionResult.redactionCount,
            applied: redactionResult.redactionCount > 0,
            details: redactionResult.redactionDetails.map(d => ({
              type: d.type,
              count: d.count
            }))
          }
        };

        logger.info('PAL callModel success', {
          skillRef,
          agentType,
          provider: currentProvider.config.provider,
          model: currentProvider.config.modelId,
          attempt: attemptedProviders.length + 1,
          latency: result.totalLatency,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cost: result.cost
        });

        return result;

      } catch (error) {
        const latency = Date.now() - attemptStart;

        // Convert to PAL error
        const palError = fromProviderError(error, currentProvider.config.provider, currentProvider.config.modelId);

        // Record failure
        attemptedProviders.push(providerKey);
        failures.push({
          provider: providerKey,
          error: palError.message,
          code: palError.code,
          latency,
          timestamp: new Date()
        });

        // Record provider failure for circuit breaker
        this._recordProviderAttempt(providerKey, false, latency, palError);

        logger.warn('Provider attempt failed', {
          provider: providerKey,
          attempt: attemptedProviders.length,
          error: palError.message,
          code: palError.code,
          latency
        });

        // Check if we should retry with fallback
        const shouldRetry = this._shouldRetryWithFallback(palError, attemptedProviders.length, providersToTry.length);

        if (!shouldRetry) {
          // Don't retry - throw immediately
          throw palError;
        }

        // If this was the last provider, throw ProviderChainExhaustedError
        if (attemptedProviders.length >= providersToTry.length) {
          throw new ProviderChainExhaustedError(agentType, attemptedProviders, failures);
        }

        // Otherwise, continue to next provider in the loop
        logger.info('Retrying with next provider in fallback chain', {
          failedProvider: providerKey,
          remainingProviders: providersToTry.length - attemptedProviders.length
        });
      }
    }

    // Should never reach here, but just in case
    throw new ProviderChainExhaustedError(agentType, attemptedProviders, failures);
  }

  /**
   * Infer agent type from skill reference and config
   * Phase 4: Agent type inference for routing
   * @private
   */
  _inferAgentType(skillRef, config) {
    // Explicit agent type in config takes precedence
    if (config.agentType) {
      return config.agentType;
    }

    // Map skill references to agent types
    const skillToAgentMap = {
      'mudbook-gate': 'mudbook-gate',
      'deal-flow': 'deal-flow',
      'deal-analysis': 'deal-flow',
      'financial-analysis': 'financial-analysis',
      'financial-report': 'financial-analysis',
      'document-processing': 'document-processing',
      'document-extraction': 'document-processing',
      'code-generation': 'code-generation',
      'code-review': 'code-generation',
      'data-extraction': 'data-extraction'
    };

    // Check for exact match
    if (skillToAgentMap[skillRef]) {
      return skillToAgentMap[skillRef];
    }

    // Check for partial match
    for (const [skillPattern, agentType] of Object.entries(skillToAgentMap)) {
      if (skillRef.includes(skillPattern) || skillPattern.includes(skillRef)) {
        return agentType;
      }
    }

    // Default to general-assistant
    return 'general-assistant';
  }

  /**
   * Check if an error should trigger fallback retry
   * Phase 4: Fallback decision logic
   * @private
   */
  _shouldRetryWithFallback(error, attemptNumber, totalProviders) {
    // Don't retry if we've exhausted all providers
    if (attemptNumber >= totalProviders) {
      return false;
    }

    // Use helper from palErrors
    return shouldRetryWithFallback(error);
  }

  /**
   * Record a provider attempt for metrics and circuit breaker
   * Phase 4: Provider health tracking
   * @private
   */
  _recordProviderAttempt(providerKey, success, latency, error = null) {
    try {
      // Record in routing service circuit breaker
      if (this.routingEnabled) {
        this.routingService.recordProviderAttempt(providerKey, success, latency, error);
      }

      logger.debug('Provider attempt recorded', {
        provider: providerKey,
        success,
        latency,
        error: error?.message
      });

    } catch (recordError) {
      logger.error('Failed to record provider attempt', {
        provider: providerKey,
        error: recordError.message
      });
      // Don't throw - recording failure shouldn't break the request
    }
  }

  /**
   * Attempt fallback to another provider (legacy method - kept for backward compatibility)
   * @private
   * @deprecated Use _callWithFallback instead
   */
  async _attemptFallback(skillRef, input, config, originalError) {
    logger.warn('Attempting fallback provider (legacy method)', {
      skillRef,
      originalProvider: config.provider,
      error: originalError.message
    });

    try {
      // Try with a different provider
      const fallbackConfig = {
        ...config,
        provider: undefined, // Let it auto-select
        model: undefined
      };

      return await this.callModel(skillRef, input, fallbackConfig);

    } catch (fallbackError) {
      logger.error('Fallback failed', {
        skillRef,
        error: fallbackError.message
      });

      throw originalError; // Throw original error
    }
  }
}

// Singleton instance
let palInstance = null;

/**
 * Get the PAL singleton instance
 */
function getPAL() {
  if (!palInstance) {
    palInstance = new ProviderAbstractionLayer();
  }
  return palInstance;
}

module.exports = {
  ProviderAbstractionLayer,
  getPAL
};
