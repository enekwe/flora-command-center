const mongoose = require('mongoose');

/**
 * AppKitToken
 *
 * Revocation registry for scoped app tokens (APP_KIT_PROJECT_CONTRACT.md §3).
 *
 * The token itself is a self-contained JWT carrying the app's manifest scopes; it
 * is NOT stored here. We persist only a reference (`jti`) plus its binding so a
 * build/app's data access can be revoked instantly — killing the build flips
 * `revoked` and the broker rejects the token on its next call.
 */
const appKitTokenSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true, index: true }, // JWT id
  buildId: { type: String, required: true, index: true },
  projectId: { type: String, index: true },

  // Multi-tenant binding (stored as strings; CC compares against header/token claims).
  organizationId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  companyId: { type: String, index: true },

  // Where the app this token was issued to actually runs, and the ZDR trust
  // classification that implies — set once at mint time from
  // config.appKit.deployTargetTrustTiers. Persisted here (not just in the JWT)
  // so the classification is inspectable/auditable without decoding a token.
  deployTarget: { type: String },
  trustTier: {
    type: String,
    enum: ['self_hosted', 'zdr_contracted', 'standard_hosted', 'unknown']
  },
  residencyZone: { type: String },

  revoked: { type: Boolean, default: false, index: true },
  revokedAt: { type: Date, default: null },
  expiresAt: { type: Date }
}, {
  timestamps: true,
  collection: 'appkit_tokens'
});

// TTL cleanup once expired (kept a while past expiry for audit joins).
appKitTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model('AppKitToken', appKitTokenSchema);
