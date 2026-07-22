const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../../utils/logger');
const AppKitToken = require('../models/AppKitToken');
const { validateSelfHostedClaim } = require('../../services/dataResidencyService');

/**
 * App Kit Token Service
 *
 * Mints, verifies, and revokes the short-lived scoped tokens that a built app
 * presents to the Command Center data broker (APP_KIT_PROJECT_CONTRACT.md §3).
 *
 * The token is a JWT carrying the app's manifest scopes AND the app's ZDR trust
 * classification (derived from where it's deployed), bound to a build and a
 * tenant. Verification also checks the revocation registry so a build can be
 * killed and its data access cut off immediately.
 */

/**
 * Resolve the ZDR trust tier + residency zone implied by a build's deploy target.
 * This describes the app that will RECEIVE brokered data — distinct from
 * config.appKit.brokerTrustTier, which describes the CC->monolith fetch hop.
 * Unmapped/unknown deploy targets get the least-trusted classification so a
 * misconfigured or new target fails closed rather than open.
 */
function resolveAppTrustTier(deployTarget) {
  const mapped = config.appKit.deployTargetTrustTiers[deployTarget];
  return mapped || { trustTier: 'standard_hosted', residencyZone: 'unknown' };
}

/**
 * Mint a scoped app token for a build.
 * @param {object} params
 * @param {string} params.buildId
 * @param {string} params.projectId
 * @param {string} params.requestId
 * @param {string} params.organizationId
 * @param {string} params.userId
 * @param {string} params.companyId
 * @param {string} params.deployTarget - where the built app runs (e.g. 'railway')
 * @param {object} params.scope - { dataScopes: [...], systems: [...] }
 * @returns {Promise<{ token: string, jti: string, expiresIn: string }>}
 */
async function mint(params) {
  const jti = crypto.randomUUID();
  const expiresIn = config.appKit.tokenExpiration;

  const { trustTier, residencyZone } = resolveAppTrustTier(params.deployTarget);

  // Defensive config check: refuse to mint a token that claims self_hosted trust
  // for a deploy target actually classified as a public-cloud residency zone.
  const claimCheck = validateSelfHostedClaim({ trustTier, residencyZone, provider: params.deployTarget });
  if (!claimCheck.valid) {
    logger.error('App Kit token mint refused: inconsistent trust claim', {
      buildId: params.buildId, deployTarget: params.deployTarget, error: claimCheck.error
    });
    const e = new Error(`App Kit deploy-target trust configuration invalid: ${claimCheck.error}`);
    e.statusCode = 500;
    throw e;
  }

  const claims = {
    jti,
    typ: 'appkit-scoped',
    buildId: params.buildId,
    projectId: params.projectId,
    requestId: params.requestId,
    organizationId: params.organizationId,
    userId: params.userId,
    companyId: params.companyId,
    scope: params.scope || { dataScopes: [], systems: [] },
    // The app's own trust classification — checked against tenant ZDR policy on
    // every broker call (see appKitBrokerService).
    appTrustTier: trustTier,
    appResidencyZone: residencyZone
  };

  const token = jwt.sign(claims, config.JWT_SECRET, { expiresIn });
  const decoded = jwt.decode(token);

  await AppKitToken.create({
    jti,
    buildId: params.buildId,
    projectId: params.projectId,
    organizationId: params.organizationId,
    userId: params.userId,
    companyId: params.companyId,
    deployTarget: params.deployTarget,
    trustTier,
    residencyZone,
    expiresAt: decoded?.exp ? new Date(decoded.exp * 1000) : undefined
  });

  logger.info('App Kit scoped token minted', {
    buildId: params.buildId, jti, deployTarget: params.deployTarget, trustTier
  });
  return { token, jti, expiresIn };
}

/**
 * Verify a scoped token and confirm it has not been revoked.
 * @returns {Promise<object>} the decoded claims
 * @throws {Error} 401-tagged error if invalid/expired/revoked
 */
async function verify(token) {
  let claims;
  try {
    claims = jwt.verify(token, config.JWT_SECRET);
  } catch (err) {
    const e = new Error(`Invalid app token: ${err.message}`);
    e.statusCode = 401;
    throw e;
  }

  if (claims.typ !== 'appkit-scoped') {
    const e = new Error('Not an App Kit scoped token');
    e.statusCode = 401;
    throw e;
  }

  const record = await AppKitToken.findOne({ jti: claims.jti }).lean();
  if (!record || record.revoked) {
    const e = new Error('App token has been revoked');
    e.statusCode = 401;
    throw e;
  }

  return claims;
}

/**
 * Revoke every token for a build (e.g. when the build/app is torn down).
 * @returns {Promise<number>} number of tokens revoked
 */
async function revokeBuild(buildId) {
  const result = await AppKitToken.updateMany(
    { buildId, revoked: false },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
  logger.info('App Kit tokens revoked', { buildId, count: result.modifiedCount });
  return result.modifiedCount;
}

module.exports = { mint, verify, revokeBuild, resolveAppTrustTier };
