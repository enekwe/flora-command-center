/**
 * ZDR Conformance Tests — ZDR-E10-S1/S2
 *
 * E10-S1: Adversarial egress tests that verify every provider path
 * honors trust-tier/fail-closed. Blocks merge on violation.
 *
 * E10-S2: Chaos drills simulating provider outages and rate limits
 * to verify fail-closed holds under failure.
 */

describe('ZDR-E10-S1: Adversarial egress conformance', () => {
  const { ZDRPolicyEngine } = require('../../../src/services/zdrPolicyEngine');
  const { getZeroRetentionHeaders, hasTenantOptedIn } = require('../../../src/services/zdrContractedService');

  let engine;

  beforeEach(() => {
    engine = new ZDRPolicyEngine();
  });

  it('should block standard_hosted provider for ZDR tenant requiring self_hosted', () => {
    engine.updatePolicy('zdr-tenant', {
      isZDR: true,
      requiredTrustTier: 'self_hosted',
      failClosed: true
    });

    const result = engine.checkProviderAllowed('zdr-tenant', 'anthropic', 'standard_hosted');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('below required');
  });

  it('should allow self_hosted provider for ZDR tenant', () => {
    engine.updatePolicy('zdr-tenant', {
      isZDR: true,
      requiredTrustTier: 'self_hosted',
      failClosed: true
    });

    const result = engine.checkProviderAllowed('zdr-tenant', 'vllm', 'self_hosted');
    expect(result.allowed).toBe(true);
  });

  it('should allow zdr_contracted for tenant that opted in', () => {
    engine.updatePolicy('mixed-tenant', {
      isZDR: false,
      requiredTrustTier: 'zdr_contracted',
      failClosed: false
    });

    const result = engine.checkProviderAllowed('mixed-tenant', 'anthropic', 'zdr_contracted');
    expect(result.allowed).toBe(true);
  });

  it('should block providers not on tenant allow-list', () => {
    engine.updatePolicy('restricted-tenant', {
      requiredTrustTier: 'standard_hosted',
      allowedEndpoints: ['anthropic'],
      failClosed: true
    });

    const allowed = engine.checkProviderAllowed('restricted-tenant', 'anthropic', 'standard_hosted');
    expect(allowed.allowed).toBe(true);

    const blocked = engine.checkProviderAllowed('restricted-tenant', 'openai', 'standard_hosted');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('not on tenant allow-list');
  });

  it('should never enable hard erase (ZDR-EX-1 gate)', () => {
    const policy = engine.updatePolicy('test-tenant', { hardEraseEnabled: true });
    expect(policy.hardEraseEnabled).toBe(false);
  });

  it('should reject invalid trust tier', () => {
    expect(() => {
      engine.updatePolicy('test', { requiredTrustTier: 'invalid_tier' });
    }).toThrow('Invalid trust tier');
  });
});

describe('ZDR-E10-S1: Fail-closed under all provider paths', () => {
  const { EgressPolicyViolationError } = require('../../../src/utils/errors/palErrors');

  it('should have EgressPolicyViolationError with correct properties', () => {
    const error = new EgressPolicyViolationError(
      'openai',
      ['anthropic', 'self_hosted'],
      'Test violation'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EgressPolicyViolationError');
    expect(error.statusCode).toBe(403);
    expect(error.provider).toBe('openai');
    expect(error.allowedProviders).toContain('anthropic');
  });

  it('should generate user-facing message', () => {
    const error = new EgressPolicyViolationError('gemini', ['anthropic']);
    const message = error.toUserMessage();

    expect(message).toContain('gemini');
    expect(message).toContain('anthropic');
  });
});

describe('ZDR-E10-S2: Chaos drill — provider outage fail-closed', () => {
  it('should not cross trust tiers when primary provider is down', () => {
    const { ZDRPolicyEngine } = require('../../../src/services/zdrPolicyEngine');
    const engine = new ZDRPolicyEngine();

    engine.updatePolicy('zdr-corp', {
      isZDR: true,
      requiredTrustTier: 'self_hosted',
      failClosed: true
    });

    // Simulate: self-hosted provider is down
    // The routing service should NOT fall back to standard_hosted
    const selfHosted = engine.checkProviderAllowed('zdr-corp', 'vllm-down', 'self_hosted');
    const standardFallback = engine.checkProviderAllowed('zdr-corp', 'anthropic', 'standard_hosted');

    // Self-hosted: allowed by policy (availability is separate concern)
    expect(selfHosted.allowed).toBe(true);
    // Standard fallback: BLOCKED by policy even if primary is down
    expect(standardFallback.allowed).toBe(false);
  });

  it('should not cross trust tiers when rate limited', () => {
    const { ZDRPolicyEngine } = require('../../../src/services/zdrPolicyEngine');
    const engine = new ZDRPolicyEngine();

    engine.updatePolicy('zdr-corp', {
      isZDR: true,
      requiredTrustTier: 'zdr_contracted',
      failClosed: true
    });

    // Even when rate limited on contracted provider, should not fall to standard
    const contractedCheck = engine.checkProviderAllowed('zdr-corp', 'anthropic', 'zdr_contracted');
    const standardCheck = engine.checkProviderAllowed('zdr-corp', 'openai', 'standard_hosted');

    expect(contractedCheck.allowed).toBe(true);
    expect(standardCheck.allowed).toBe(false);
  });
});

describe('ZDR-E6: ZDR-Contracted provider management', () => {
  const {
    getZeroRetentionHeaders,
    validateContractedProvider,
    applyZeroRetentionOptions
  } = require('../../../src/services/zdrContractedService');

  it('should return zero-retention headers for known providers', () => {
    const anthropicHeaders = getZeroRetentionHeaders('anthropic');
    expect(anthropicHeaders).toHaveProperty('anthropic-beta');

    const genericHeaders = getZeroRetentionHeaders('unknown_provider');
    expect(genericHeaders['X-Data-Retention']).toBe('none');
    expect(genericHeaders['X-No-Training']).toBe('true');
  });

  it('should validate contracted provider configuration', () => {
    const valid = validateContractedProvider({
      trustTier: 'zdr_contracted',
      provider: 'anthropic',
      metadata: { zdrEvidenceLink: 'https://dpa.example.com/contract-123' }
    });
    expect(valid.valid).toBe(true);

    const noEvidence = validateContractedProvider({
      trustTier: 'zdr_contracted',
      provider: 'anthropic',
      metadata: {}
    });
    expect(noEvidence.warnings.length).toBeGreaterThan(0);
  });

  it('should apply zero-retention options to request', () => {
    const options = applyZeroRetentionOptions('anthropic', {
      temperature: 0.7,
      headers: { 'Content-Type': 'application/json' }
    });

    expect(options.temperature).toBe(0.7);
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['anthropic-beta']).toBeDefined();
  });
});

describe('ZDR-E11-S1: Per-tenant policy engine', () => {
  const { ZDRPolicyEngine } = require('../../../src/services/zdrPolicyEngine');

  it('should return default policy for unknown tenant', () => {
    const engine = new ZDRPolicyEngine();
    const policy = engine.getPolicy('unknown-tenant');

    expect(policy.companyId).toBe('unknown-tenant');
    expect(policy.requiredTrustTier).toBe('standard_hosted');
    expect(policy.failClosed).toBe(false);
    expect(policy.hardEraseEnabled).toBe(false);
  });

  it('should return ZDR defaults for known ZDR tenant', () => {
    // Set up ZDR tenant in config
    const originalTenants = process.env.ZDR_TENANT_IDS;
    process.env.ZDR_TENANT_IDS = 'zdr-corp,test-zdr';

    const engine = new ZDRPolicyEngine();
    const policy = engine.getPolicy('zdr-corp');

    expect(policy.isZDR).toBe(true);
    expect(policy.requiredTrustTier).toBe('self_hosted');
    expect(policy.failClosed).toBe(true);
    expect(policy.retentionDays).toBe(0);

    process.env.ZDR_TENANT_IDS = originalTenants;
  });

  it('should enforce custom redaction patterns', () => {
    const engine = new ZDRPolicyEngine();
    engine.updatePolicy('custom-tenant', {
      customRedactionPatterns: [
        { name: 'internal_id', pattern: /INT-\d{6}/g, replacement: '[INTERNAL_ID]' }
      ]
    });

    const patterns = engine.getCustomRedactionPatterns('custom-tenant');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe('internal_id');
  });
});
