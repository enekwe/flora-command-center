/**
 * Data Redaction Service
 * ZDR-E0-S2: Microservice Redaction Restoration
 *
 * Redacts sensitive data (secrets, PII, credentials) from content before egress.
 * This is a critical security control enforcing ZDR Guarantee G4.
 *
 * IMPORTANT: This service redacts BEFORE provider calls to prevent
 * Customer Code containing secrets from being transmitted to external models.
 *
 * Based on passbook-flora contextBoundaryService.js but focused on
 * credential/secret detection for ZDR use cases.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

class DataRedactionService {
  constructor() {
    // Extended credential patterns (ZDR-E0-S2 baseline + ZDR-E2-S1 comprehensive)
    this.credentialPatterns = {
      // PII patterns
      email: {
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: '[EMAIL_REDACTED]'
      },
      phone: {
        pattern: /\b(?:\+?1[-.\s]?)?(?:\([0-9]{3}\)|[0-9]{3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
        replacement: '[PHONE_REDACTED]'
      },
      ssn: {
        pattern: /\b(?!000|666|9\d{2})\d{3}[-]?(?!00)\d{2}[-]?(?!0000)\d{4}\b/g,
        replacement: '[SSN_REDACTED]'
      },
      creditCard: {
        pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
        replacement: '[CREDIT_CARD_REDACTED]'
      },

      // Cloud/Platform API Keys
      awsAccessKey: {
        pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
        replacement: '[AWS_KEY_REDACTED]'
      },
      awsSecretKey: {
        pattern: /\baws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}\b/gi,
        replacement: '[AWS_SECRET_REDACTED]'
      },
      googleApiKey: {
        pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
        replacement: '[GOOGLE_API_KEY_REDACTED]'
      },
      githubToken: {
        pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
        replacement: '[GITHUB_TOKEN_REDACTED]'
      },
      githubOAuth: {
        pattern: /\bgho_[A-Za-z0-9]{36}\b/g,
        replacement: '[GITHUB_OAUTH_REDACTED]'
      },
      slackToken: {
        pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
        replacement: '[SLACK_TOKEN_REDACTED]'
      },
      slackWebhook: {
        pattern: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Z0-9\/]+\b/gi,
        replacement: '[SLACK_WEBHOOK_REDACTED]'
      },

      // Payment/Financial
      stripeKey: {
        pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
        replacement: '[STRIPE_KEY_REDACTED]'
      },
      stripeWebhook: {
        pattern: /\bwhsec_[A-Za-z0-9]{32,}\b/g,
        replacement: '[STRIPE_WEBHOOK_SECRET_REDACTED]'
      },

      // Generic API Keys
      genericApiKey: {
        pattern: /\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key)["\s:=]+[A-Za-z0-9_\-]{20,}\b/gi,
        replacement: '[API_KEY_REDACTED]'
      },

      // Cryptographic Keys
      privateKey: {
        pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
        replacement: '[PRIVATE_KEY_REDACTED]'
      },
      sshKey: {
        pattern: /\bssh-(?:rsa|ed25519|ecdsa)\s+[A-Za-z0-9+\/=]{100,}/g,
        replacement: '[SSH_KEY_REDACTED]'
      },

      // JWTs and Bearer Tokens
      jwt: {
        pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        replacement: '[JWT_REDACTED]'
      },
      bearerToken: {
        pattern: /\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/gi,
        replacement: 'Bearer [TOKEN_REDACTED]'
      },

      // Database Connection Strings
      mongoUri: {
        pattern: /\bmongodb(?:\+srv)?:\/\/[^\s'"<>]+/gi,
        replacement: '[MONGODB_URI_REDACTED]'
      },
      postgresUri: {
        pattern: /\bpostgres(?:ql)?:\/\/[^\s'"<>]+/gi,
        replacement: '[POSTGRES_URI_REDACTED]'
      },
      mysqlUri: {
        pattern: /\bmysql:\/\/[^\s'"<>]+/gi,
        replacement: '[MYSQL_URI_REDACTED]'
      },
      redisUri: {
        pattern: /\bredis:\/\/[^\s'"<>]+/gi,
        replacement: '[REDIS_URI_REDACTED]'
      },

      // Password in connection strings or configs
      passwordInUri: {
        pattern: /(:\/\/[^:\/\s]+):([^@\s]+)@/g,
        replacement: '$1:[PASSWORD_REDACTED]@'
      },

      // .env file content patterns
      envPassword: {
        pattern: /\b(?:PASSWORD|PASSWD|PWD|SECRET)\s*=\s*["']?[^\s"']+["']?/gi,
        replacement: (match) => {
          const key = match.split('=')[0];
          return `${key}=[REDACTED]`;
        }
      },

      // IP Addresses (optional - may be needed for some use cases)
      ipAddress: {
        pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
        replacement: '[IP_ADDRESS_REDACTED]',
        enabled: false // Disabled by default, can be enabled for restricted contexts
      }
    };

    // High-entropy string detection (catches generic secrets)
    this.entropyThreshold = 4.5; // bits per character
    this.minEntropyLength = 24; // minimum length to check

    // Redaction statistics
    this.stats = {
      totalRedactions: 0,
      redactionsByType: {}
    };
  }

  /**
   * Redact sensitive data from content
   * Primary method for ZDR-E0-S2 integration
   *
   * @param {string|object} content - Content to redact (string or object)
   * @param {object} options - Redaction options
   * @param {boolean} options.includeEntropy - Enable high-entropy detection (default: true)
   * @param {boolean} options.preserveStructure - Keep JSON structure if input is object (default: true)
   * @returns {object} { redactedContent, redactionCount, redactionDetails }
   */
  redact(content, options = {}) {
    const {
      includeEntropy = true,
      preserveStructure = true
    } = options;

    // Handle different content types
    const isObject = typeof content === 'object' && content !== null;
    const contentStr = isObject ? JSON.stringify(content, null, 2) : String(content);

    // Track redactions for this operation
    const redactionDetails = [];
    let redactedContent = contentStr;
    let redactionCount = 0;

    // Apply all credential patterns
    for (const [type, config] of Object.entries(this.credentialPatterns)) {
      // Skip disabled patterns
      if (config.enabled === false) continue;

      const beforeLength = redactedContent.length;
      const beforeCount = (redactedContent.match(config.pattern) || []).length;

      if (beforeCount > 0) {
        if (typeof config.replacement === 'function') {
          redactedContent = redactedContent.replace(config.pattern, config.replacement);
        } else {
          redactedContent = redactedContent.replace(config.pattern, config.replacement);
        }

        redactionCount += beforeCount;
        redactionDetails.push({
          type,
          count: beforeCount,
          pattern: config.pattern.toString()
        });

        // Update global stats
        this.stats.totalRedactions += beforeCount;
        this.stats.redactionsByType[type] = (this.stats.redactionsByType[type] || 0) + beforeCount;

        logger.debug('Redaction applied', {
          type,
          count: beforeCount,
          lengthBefore: beforeLength,
          lengthAfter: redactedContent.length
        });
      }
    }

    // High-entropy detection (ZDR-E2-S1 comprehensive secret detector)
    if (includeEntropy) {
      const entropyRedactions = this._redactHighEntropyStrings(redactedContent);
      redactedContent = entropyRedactions.content;
      redactionCount += entropyRedactions.count;

      if (entropyRedactions.count > 0) {
        redactionDetails.push({
          type: 'highEntropy',
          count: entropyRedactions.count,
          pattern: 'entropy-based detection'
        });
      }
    }

    // Parse back to object if needed
    let finalContent = redactedContent;
    if (isObject && preserveStructure) {
      try {
        finalContent = JSON.parse(redactedContent);
      } catch (error) {
        logger.warn('Failed to parse redacted content back to object, returning string', {
          error: error.message
        });
      }
    }

    // Log redaction summary
    if (redactionCount > 0) {
      logger.info('Content redacted before egress', {
        redactionCount,
        types: redactionDetails.map(d => d.type),
        originalLength: contentStr.length,
        redactedLength: redactedContent.length
      });
    }

    return {
      redactedContent: finalContent,
      redactionCount,
      redactionDetails,
      redactionApplied: redactionCount > 0
    };
  }

  /**
   * Detect and redact high-entropy strings (potential secrets)
   * @private
   */
  _redactHighEntropyStrings(content) {
    let redactedContent = content;
    let count = 0;

    // Find candidate strings (alphanumeric sequences)
    const candidatePattern = /\b[A-Za-z0-9_\-+=\/]{24,}\b/g;
    const candidates = content.match(candidatePattern) || [];

    for (const candidate of candidates) {
      // Skip if already redacted
      if (candidate.includes('REDACTED')) continue;

      // Calculate entropy
      const entropy = this._calculateEntropy(candidate);

      if (entropy >= this.entropyThreshold && candidate.length >= this.minEntropyLength) {
        // High entropy detected - likely a secret
        redactedContent = redactedContent.replace(
          new RegExp(this._escapeRegExp(candidate), 'g'),
          '[HIGH_ENTROPY_SECRET_REDACTED]'
        );
        count++;

        logger.debug('High-entropy secret detected', {
          length: candidate.length,
          entropy: entropy.toFixed(2),
          preview: candidate.substring(0, 8) + '...'
        });
      }
    }

    return { content: redactedContent, count };
  }

  /**
   * Calculate Shannon entropy of a string
   * @private
   */
  _calculateEntropy(str) {
    const freq = {};
    for (const char of str) {
      freq[char] = (freq[char] || 0) + 1;
    }

    let entropy = 0;
    const len = str.length;

    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Escape special regex characters
   * @private
   */
  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get redaction statistics
   * @returns {object} Redaction stats
   */
  getStats() {
    return {
      ...this.stats,
      timestamp: new Date()
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRedactions: 0,
      redactionsByType: {}
    };
  }

  /**
   * Add custom redaction pattern
   * @param {string} name - Pattern name
   * @param {RegExp} pattern - Pattern to match
   * @param {string|function} replacement - Replacement text or function
   */
  addCustomPattern(name, pattern, replacement) {
    this.credentialPatterns[name] = {
      pattern,
      replacement
    };

    logger.info('Custom redaction pattern added', { name });
  }

  /**
   * Pre-flight check: Scan content for secrets without redacting
   * Used for ZDR-E2-S2 pre-flight warnings
   *
   * @param {string|object} content - Content to scan
   * @returns {object} { hasSecrets, secretTypes, count }
   */
  scanForSecrets(content) {
    const contentStr = typeof content === 'object' ? JSON.stringify(content) : String(content);
    const secretTypes = [];
    let count = 0;

    for (const [type, config] of Object.entries(this.credentialPatterns)) {
      if (config.enabled === false) continue;

      const matches = contentStr.match(config.pattern) || [];
      if (matches.length > 0) {
        secretTypes.push(type);
        count += matches.length;
      }
    }

    // Check high-entropy strings
    const candidatePattern = /\b[A-Za-z0-9_\-+=\/]{24,}\b/g;
    const candidates = contentStr.match(candidatePattern) || [];

    for (const candidate of candidates) {
      const entropy = this._calculateEntropy(candidate);
      if (entropy >= this.entropyThreshold && candidate.length >= this.minEntropyLength) {
        if (!secretTypes.includes('highEntropy')) {
          secretTypes.push('highEntropy');
        }
        count++;
      }
    }

    return {
      hasSecrets: count > 0,
      secretTypes,
      count,
      threshold: this.entropyThreshold
    };
  }
}

// Singleton instance
let redactionServiceInstance = null;

/**
 * Get the redaction service singleton
 */
function getRedactionService() {
  if (!redactionServiceInstance) {
    redactionServiceInstance = new DataRedactionService();
  }
  return redactionServiceInstance;
}

module.exports = {
  DataRedactionService,
  getRedactionService
};
