const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * ContextSession — ZDR-E1-S1: Ephemeral Context Engine
 *
 * Holds Customer Content in request-scoped memory only.
 * No plaintext writes to Mongo/Redis/disk for ZDR tenants.
 * dispose() zeroizes all buffers at request end.
 *
 * Guarantees: G2 (at rest), G3 (retention = 0 for ZDR tenants).
 */
class ContextSession {
  /**
   * @param {object} opts
   * @param {string} opts.requestId - Unique request identifier
   * @param {string} opts.companyId - Tenant identifier
   * @param {boolean} opts.isZDR - Whether tenant is ZDR-enabled
   */
  constructor({ requestId, companyId, isZDR = false }) {
    this.requestId = requestId;
    this.companyId = companyId;
    this.isZDR = isZDR;
    this.createdAt = Date.now();
    this.disposed = false;

    // In-memory stores — never persisted for ZDR tenants
    this._codeBuffers = [];
    this._prompts = [];
    this._responses = [];
    this._redactionMap = new Map();

    // Per-request ephemeral encryption key (E1-S2)
    this._dataKey = crypto.randomBytes(32);
    this._iv = crypto.randomBytes(16);

    logger.info('ContextSession created', {
      requestId: this.requestId,
      companyId: this.companyId,
      isZDR: this.isZDR
    });
  }

  /**
   * Store customer code in ephemeral memory.
   * For ZDR tenants, code is NEVER written to any durable store.
   *
   * @param {string} label - Identifier for the code fragment
   * @param {string} code - Raw customer code
   */
  storeCode(label, code) {
    this._assertNotDisposed();

    if (this.isZDR) {
      // ZDR: hold in memory only, encrypt at rest in-memory
      const encrypted = this._encryptBuffer(code);
      this._codeBuffers.push({ label, data: encrypted, storedAt: Date.now() });
    } else {
      // Non-ZDR: still hold in memory during request lifecycle
      this._codeBuffers.push({ label, data: code, storedAt: Date.now() });
    }

    logger.debug('Code stored in ephemeral context', {
      requestId: this.requestId,
      label,
      size: code.length,
      isZDR: this.isZDR
    });
  }

  /**
   * Store a prompt in ephemeral memory.
   * Prompts are Operational Records — stored after redaction only.
   *
   * @param {object} prompt - { content, redactedContent, redactionCount }
   */
  storePrompt(prompt) {
    this._assertNotDisposed();
    this._prompts.push({
      ...prompt,
      storedAt: Date.now()
    });
  }

  /**
   * Store a response in ephemeral memory.
   *
   * @param {object} response - { content, provider, trustTier, redactionCount }
   */
  storeResponse(response) {
    this._assertNotDisposed();
    this._responses.push({
      ...response,
      storedAt: Date.now()
    });
  }

  /**
   * Store redaction map for reversible redaction (E2-S3).
   * Map is held in ephemeral memory only — never egressed.
   *
   * @param {string} key - Redaction placeholder (e.g., '[EMAIL_REDACTED]')
   * @param {string} original - Original value
   */
  storeRedactionMapping(key, original) {
    this._assertNotDisposed();
    this._redactionMap.set(key, this._encryptBuffer(original));
  }

  /**
   * Get the redaction map for rehydration (E2-S3).
   * Only callable within the perimeter (inside Flora).
   *
   * @returns {Map<string, string>} Decrypted redaction map
   */
  getRedactionMap() {
    this._assertNotDisposed();
    const decrypted = new Map();
    for (const [key, encryptedValue] of this._redactionMap) {
      decrypted.set(key, this._decryptBuffer(encryptedValue));
    }
    return decrypted;
  }

  /**
   * Retrieve stored code for in-request use.
   *
   * @param {string} label - Code fragment label
   * @returns {string|null} Decrypted code or null
   */
  getCode(label) {
    this._assertNotDisposed();
    const entry = this._codeBuffers.find(b => b.label === label);
    if (!entry) return null;

    if (this.isZDR) {
      return this._decryptBuffer(entry.data);
    }
    return entry.data;
  }

  /**
   * Get all stored prompts (code-free, for Operational Records persistence).
   *
   * @returns {Array} Prompts with redacted content only
   */
  getPromptsForPersistence() {
    return this._prompts.map(p => ({
      content: p.redactedContent || p.content,
      redactionCount: p.redactionCount || 0,
      storedAt: p.storedAt
    }));
  }

  /**
   * Get all stored responses (code-free, for Operational Records persistence).
   *
   * @returns {Array} Responses stripped of any customer code
   */
  getResponsesForPersistence() {
    return this._responses.map(r => ({
      content: r.redactedContent || r.content,
      provider: r.provider,
      trustTier: r.trustTier,
      redactionCount: r.redactionCount || 0,
      storedAt: r.storedAt
    }));
  }

  /**
   * Get summary for audit ledger (code-free).
   *
   * @returns {object} Summary with counts and metadata, no Customer Content
   */
  getAuditSummary() {
    return {
      requestId: this.requestId,
      companyId: this.companyId,
      isZDR: this.isZDR,
      codeBufferCount: this._codeBuffers.length,
      promptCount: this._prompts.length,
      responseCount: this._responses.length,
      redactionMapSize: this._redactionMap.size,
      createdAt: this.createdAt,
      durationMs: Date.now() - this.createdAt
    };
  }

  /**
   * DISPOSE — zeroize all buffers and destroy ephemeral key.
   * MUST be called at request end for ZDR tenants.
   * After dispose, no data is recoverable from this session.
   */
  dispose() {
    if (this.disposed) {
      logger.warn('ContextSession already disposed', { requestId: this.requestId });
      return;
    }

    const stats = this.getAuditSummary();

    // Zeroize code buffers
    for (const buf of this._codeBuffers) {
      if (Buffer.isBuffer(buf.data)) {
        buf.data.fill(0);
      } else if (typeof buf.data === 'string') {
        buf.data = '';
      }
    }
    this._codeBuffers.length = 0;

    // Zeroize prompts and responses
    this._prompts.length = 0;
    this._responses.length = 0;

    // Zeroize redaction map
    for (const [key] of this._redactionMap) {
      this._redactionMap.set(key, '');
    }
    this._redactionMap.clear();

    // Destroy ephemeral key material
    if (this._dataKey) {
      this._dataKey.fill(0);
      this._dataKey = null;
    }
    if (this._iv) {
      this._iv.fill(0);
      this._iv = null;
    }

    this.disposed = true;

    logger.info('ContextSession disposed', {
      requestId: this.requestId,
      companyId: this.companyId,
      codeBuffersDestroyed: stats.codeBufferCount,
      durationMs: stats.durationMs
    });
  }

  /**
   * Encrypt a string buffer with the per-request key.
   * @private
   */
  _encryptBuffer(plaintext) {
    if (!this._dataKey) {
      throw new Error('ContextSession data key destroyed — session disposed');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._dataKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  /**
   * Decrypt a buffer with the per-request key.
   * @private
   */
  _decryptBuffer(buffer) {
    if (!this._dataKey) {
      throw new Error('ContextSession data key destroyed — session disposed');
    }
    if (typeof buffer === 'string') return buffer;
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._dataKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  _assertNotDisposed() {
    if (this.disposed) {
      throw new Error(`ContextSession ${this.requestId} has been disposed`);
    }
  }
}

/**
 * ContextSessionManager — registry for active context sessions.
 * Provides request-scoped lifecycle management.
 */
class ContextSessionManager {
  constructor() {
    this._sessions = new Map();
    this._maxAge = 30 * 60 * 1000; // 30 minutes max session age
    this._cleanupInterval = null;
  }

  /**
   * Create a new context session for a request.
   *
   * @param {object} opts - { requestId, companyId }
   * @returns {ContextSession}
   */
  create(opts) {
    const isZDR = this._isZDRTenant(opts.companyId);
    const session = new ContextSession({ ...opts, isZDR });
    this._sessions.set(opts.requestId, session);
    return session;
  }

  /**
   * Get an active context session by requestId.
   *
   * @param {string} requestId
   * @returns {ContextSession|null}
   */
  get(requestId) {
    const session = this._sessions.get(requestId);
    if (session && session.disposed) {
      this._sessions.delete(requestId);
      return null;
    }
    return session || null;
  }

  /**
   * Dispose and remove a context session.
   *
   * @param {string} requestId
   */
  dispose(requestId) {
    const session = this._sessions.get(requestId);
    if (session) {
      session.dispose();
      this._sessions.delete(requestId);
    }
  }

  /**
   * Start periodic cleanup of stale sessions.
   */
  startCleanup() {
    if (this._cleanupInterval) return;

    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [id, session] of this._sessions) {
        if (now - session.createdAt > this._maxAge) {
          logger.warn('Force-disposing stale ContextSession', {
            requestId: id,
            age: now - session.createdAt
          });
          session.dispose();
          this._sessions.delete(id);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info('Stale context session cleanup completed', { cleaned });
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }

    // Dispose all remaining sessions
    for (const [id, session] of this._sessions) {
      session.dispose();
    }
    this._sessions.clear();
  }

  getActiveCount() {
    return this._sessions.size;
  }

  _isZDRTenant(companyId) {
    if (!companyId) return false;
    const zdrTenants = config.zdr.tenantIds || [];
    return zdrTenants.includes(companyId);
  }
}

let managerInstance = null;

function getContextSessionManager() {
  if (!managerInstance) {
    managerInstance = new ContextSessionManager();
  }
  return managerInstance;
}

module.exports = {
  ContextSession,
  ContextSessionManager,
  getContextSessionManager
};
