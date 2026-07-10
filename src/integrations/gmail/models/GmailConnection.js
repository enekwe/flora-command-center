const mongoose = require('mongoose');

/**
 * Gmail Connection Model
 * Multi-tenant OAuth connection for Gmail accounts
 *
 * Security Features:
 * - OAuth tokens encrypted with AES-256-GCM
 * - Tokens marked with select: false
 * - Multi-tenant isolation (userId + organizationId)
 */

const gmailConnectionSchema = new mongoose.Schema({
  // Multi-tenant identifiers (REQUIRED)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },

  // Gmail account info
  email: {
    type: String,
    required: true,
    index: true,
    lowercase: true
  },
  accountName: String,
  profilePictureUrl: String,

  // Google account info
  googleAccountId: {
    type: String,
    required: true,
    index: true
  },

  // OAuth tokens (ALWAYS ENCRYPTED - select: false)
  accessToken: {
    type: String,
    required: true,
    select: false // Never include in queries by default
  },
  refreshToken: {
    type: String,
    required: true,
    select: false
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  expiresAt: {
    type: Date,
    required: true
  },

  // OAuth scopes
  scopes: {
    type: [String],
    default: []
  },

  // Gmail sync state
  historyId: {
    type: String,
    index: true
  },
  lastHistoryId: String,

  // Connection status
  status: {
    type: String,
    enum: ['pending', 'active', 'expired', 'disconnected', 'error'],
    default: 'pending',
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  // Sync settings
  syncSettings: {
    autoSync: {
      type: Boolean,
      default: true
    },
    syncFrequency: {
      type: String,
      enum: ['realtime', 'hourly', 'daily', 'manual'],
      default: 'hourly'
    },
    labels: {
      type: [String],
      default: ['INBOX', 'SENT', 'IMPORTANT']
    },
    syncAttachments: {
      type: Boolean,
      default: false
    },
    maxResults: {
      type: Number,
      default: 100
    },
    includeSpamTrash: {
      type: Boolean,
      default: false
    }
  },

  // Watch/Push notification settings
  watchExpiration: Date,
  watchTopicName: String,
  watchSubscription: String,

  // Statistics
  stats: {
    totalEmails: {
      type: Number,
      default: 0
    },
    totalThreads: {
      type: Number,
      default: 0
    },
    lastSyncCount: {
      type: Number,
      default: 0
    }
  },

  // Metadata
  connectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastSyncAt: Date,
  lastConnectedAt: Date,
  disconnectedAt: Date,
  lastError: {
    message: String,
    timestamp: Date,
    code: String
  }
}, {
  timestamps: true,
  collection: 'gmail_connections'
});

// Compound indexes for efficient queries
gmailConnectionSchema.index({ organizationId: 1, email: 1 }, { unique: true });
gmailConnectionSchema.index({ userId: 1, organizationId: 1 });
gmailConnectionSchema.index({ organizationId: 1, status: 1 });
gmailConnectionSchema.index({ googleAccountId: 1, status: 1 });

// Virtual for checking token expiration
gmailConnectionSchema.virtual('isExpired').get(function() {
  if (!this.expiresAt) return false;
  return new Date() >= this.expiresAt;
});

// Methods
gmailConnectionSchema.methods = {
  /**
   * Mark connection as active
   */
  markActive() {
    this.status = 'active';
    this.lastConnectedAt = new Date();
    this.isActive = true;
    return this.save();
  },

  /**
   * Mark connection as disconnected
   */
  markDisconnected(reason = null) {
    this.status = 'disconnected';
    this.disconnectedAt = new Date();
    this.isActive = false;
    if (reason) {
      this.lastError = {
        message: reason,
        timestamp: new Date()
      };
    }
    return this.save();
  },

  /**
   * Update sync time and stats
   */
  updateSyncInfo(emailCount = 0, historyId = null) {
    this.lastSyncAt = new Date();
    this.stats.lastSyncCount = emailCount;

    if (historyId) {
      this.lastHistoryId = this.historyId;
      this.historyId = historyId;
    }

    return this.save();
  },

  /**
   * Log error
   */
  logError(error) {
    this.lastError = {
      message: error.message || error,
      timestamp: new Date(),
      code: error.code || 'UNKNOWN'
    };
    return this.save();
  },

  /**
   * Update watch expiration
   */
  updateWatch(expiration, topicName, subscription) {
    this.watchExpiration = expiration;
    this.watchTopicName = topicName;
    this.watchSubscription = subscription;
    return this.save();
  },

  /**
   * Check if watch is expired
   */
  isWatchExpired() {
    if (!this.watchExpiration) return true;
    return new Date() >= this.watchExpiration;
  },

  /**
   * Get safe connection info (without tokens)
   */
  toSafeObject() {
    const obj = this.toObject();
    delete obj.accessToken;
    delete obj.refreshToken;
    return obj;
  }
};

// Statics
gmailConnectionSchema.statics = {
  /**
   * Find active connection by organization and email
   */
  async findActiveConnection(organizationId, email = null) {
    const query = {
      organizationId,
      status: 'active',
      isActive: true
    };

    if (email) {
      query.email = email.toLowerCase();
    }

    return this.findOne(query);
  },

  /**
   * Find connection with tokens (for API calls)
   */
  async findWithTokens(connectionId) {
    return this.findById(connectionId)
      .select('+accessToken +refreshToken');
  },

  /**
   * Get all active connections for organization
   */
  async findByOrganization(organizationId, includeInactive = false) {
    const query = { organizationId };

    if (!includeInactive) {
      query.isActive = true;
      query.status = 'active';
    }

    return this.find(query).sort({ createdAt: -1 });
  },

  /**
   * Get user's connections
   */
  async findByUser(userId, organizationId = null) {
    const query = { userId };

    if (organizationId) {
      query.organizationId = organizationId;
    }

    return this.find(query).sort({ createdAt: -1 });
  },

  /**
   * Get connections needing token refresh
   */
  async findExpiredConnections() {
    return this.find({
      status: 'active',
      isActive: true,
      expiresAt: { $lt: new Date() }
    });
  },

  /**
   * Get connections with expired watch
   */
  async findExpiredWatches() {
    return this.find({
      status: 'active',
      isActive: true,
      watchExpiration: { $lt: new Date() }
    });
  },

  /**
   * Disconnect all connections for an email
   */
  async disconnectEmail(email, reason = 'Manual disconnect') {
    return this.updateMany(
      { email: email.toLowerCase() },
      {
        $set: {
          status: 'disconnected',
          isActive: false,
          disconnectedAt: new Date(),
          'lastError.message': reason,
          'lastError.timestamp': new Date()
        }
      }
    );
  }
};

// Pre-save middleware
gmailConnectionSchema.pre('save', function(next) {
  // Update status based on expiration
  if (this.expiresAt && new Date() >= this.expiresAt && this.status === 'active') {
    this.status = 'expired';
  }

  // Ensure email is lowercase
  if (this.email) {
    this.email = this.email.toLowerCase();
  }

  next();
});

const GmailConnection = mongoose.model('GmailConnection', gmailConnectionSchema);

module.exports = GmailConnection;
