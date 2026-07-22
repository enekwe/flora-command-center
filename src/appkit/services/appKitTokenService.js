const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../../utils/logger');
const AppKitToken = require('../models/AppKitToken');

/**
 * App Kit Token Service
 *
 * Mints, verifies, and revokes the short-lived scoped tokens that a built app
 * presents to the Command Center data broker (APP_KIT_PROJECT_CONTRACT.md §3).
 *
 * The token is a JWT carrying the app's manifest scopes, bound to a build and a
 * tenant. Verification also checks the revocation registry so a build can be
 * killed and its data access cut off immediately.
 */

/**
 * Mint a scoped app token for a build.
 * @param {object} params
 * @param {string} params.buildId
 * @param {string} params.projectId
 * @param {string} params.requestId
 * @param {string} params.organizationId
 * @param {string} params.userId
 * @param {string} params.companyId
 * @param {object} params.scope - { dataScopes: [...], systems: [...] }
 * @returns {Promise<{ token: string, jti: string, expiresIn: string }>}
 */
async function mint(params) {
  const jti = crypto.randomUUID();
  const expiresIn = config.appKit.tokenExpiration;

  const claims = {
    jti,
    typ: 'appkit-scoped',
    buildId: params.buildId,
    projectId: params.projectId,
    requestId: params.requestId,
    organizationId: params.organizationId,
    userId: params.userId,
    companyId: params.companyId,
    scope: params.scope || { dataScopes: [], systems: [] }
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
    expiresAt: decoded?.exp ? new Date(decoded.exp * 1000) : undefined
  });

  logger.info('App Kit scoped token minted', { buildId: params.buildId, jti });
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

module.exports = { mint, verify, revokeBuild };
