const gmailAuthService = require('./gmailAuthService');

/**
 * Gmail Label Service
 *
 * Handles:
 * - Label management
 * - Creating, updating, deleting labels
 * - Label filtering
 */

class GmailLabelService {
  /**
   * Get Gmail client
   * @param {string} connectionId - Connection ID
   * @returns {gmail_v1.Gmail} - Gmail client
   */
  async getClient(connectionId) {
    return gmailAuthService.getGmailClient(connectionId);
  }

  /**
   * List all labels
   * @param {string} connectionId - Connection ID
   * @returns {Object} - Labels list
   */
  async listLabels(connectionId) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.labels.list({
        userId: 'me'
      });

      return {
        success: true,
        labels: response.data.labels || []
      };
    } catch (error) {
      throw new Error(`Failed to list labels: ${error.message}`);
    }
  }

  /**
   * Get label details
   * @param {string} connectionId - Connection ID
   * @param {string} labelId - Label ID
   * @returns {Object} - Label details
   */
  async getLabel(connectionId, labelId) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.labels.get({
        userId: 'me',
        id: labelId
      });

      return {
        success: true,
        label: response.data
      };
    } catch (error) {
      throw new Error(`Failed to get label: ${error.message}`);
    }
  }

  /**
   * Create a label
   * @param {string} connectionId - Connection ID
   * @param {Object} labelData - Label data
   * @returns {Object} - Created label
   */
  async createLabel(connectionId, labelData) {
    try {
      const gmail = await this.getClient(connectionId);

      const { name, messageListVisibility, labelListVisibility, color } = labelData;

      const requestBody = {
        name,
        messageListVisibility: messageListVisibility || 'show',
        labelListVisibility: labelListVisibility || 'labelShow'
      };

      if (color) {
        requestBody.color = color;
      }

      const response = await gmail.users.labels.create({
        userId: 'me',
        requestBody
      });

      return {
        success: true,
        label: response.data
      };
    } catch (error) {
      throw new Error(`Failed to create label: ${error.message}`);
    }
  }

  /**
   * Update a label
   * @param {string} connectionId - Connection ID
   * @param {string} labelId - Label ID
   * @param {Object} labelData - Updated label data
   * @returns {Object} - Updated label
   */
  async updateLabel(connectionId, labelId, labelData) {
    try {
      const gmail = await this.getClient(connectionId);

      const { name, messageListVisibility, labelListVisibility, color } = labelData;

      const requestBody = {};

      if (name) requestBody.name = name;
      if (messageListVisibility) requestBody.messageListVisibility = messageListVisibility;
      if (labelListVisibility) requestBody.labelListVisibility = labelListVisibility;
      if (color) requestBody.color = color;

      const response = await gmail.users.labels.update({
        userId: 'me',
        id: labelId,
        requestBody
      });

      return {
        success: true,
        label: response.data
      };
    } catch (error) {
      throw new Error(`Failed to update label: ${error.message}`);
    }
  }

  /**
   * Delete a label
   * @param {string} connectionId - Connection ID
   * @param {string} labelId - Label ID
   * @returns {Object} - Delete result
   */
  async deleteLabel(connectionId, labelId) {
    try {
      const gmail = await this.getClient(connectionId);

      await gmail.users.labels.delete({
        userId: 'me',
        id: labelId
      });

      return {
        success: true
      };
    } catch (error) {
      throw new Error(`Failed to delete label: ${error.message}`);
    }
  }

  /**
   * Patch a label (partial update)
   * @param {string} connectionId - Connection ID
   * @param {string} labelId - Label ID
   * @param {Object} labelData - Label data to patch
   * @returns {Object} - Patched label
   */
  async patchLabel(connectionId, labelId, labelData) {
    try {
      const gmail = await this.getClient(connectionId);

      const response = await gmail.users.labels.patch({
        userId: 'me',
        id: labelId,
        requestBody: labelData
      });

      return {
        success: true,
        label: response.data
      };
    } catch (error) {
      throw new Error(`Failed to patch label: ${error.message}`);
    }
  }

  /**
   * Get system labels (INBOX, SENT, TRASH, etc.)
   * @param {string} connectionId - Connection ID
   * @returns {Object} - System labels
   */
  async getSystemLabels(connectionId) {
    try {
      const result = await this.listLabels(connectionId);

      const systemLabels = result.labels.filter(label =>
        label.type === 'system'
      );

      return {
        success: true,
        labels: systemLabels
      };
    } catch (error) {
      throw new Error(`Failed to get system labels: ${error.message}`);
    }
  }

  /**
   * Get user-created labels
   * @param {string} connectionId - Connection ID
   * @returns {Object} - User labels
   */
  async getUserLabels(connectionId) {
    try {
      const result = await this.listLabels(connectionId);

      const userLabels = result.labels.filter(label =>
        label.type === 'user'
      );

      return {
        success: true,
        labels: userLabels
      };
    } catch (error) {
      throw new Error(`Failed to get user labels: ${error.message}`);
    }
  }

  /**
   * Find label by name
   * @param {string} connectionId - Connection ID
   * @param {string} name - Label name
   * @returns {Object} - Label or null
   */
  async findLabelByName(connectionId, name) {
    try {
      const result = await this.listLabels(connectionId);

      const label = result.labels.find(l =>
        l.name.toLowerCase() === name.toLowerCase()
      );

      return {
        success: true,
        label: label || null
      };
    } catch (error) {
      throw new Error(`Failed to find label: ${error.message}`);
    }
  }
}

module.exports = new GmailLabelService();
