const gmailAuthService = require('./gmailAuthService');
const gmailSyncService = require('./gmailSyncService');
const GmailConnection = require('../models/GmailConnection');
const logger = require('../../../config/logger');

/**
 * Gmail Polling Service
 *
 * Handles periodic email polling for Gmail accounts with:
 * - Configurable polling intervals
 * - Context-aware email processing (deals, fundraising, intros, etc.)
 * - Screenshot/attachment processing
 * - Multi-tenant support
 * - Email marking as read
 *
 * MIGRATION NOTE: Enhanced from monolith version with:
 * - Multi-tenant support (userId + organizationId)
 * - Proper connection management
 * - Integration with flora-command-center message queue
 */

class GmailPollingService {
  constructor() {
    this.pollingIntervals = new Map(); // connectionId -> intervalId
    this.lastCheckedTimes = new Map(); // connectionId -> timestamp
    this.isInitialized = false;
  }

  /**
   * Initialize polling service
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('Gmail polling service already initialized');
      return;
    }

    this.isInitialized = true;
    logger.info('Gmail polling service initialized');
  }

  /**
   * Start polling for a specific connection
   * @param {string} connectionId - Gmail connection ID
   * @param {number} intervalMs - Polling interval in milliseconds (default: 60000 = 1 minute)
   */
  async startPolling(connectionId, intervalMs = 60000) {
    try {
      // Check if already polling
      if (this.pollingIntervals.has(connectionId)) {
        logger.warn(`Polling already active for connection ${connectionId}`);
        return;
      }

      // Verify connection exists and is active
      const connection = await GmailConnection.findById(connectionId);
      if (!connection || !connection.isActive || connection.status !== 'active') {
        throw new Error(`Connection ${connectionId} is not active or not found`);
      }

      // Set initial check time
      this.lastCheckedTimes.set(connectionId, Date.now());

      // Initial check
      await this.checkForNewEmails(connectionId);

      // Set up interval
      const intervalId = setInterval(async () => {
        try {
          await this.checkForNewEmails(connectionId);
        } catch (error) {
          logger.error(`Error in polling interval for connection ${connectionId}:`, error);
        }
      }, intervalMs);

      this.pollingIntervals.set(connectionId, intervalId);

      logger.info(`Gmail polling started for connection ${connectionId} with ${intervalMs}ms interval`);
    } catch (error) {
      logger.error(`Failed to start polling for connection ${connectionId}:`, error);
      throw error;
    }
  }

  /**
   * Stop polling for a specific connection
   * @param {string} connectionId - Gmail connection ID
   */
  stopPolling(connectionId) {
    const intervalId = this.pollingIntervals.get(connectionId);

    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(connectionId);
      this.lastCheckedTimes.delete(connectionId);
      logger.info(`Gmail polling stopped for connection ${connectionId}`);
    } else {
      logger.warn(`No active polling found for connection ${connectionId}`);
    }
  }

  /**
   * Stop all polling
   */
  stopAllPolling() {
    const connectionIds = Array.from(this.pollingIntervals.keys());

    connectionIds.forEach(connectionId => {
      this.stopPolling(connectionId);
    });

    logger.info(`Stopped polling for ${connectionIds.length} connections`);
  }

  /**
   * Check for new emails with context-aware queries
   * @param {string} connectionId - Gmail connection ID
   */
  async checkForNewEmails(connectionId) {
    try {
      const connection = await GmailConnection.findById(connectionId);

      if (!connection || !connection.isActive) {
        logger.warn(`Connection ${connectionId} is not active, skipping poll`);
        this.stopPolling(connectionId);
        return;
      }

      // Get sync settings
      const { labels, maxResults } = connection.syncSettings;

      // Define context-aware search queries
      const queries = this.buildSearchQueries(connection);

      let totalProcessed = 0;

      // Process each query
      for (const { query, context } of queries) {
        const count = await this.processEmailQuery(connectionId, query, context);
        totalProcessed += count;
      }

      // Update last check time
      this.lastCheckedTimes.set(connectionId, Date.now());

      // Update connection sync info
      if (totalProcessed > 0) {
        await connection.updateSyncInfo(totalProcessed);
        logger.info(`Processed ${totalProcessed} new emails for connection ${connectionId}`);
      }

    } catch (error) {
      logger.error(`Error checking for new emails for connection ${connectionId}:`, error);

      // Log error to connection
      const connection = await GmailConnection.findById(connectionId);
      if (connection) {
        await connection.logError(error);
      }
    }
  }

  /**
   * Build context-aware search queries
   * @param {Object} connection - Gmail connection
   * @returns {Array} Array of query objects
   */
  buildSearchQueries(connection) {
    // Get last checked time or default to 1 hour ago
    const lastChecked = this.lastCheckedTimes.get(connection._id.toString()) ||
                        (Date.now() - 60 * 60 * 1000);

    const afterTimestamp = Math.floor(lastChecked / 1000);

    return [
      {
        label: 'deals',
        query: `(to:deals@flora.passbook.vc OR subject:deal) after:${afterTimestamp} is:unread`,
        context: 'deal'
      },
      {
        label: 'fundraising',
        query: `(to:fundraising@flora.passbook.vc OR subject:fundraising) after:${afterTimestamp} is:unread`,
        context: 'fundraising'
      },
      {
        label: 'intros',
        query: `(to:intros@flora.passbook.vc OR subject:introduction) after:${afterTimestamp} is:unread`,
        context: 'introduction'
      },
      {
        label: 'texts',
        query: `(to:texts@flora.passbook.vc OR subject:"text message") after:${afterTimestamp} is:unread`,
        context: 'sms'
      },
      {
        label: 'linkedin',
        query: `(to:linkedin@flora.passbook.vc OR from:linkedin.com) after:${afterTimestamp} is:unread`,
        context: 'linkedin'
      }
    ];
  }

  /**
   * Process emails matching a specific query
   * @param {string} connectionId - Gmail connection ID
   * @param {string} query - Gmail search query
   * @param {string} context - Email context (deal, fundraising, etc.)
   * @returns {number} Number of emails processed
   */
  async processEmailQuery(connectionId, query, context) {
    try {
      // List messages matching query
      const result = await gmailSyncService.listMessages(connectionId, {
        query,
        maxResults: 10
      });

      const messages = result.messages || [];
      let processedCount = 0;

      // Process each message
      for (const message of messages) {
        try {
          await this.processEmailMessage(connectionId, message.id, context);
          processedCount++;
        } catch (error) {
          logger.error(`Error processing message ${message.id}:`, error);
        }
      }

      return processedCount;
    } catch (error) {
      logger.error(`Error processing ${context} emails:`, error);
      return 0;
    }
  }

  /**
   * Process individual email message
   * @param {string} connectionId - Gmail connection ID
   * @param {string} messageId - Gmail message ID
   * @param {string} context - Email context
   */
  async processEmailMessage(connectionId, messageId, context) {
    try {
      // Get full message details
      const result = await gmailSyncService.getMessage(connectionId, messageId, 'full');
      const message = result.message;

      // Extract email data
      const emailData = this.extractEmailData(message);

      // Check for attachments (potential screenshots)
      const hasAttachments = message.payload.parts?.some(
        part => part.filename && part.body.attachmentId
      );

      // Process attachments if this is a screenshot context
      if (hasAttachments && (context === 'sms' || context === 'linkedin')) {
        await this.processAttachments(connectionId, messageId, message.payload.parts, context);
      }

      // TODO: Send email data to interaction ingest service via message queue
      // This will be implemented when connecting to the main monolith
      logger.info('Email processed (not yet sent to ingest):', {
        messageId,
        context,
        from: emailData.from,
        subject: emailData.subject,
        hasAttachments
      });

      // Mark email as read
      await gmailSyncService.modifyMessage(
        connectionId,
        messageId,
        [], // No labels to add
        ['UNREAD'] // Remove UNREAD label
      );

    } catch (error) {
      logger.error(`Error processing message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Extract email data from Gmail message
   * @param {Object} message - Gmail message object
   * @returns {Object} Extracted email data
   */
  extractEmailData(message) {
    const headers = message.payload.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    // Get email body
    let body = '';
    if (message.payload.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    } else if (message.payload.parts) {
      const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      } else {
        // Try HTML part
        const htmlPart = message.payload.parts.find(p => p.mimeType === 'text/html');
        if (htmlPart?.body?.data) {
          body = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
        }
      }
    }

    return {
      messageId: message.id,
      threadId: message.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      cc: getHeader('Cc'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      body: body,
      snippet: message.snippet,
      labelIds: message.labelIds,
      internalDate: message.internalDate
    };
  }

  /**
   * Process email attachments (screenshots with OCR)
   * @param {string} connectionId - Gmail connection ID
   * @param {string} messageId - Gmail message ID
   * @param {Array} parts - Message parts
   * @param {string} context - Email context
   */
  async processAttachments(connectionId, messageId, parts, context) {
    if (!parts) return;

    for (const part of parts) {
      if (part.filename && part.body.attachmentId) {
        try {
          const gmail = await gmailAuthService.getGmailClient(connectionId);

          // Get attachment data
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: part.body.attachmentId
          });

          // Decode attachment
          const attachmentData = Buffer.from(attachment.data.data, 'base64');

          // Check if it's an image
          if (part.mimeType?.startsWith('image/')) {
            // TODO: Perform OCR processing
            // This will be implemented when OCR service is integrated
            logger.info('Image attachment detected for OCR:', {
              filename: part.filename,
              mimeType: part.mimeType,
              size: attachmentData.length,
              context
            });

            // TODO: Send to OCR service and then to interaction ingest
          }
        } catch (error) {
          logger.error(`Error processing attachment ${part.filename}:`, error);
        }
      }
    }
  }

  /**
   * Get polling status for a connection
   * @param {string} connectionId - Gmail connection ID
   * @returns {Object} Polling status
   */
  getPollingStatus(connectionId) {
    const isPolling = this.pollingIntervals.has(connectionId);
    const lastChecked = this.lastCheckedTimes.get(connectionId);

    return {
      isPolling,
      lastCheckedAt: lastChecked ? new Date(lastChecked).toISOString() : null,
      nextCheckIn: isPolling && lastChecked ?
        Math.max(0, 60000 - (Date.now() - lastChecked)) : null
    };
  }

  /**
   * Get all active polling connections
   * @returns {Array} Array of active connection IDs
   */
  getActivePollingConnections() {
    return Array.from(this.pollingIntervals.keys());
  }
}

module.exports = new GmailPollingService();
