const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');
const monolithApiClient = require('../../clients/monolithApiClient');
const dataRedactionService = require('../../services/dataRedactionService');
const ZDRAuditLedger = require('../../models/ZDRAuditLedger');

/**
 * App Kit Data Broker
 *
 * The single governed path by which an app built by the devops App Kit reaches
 * authoritative Flora data (APP_KIT_PROJECT_CONTRACT.md §2.2). A built app never
 * holds raw credentials or a DB handle — it presents a scoped token and names an
 * operation, and this broker:
 *   1. enforces the app's manifest (the hard boundary),
 *   2. enforces tenant isolation,
 *   3. applies redaction before returning data,
 *   4. fetches from the monolith (single source of truth),
 *   5. writes a ZDRAuditLedger row per data touch.
 */

// Operation → monolith call + the manifest requirement it needs.
// Mirrors flora-devops `appKitManifestService.OP_REQUIREMENTS` — keep in sync.
const OPS = {
  getCompany: {
    resource: 'company', access: 'read',
    idArg: 'companyId', tenantScoped: true,
    call: (a) => monolithApiClient.getCompany(a.companyId, a.options || {})
  },
  updateCompany: {
    resource: 'company', access: 'write',
    idArg: 'companyId', tenantScoped: true,
    call: (a) => monolithApiClient.updateCompany(a.companyId, a.updates || {})
  },
  getSite: {
    resource: 'site', access: 'read',
    idArg: 'siteId',
    call: (a) => monolithApiClient.getSite(a.siteId, a.options || {})
  },
  updateSite: {
    resource: 'site', access: 'write',
    idArg: 'siteId',
    call: (a) => monolithApiClient.updateSite(a.siteId, a.updates || {})
  },
  incrementSiteMetrics: {
    resource: 'site.metrics', access: 'write',
    idArg: 'siteId',
    call: (a) => monolithApiClient.incrementSiteMetrics(a.siteId, a.increments || {})
  },
  getUser: {
    resource: 'user', access: 'read',
    idArg: 'userId',
    call: (a) => monolithApiClient.getUser(a.userId)
  },
  createNotification: {
    resource: 'notifications', access: 'write', system: 'notifications',
    call: (a) => monolithApiClient.createNotification(a.notification || {})
  },
  checkMilestones: {
    resource: 'milestones', access: 'write',
    idArg: 'siteId',
    call: (a) => monolithApiClient.checkMilestones(a.siteId)
  }
};

/**
 * Does the token's manifest scope permit this op against this resource id?
 */
function isAllowed(scope, opSpec, resourceId) {
  if (opSpec.system && !(scope.systems || []).includes(opSpec.system)) {
    return { allowed: false, reason: `System '${opSpec.system}' not declared` };
  }
  const match = (scope.dataScopes || []).find((s) => {
    if (s.resource !== opSpec.resource) return false;
    if (s.id && resourceId && s.id !== resourceId) return false;
    return true;
  });
  if (!match) {
    return { allowed: false, reason: `Resource '${opSpec.resource}' not declared` };
  }
  if (opSpec.access === 'write' && match.access !== 'write') {
    return { allowed: false, reason: `Manifest grants only read on '${opSpec.resource}'` };
  }
  return { allowed: true };
}

/**
 * Execute a brokered data operation on behalf of a built app.
 * @param {object} claims - verified scoped-token claims
 * @param {object} body - { op, args }
 * @returns {Promise<{ data: any, redactionCount: number }>}
 */
async function execute(claims, body) {
  const { op, args = {} } = body || {};
  const opSpec = OPS[op];

  if (!opSpec) {
    const e = new Error(`Unknown broker operation: ${op}`);
    e.statusCode = 400;
    throw e;
  }

  const resourceId = opSpec.idArg ? args[opSpec.idArg] : undefined;

  // (1) Manifest enforcement — the hard boundary.
  const verdict = isAllowed(claims.scope || {}, opSpec, resourceId);
  if (!verdict.allowed) {
    logger.warn('App Kit broker denied by manifest', {
      buildId: claims.buildId, op, reason: verdict.reason
    });
    const e = new Error(`Manifest denies operation: ${verdict.reason}`);
    e.statusCode = 403;
    throw e;
  }

  // (2) Tenant isolation — an app may only reach its own company's data.
  if (opSpec.tenantScoped && resourceId && claims.companyId && resourceId !== claims.companyId) {
    logger.warn('App Kit broker cross-tenant access blocked', {
      buildId: claims.buildId, tokenCompany: claims.companyId, requested: resourceId
    });
    const e = new Error('Access denied: resource belongs to another tenant');
    e.statusCode = 403;
    throw e;
  }

  // (4) Authoritative fetch from the monolith.
  let data = await opSpec.call(args);

  // (3) Redaction before the data reaches the app.
  let redactionCount = 0;
  if (config.appKit.redactBrokeredData && data != null) {
    const { redactedContent, redactionCount: count } = dataRedactionService.redact(
      JSON.stringify(data)
    );
    redactionCount = count || 0;
    try {
      data = JSON.parse(redactedContent);
    } catch (_) {
      data = redactedContent; // redaction broke JSON structure — return sanitized string
    }
  }

  // (5) Audit the data touch (metadata only — no content).
  await recordAudit(claims, op, data, redactionCount);

  return { data, redactionCount };
}

async function recordAudit(claims, op, data, redactionCount) {
  try {
    await ZDRAuditLedger.appendEntry({
      requestId: `appkit:${claims.buildId}:${crypto.randomUUID()}`,
      companyId: claims.companyId || 'unknown',
      endpoint: `monolith:${op}`,
      provider: 'flora-monolith',
      trustTier: config.appKit.brokerTrustTier,
      redactionCount,
      bytesEgressed: data != null ? Buffer.byteLength(JSON.stringify(data)) : 0,
      sessionId: claims.buildId,
      agentType: 'appkit',
      status: 'recorded'
    });
  } catch (err) {
    // Audit failure must not silently drop — log loudly, but do not fail the read
    // once data has already been governed and returned.
    logger.error('App Kit broker audit write failed', {
      buildId: claims.buildId, op, error: err.message
    });
  }
}

module.exports = { execute, OPS };
