const mongoose = require('mongoose');
const encryption = require('../utils/encryption');
const logger = require('../utils/logger');

/**
 * PlatformIntegration Model
 *
 * Generic multi-platform integration model supporting GitHub, WordPress, Shopify, and more.
 * Replaces GitHubInstallation with a platform-agnostic design while maintaining backward compatibility.
 *
 * Manages:
 * - OAuth and API key authentication (encrypted)
 * - Platform-specific configuration (flexible schema)
 * - Webhook management
 * - Integration health monitoring
 * - Platform capabilities tracking
 *
 * Part of Flora Command Center - Multi-Platform Support
 * Follows Flora Development Rules Section 11.4 for encryption
 */

const platformIntegrationSchema = new mongoose.Schema({
  // ===== Core Integration Data =====

  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudioCompany',
    required: [true, 'Company ID is required'],
    index: true
  },

  platform: {
    type: String,
    enum: {
      values: ['github', 'wordpress', 'shopify', 'gitlab', 'bitbucket', 'woocommerce', 'magento', 'wix', 'squarespace'],
      message: '{VALUE} is not a supported platform'
    },
    required: [true, 'Platform is required'],
    index: true
  },

  status: {
    type: String,
    enum: {
      values: ['active', 'inactive', 'error', 'pending', 'suspended', 'uninstalled'],
      message: '{VALUE} is not a valid status'
    },
    default: 'pending',
    index: true
  },

  installedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },

  installedAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  lastSyncAt: {
    type: Date,
    index: true
  },

  lastWebhookAt: {
    type: Date,
    index: true
  },

  // ===== Platform-Specific Configuration =====
  // Flexible schema to accommodate different platform requirements

  configuration: {
    // GitHub specific
    installationId: String,          // GitHub App Installation ID
    accountType: String,              // 'User' | 'Organization'
    accountLogin: String,             // GitHub username/org name
    accountId: Number,                // GitHub account ID
    repositorySelection: String,      // 'all' | 'selected'
    accessibleRepositories: [{
      id: Number,
      name: String,
      fullName: String,
      private: Boolean,
      defaultBranch: String,
      htmlUrl: String,
      language: String,
      size: Number,
      updatedAt: Date
    }],
    monitoredRepositories: [Number],

    // WordPress specific
    siteUrl: String,                  // WordPress site URL
    wpCliEnabled: Boolean,            // WP-CLI available
    ftpAccess: Boolean,               // FTP access available
    restApiEnabled: Boolean,          // REST API enabled
    adminUrl: String,                 // WP admin URL
    wpVersion: String,                // WordPress version
    phpVersion: String,               // PHP version

    // Shopify specific
    shopDomain: String,               // myshop.myshopify.com
    shopName: String,                 // Store name
    apiVersion: String,               // API version (e.g., '2024-01')
    themeAccess: Boolean,             // Theme access granted
    storefrontToken: String,          // Storefront API token

    // WooCommerce specific
    storeUrl: String,                 // WooCommerce store URL
    wcVersion: String,                // WooCommerce version

    // Generic fields
    owner: String,                    // Owner/account name
    description: String,              // Integration description
    metadata: mongoose.Schema.Types.Mixed  // Additional platform-specific data
  },

  // ===== Authentication & Credentials =====
  // All sensitive fields are encrypted before storage

  credentials: {
    type: {
      type: String,
      enum: ['oauth', 'api_key', 'token', 'basic_auth', 'ftp', 'ssh', 'jwt'],
      required: [true, 'Credential type is required']
    },

    // OAuth fields
    accessToken: {
      type: String,
      select: false  // Never include by default
    },
    refreshToken: {
      type: String,
      select: false
    },
    tokenExpiry: {
      type: Date,
      select: false
    },

    // API Key fields
    apiKey: {
      type: String,
      select: false
    },
    apiSecret: {
      type: String,
      select: false
    },
    consumerKey: {
      type: String,
      select: false
    },
    consumerSecret: {
      type: String,
      select: false
    },

    // Basic Auth / FTP
    username: {
      type: String,
      select: false
    },
    password: {
      type: String,
      select: false
    },

    // SSH
    sshKey: {
      type: String,
      select: false
    },
    sshPassphrase: {
      type: String,
      select: false
    },

    // Token expiration tracking
    expiresAt: Date,
    isExpired: {
      type: Boolean,
      default: false,
      index: true
    }
  },

  // ===== Webhook Configuration =====

  webhooks: {
    enabled: {
      type: Boolean,
      default: false
    },
    webhookUrl: String,
    webhookId: {
      type: String,
      index: true
    },
    secret: {
      type: String,
      select: false
    },
    events: [{
      type: String
      // Platform-specific events:
      // GitHub: 'push', 'pull_request', 'deployment', 'release', 'repository'
      // WordPress: 'post_updated', 'theme_changed', 'plugin_updated'
      // Shopify: 'orders/create', 'products/update', 'themes/publish'
    }],
    lastWebhookEvent: {
      event: String,
      receivedAt: Date,
      status: String  // 'success' | 'failed'
    }
  },

  // ===== Platform Capabilities =====
  // What actions can be performed via this integration

  capabilities: [{
    type: String
    // Examples:
    // GitHub: 'read_code', 'write_code', 'manage_deployments', 'manage_issues'
    // WordPress: 'manage_themes', 'manage_plugins', 'manage_posts', 'ftp_access'
    // Shopify: 'read_products', 'write_products', 'manage_themes', 'read_orders'
  }],

  scopes: [{
    type: String  // OAuth scopes granted
  }],

  // ===== Health & Monitoring =====

  health: {
    lastCheck: {
      type: Date,
      index: true
    },
    status: {
      type: String,
      enum: ['healthy', 'degraded', 'unhealthy', 'unknown'],
      default: 'unknown'
    },
    consecutiveFailures: {
      type: Number,
      default: 0
    },
    lastError: String,
    lastErrorAt: Date,
    errorDetails: mongoose.Schema.Types.Mixed,
    uptime: Number  // Percentage (0-100)
  },

  // ===== Integration Metrics =====

  metrics: {
    totalSyncs: {
      type: Number,
      default: 0
    },
    successfulSyncs: {
      type: Number,
      default: 0
    },
    failedSyncs: {
      type: Number,
      default: 0
    },
    lastSyncDuration: Number,        // milliseconds
    avgSyncDuration: Number,         // milliseconds
    totalWebhooks: {
      type: Number,
      default: 0
    },
    successfulWebhooks: {
      type: Number,
      default: 0
    },
    failedWebhooks: {
      type: Number,
      default: 0
    },
    totalApiCalls: {
      type: Number,
      default: 0
    },
    rateLimitRemaining: Number,
    rateLimitReset: Date,
    dataTransferred: Number          // bytes
  },

  // ===== Rate Limiting =====

  rateLimit: {
    limit: Number,
    remaining: Number,
    reset: Date,
    exceeded: {
      type: Boolean,
      default: false
    }
  },

  // ===== Migration Support =====
  // For backward compatibility with GitHubInstallation

  migratedFrom: {
    model: String,  // 'GitHubInstallation'
    id: mongoose.Schema.Types.ObjectId,
    migratedAt: Date
  },

  // ===== Audit Fields =====

  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // ===== Soft Delete =====

  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },

  deletedAt: Date,

  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // ===== Site Support (Multi-Site Management) =====

  // NEW FIELD: Optional site reference
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    index: true,
    sparse: true,  // Allows null for legacy integrations
    default: null
  },

  // NEW FIELD: Token usage for this integration
  tokenUsage: {
    total: {
      type: Number,
      default: 0,
      min: [0, 'Token usage must be non-negative']
    },
    lastUpdated: Date
  }
}, {
  timestamps: true,
  collection: 'platform_integrations'
});

// ============================================================================
// INDEXES
// ============================================================================

// Compound indexes for common queries
platformIntegrationSchema.index({ companyId: 1, platform: 1 });
platformIntegrationSchema.index({ companyId: 1, status: 1 });
platformIntegrationSchema.index({ platform: 1, status: 1 });
platformIntegrationSchema.index({ 'health.lastCheck': 1 });
platformIntegrationSchema.index({ 'credentials.isExpired': 1, status: 1 });
platformIntegrationSchema.index({ lastSyncAt: 1 });

// NEW INDEXES for site support
platformIntegrationSchema.index({ siteId: 1, platform: 1 });
platformIntegrationSchema.index({ companyId: 1, siteId: 1 });

// Unique constraint for platform-specific IDs
platformIntegrationSchema.index(
  { 'configuration.installationId': 1 },
  { unique: true, sparse: true }  // GitHub installation ID
);
platformIntegrationSchema.index(
  { 'configuration.shopDomain': 1 },
  { unique: true, sparse: true }  // Shopify shop domain
);

// ============================================================================
// VIRTUALS
// ============================================================================

// Is integration healthy
platformIntegrationSchema.virtual('isHealthy').get(function() {
  return this.status === 'active' &&
         this.health.status === 'healthy' &&
         !this.credentials.isExpired;
});

// Success rate
platformIntegrationSchema.virtual('successRate').get(function() {
  if (this.metrics.totalSyncs === 0) return 100;
  return Math.round((this.metrics.successfulSyncs / this.metrics.totalSyncs) * 100);
});

// Webhook success rate
platformIntegrationSchema.virtual('webhookSuccessRate').get(function() {
  if (this.metrics.totalWebhooks === 0) return 100;
  return Math.round((this.metrics.successfulWebhooks / this.metrics.totalWebhooks) * 100);
});

// Days since last sync
platformIntegrationSchema.virtual('daysSinceLastSync').get(function() {
  if (!this.lastSyncAt) return null;
  const diffTime = Math.abs(Date.now() - this.lastSyncAt.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Set credentials (encrypts sensitive fields before storing)
 * @param {Object} creds - Credentials object
 */
platformIntegrationSchema.methods.setCredentials = async function(creds) {
  try {
    if (!creds) {
      throw new Error('Credentials cannot be empty');
    }

    // Set credential type
    if (creds.type) {
      this.credentials.type = creds.type;
    }

    // Set expiry
    if (creds.expiresAt) {
      this.credentials.expiresAt = creds.expiresAt;
    }

    // Don't encrypt in method - let pre-save middleware handle it
    // Just set the values
    if (creds.accessToken) this.credentials.accessToken = creds.accessToken;
    if (creds.refreshToken) this.credentials.refreshToken = creds.refreshToken;
    if (creds.apiKey) this.credentials.apiKey = creds.apiKey;
    if (creds.apiSecret) this.credentials.apiSecret = creds.apiSecret;
    if (creds.consumerKey) this.credentials.consumerKey = creds.consumerKey;
    if (creds.consumerSecret) this.credentials.consumerSecret = creds.consumerSecret;
    if (creds.username) this.credentials.username = creds.username;
    if (creds.password) this.credentials.password = creds.password;
    if (creds.sshKey) this.credentials.sshKey = creds.sshKey;
    if (creds.sshPassphrase) this.credentials.sshPassphrase = creds.sshPassphrase;

    // Mark as needing encryption
    this._credentialsNeedEncryption = true;

    return await this.save();
  } catch (error) {
    logger.error('Error setting credentials:', error);
    throw new Error(`Failed to set credentials: ${error.message}`);
  }
};

/**
 * Get decrypted credentials
 * @returns {Object} Decrypted credentials
 */
platformIntegrationSchema.methods.getCredentials = async function() {
  try {
    // Need to explicitly select credentials fields
    const integration = await this.constructor.findById(this._id)
      .select('+credentials.accessToken +credentials.refreshToken +credentials.apiKey +credentials.apiSecret +credentials.consumerKey +credentials.consumerSecret +credentials.username +credentials.password +credentials.sshKey +credentials.sshPassphrase');

    if (!integration) {
      throw new Error('Integration not found');
    }

    const decrypted = {
      type: integration.credentials.type
    };

    // Decrypt each credential field if present
    if (integration.credentials.accessToken) {
      decrypted.accessToken = encryption.decrypt(integration.credentials.accessToken);
    }
    if (integration.credentials.refreshToken) {
      decrypted.refreshToken = encryption.decrypt(integration.credentials.refreshToken);
    }
    if (integration.credentials.apiKey) {
      decrypted.apiKey = encryption.decrypt(integration.credentials.apiKey);
    }
    if (integration.credentials.apiSecret) {
      decrypted.apiSecret = encryption.decrypt(integration.credentials.apiSecret);
    }
    if (integration.credentials.consumerKey) {
      decrypted.consumerKey = encryption.decrypt(integration.credentials.consumerKey);
    }
    if (integration.credentials.consumerSecret) {
      decrypted.consumerSecret = encryption.decrypt(integration.credentials.consumerSecret);
    }
    if (integration.credentials.username) {
      decrypted.username = encryption.decrypt(integration.credentials.username);
    }
    if (integration.credentials.password) {
      decrypted.password = encryption.decrypt(integration.credentials.password);
    }
    if (integration.credentials.sshKey) {
      decrypted.sshKey = encryption.decrypt(integration.credentials.sshKey);
    }
    if (integration.credentials.sshPassphrase) {
      decrypted.sshPassphrase = encryption.decrypt(integration.credentials.sshPassphrase);
    }

    return decrypted;
  } catch (error) {
    logger.error('Error getting credentials:', error);
    throw new Error('Failed to decrypt credentials');
  }
};

/**
 * Check if credentials are expired
 * @returns {Boolean} True if expired
 */
platformIntegrationSchema.methods.isCredentialsExpired = function() {
  if (!this.credentials.expiresAt) {
    return false;  // No expiry set = doesn't expire
  }
  const isExpired = new Date() > this.credentials.expiresAt;

  // Update cached field if changed
  if (isExpired !== this.credentials.isExpired) {
    this.credentials.isExpired = isExpired;
    this.save().catch(err => logger.error('Error updating isExpired flag:', err));
  }

  return isExpired;
};

/**
 * Record successful sync
 * @param {Number} duration - Sync duration in milliseconds
 */
platformIntegrationSchema.methods.recordSuccessfulSync = async function(duration) {
  this.lastSyncAt = new Date();
  this.metrics.totalSyncs += 1;
  this.metrics.successfulSyncs += 1;
  this.metrics.lastSyncDuration = duration;

  // Update average duration
  const totalDuration = (this.metrics.avgSyncDuration || 0) * (this.metrics.totalSyncs - 1) + duration;
  this.metrics.avgSyncDuration = Math.round(totalDuration / this.metrics.totalSyncs);

  // Reset failure count
  this.health.consecutiveFailures = 0;
  this.health.status = 'healthy';

  return await this.save();
};

/**
 * Record failed sync
 * @param {Error|String} error - Error that caused failure
 */
platformIntegrationSchema.methods.recordFailedSync = async function(error) {
  this.metrics.totalSyncs += 1;
  this.metrics.failedSyncs += 1;
  this.health.consecutiveFailures += 1;
  this.health.lastError = error.message || error;
  this.health.lastErrorAt = new Date();

  if (error.stack) {
    this.health.errorDetails = {
      message: error.message,
      stack: error.stack,
      code: error.code
    };
  }

  // Update health status based on consecutive failures
  if (this.health.consecutiveFailures >= 5) {
    this.health.status = 'unhealthy';
    this.status = 'error';
  } else if (this.health.consecutiveFailures >= 3) {
    this.health.status = 'degraded';
  }

  return await this.save();
};

/**
 * Record webhook event
 * @param {String} event - Event name
 * @param {Boolean} success - Whether webhook was processed successfully
 */
platformIntegrationSchema.methods.recordWebhook = async function(event, success = true) {
  this.lastWebhookAt = new Date();
  this.metrics.totalWebhooks += 1;

  if (success) {
    this.metrics.successfulWebhooks += 1;
  } else {
    this.metrics.failedWebhooks += 1;
  }

  this.webhooks.lastWebhookEvent = {
    event,
    receivedAt: new Date(),
    status: success ? 'success' : 'failed'
  };

  return await this.save();
};

/**
 * Update health check
 * @param {String} status - Health status
 * @param {String} error - Optional error message
 */
platformIntegrationSchema.methods.updateHealthCheck = async function(status, error = null) {
  this.health.lastCheck = new Date();
  this.health.status = status;

  if (error) {
    this.health.lastError = error;
    this.health.lastErrorAt = new Date();
  }

  return await this.save();
};

/**
 * Soft delete integration
 * @param {ObjectId} userId - User performing deletion
 */
platformIntegrationSchema.methods.softDelete = async function(userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.status = 'uninstalled';

  return await this.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Find active integrations for a company
 * @param {ObjectId} companyId - Company ID
 * @param {String} platform - Optional platform filter
 */
platformIntegrationSchema.statics.findActiveByCompany = function(companyId, platform = null) {
  const query = {
    companyId,
    status: 'active',
    isDeleted: false
  };

  if (platform) {
    query.platform = platform;
  }

  return this.find(query).sort({ createdAt: -1 });
};

/**
 * Find integrations needing health check
 * @param {Number} hoursThreshold - Hours since last check
 */
platformIntegrationSchema.statics.findNeedingHealthCheck = function(hoursThreshold = 1) {
  const threshold = new Date();
  threshold.setHours(threshold.getHours() - hoursThreshold);

  return this.find({
    status: 'active',
    isDeleted: false,
    $or: [
      { 'health.lastCheck': { $exists: false } },
      { 'health.lastCheck': { $lt: threshold } }
    ]
  });
};

/**
 * Find integrations with expired credentials
 */
platformIntegrationSchema.statics.findWithExpiredCredentials = function() {
  return this.find({
    'credentials.isExpired': true,
    status: { $ne: 'uninstalled' },
    isDeleted: false
  });
};

/**
 * Get integration statistics
 * @param {ObjectId} companyId - Optional company filter
 */
platformIntegrationSchema.statics.getStatistics = async function(companyId = null) {
  const match = { isDeleted: false };
  if (companyId) {
    match.companyId = companyId;
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$platform',
        total: { $sum: 1 },
        active: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        healthy: {
          $sum: { $cond: [{ $eq: ['$health.status', 'healthy'] }, 1, 0] }
        },
        avgSuccessRate: {
          $avg: {
            $cond: [
              { $eq: ['$metrics.totalSyncs', 0] },
              100,
              { $multiply: [
                { $divide: ['$metrics.successfulSyncs', '$metrics.totalSyncs'] },
                100
              ]}
            ]
          }
        }
      }
    },
    { $sort: { total: -1 } }
  ]);

  return stats;
};

// ============================================================================
// MIDDLEWARE HOOKS
// ============================================================================

/**
 * Pre-save: Encrypt credentials and update timestamps
 */
platformIntegrationSchema.pre('save', async function(next) {
  try {
    // Encrypt credentials if needed
    if (this._credentialsNeedEncryption) {
      const fields = [
        'accessToken', 'refreshToken', 'apiKey', 'apiSecret',
        'consumerKey', 'consumerSecret', 'username', 'password',
        'sshKey', 'sshPassphrase'
      ];

      for (const field of fields) {
        if (this.credentials[field] && this.isModified(`credentials.${field}`)) {
          this.credentials[field] = encryption.encrypt(this.credentials[field]);
        }
      }

      this._credentialsNeedEncryption = false;
    }

    // Encrypt webhook secret
    if (this.isModified('webhooks.secret') && this.webhooks.secret) {
      this.webhooks.secret = encryption.encrypt(this.webhooks.secret);
    }

    // Update credentials expiry flag
    if (this.credentials.expiresAt) {
      this.credentials.isExpired = new Date() > this.credentials.expiresAt;
    }

    // Update timestamp
    this.updatedAt = new Date();

    next();
  } catch (error) {
    logger.error('Error in pre-save middleware:', error);
    next(error);
  }
});

/**
 * Post-save: Log integration changes
 */
platformIntegrationSchema.post('save', function(doc) {
  if (doc.isNew) {
    logger.info('Platform integration created', {
      integrationId: doc._id,
      companyId: doc.companyId,
      platform: doc.platform
    });
  }
});

/**
 * Post-find: Never return encrypted credentials in queries
 */
platformIntegrationSchema.post('find', function(docs) {
  if (Array.isArray(docs)) {
    docs.forEach(doc => {
      if (doc.credentials) {
        delete doc.credentials.accessToken;
        delete doc.credentials.refreshToken;
        delete doc.credentials.apiKey;
        delete doc.credentials.apiSecret;
        delete doc.credentials.consumerKey;
        delete doc.credentials.consumerSecret;
        delete doc.credentials.username;
        delete doc.credentials.password;
        delete doc.credentials.sshKey;
        delete doc.credentials.sshPassphrase;
      }
      if (doc.webhooks) {
        delete doc.webhooks.secret;
      }
    });
  }
});

// Ensure virtuals are included in JSON
platformIntegrationSchema.set('toJSON', { virtuals: true });
platformIntegrationSchema.set('toObject', { virtuals: true });

// ============================================================================
// CREATE MODEL
// ============================================================================

const PlatformIntegration = mongoose.model('PlatformIntegration', platformIntegrationSchema);

module.exports = PlatformIntegration;
