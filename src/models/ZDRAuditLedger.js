const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * ZDR Audit Ledger — ZDR-E7-S1
 *
 * Append-only, tamper-evident record of every request's data handling.
 * Contains NO Customer Content — only metadata for provability (G8).
 *
 * Each entry records: requestId, companyId, endpoint, trustTier,
 * redactionCount, bytesEgressed, purgedAt.
 *
 * Tamper-evidence: each entry includes a hash chain linking to the previous entry.
 */

const zdrAuditLedgerSchema = new mongoose.Schema({
  // Request identification
  requestId: {
    type: String,
    required: [true, 'Request ID is required'],
    index: true,
    trim: true
  },

  // ZDR-E3-S1: Tenant isolation
  companyId: {
    type: String,
    required: [true, 'Company ID is required'],
    index: true,
    trim: true
  },

  // Provider/endpoint information
  endpoint: {
    type: String,
    required: true,
    trim: true,
    description: 'Provider endpoint URL or identifier'
  },

  provider: {
    type: String,
    required: true,
    trim: true
  },

  model: {
    type: String,
    trim: true
  },

  // Trust tier at time of request
  trustTier: {
    type: String,
    required: true,
    enum: ['self_hosted', 'zdr_contracted', 'standard_hosted', 'unknown'],
    description: 'Trust tier of the provider that served the request'
  },

  residencyZone: {
    type: String,
    trim: true,
    description: 'Residency zone where the provider runs'
  },

  // Redaction metadata (no content)
  redactionCount: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Number of redaction replacements applied before egress'
  },

  redactionTypes: [{
    type: String,
    trim: true
  }],

  // Egress metrics (no content)
  bytesEgressed: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Total bytes sent to external endpoint (post-redaction)'
  },

  // Token usage (metadata only)
  tokensInput: {
    type: Number,
    default: 0,
    min: 0
  },

  tokensOutput: {
    type: Number,
    default: 0,
    min: 0
  },

  // Purge/deletion tracking
  purgedAt: {
    type: Date,
    default: null,
    description: 'When customer code was purged (null = not yet purged)'
  },

  purgeMethod: {
    type: String,
    enum: ['crypto_erase', 'no_write', 'ttl_expiry', 'manual_purge', null],
    default: null
  },

  // Tamper-evidence hash chain
  entryHash: {
    type: String,
    required: true,
    trim: true,
    description: 'SHA-256 hash of this entry content'
  },

  previousHash: {
    type: String,
    trim: true,
    default: null,
    description: 'SHA-256 hash of the previous ledger entry (genesis = null)'
  },

  // Attestation
  attestationSignature: {
    type: String,
    trim: true,
    description: 'HMAC signature for deletion attestation'
  },

  // Session context
  sessionId: {
    type: String,
    trim: true,
    index: true
  },

  agentType: {
    type: String,
    trim: true
  },

  // Status
  status: {
    type: String,
    enum: ['recorded', 'purged', 'attested'],
    default: 'recorded',
    index: true
  },

  // Timestamp
  recordedAt: {
    type: Date,
    default: Date.now,
    index: true
  }

}, {
  timestamps: false, // Append-only — no updates
  collection: 'zdr_audit_ledger'
});

// Indexes
zdrAuditLedgerSchema.index({ companyId: 1, recordedAt: -1 });
zdrAuditLedgerSchema.index({ requestId: 1, companyId: 1 });
zdrAuditLedgerSchema.index({ sessionId: 1, recordedAt: -1 });
zdrAuditLedgerSchema.index({ trustTier: 1, recordedAt: -1 });
zdrAuditLedgerSchema.index({ status: 1, recordedAt: -1 });

// Static: compute entry hash
zdrAuditLedgerSchema.statics.computeHash = function(entry) {
  const payload = JSON.stringify({
    requestId: entry.requestId,
    companyId: entry.companyId,
    endpoint: entry.endpoint,
    provider: entry.provider,
    trustTier: entry.trustTier,
    redactionCount: entry.redactionCount,
    bytesEgressed: entry.bytesEgressed,
    previousHash: entry.previousHash,
    recordedAt: entry.recordedAt
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
};

// Static: append an entry with hash chain
zdrAuditLedgerSchema.statics.appendEntry = async function(entryData) {
  const lastEntry = await this.findOne({})
    .sort({ recordedAt: -1 })
    .select('entryHash')
    .lean();

  const entry = new this({
    ...entryData,
    previousHash: lastEntry ? lastEntry.entryHash : null,
    recordedAt: new Date()
  });

  entry.entryHash = this.computeHash(entry);
  await entry.save();
  return entry;
};

// Static: verify hash chain integrity
zdrAuditLedgerSchema.statics.verifyChainIntegrity = async function(fromRequestId, toRequestId) {
  const query = {};
  if (fromRequestId || toRequestId) {
    query.recordedAt = {};
    // Would need timestamps for range queries
  }

  const entries = await this.find(query).sort({ recordedAt: 1 }).lean();
  let previousHash = null;

  for (const entry of entries) {
    if (entry.previousHash !== previousHash) {
      return { valid: false, brokenAt: entry.requestId };
    }
    const computed = this.computeHash(entry);
    if (computed !== entry.entryHash) {
      return { valid: false, tamperedAt: entry.requestId };
    }
    previousHash = entry.entryHash;
  }

  return { valid: true, entriesChecked: entries.length };
};

// Static: get attestation for a session
zdrAuditLedgerSchema.statics.getSessionAttestation = async function(sessionId, companyId) {
  const entries = await this.find({
    sessionId,
    companyId
  }).sort({ recordedAt: 1 }).lean();

  if (entries.length === 0) {
    return null;
  }

  const attestationData = {
    sessionId,
    companyId,
    totalRequests: entries.length,
    totalRedactions: entries.reduce((sum, e) => sum + e.redactionCount, 0),
    totalBytesEgressed: entries.reduce((sum, e) => sum + e.bytesEgressed, 0),
    providers: [...new Set(entries.map(e => `${e.provider}:${e.trustTier}`))],
    firstEntry: entries[0].entryHash,
    lastEntry: entries[entries.length - 1].entryHash,
    allPurged: entries.every(e => e.purgedAt !== null),
    generatedAt: new Date().toISOString()
  };

  const hmacKey = process.env.ZDR_ATTESTATION_KEY || process.env.JWT_SECRET || 'attestation-dev-key';
  const signature = crypto
    .createHmac('sha256', hmacKey)
    .update(JSON.stringify(attestationData))
    .digest('hex');

  return {
    ...attestationData,
    signature
  };
};

module.exports = mongoose.model('ZDRAuditLedger', zdrAuditLedgerSchema);
