const { google } = require('googleapis');
const GmailConnection = require('../models/GmailConnection');
const encryption = require('../../../utils/encryption');

/**
 * Gmail OAuth Authentication Service
 *
 * Implements:
 * - OAuth 2.0 authorization flow
 * - Token encryption/decryption (AES-256-GCM)
 * - State parameter with encrypted user context
 * - Token refresh
 * - Connection management
 */

class GmailAuthService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/integrations/gmail/callback';

    // Google OAuth is optional - IMAP polling is used as alternative
    // No warning needed as this is expected configuration

    // Default Gmail scopes
    this.defaultScopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];
  }

  /**
   * Get OAuth2 client
   * @returns {OAuth2Client} - Google OAuth2 client
   */
  getOAuth2Client() {
    return new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );
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
      throw new Error('Google Client ID not configured');
    }

    const oauth2Client = this.getOAuth2Client();

    // Encrypt state parameter with user context
    const state = encryption.encryptState({
      userId,
      organizationId,
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(7)
    });

    const scopes = customScopes || this.defaultScopes;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent' // Force consent to get refresh token
    });

    return authUrl;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @param {string} state - State parameter (encrypted)
   * @returns {Object} - Token data and user context
   */
  async exchangeCodeForToken(code, state) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Google OAuth credentials not configured');
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

      const oauth2Client = this.getOAuth2Client();

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Failed to obtain access and refresh tokens');
      }

      // Set credentials to get user info
      oauth2Client.setCredentials(tokens);

      // Get user info
      const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: 'v2'
      });

      const userInfo = await oauth2.userinfo.get();

      return {
        userId,
        organizationId,
        tokens,
        userInfo: userInfo.data
      };
    } catch (error) {
      if (error.response) {
        throw new Error(`Google OAuth error: ${error.response.data.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Save or update connection with encrypted tokens
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {Object} tokens - Token data from Google
   * @param {Object} userInfo - User info from Google
   * @returns {Object} - Saved connection
   */
  async saveConnection(userId, organizationId, tokens, userInfo) {
    try {
      const {
        access_token,
        refresh_token,
        token_type,
        expiry_date,
        scope
      } = tokens;

      const { email, name, picture, id } = userInfo;

      // Encrypt tokens before saving
      const encryptedAccessToken = this.encryptToken(access_token);
      const encryptedRefreshToken = this.encryptToken(refresh_token);

      // Calculate expiration
      const expiresAt = new Date(expiry_date);

      // Check if connection already exists
      const existingConnection = await GmailConnection.findOne({
        organizationId,
        email: email.toLowerCase()
      });

      let connection;

      if (existingConnection) {
        // Update existing connection
        existingConnection.userId = userId;
        existingConnection.accountName = name;
        existingConnection.profilePictureUrl = picture;
        existingConnection.googleAccountId = id;
        existingConnection.accessToken = encryptedAccessToken;
        existingConnection.refreshToken = encryptedRefreshToken;
        existingConnection.tokenType = token_type;
        existingConnection.expiresAt = expiresAt;
        existingConnection.scopes = scope ? scope.split(' ') : [];
        existingConnection.status = 'active';
        existingConnection.isActive = true;
        existingConnection.lastConnectedAt = new Date();

        connection = await existingConnection.save();
      } else {
        // Create new connection
        connection = await GmailConnection.create({
          userId,
          organizationId,
          email: email.toLowerCase(),
          accountName: name,
          profilePictureUrl: picture,
          googleAccountId: id,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenType: token_type,
          expiresAt: expiresAt,
          scopes: scope ? scope.split(' ') : [],
          status: 'active',
          isActive: true,
          connectedBy: userId,
          lastConnectedAt: new Date()
        });
      }

      // Return connection without tokens
      return connection.toSafeObject();
    } catch (error) {
      throw new Error(`Failed to save Gmail connection: ${error.message}`);
    }
  }

  /**
   * Get authenticated Gmail client
   * @param {string} connectionId - Connection ID
   * @returns {gmail_v1.Gmail} - Authenticated Gmail client
   */
  async getGmailClient(connectionId) {
    try {
      const connection = await GmailConnection.findWithTokens(connectionId);

      if (!connection) {
        throw new Error('Gmail connection not found');
      }

      if (connection.status !== 'active' || !connection.isActive) {
        throw new Error('Gmail connection is not active');
      }

      // Check if token is expired and refresh if needed
      if (connection.isExpired) {
        await this.refreshAccessToken(connectionId);
        // Refetch connection with new tokens
        const refreshedConnection = await GmailConnection.findWithTokens(connectionId);
        connection.accessToken = refreshedConnection.accessToken;
        connection.expiresAt = refreshedConnection.expiresAt;
      }

      // Decrypt tokens
      const accessToken = this.decryptToken(connection.accessToken);

      const oauth2Client = this.getOAuth2Client();
      oauth2Client.setCredentials({
        access_token: accessToken
      });

      return google.gmail({ version: 'v1', auth: oauth2Client });
    } catch (error) {
      throw new Error(`Failed to get Gmail client: ${error.message}`);
    }
  }

  /**
   * Refresh access token
   * @param {string} connectionId - Connection ID
   * @returns {Object} - Updated connection
   */
  async refreshAccessToken(connectionId) {
    try {
      const connection = await GmailConnection.findWithTokens(connectionId);

      if (!connection) {
        throw new Error('Gmail connection not found');
      }

      if (!connection.refreshToken) {
        throw new Error('No refresh token available');
      }

      // Decrypt refresh token
      const refreshToken = this.decryptToken(connection.refreshToken);

      const oauth2Client = this.getOAuth2Client();
      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      // Refresh the token
      const { credentials } = await oauth2Client.refreshAccessToken();

      // Encrypt new access token
      const encryptedAccessToken = this.encryptToken(credentials.access_token);

      // Update connection
      connection.accessToken = encryptedAccessToken;
      connection.expiresAt = new Date(credentials.expiry_date);
      connection.status = 'active';

      await connection.save();

      return connection.toSafeObject();
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${error.message}`);
    }
  }

  /**
   * Revoke access token and disconnect
   * @param {string} connectionId - Connection ID
   * @returns {boolean} - Success status
   */
  async revokeAccess(connectionId) {
    try {
      const connection = await GmailConnection.findWithTokens(connectionId);

      if (!connection) {
        throw new Error('Gmail connection not found');
      }

      // Decrypt token
      const accessToken = this.decryptToken(connection.accessToken);

      const oauth2Client = this.getOAuth2Client();
      oauth2Client.setCredentials({
        access_token: accessToken
      });

      // Revoke with Google
      try {
        await oauth2Client.revokeCredentials();
      } catch (error) {
        console.error('Failed to revoke token with Google:', error.message);
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
      const gmail = await this.getGmailClient(connectionId);

      // Test with Gmail API
      const response = await gmail.users.getProfile({
        userId: 'me'
      });

      return {
        success: true,
        email: response.data.emailAddress,
        messagesTotal: response.data.messagesTotal,
        threadsTotal: response.data.threadsTotal
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
      const connection = await GmailConnection.findById(connectionId);

      if (!connection) {
        throw new Error('Gmail connection not found');
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
      const connections = await GmailConnection.findByOrganization(
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
      const connection = await GmailConnection.findById(connectionId);

      if (!connection) {
        throw new Error('Gmail connection not found');
      }

      return connection.toSafeObject();
    } catch (error) {
      throw new Error(`Failed to get connection: ${error.message}`);
    }
  }

  /**
   * Refresh expired tokens for all connections
   * @returns {Object} - Refresh results
   */
  async refreshExpiredTokens() {
    try {
      const expiredConnections = await GmailConnection.findExpiredConnections();

      const results = {
        total: expiredConnections.length,
        refreshed: 0,
        failed: 0,
        errors: []
      };

      for (const connection of expiredConnections) {
        try {
          await this.refreshAccessToken(connection._id.toString());
          results.refreshed++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            connectionId: connection._id,
            email: connection.email,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to refresh expired tokens: ${error.message}`);
    }
  }
}

module.exports = new GmailAuthService();
