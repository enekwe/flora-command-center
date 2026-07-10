const mongoose = require('mongoose');

/**
 * Slack Connection Model
 * Multi-tenant OAuth connection for Slack workspaces
 *
 * Security Features:
 * - OAuth tokens encrypted with AES-256-GCM
 * - Tokens marked with select: false
 * - Multi-tenant isolation (userId + organizationId)
 */

const slackConnectionSchema = new mongoose.Schema({
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

  // Slack workspace info
  teamId: {
    type: String,
    required: true,
    index: true
  },
  teamName: {
    type: String,
    required: true
  },
  teamDomain: String,
  teamUrl: String,

  // Bot/App info
  appId: String,
  botUserId: String,

  // OAuth tokens (ALWAYS ENCRYPTED - select: false)
  accessToken: {
    type: String,
    required: true,
    select: false // Never include in queries by default
  },
  refreshToken: {
    type: String,
    select: false
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  expiresAt: {
    type: Date,
    required: false // Slack tokens don't always expire
  },

  // OAuth scopes
  scopes: {
    type: [String],
    default: []
  },
  botScopes: {
    type: [String],
    default: []
  },

  // Webhook configuration
  webhookUrl: String,
  webhookChannel: String,
  webhookConfigUrl: String,

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
    channels: {
      type: [String],
      default: []
    },
    autoSync: {
      type: Boolean,
      default: false
    },
    syncMessages: {
      type: Boolean,
      default: true
    },
    syncFiles: {
      type: Boolean,
      default: false
    },
    syncFrequency: {
      type: String,
      enum: ['realtime', 'hourly', 'daily', 'manual'],
      default: 'realtime'
    }
  },

  // Metadata
  installedBy: {
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
  collection: 'slack_connections'
});

// Compound indexes for efficient queries
slackConnectionSchema.index({ organizationId: 1, teamId: 1 }, { unique: true });
slackConnectionSchema.index({ userId: 1, organizationId: 1 });
slackConnectionSchema.index({ organizationId: 1, status: 1 });
slackConnectionSchema.index({ teamId: 1, status: 1 });

// Virtual for checking token expiration
slackConnectionSchema.virtual('isExpired').get(function() {
  if (!this.expiresAt) return false;
  return new Date() >= this.expiresAt;
});

// Methods
slackConnectionSchema.methods = {
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
   * Update last sync time
   */
  updateSyncTime() {
    this.lastSyncAt = new Date();
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
slackConnectionSchema.statics = {
  /**
   * Find active connection by organization and team
   */
  async findActiveConnection(organizationId, teamId = null) {
    const query = {
      organizationId,
      status: 'active',
      isActive: true
    };

    if (teamId) {
      query.teamId = teamId;
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
   * Disconnect all connections for a team
   */
  async disconnectTeam(teamId, reason = 'Manual disconnect') {
    return this.updateMany(
      { teamId },
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
slackConnectionSchema.pre('save', function(next) {
  // Update status based on expiration
  if (this.expiresAt && new Date() >= this.expiresAt && this.status === 'active') {
    this.status = 'expired';
    this.isActive = false;
  }
  next();
});

const SlackConnection = mongoose.model('SlackConnection', slackConnectionSchema);

module.exports = SlackConnection;
