const Site = require('../models/Site');
const StudioCompany = require('../models/StudioCompany');
const encryption = require('../utils/encryption');
const logger = require('../utils/logger');

class BYOKService {
  /**
   * Get API credentials for a site request
   * Returns { provider, apiKey, orgId, source: 'site_byok' | 'company_byok' | 'passbook_budget' }
   */
  async getCredentials(siteId) {
    const site = await Site.findById(siteId)
      .select('+tokenConfig.byokApiKey')
      .populate('companyId');

    if (!site) {
      throw new Error('Site not found');
    }

    const { mode } = site.tokenConfig;

    // Site BYOK
    if (mode === 'site_byok') {
      if (!site.tokenConfig.byokApiKey) {
        throw new Error('Site BYOK enabled but no API key configured');
      }

      return {
        provider: site.tokenConfig.byokProvider,
        apiKey: encryption.decrypt(site.tokenConfig.byokApiKey),
        orgId: site.tokenConfig.byokOrgId,
        source: 'site_byok'
      };
    }

    // Company BYOK
    if (mode === 'company_byok') {
      const company = await StudioCompany.findById(site.companyId)
        .select('+byokConfig.apiKey');

      if (!company.byokConfig.enabled || !company.byokConfig.apiKey) {
        throw new Error('Company BYOK enabled but not configured');
      }

      return {
        provider: company.byokConfig.provider,
        apiKey: encryption.decrypt(company.byokConfig.apiKey),
        orgId: company.byokConfig.orgId,
        source: 'company_byok'
      };
    }

    // Passbook Budget (default)
    return {
      provider: process.env.DEFAULT_AI_PROVIDER || 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      orgId: null,
      source: 'passbook_budget'
    };
  }

  /**
   * Validate BYOK API key
   */
  async validateApiKey(provider, apiKey) {
    const aiProvider = require('../utils/aiProviderFactory').create(provider, apiKey);

    try {
      await aiProvider.testConnection();
      return true;
    } catch (error) {
      logger.error('BYOK API key validation failed', { provider, error: error.message });
      return false;
    }
  }

  /**
   * Update company BYOK configuration
   */
  async updateCompanyBYOK(companyId, { provider, apiKey, orgId }) {
    const company = await StudioCompany.findById(companyId);

    if (!company) {
      throw new Error('Company not found');
    }

    // Validate API key before saving
    const isValid = await this.validateApiKey(provider, apiKey);
    if (!isValid) {
      throw new Error('Invalid API key');
    }

    company.byokConfig.enabled = true;
    company.byokConfig.provider = provider;
    company.byokConfig.apiKey = encryption.encrypt(apiKey);
    company.byokConfig.orgId = orgId;

    await company.save();

    logger.info('Company BYOK configured', { companyId, provider });

    return company;
  }
}

module.exports = new BYOKService();
