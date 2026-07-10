const { WebClient } = require('@slack/web-api');
const slackAuthService = require('./slackAuthService');

/**
 * Slack Message Service
 *
 * Handles:
 * - Sending messages to channels
 * - Retrieving message history
 * - Replying to threads
 * - Updating and deleting messages
 * - File uploads
 */

class SlackMessageService {
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
   * Send a message to a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID or name
   * @param {string} text - Message text
   * @param {Object} options - Additional options (blocks, attachments, etc.)
   * @returns {Object} - Message response
   */
  async sendMessage(connectionId, channel, text, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.postMessage({
        channel,
        text,
        ...options
      });

      return {
        success: response.ok,
        message: {
          ts: response.ts,
          channel: response.channel,
          text: text
        }
      };
    } catch (error) {
      throw new Error(`Failed to send Slack message: ${error.message}`);
    }
  }

  /**
   * Send a formatted message with blocks
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID or name
   * @param {Array} blocks - Slack Block Kit blocks
   * @param {string} fallbackText - Fallback text for notifications
   * @returns {Object} - Message response
   */
  async sendBlockMessage(connectionId, channel, blocks, fallbackText = '') {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.postMessage({
        channel,
        text: fallbackText,
        blocks
      });

      return {
        success: response.ok,
        message: {
          ts: response.ts,
          channel: response.channel
        }
      };
    } catch (error) {
      throw new Error(`Failed to send block message: ${error.message}`);
    }
  }

  /**
   * Reply to a thread
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} threadTs - Thread timestamp
   * @param {string} text - Reply text
   * @param {Object} options - Additional options
   * @returns {Object} - Message response
   */
  async replyToThread(connectionId, channel, threadTs, text, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text,
        ...options
      });

      return {
        success: response.ok,
        message: {
          ts: response.ts,
          channel: response.channel,
          threadTs: threadTs
        }
      };
    } catch (error) {
      throw new Error(`Failed to reply to thread: ${error.message}`);
    }
  }

  /**
   * Update an existing message
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} ts - Message timestamp
   * @param {string} text - New message text
   * @param {Object} options - Additional options
   * @returns {Object} - Update response
   */
  async updateMessage(connectionId, channel, ts, text, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.update({
        channel,
        ts,
        text,
        ...options
      });

      return {
        success: response.ok,
        message: {
          ts: response.ts,
          channel: response.channel
        }
      };
    } catch (error) {
      throw new Error(`Failed to update message: ${error.message}`);
    }
  }

  /**
   * Delete a message
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} ts - Message timestamp
   * @returns {Object} - Delete response
   */
  async deleteMessage(connectionId, channel, ts) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.delete({
        channel,
        ts
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to delete message: ${error.message}`);
    }
  }

  /**
   * Get message history from a channel
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {Object} options - Options (limit, oldest, latest, etc.)
   * @returns {Object} - Message history
   */
  async getHistory(connectionId, channel, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.history({
        channel,
        limit: options.limit || 100,
        oldest: options.oldest,
        latest: options.latest,
        inclusive: options.inclusive !== false
      });

      return {
        success: response.ok,
        messages: response.messages || [],
        hasMore: response.has_more,
        responseMetadata: response.response_metadata
      };
    } catch (error) {
      throw new Error(`Failed to get message history: ${error.message}`);
    }
  }

  /**
   * Get replies to a thread
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} ts - Thread timestamp
   * @param {Object} options - Options (limit, oldest, latest)
   * @returns {Object} - Thread replies
   */
  async getReplies(connectionId, channel, ts, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.conversations.replies({
        channel,
        ts,
        limit: options.limit || 100,
        oldest: options.oldest,
        latest: options.latest
      });

      return {
        success: response.ok,
        messages: response.messages || [],
        hasMore: response.has_more
      };
    } catch (error) {
      throw new Error(`Failed to get thread replies: ${error.message}`);
    }
  }

  /**
   * Upload a file to a channel
   * @param {string} connectionId - Connection ID
   * @param {Object} fileData - File data
   * @param {string} fileData.channels - Comma-separated channel IDs
   * @param {Buffer|string} fileData.file - File content
   * @param {string} fileData.filename - File name
   * @param {string} fileData.title - File title
   * @param {string} fileData.initialComment - Initial comment
   * @returns {Object} - Upload response
   */
  async uploadFile(connectionId, fileData) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.files.upload({
        channels: fileData.channels,
        file: fileData.file,
        filename: fileData.filename,
        title: fileData.title,
        initial_comment: fileData.initialComment
      });

      return {
        success: response.ok,
        file: response.file
      };
    } catch (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Add a reaction to a message
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} timestamp - Message timestamp
   * @param {string} reaction - Reaction name (without colons)
   * @returns {Object} - Reaction response
   */
  async addReaction(connectionId, channel, timestamp, reaction) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.reactions.add({
        channel,
        timestamp,
        name: reaction
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to add reaction: ${error.message}`);
    }
  }

  /**
   * Remove a reaction from a message
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} timestamp - Message timestamp
   * @param {string} reaction - Reaction name (without colons)
   * @returns {Object} - Reaction response
   */
  async removeReaction(connectionId, channel, timestamp, reaction) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.reactions.remove({
        channel,
        timestamp,
        name: reaction
      });

      return {
        success: response.ok
      };
    } catch (error) {
      throw new Error(`Failed to remove reaction: ${error.message}`);
    }
  }

  /**
   * Search for messages
   * @param {string} connectionId - Connection ID
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Object} - Search results
   */
  async searchMessages(connectionId, query, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.search.messages({
        query,
        count: options.count || 20,
        page: options.page || 1,
        sort: options.sort || 'timestamp',
        sort_dir: options.sortDir || 'desc'
      });

      return {
        success: response.ok,
        messages: response.messages?.matches || [],
        total: response.messages?.total || 0
      };
    } catch (error) {
      throw new Error(`Failed to search messages: ${error.message}`);
    }
  }

  /**
   * Schedule a message for later delivery
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} text - Message text
   * @param {number} postAt - Unix timestamp for when to post
   * @param {Object} options - Additional options
   * @returns {Object} - Scheduled message response
   */
  async scheduleMessage(connectionId, channel, text, postAt, options = {}) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.scheduleMessage({
        channel,
        text,
        post_at: postAt,
        ...options
      });

      return {
        success: response.ok,
        scheduledMessageId: response.scheduled_message_id,
        postAt: response.post_at
      };
    } catch (error) {
      throw new Error(`Failed to schedule message: ${error.message}`);
    }
  }

  /**
   * Get permalink for a message
   * @param {string} connectionId - Connection ID
   * @param {string} channel - Channel ID
   * @param {string} messageTs - Message timestamp
   * @returns {Object} - Permalink response
   */
  async getPermalink(connectionId, channel, messageTs) {
    try {
      const client = await this.getClient(connectionId);

      const response = await client.chat.getPermalink({
        channel,
        message_ts: messageTs
      });

      return {
        success: response.ok,
        permalink: response.permalink
      };
    } catch (error) {
      throw new Error(`Failed to get permalink: ${error.message}`);
    }
  }
}

module.exports = new SlackMessageService();
