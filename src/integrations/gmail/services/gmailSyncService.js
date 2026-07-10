const gmailAuthService = require('./gmailAuthService');
const GmailConnection = require('../models/GmailConnection');

/**
 * Gmail Sync Service
 *
 * Handles:
 * - Email synchronization
 * - Message retrieval
 * - Thread management
 * - Sending emails
 * - History sync
 */

class GmailSyncService {
  /**
   * Get Gmail client
   * @param {string} connectionId - Connection ID
   * @returns {gmail_v1.Gmail} - Gmail client
   */
  async getClient(connectionId) {
    return gmailAuthService.getGmailClient(connectionId);
  }

  /**
   * List messages
   * @param {string} connectionId - Connection ID
   * @param {Object} options - Query options
   * @returns {Object} - Messages list
   */
  async listMessages(connectionId, options = {}) {
    try {
      const gmail = await this.getClient(connectionId);

      const params = {
        userId: 'me',
        maxResults: options.maxResults || 100,
        labelIds: options.labelIds,
        q: options.query,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash || false
      };

      const response = await gmail.users.messages.list(params);

      return {
        success: true,
        messages: response.data.messages || [],
        nextPageToken: response.data.nextPageToken,
        resultSizeEstimate: response.data.resultSizeEstimate
      };
    } catch (error) {
      throw new Error(`Failed to list messages: ${error.message}`);
    }
  }

  /**
   * Get message details
   * @param {string} connectionId - Connection ID
   * @param {string} messageId - Message ID
   * @param {string} format - Message format (full, metadata, minimal, raw)
   * @returns {Object} - Message details
   */
  async getMessage(connectionId, messageId, format = 'full') {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: format
      });

      return {
        success: true,
        message: response.data
      };
    } catch (error) {
      throw new Error(`Failed to get message: ${error.message}`);
    }
  }

  /**
   * Send an email
   * @param {string} connectionId - Connection ID
   * @param {Object} emailData - Email data (to, subject, body, etc.)
   * @returns {Object} - Send result
   */
  async sendMessage(connectionId, emailData) {
    try {
      const gmail = await this.getClient(connectionId);

      // Build email content
      const { to, cc, bcc, subject, body, isHtml, threadId, replyTo } = emailData;

      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`
      ];

      if (cc) headers.push(`Cc: ${cc}`);
      if (bcc) headers.push(`Bcc: ${bcc}`);
      if (replyTo) headers.push(`Reply-To: ${replyTo}`);

      headers.push(`Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`);

      const email = [
        ...headers,
        '',
        body
      ].join('\n');

      // Encode email in base64url
      const encodedEmail = Buffer.from(email)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const params = {
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
          threadId: threadId
        }
      };

      const response = await gmail.users.messages.send(params);

      return {
        success: true,
        messageId: response.data.id,
        threadId: response.data.threadId
      };
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Modify message labels
   * @param {string} connectionId - Connection ID
   * @param {string} messageId - Message ID
   * @param {Array} addLabelIds - Labels to add
   * @param {Array} removeLabelIds - Labels to remove
   * @returns {Object} - Modify result
   */
  async modifyMessage(connectionId, messageId, addLabelIds = [], removeLabelIds = []) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds,
          removeLabelIds
        }
      });

      return {
        success: true,
        message: response.data
      };
    } catch (error) {
      throw new Error(`Failed to modify message: ${error.message}`);
    }
  }

  /**
   * Trash a message
   * @param {string} connectionId - Connection ID
   * @param {string} messageId - Message ID
   * @returns {Object} - Trash result
   */
  async trashMessage(connectionId, messageId) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.messages.trash({
        userId: 'me',
        id: messageId
      });

      return {
        success: true,
        message: response.data
      };
    } catch (error) {
      throw new Error(`Failed to trash message: ${error.message}`);
    }
  }

  /**
   * Untrash a message
   * @param {string} connectionId - Connection ID
   * @param {string} messageId - Message ID
   * @returns {Object} - Untrash result
   */
  async untrashMessage(connectionId, messageId) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.messages.untrash({
        userId: 'me',
        id: messageId
      });

      return {
        success: true,
        message: response.data
      };
    } catch (error) {
      throw new Error(`Failed to untrash message: ${error.message}`);
    }
  }

  /**
   * Delete a message permanently
   * @param {string} connectionId - Connection ID
   * @param {string} messageId - Message ID
   * @returns {Object} - Delete result
   */
  async deleteMessage(connectionId, messageId) {
    try {
      const gmail = await this.getClient(connectionId);

      await gmail.users.messages.delete({
        userId: 'me',
        id: messageId
      });

      return {
        success: true
      };
    } catch (error) {
      throw new Error(`Failed to delete message: ${error.message}`);
    }
  }

  /**
   * List threads
   * @param {string} connectionId - Connection ID
   * @param {Object} options - Query options
   * @returns {Object} - Threads list
   */
  async listThreads(connectionId, options = {}) {
    try {
      const gmail = await this.getClient(connectionId);

      const params = {
        userId: 'me',
        maxResults: options.maxResults || 100,
        labelIds: options.labelIds,
        q: options.query,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash || false
      };

      const response = await gmail.users.threads.list(params);

      return {
        success: true,
        threads: response.data.threads || [],
        nextPageToken: response.data.nextPageToken,
        resultSizeEstimate: response.data.resultSizeEstimate
      };
    } catch (error) {
      throw new Error(`Failed to list threads: ${error.message}`);
    }
  }

  /**
   * Get thread details
   * @param {string} connectionId - Connection ID
   * @param {string} threadId - Thread ID
   * @param {string} format - Message format
   * @returns {Object} - Thread details
   */
  async getThread(connectionId, threadId, format = 'full') {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: format
      });

      return {
        success: true,
        thread: response.data
      };
    } catch (error) {
      throw new Error(`Failed to get thread: ${error.message}`);
    }
  }

  /**
   * Modify thread labels
   * @param {string} connectionId - Connection ID
   * @param {string} threadId - Thread ID
   * @param {Array} addLabelIds - Labels to add
   * @param {Array} removeLabelIds - Labels to remove
   * @returns {Object} - Modify result
   */
  async modifyThread(connectionId, threadId, addLabelIds = [], removeLabelIds = []) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: {
          addLabelIds,
          removeLabelIds
        }
      });

      return {
        success: true,
        thread: response.data
      };
    } catch (error) {
      throw new Error(`Failed to modify thread: ${error.message}`);
    }
  }

  /**
   * Get message history (incremental sync)
   * @param {string} connectionId - Connection ID
   * @param {string} startHistoryId - Starting history ID
   * @returns {Object} - History data
   */
  async getHistory(connectionId, startHistoryId = null) {
    try {
      const connection = await GmailConnection.findById(connectionId);

      if (!connection) {
        throw new Error('Connection not found');
      }

      const historyId = startHistoryId || connection.historyId;

      if (!historyId) {
        throw new Error('No history ID available. Perform a full sync first.');
      }

      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: historyId,
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
      });

      // Update connection with latest history ID
      if (response.data.historyId) {
        await connection.updateSyncInfo(
          response.data.history?.length || 0,
          response.data.historyId
        );
      }

      return {
        success: true,
        history: response.data.history || [],
        historyId: response.data.historyId,
        nextPageToken: response.data.nextPageToken
      };
    } catch (error) {
      throw new Error(`Failed to get history: ${error.message}`);
    }
  }

  /**
   * Get user profile
   * @param {string} connectionId - Connection ID
   * @returns {Object} - User profile
   */
  async getProfile(connectionId) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.getProfile({
        userId: 'me'
      });

      return {
        success: true,
        profile: response.data
      };
    } catch (error) {
      throw new Error(`Failed to get profile: ${error.message}`);
    }
  }

  /**
   * Search messages
   * @param {string} connectionId - Connection ID
   * @param {string} query - Search query
   * @param {Object} options - Additional options
   * @returns {Object} - Search results
   */
  async searchMessages(connectionId, query, options = {}) {
    return this.listMessages(connectionId, {
      query,
      ...options
    });
  }

  /**
   * Batch get messages
   * @param {string} connectionId - Connection ID
   * @param {Array<string>} messageIds - Array of message IDs
   * @param {string} format - Message format
   * @returns {Object} - Messages
   */
  async batchGetMessages(connectionId, messageIds, format = 'full') {
    try {
      const messages = await Promise.all(
        messageIds.map(id => this.getMessage(connectionId, id, format))
      );

      return {
        success: true,
        messages: messages.map(m => m.message)
      };
    } catch (error) {
      throw new Error(`Failed to batch get messages: ${error.message}`);
    }
  }
}

module.exports = new GmailSyncService();
