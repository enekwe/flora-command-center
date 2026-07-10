const axios = require('axios');
const SlackConnection = require('../models/SlackConnection');
const encryption = require('../../../utils/encryption');

/**
 * Slack OAuth Authentication Service
 *
 * Implements:
 * - OAuth 2.0 authorization flow
 * - Token encryption/decryption (AES-256-GCM)
 * - State parameter with encrypted user context
 * - Token refresh (if applicable)
 * - Connection management
 */

class SlackAuthService {
  constructor() {
    this.clientId = process.env.SLACK_CLIENT_ID;
    this.clientSecret = process.env.SLACK_CLIENT_SECRET;
    this.redirectUri = process.env.SLACK_REDIRECT_URI || 'http://localhost:4000/api/integrations/slack/callback';

    if (!this.clientId || !this.clientSecret) {
      console.warn('Slack OAuth credentials not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.');
    }

    // Slack OAuth endpoints
    this.authUrl = 'https://slack.com/oauth/v2/authorize';
    this.tokenUrl = 'https://slack.com/api/oauth.v2.access';
    this.revokeUrl = 'https://slack.com/api/auth.revoke';

    // Default scopes
    this.defaultScopes = [
      'channels:read',
      'channels:history',
      'chat:write',
      'users:read',
      'users:read.email',
      'team:read'
    ];

    this.defaultBotScopes = [
      'channels:read',
      'channels:history',
      'chat:write',
      'users:read',
      'users:read.email'
    ];
  }

  /**
   * Encrypt token for storage
   * @param {string} token - Plain token
   * @returns {string} - Encrypted token
   */
  encryptToken(token) {
    return encryption.encrypt(token);
  }

  /**
   * Decrypt token for use
   * @param {string} encryptedToken - Encrypted token
   * @returns {string} - Plain token
   */
  decryptToken(encryptedToken) {
    return encryption.decrypt(encryptedToken);
  }

  /**
   * Generate OAuth authorization URL
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {Array<string>} customScopes - Optional custom scopes
   * @returns {string} - Authorization URL
   */
  getAuthorizationUrl(userId, organizationId, customScopes = null) {
    if (!this.clientId) {
      throw new Error('Slack Client ID not configured');
    }

    // Encrypt state parameter with user context
    const state = encryption.encryptState({
      userId,
      organizationId,
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(7)
    });

    const scopes = customScopes || this.defaultScopes;
    const botScopes = this.defaultBotScopes;

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(','),
      user_scope: botScopes.join(','),
      state: state
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @param {string} state - State parameter (encrypted)
   * @returns {Object} - Token data and user context
   */
  async exchangeCodeForToken(code, state) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Slack OAuth credentials not configured');
    }

    try {
      // Decrypt and validate state
      const stateData = encryption.decryptState(state);
      const { userId, organizationId, timestamp } = stateData;

      // Validate state timestamp (within 10 minutes)
      const stateAge = Date.now() - timestamp;
      if (stateAge > 10 * 60 * 1000) {
        throw new Error('OAuth state expired. Please try again.');
      }

      // Exchange code for tokens
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
          redirect_uri: this.redirectUri
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (!response.data.ok) {
        throw new Error(response.data.error || 'Failed to exchange code for token');
      }

      const tokenData = response.data;

      return {
        userId,
        organizationId,
        tokenData
      };
    } catch (error) {
      if (error.response) {
        throw new Error(`Slack OAuth error: ${error.response.data.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Save or update connection with encrypted tokens
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {Object} tokenData - Token data from Slack
   * @returns {Object} - Saved connection
   */
  async saveConnection(userId, organizationId, tokenData) {
    try {
      const {
        access_token,
        token_type,
        scope,
        bot_user_id,
        app_id,
        team,
        authed_user,
        incoming_webhook,
        expires_in
      } = tokenData;

      // Encrypt tokens before saving
      const encryptedAccessToken = this.encryptToken(access_token);

      // Calculate expiration (if provided)
      const expiresAt = expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : null;

      // Check if connection already exists
      const existingConnection = await SlackConnection.findOne({
        organizationId,
        teamId: team.id
      });

      let connection;

      if (existingConnection) {
        // Update existing connection
        existingConnection.userId = userId;
        existingConnection.teamName = team.name;
        existingConnection.accessToken = encryptedAccessToken;
        existingConnection.tokenType = token_type;
        existingConnection.expiresAt = expiresAt;
        existingConnection.scopes = scope ? scope.split(',') : [];
        existingConnection.botUserId = bot_user_id;
        existingConnection.appId = app_id;
        existingConnection.status = 'active';
        existingConnection.isActive = true;
        existingConnection.lastConnectedAt = new Date();

        if (incoming_webhook) {
          existingConnection.webhookUrl = incoming_webhook.url;
          existingConnection.webhookChannel = incoming_webhook.channel;
          existingConnection.webhookConfigUrl = incoming_webhook.configuration_url;
        }

        connection = await existingConnection.save();
      } else {
        // Create new connection
        connection = await SlackConnection.create({
          userId,
          organizationId,
          teamId: team.id,
          teamName: team.name,
          accessToken: encryptedAccessToken,
          tokenType: token_type,
          expiresAt: expiresAt,
          scopes: scope ? scope.split(',') : [],
          botUserId: bot_user_id,
          appId: app_id,
          webhookUrl: incoming_webhook?.url,
          webhookChannel: incoming_webhook?.channel,
          webhookConfigUrl: incoming_webhook?.configuration_url,
          status: 'active',
          isActive: true,
          installedBy: userId,
          lastConnectedAt: new Date()
        });
      }

      // Return connection without tokens
      return connection.toSafeObject();
    } catch (error) {
      throw new Error(`Failed to save Slack connection: ${error.message}`);
    }
  }

  /**
   * Get decrypted access token for API calls
   * @param {string} connectionId - Connection ID
   * @returns {string} - Decrypted access token
   */
  async getAccessToken(connectionId) {
    try {
      const connection = await SlackConnection.findWithTokens(connectionId);

      if (!connection) {
        throw new Error('Slack connection not found');
      }

      if (connection.status !== 'active' || !connection.isActive) {
        throw new Error('Slack connection is not active');
      }

      // Check if token is expired
      if (connection.isExpired) {
        throw new Error('Slack access token expired');
      }

      // Decrypt and return token
      return this.decryptToken(connection.accessToken);
    } catch (error) {
      throw new Error(`Failed to get access token: ${error.message}`);
    }
  }

  /**
   * Refresh access token (if Slack supports it)
   * Note: As of now, Slack doesn't typically require token refresh
   * @param {string} connectionId - Connection ID
   * @returns {Object} - Updated connection
   */
  async refreshAccessToken(connectionId) {
    throw new Error('Slack does not currently support token refresh. Tokens do not expire unless revoked.');
  }

  /**
   * Revoke access token and disconnect
   * @param {string} connectionId - Connection ID
   * @returns {boolean} - Success status
   */
  async revokeAccess(connectionId) {
    try {
      const connection = await SlackConnection.findWithTokens(connectionId);

      if (!connection) {
        throw new Error('Slack connection not found');
      }

      // Decrypt token
      const accessToken = this.decryptToken(connection.accessToken);

      // Revoke with Slack API
      try {
        await axios.post(
          this.revokeUrl,
          new URLSearchParams({
            token: accessToken
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
      } catch (error) {
        console.error('Failed to revoke token with Slack:', error.message);
        // Continue with local disconnection even if revocation fails
      }

      // Mark connection as disconnected
      await connection.markDisconnected('Access revoked by user');

      return true;
    } catch (error) {
      throw new Error(`Failed to revoke access: ${error.message}`);
    }
  }

  /**
   * Test connection validity
   * @param {string} connectionId - Connection ID
   * @returns {Object} - Test result
   */
  async testConnection(connectionId) {
    try {
      const accessToken = await this.getAccessToken(connectionId);

      // Test with Slack API
      const response = await axios.post(
        'https://slack.com/api/auth.test',
        {},
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.data.ok) {
        throw new Error(response.data.error || 'Connection test failed');
      }

      return {
        success: true,
        team: response.data.team,
        user: response.data.user,
        teamId: response.data.team_id,
        userId: response.data.user_id
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Disconnect connection (soft delete)
   * @param {string} connectionId - Connection ID
   * @param {string} reason - Disconnect reason
   * @returns {Object} - Updated connection
   */
  async disconnect(connectionId, reason = 'User disconnected') {
    try {
      const connection = await SlackConnection.findById(connectionId);

      if (!connection) {
        throw new Error('Slack connection not found');
      }

      await connection.markDisconnected(reason);

      return connection.toSafeObject();
    } catch (error) {
      throw new Error(`Failed to disconnect: ${error.message}`);
    }
  }

  /**
   * Get all connections for an organization
   * @param {string} organizationId - Organization ID
   * @param {boolean} includeInactive - Include inactive connections
   * @returns {Array} - List of connections
   */
  async getConnections(organizationId, includeInactive = false) {
    try {
      const connections = await SlackConnection.findByOrganization(
        organizationId,
        includeInactive
      );

      return connections.map(conn => conn.toSafeObject());
    } catch (error) {
      throw new Error(`Failed to get connections: ${error.message}`);
    }
  }

  /**
   * Get connection by ID
   * @param {string} connectionId - Connection ID
   * @returns {Object} - Connection object
   */
  async getConnection(connectionId) {
    try {
      const connection = await SlackConnection.findById(connectionId);

      if (!connection) {
        throw new Error('Slack connection not found');
      }

      return connection.toSafeObject();
    } catch (error) {
      throw new Error(`Failed to get connection: ${error.message}`);
    }
  }
}

module.exports = new SlackAuthService();
