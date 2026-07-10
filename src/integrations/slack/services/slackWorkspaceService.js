const { WebClient } = require('@slack/web-api');
const slackAuthService = require('./slackAuthService');

/**
 * Slack Workspace Service
 *
 * Handles:
 * - Channel management
 * - User management
 * - Workspace info
 * - Conversations
 */

class SlackWorkspaceService {
  /**
   * Get Slack Web Client with access token
   * @param {string} connectionId - Connection ID
   * @returns {WebClient} - Slack Web Client instance
   */
  async getClient(connectionId) {
    const accessToken = await slackAuthService.getAccessToken(connectionId);
    return new WebClient(accessToken);
  }

  /**
   * Get workspace info
   * @param {string} connectionId - Connection ID
   * @returns {Object} - Workspace information
   */
  async getWorkspaceInfo(connectionId) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.team.info();

      return {
        success: response.ok,
        workspace: response.team
      };
    } catch (error) {
      throw new Error(`Failed to get workspace info: ${error.message}`);
    }
  }

  /**
   * List all channels
   * @param {string} connectionId - Connection ID
   * @param {Object} options - Options (types, excludeArchived, limit)
   * @returns {Object} - List of channels
   */
  async listChannels(connectionId, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.list({
        types: options.types || 'public_channel,private_channel',
        exclude_archived: options.excludeArchived !== false,
        limit: options.limit || 100
      });

      return {
        success: response.ok,
        channels: response.channels || [],
        responseMetadata: response.response_metadata
      };
    } catch (error) {
      throw new Error(`Failed to list channels: ${error.message}`);
    }
  }

  /**
   * Get channel info
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @returns {Object} - Channel information
   */
  async getChannelInfo(connectionId, channel) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.info({
        channel
      });

      return {
        success: response.ok,
        channel: response.channel
      };
    } catch (error) {
      throw new Error(`Failed to get channel info: ${error.message}`);
    }
  }

  /**
   * Create a channel
   * @param {string} connectionId - Connection ID
   * @param {string} name - Channel name
   * @param {boolean} isPrivate - Whether channel is private
   * @returns {Object} - Created channel
   */
  async createChannel(connectionId, name, isPrivate = false) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.create({
        name,
        is_private: isPrivate
      });

      return {
        success: response.ok,
        channel: response.channel
      };
    } catch (error) {
      throw new Error(`Failed to create channel: ${error.message}`);
    }
  }

  /**
   * Archive a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @returns {Object} - Archive response
   */
  async archiveChannel(connectionId, channel) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.archive({
        channel
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to archive channel: ${error.message}`);
    }
  }

  /**
   * Unarchive a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @returns {Object} - Unarchive response
   */
  async unarchiveChannel(connectionId, channel) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.unarchive({
        channel
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to unarchive channel: ${error.message}`);
    }
  }

  /**
   * Rename a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} name - New channel name
   * @returns {Object} - Rename response
   */
  async renameChannel(connectionId, channel, name) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.rename({
        channel,
        name
      });

      return {
        success: response.ok,
        channel: response.channel
      };
    } catch (error) {
      throw new Error(`Failed to rename channel: ${error.message}`);
    }
  }

  /**
   * Set channel topic
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} topic - New topic
   * @returns {Object} - Topic response
   */
  async setChannelTopic(connectionId, channel, topic) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.setTopic({
        channel,
        topic
      });

      return {
        success: response.ok,
        topic: response.topic
      };
    } catch (error) {
      throw new Error(`Failed to set channel topic: ${error.message}`);
    }
  }

  /**
   * Set channel purpose
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} purpose - New purpose
   * @returns {Object} - Purpose response
   */
  async setChannelPurpose(connectionId, channel, purpose) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.setPurpose({
        channel,
        purpose
      });

      return {
        success: response.ok,
        purpose: response.purpose
      };
    } catch (error) {
      throw new Error(`Failed to set channel purpose: ${error.message}`);
    }
  }

  /**
   * Invite users to a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {Array<string>} users - User IDs to invite
   * @returns {Object} - Invite response
   */
  async inviteToChannel(connectionId, channel, users) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.invite({
        channel,
        users: users.join(',')
      });

      return {
        success: response.ok,
        channel: response.channel
      };
    } catch (error) {
      throw new Error(`Failed to invite users to channel: ${error.message}`);
    }
  }

  /**
   * Kick user from channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} user - User ID to kick
   * @returns {Object} - Kick response
   */
  async kickFromChannel(connectionId, channel, user) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.kick({
        channel,
        user
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to kick user from channel: ${error.message}`);
    }
  }

  /**
   * Get channel members
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {Object} options - Options (limit, cursor)
   * @returns {Object} - Channel members
   */
  async getChannelMembers(connectionId, channel, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.members({
        channel,
        limit: options.limit || 100,
        cursor: options.cursor
      });

      return {
        success: response.ok,
        members: response.members || [],
        responseMetadata: response.response_metadata
      };
    } catch (error) {
      throw new Error(`Failed to get channel members: ${error.message}`);
    }
  }

  /**
   * List users in workspace
   * @param {string} connectionId - Connection ID
   * @param {Object} options - Options (limit, cursor)
   * @returns {Object} - List of users
   */
  async listUsers(connectionId, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.users.list({
        limit: options.limit || 100,
        cursor: options.cursor
      });

      return {
        success: response.ok,
        users: response.members || [],
        responseMetadata: response.response_metadata
      };
    } catch (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }
  }

  /**
   * Get user info
   * @param {string} connectionId - Connection ID
   * @param {string} user - User ID
   * @returns {Object} - User information
   */
  async getUserInfo(connectionId, user) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.users.info({
        user
      });

      return {
        success: response.ok,
        user: response.user
      };
    } catch (error) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Get user presence
   * @param {string} connectionId - Connection ID
   * @param {string} user - User ID
   * @returns {Object} - User presence
   */
  async getUserPresence(connectionId, user) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.users.getPresence({
        user
      });

      return {
        success: response.ok,
        presence: response.presence,
        online: response.online,
        autoAway: response.auto_away,
        manualAway: response.manual_away
      };
    } catch (error) {
      throw new Error(`Failed to get user presence: ${error.message}`);
    }
  }

  /**
   * Open a direct message conversation
   * @param {string} connectionId - Connection ID
   * @param {Array<string>} users - User IDs
   * @returns {Object} - Conversation info
   */
  async openDirectMessage(connectionId, users) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.open({
        users: users.join(',')
      });

      return {
        success: response.ok,
        channel: response.channel
      };
    } catch (error) {
      throw new Error(`Failed to open direct message: ${error.message}`);
    }
  }

  /**
   * Join a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @returns {Object} - Join response
   */
  async joinChannel(connectionId, channel) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.join({
        channel
      });

      return {
        success: response.ok,
        channel: response.channel
      };
    } catch (error) {
      throw new Error(`Failed to join channel: ${error.message}`);
    }
  }

  /**
   * Leave a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @returns {Object} - Leave response
   */
  async leaveChannel(connectionId, channel) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.leave({
        channel
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to leave channel: ${error.message}`);
    }
  }
}

module.exports = new SlackWorkspaceService();
