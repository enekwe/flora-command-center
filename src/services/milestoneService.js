// services/milestoneService.js
const Site = require('../models/Site');
const StudioCompany = require('../models/StudioCompany');
const PlatformIntegration = require('../models/PlatformIntegration');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');

class MilestoneService {
  /**
   * Check all sites for milestone conditions
   */
  async checkAllSites() {
    const sites = await Site.find({
      status: 'active',
      isDeleted: false,
      'nudges.dismissed': false
    }).populate('companyId');

    let nudgesCreated = 0;

    for (const site of sites) {
      const shouldNudge = await this.shouldCreateNudge(site);

      if (shouldNudge) {
        await this.createNudge(site);
        nudgesCreated++;
      }
    }

    logger.info('Milestone check completed', { sitesChecked: sites.length, nudgesCreated });

    return { sitesChecked: sites.length, nudgesCreated };
  }

  /**
   * Determine if site should receive reassignment nudge
   */
  async shouldCreateNudge(site) {
    // Only nudge sites assigned to "Passbook" default company
    const company = await StudioCompany.findById(site.companyId);

    if (!company || company.name !== 'Passbook') {
      return false;
    }

    // Check if already nudged recently (within 7 days)
    if (site.nudges.lastNudgeAt) {
      const daysSinceLastNudge = (Date.now() - site.nudges.lastNudgeAt) / (1000 * 60 * 60 * 24);
      if (daysSinceLastNudge < 7) {
        return false;
      }
    }

    // Check milestones
    const milestones = site.metrics.milestones;
    const meetsThreshold = milestones.tokensUsed100 || milestones.daysActive7 || milestones.platformsConnected3;

    return meetsThreshold;
  }

  /**
   * Create nudge notification for site
   */
  async createNudge(site) {
    // Update site nudge data
    site.nudges.lastNudgeAt = new Date();
    site.nudges.nudgeCount = (site.nudges.nudgeCount || 0) + 1;
    await site.save();

    // Get admin users for notification
    const User = require('../models/User');
    const adminUsers = await User.find({ role: { $in: ['admin', 'GP'] } });

    // Create notification for each admin
    for (const admin of adminUsers) {
      await notificationService.createNotification({
        userId: admin._id,
        type: 'site_reassignment_nudge',
        title: 'Site Ready for Reassignment',
        message: `Site "${site.name}" has reached milestones and may be ready to reassign from Passbook to a specific company.`,
        data: {
          siteId: site._id,
          siteName: site.name,
          milestones: site.metrics.milestones,
          tokenUsage: site.metrics.totalTokensUsed
        },
        actionUrl: `/command-center/sites/${site._id}`
      });
    }

    logger.info('Nudge created for site', {
      siteId: site._id,
      siteName: site.name,
      nudgeCount: site.nudges.nudgeCount
    });

    return site;
  }

  /**
   * Update milestone flags based on current metrics
   */
  async updateMilestones(siteId) {
    const site = await Site.findById(siteId);

    if (!site) {
      throw new Error('Site not found');
    }

    // Check token milestone (100 tokens)
    if (!site.metrics.milestones.tokensUsed100) {
      if (site.metrics.totalTokensUsed >= 100) {
        site.metrics.milestones.tokensUsed100 = true;
      }
    }

    // Check days active milestone (7 days)
    if (!site.metrics.milestones.daysActive7) {
      const daysSinceCreation = (Date.now() - site.createdAt) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation >= 7) {
        site.metrics.milestones.daysActive7 = true;
      }
    }

    // Check platforms connected milestone (3 platforms)
    if (!site.metrics.milestones.platformsConnected3) {
      const integrationCount = await PlatformIntegration.countDocuments({
        siteId: site._id,
        isDeleted: false
      });

      if (integrationCount >= 3) {
        site.metrics.milestones.platformsConnected3 = true;
      }
    }

    await site.save();

    return site;
  }

  /**
   * Dismiss nudge for site
   */
  async dismissNudge(siteId, userId) {
    const site = await Site.findById(siteId);

    if (!site) {
      throw new Error('Site not found');
    }

    site.nudges.dismissed = true;
    site.nudges.dismissedAt = new Date();
    site.nudges.dismissedBy = userId;

    await site.save();

    logger.info('Nudge dismissed', { siteId, userId });

    return site;
  }
}

module.exports = new MilestoneService();
