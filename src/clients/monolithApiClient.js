const axios = require('axios');
const logger = require('../utils/logger');

/**
 * MonolithApiClient
 *
 * HTTP client for communicating with the monolith application.
 * Handles all API calls for shared resources (Site, Company, User, Notification, etc.)
 *
 * This follows microservices best practices by:
 * - Avoiding model duplication
 * - Centralizing external API communication
 * - Providing retry logic and error handling
 * - Enabling service decoupling
 */
class MonolithApiClient {
  constructor() {
    this.baseURL = process.env.MONOLITH_API_URL || 'http://localhost:3000';
    this.timeout = parseInt(process.env.MONOLITH_API_TIMEOUT || '10000', 10);
    this.maxRetries = parseInt(process.env.MONOLITH_API_MAX_RETRIES || '3', 10);
    this.retryDelay = parseInt(process.env.MONOLITH_API_RETRY_DELAY || '1000', 10);

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'flora-command-center'
      }
    });

    // Add request interceptor for authentication
    this.client.interceptors.request.use(
      (config) => {
        const apiKey = process.env.MONOLITH_API_KEY;
        if (apiKey) {
          config.headers['X-API-Key'] = apiKey;
        }
        return config;
      },
      (error) => {
        logger.error('Monolith API request interceptor error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;

        logger.error('Monolith API error', {
          url: error.config?.url,
          method: error.config?.method,
          status,
          message
        });

        return Promise.reject(error);
      }
    );
  }

  /**
   * Generic retry wrapper for API calls
   */
  async retryRequest(fn, retries = this.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0 && this.isRetryable(error)) {
        logger.warn(`Retrying request, ${retries} attempts remaining`, {
          error: error.message
        });

        await this.delay(this.retryDelay);
        return this.retryRequest(fn, retries - 1);
      }
      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error) {
    // Retry on network errors or 5xx server errors
    return !error.response || (error.response.status >= 500 && error.response.status < 600);
  }

  /**
   * Delay helper for retries
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================
  // SITE API CALLS
  // ==========================================

  /**
   * Get site by ID with populated fields
   * @param {string} siteId - Site ID
   * @param {object} options - Query options
   * @param {boolean} options.includeByokKey - Include encrypted BYOK API key
   * @param {boolean} options.populateCompany - Populate company data
   * @returns {Promise<object>} Site object
   */
  async getSite(siteId, options = {}) {
    return this.retryRequest(async () => {
      const params = new URLSearchParams();

      if (options.includeByokKey) {
        params.append('includeByokKey', 'true');
      }
      if (options.populateCompany) {
        params.append('populate', 'companyId');
      }

      const response = await this.client.get(`/api/sites/${siteId}?${params.toString()}`);

      logger.debug('Site retrieved from monolith', { siteId });

      return response.data;
    });
  }

  /**
   * Update site
   * @param {string} siteId - Site ID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated site object
   */
  async updateSite(siteId, updates) {
    return this.retryRequest(async () => {
      const response = await this.client.patch(`/api/sites/${siteId}`, updates);

      logger.info('Site updated via monolith', { siteId, updates: Object.keys(updates) });

      return response.data;
    });
  }

  /**
   * Increment site metrics atomically
   * @param {string} siteId - Site ID
   * @param {object} increments - Fields to increment
   * @returns {Promise<object>} Updated site object
   */
  async incrementSiteMetrics(siteId, increments) {
    return this.retryRequest(async () => {
      const response = await this.client.post(`/api/sites/${siteId}/increment`, increments);

      logger.debug('Site metrics incremented via monolith', { siteId, increments });

      return response.data;
    });
  }

  // ==========================================
  // COMPANY API CALLS
  // ==========================================

  /**
   * Get company by ID
   * @param {string} companyId - Company ID
   * @param {object} options - Query options
   * @param {boolean} options.includeByokKey - Include encrypted BYOK API key
   * @returns {Promise<object>} Company object
   */
  async getCompany(companyId, options = {}) {
    return this.retryRequest(async () => {
      const params = new URLSearchParams();

      if (options.includeByokKey) {
        params.append('includeByokKey', 'true');
      }

      const response = await this.client.get(`/api/companies/${companyId}?${params.toString()}`);

      logger.debug('Company retrieved from monolith', { companyId });

      return response.data;
    });
  }

  /**
   * Update company
   * @param {string} companyId - Company ID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated company object
   */
  async updateCompany(companyId, updates) {
    return this.retryRequest(async () => {
      const response = await this.client.patch(`/api/companies/${companyId}`, updates);

      logger.info('Company updated via monolith', { companyId, updates: Object.keys(updates) });

      return response.data;
    });
  }

  /**
   * Increment company token usage
   * @param {string} companyId - Company ID
   * @param {number} tokens - Number of tokens to increment
   * @returns {Promise<object>} Updated company object
   */
  async incrementCompanyTokens(companyId, tokens) {
    return this.retryRequest(async () => {
      const response = await this.client.post(`/api/companies/${companyId}/increment-tokens`, {
        tokens
      });

      logger.debug('Company tokens incremented via monolith', { companyId, tokens });

      return response.data;
    });
  }

  // ==========================================
  // USER API CALLS
  // ==========================================

  /**
   * Get user by ID
   * @param {string} userId - User ID
   * @returns {Promise<object>} User object
   */
  async getUser(userId) {
    return this.retryRequest(async () => {
      const response = await this.client.get(`/api/users/${userId}`);

      logger.debug('User retrieved from monolith', { userId });

      return response.data;
    });
  }

  /**
   * Get users by criteria
   * @param {object} criteria - Query criteria
   * @returns {Promise<Array>} Array of user objects
   */
  async getUsers(criteria = {}) {
    return this.retryRequest(async () => {
      const response = await this.client.get('/api/users', { params: criteria });

      logger.debug('Users retrieved from monolith', { criteria });

      return response.data;
    });
  }

  // ==========================================
  // NOTIFICATION API CALLS
  // ==========================================

  /**
   * Create notification
   * @param {object} notificationData - Notification data
   * @returns {Promise<object>} Created notification object
   */
  async createNotification(notificationData) {
    return this.retryRequest(async () => {
      const response = await this.client.post('/api/notifications', notificationData);

      logger.info('Notification created via monolith', {
        userId: notificationData.userId,
        type: notificationData.type
      });

      return response.data;
    });
  }

  // ==========================================
  // MILESTONE API CALLS
  // ==========================================

  /**
   * Check and update milestones for a site
   * @param {string} siteId - Site ID
   * @returns {Promise<object>} Updated site with milestone data
   */
  async checkMilestones(siteId) {
    return this.retryRequest(async () => {
      const response = await this.client.post(`/api/milestones/check`, { siteId });

      logger.info('Milestones checked via monolith', { siteId });

      return response.data;
    });
  }

  // ==========================================
  // PLATFORM INTEGRATION API CALLS
  // ==========================================

  /**
   * Get platform integration by ID
   * @param {string} integrationId - Integration ID
   * @returns {Promise<object>} Integration object
   */
  async getIntegration(integrationId) {
    return this.retryRequest(async () => {
      const response = await this.client.get(`/api/integrations/${integrationId}`);

      logger.debug('Integration retrieved from monolith', { integrationId });

      return response.data;
    });
  }

  /**
   * Count platform integrations for a site
   * @param {string} siteId - Site ID
   * @returns {Promise<number>} Integration count
   */
  async countSiteIntegrations(siteId) {
    return this.retryRequest(async () => {
      const response = await this.client.get(`/api/integrations/count`, {
        params: { siteId }
      });

      logger.debug('Integration count retrieved from monolith', { siteId });

      return response.data.count;
    });
  }

  // ==========================================
  // HEALTH CHECK
  // ==========================================

  /**
   * Check if monolith is reachable
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      logger.error('Monolith health check failed', { error: error.message });
      return false;
    }
  }
}

module.exports = new MonolithApiClient();
