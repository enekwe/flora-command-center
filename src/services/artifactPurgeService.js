/**
 * Artifact Purge Service
 *
 * ZDR-E0-S4: On-disk code artifact purging
 *
 * Implements Zero Data Retention (ZDR) guarantee G3 by:
 * 1. Scheduled deletion of ./data/skills/*.md past TTL
 * 2. Scheduled deletion of docs/handoffs/*.md past TTL
 * 3. Prevention of disk writes for ZDR tenants
 *
 * Ensures customer code artifacts do not linger on filesystem.
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

class ArtifactPurgeService {
  constructor() {
    // Default TTL: 24 hours for non-ZDR tenants
    this.defaultTTL = parseInt(process.env.ARTIFACT_TTL_HOURS || '24') * 60 * 60 * 1000;

    // ZDR tenants: 0 retention (artifacts never written to disk)
    this.zdrTTL = 0;

    // Directories to monitor
    this.artifactDirs = [
      { path: path.join(process.cwd(), 'data', 'skills'), type: 'skills' },
      { path: path.join(process.cwd(), 'docs', 'handoffs'), type: 'handoffs' }
    ];

    this.isRunning = false;
    this.purgeIntervalMs = parseInt(process.env.PURGE_INTERVAL_MINUTES || '60') * 60 * 1000;
  }

  /**
   * Initialize the purge service
   * Creates required directories if they don't exist
   */
  async initialize() {
    try {
      for (const dir of this.artifactDirs) {
        try {
          await fs.mkdir(dir.path, { recursive: true });
          logger.info(`Artifact directory ensured: ${dir.path}`);
        } catch (error) {
          if (error.code !== 'EEXIST') {
            logger.error(`Failed to create artifact directory ${dir.path}:`, error);
          }
        }
      }
      logger.info('ArtifactPurgeService initialized', {
        defaultTTL: `${this.defaultTTL / 1000 / 60 / 60} hours`,
        purgeInterval: `${this.purgeIntervalMs / 1000 / 60} minutes`,
        directories: this.artifactDirs.map(d => d.path)
      });
    } catch (error) {
      logger.error('Failed to initialize ArtifactPurgeService:', error);
      throw error;
    }
  }

  /**
   * Check if a tenant is ZDR-enabled
   * @param {string} companyId - Company/tenant identifier
   * @returns {Promise<boolean>}
   */
  async isZDRTenant(companyId) {
    // For now, check environment variable for ZDR tenant list
    // In production, this would query the tenant configuration service
    const zdrTenants = (process.env.ZDR_TENANT_IDS || '').split(',').filter(Boolean);
    return zdrTenants.includes(companyId);
  }

  /**
   * Determine if disk write should be allowed for a tenant
   * ZDR tenants should never write artifacts to disk
   * @param {string} companyId - Company/tenant identifier
   * @returns {Promise<boolean>}
   */
  async shouldWriteToDisk(companyId) {
    if (!companyId) {
      // If no companyId provided, allow write (legacy behavior)
      logger.warn('No companyId provided for disk write check - allowing write');
      return true;
    }

    const isZDR = await this.isZDRTenant(companyId);
    if (isZDR) {
      logger.info(`Disk write blocked for ZDR tenant: ${companyId}`);
      return false;
    }

    return true;
  }

  /**
   * Purge expired artifacts from a directory
   * @param {string} dirPath - Directory path to purge
   * @param {string} type - Artifact type (skills/handoffs)
   * @param {number} ttlMs - Time-to-live in milliseconds
   * @returns {Promise<object>} Purge statistics
   */
  async purgeDirectory(dirPath, type, ttlMs) {
    const stats = {
      type,
      path: dirPath,
      scanned: 0,
      purged: 0,
      errors: 0,
      bytesFreed: 0
    };

    try {
      // Check if directory exists
      try {
        await fs.access(dirPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.debug(`Directory does not exist, skipping: ${dirPath}`);
          return stats;
        }
        throw error;
      }

      const files = await fs.readdir(dirPath);
      const now = Date.now();

      for (const file of files) {
        // Only process markdown files
        if (!file.endsWith('.md')) {
          continue;
        }

        stats.scanned++;
        const filePath = path.join(dirPath, file);

        try {
          const stat = await fs.stat(filePath);
          const age = now - stat.mtimeMs;

          if (age > ttlMs) {
            // File has exceeded TTL, delete it
            stats.bytesFreed += stat.size;
            await fs.unlink(filePath);
            stats.purged++;

            logger.info(`Purged expired artifact`, {
              type,
              file,
              age: `${Math.round(age / 1000 / 60 / 60)} hours`,
              size: stat.size
            });
          }
        } catch (error) {
          stats.errors++;
          logger.error(`Error processing file ${filePath}:`, error);
        }
      }
    } catch (error) {
      logger.error(`Error purging directory ${dirPath}:`, error);
      throw error;
    }

    return stats;
  }

  /**
   * Run a full purge cycle across all artifact directories
   * @returns {Promise<object>} Aggregated purge statistics
   */
  async runPurgeCycle() {
    const cycleStart = Date.now();
    const results = {
      cycleStart: new Date(cycleStart).toISOString(),
      totalScanned: 0,
      totalPurged: 0,
      totalErrors: 0,
      totalBytesFreed: 0,
      directories: []
    };

    logger.info('Starting artifact purge cycle');

    for (const dir of this.artifactDirs) {
      try {
        const stats = await this.purgeDirectory(dir.path, dir.type, this.defaultTTL);
        results.directories.push(stats);
        results.totalScanned += stats.scanned;
        results.totalPurged += stats.purged;
        results.totalErrors += stats.errors;
        results.totalBytesFreed += stats.bytesFreed;
      } catch (error) {
        logger.error(`Failed to purge directory ${dir.path}:`, error);
        results.totalErrors++;
      }
    }

    const cycleDuration = Date.now() - cycleStart;
    results.cycleDuration = cycleDuration;
    results.cycleEnd = new Date().toISOString();

    logger.info('Artifact purge cycle completed', {
      scanned: results.totalScanned,
      purged: results.totalPurged,
      errors: results.totalErrors,
      bytesFreed: results.totalBytesFreed,
      duration: `${cycleDuration}ms`
    });

    return results;
  }

  /**
   * Start scheduled purge job
   * Runs purge cycles at configured interval
   */
  startScheduledPurge() {
    if (this.isRunning) {
      logger.warn('Scheduled purge is already running');
      return;
    }

    this.isRunning = true;

    // Run initial purge immediately
    this.runPurgeCycle().catch(error => {
      logger.error('Error in initial purge cycle:', error);
    });

    // Schedule recurring purges
    this.purgeInterval = setInterval(async () => {
      try {
        await this.runPurgeCycle();
      } catch (error) {
        logger.error('Error in scheduled purge cycle:', error);
      }
    }, this.purgeIntervalMs);

    logger.info('Scheduled artifact purge started', {
      interval: `${this.purgeIntervalMs / 1000 / 60} minutes`
    });
  }

  /**
   * Stop scheduled purge job
   */
  stopScheduledPurge() {
    if (!this.isRunning) {
      logger.warn('Scheduled purge is not running');
      return;
    }

    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
      this.purgeInterval = null;
    }

    this.isRunning = false;
    logger.info('Scheduled artifact purge stopped');
  }

  /**
   * Manually purge a specific artifact file
   * @param {string} filePath - Full path to artifact file
   * @returns {Promise<boolean>} Success status
   */
  async purgeFile(filePath) {
    try {
      const stat = await fs.stat(filePath);
      await fs.unlink(filePath);

      logger.info('Manually purged artifact file', {
        file: path.basename(filePath),
        size: stat.size
      });

      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('File already deleted:', filePath);
        return true;
      }

      logger.error('Failed to purge file:', error);
      throw error;
    }
  }

  /**
   * Get current purge service status
   * @returns {object} Service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      defaultTTL: this.defaultTTL,
      purgeInterval: this.purgeIntervalMs,
      directories: this.artifactDirs.map(d => ({
        path: d.path,
        type: d.type
      }))
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get ArtifactPurgeService singleton instance
 * @returns {ArtifactPurgeService}
 */
function getArtifactPurgeService() {
  if (!instance) {
    instance = new ArtifactPurgeService();
  }
  return instance;
}

module.exports = {
  ArtifactPurgeService,
  getArtifactPurgeService
};
