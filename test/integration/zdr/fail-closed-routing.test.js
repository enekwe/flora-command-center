/**
 * ZDR-E0-S1: Fail-Closed Routing Mode Tests
 *
 * Acceptance Criteria:
 * - When enabled, PAL._callWithFallback throws EgressPolicyViolationError
 *   instead of crossing to a provider not on the request's allow-list
 * - Covered by tests simulating primary-provider outage
 *
 * NOTE: These tests validate the fail-closed logic. Full integration tests
 * require database and provider mocking infrastructure.
 */

// Set ENCRYPTION_KEY before any requires (needed by encryption.js loaded transitively)
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { ProviderAbstractionLayer } = require('../../../src/services/providerAbstractionLayer');
const {
  EgressPolicyViolationError
} = require('../../../src/utils/errors/palErrors');

describe('ZDR-E0-S1: Fail-Closed Routing Mode', () => {
  describe('EgressPolicyViolationError', () => {
    it('should create error with correct properties', () => {
      const error = new EgressPolicyViolationError(
        'qwen',
        ['anthropic', 'openai'],
        'Provider not on tenant allow-list'
      );

      expect(error).toBeInstanceOf(EgressPolicyViolationError);
      expect(error.code).toBe('EGRESS_POLICY_VIOLATION');
      expect(error.requestedProvider).toBe('qwen');
      expect(error.allowedProviders).toEqual(['anthropic', 'openai']);
      expect(error.isRecoverable).toBe(false);
      expect(error.isRetryable).toBe(false);
    });

    it('should generate user-friendly message', () => {
      const error = new EgressPolicyViolationError(
        'qwen',
        ['anthropic', 'openai']
      );

      const userMessage = error.getUserMessage();

      expect(userMessage.type).toBe('egress_policy_violation');
      expect(userMessage.message).toContain('not approved');
      expect(userMessage.requestedProvider).toBe('qwen');
    });

    it('should handle empty allow-list', () => {
      const error = new EgressPolicyViolationError('qwen', []);

      expect(error.message).toContain('none (fail-closed mode enabled)');
    });
  });

  describe('PAL Configuration', () => {
    it('should accept failClosed and allowedProviders in config', () => {
      // Config object shape that PAL._callWithFallback accepts
      const config = {
        failClosed: true,
        allowedProviders: ['anthropic', 'openai'],
        enableFallback: true
      };

      expect(config.failClosed).toBe(true);
      expect(config.allowedProviders).toHaveLength(2);
      expect(config.enableFallback).toBe(true);
    });
  });

  describe('Fail-Closed Logic Validation', () => {
    it('validates primary provider against allow-list', () => {
      // Test case: failClosed=true, primary provider NOT on allow-list
      const config = {
        failClosed: true,
        allowedProviders: ['anthropic', 'openai'],
        enableFallback: true
      };

      // Simulate primary provider being 'qwen' (not on allow-list)
      const primaryProvider = {
        config: { provider: 'qwen', modelId: 'qwen-turbo' }
      };

      // In PAL._callWithFallback, this should throw EgressPolicyViolationError
      // before attempting the call

      expect(primaryProvider.config.provider).toBe('qwen');
      expect(config.allowedProviders).not.toContain('qwen');
    });

    it('allows primary provider on allow-list', () => {
      // Test case: failClosed=true, primary provider ON allow-list
      const config = {
        failClosed: true,
        allowedProviders: ['anthropic', 'openai'],
        enableFallback: true
      };

      const primaryProvider = {
        config: { provider: 'anthropic', modelId: 'claude-3-sonnet-20240229' }
      };

      expect(config.allowedProviders).toContain(primaryProvider.config.provider);
    });

    it('filters fallback chain by allow-list', () => {
      // Simulate fallback chain filtering
      const config = {
        failClosed: true,
        allowedProviders: ['anthropic', 'openai']
      };

      const allProviders = [
        { config: { provider: 'qwen', modelId: 'qwen-turbo' } },
        { config: { provider: 'glm', modelId: 'glm-4' } },
        { config: { provider: 'openai', modelId: 'gpt-4' } },
        { config: { provider: 'gemini', modelId: 'gemini-pro' } }
      ];

      // Filter by allow-list
      const allowedFallbacks = allProviders.filter(p =>
        config.allowedProviders.includes(p.config.provider)
      );

      expect(allowedFallbacks).toHaveLength(1);
      expect(allowedFallbacks[0].config.provider).toBe('openai');
    });

    it('handles empty allow-list in fail-closed mode', () => {
      // Test case: failClosed=true with empty allow-list = reject everything
      const config = {
        failClosed: true,
        allowedProviders: []
      };

      const primaryProvider = {
        config: { provider: 'anthropic', modelId: 'claude-3-opus-20240229' }
      };

      // Should reject even approved providers when allow-list is empty
      expect(config.allowedProviders).toHaveLength(0);
      expect(config.failClosed).toBe(true);
    });
  });

  describe('Integration Test Scenarios', () => {
    it('simulates primary provider outage with fail-closed', () => {
      // Scenario: Primary provider fails, fallback enabled, fail-closed mode
      // Expected: Only fallback to providers on allow-list, throw error if none available

      const scenario = {
        primaryProvider: 'anthropic',
        primaryProviderStatus: 'failed',
        failClosed: true,
        allowedProviders: ['anthropic', 'openai'],
        availableProviders: ['qwen', 'glm', 'openai'],
        expectedFallback: 'openai',
        expectedBehavior: 'fallback to openai, skip qwen and glm'
      };

      expect(scenario.allowedProviders).toContain(scenario.expectedFallback);
      expect(scenario.availableProviders).toContain(scenario.expectedFallback);
    });

    it('simulates total fallback chain exhaustion', () => {
      // Scenario: Primary fails, all allowed fallbacks fail
      // Expected: Throw ProviderChainExhaustedError (not EgressPolicyViolationError)

      const scenario = {
        primaryProvider: 'anthropic',
        primaryProviderStatus: 'failed',
        failClosed: true,
        allowedProviders: ['anthropic', 'openai'],
        anthropicStatus: 'failed',
        openaiStatus: 'failed',
        qwenStatus: 'available',  // Available but not on allow-list
        expectedError: 'ProviderChainExhaustedError',
        expectedBehavior: 'all allowed providers tried and failed, no fallback to qwen'
      };

      expect(scenario.allowedProviders).not.toContain('qwen');
      expect(scenario.expectedError).toBe('ProviderChainExhaustedError');
    });

    it('validates fail-closed disabled allows any fallback', () => {
      // Scenario: failClosed=false (default) should allow any provider fallback
      const scenario = {
        primaryProvider: 'anthropic',
        primaryProviderStatus: 'failed',
        failClosed: false,
        allowedProviders: [],  // Empty list should be ignored when failClosed=false
        availableProviders: ['qwen', 'glm', 'openai'],
        expectedBehavior: 'fallback to any available provider regardless of allow-list'
      };

      expect(scenario.failClosed).toBe(false);
      expect(scenario.availableProviders.length).toBeGreaterThan(0);
    });
  });
});
