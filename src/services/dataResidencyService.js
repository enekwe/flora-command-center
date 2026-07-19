const config = require('../config');
const logger = require('../utils/logger');

/**
 * Data Residency Service — ZDR-E4-S3
 *
 * Corrects the semantic mismatch identified in gap R7:
 * "dataResidency" previously meant Flora's AWS regions, but ZDR requires
 * distinguishing the customer/Flora *perimeter* from a generic cloud region.
 *
 * Perimeter classes:
 *   - customer_perimeter: code runs inside the customer's own VPC/infra
 *   - flora_perimeter: code runs inside Flora-controlled infrastructure
 *   - third_party: code runs on an external provider's infrastructure
 *
 * Cloud regions (AWS/GCP/Azure) are a separate dimension and do NOT imply
 * perimeter ownership.
 */

const PERIMETER_CLASSES = {
  customer_perimeter: {
    label: 'Customer Perimeter',
    description: 'Data processed inside the customer\'s own infrastructure',
    zdrEligible: true
  },
  flora_perimeter: {
    label: 'Flora Perimeter',
    description: 'Data processed inside Flora-controlled infrastructure',
    zdrEligible: true
  },
  third_party: {
    label: 'Third-Party Hosted',
    description: 'Data processed on external provider infrastructure',
    zdrEligible: false
  }
};

const CLOUD_REGIONS = {
  us_east: { label: 'US East', gdpr: false },
  us_west: { label: 'US West', gdpr: false },
  eu_west: { label: 'EU West', gdpr: true },
  eu_central: { label: 'EU Central', gdpr: true },
  ap_southeast: { label: 'AP Southeast', gdpr: false },
  ca_central: { label: 'CA Central', gdpr: false },
  china: { label: 'China', gdpr: false, specialCompliance: true }
};

/**
 * Resolve the perimeter class for a provider based on its trustTier and residencyZone.
 *
 * @param {object} providerConfig - { trustTier, residencyZone }
 * @returns {string} Perimeter class
 */
function resolvePerimeterClass(providerConfig) {
  if (!providerConfig) return 'third_party';

  const { trustTier, residencyZone } = providerConfig;

  if (trustTier === 'self_hosted') {
    return residencyZone === 'customer_perimeter' ? 'customer_perimeter' : 'flora_perimeter';
  }

  if (trustTier === 'zdr_contracted') {
    return 'third_party';
  }

  return 'third_party';
}

/**
 * Check if a provider is ZDR-eligible based on its perimeter class.
 *
 * @param {object} providerConfig
 * @returns {boolean}
 */
function isZDREligible(providerConfig) {
  const perimeter = resolvePerimeterClass(providerConfig);
  return PERIMETER_CLASSES[perimeter]?.zdrEligible || false;
}

/**
 * Get human-readable residency description for UI display.
 *
 * @param {object} providerConfig
 * @returns {object} { perimeterLabel, regionLabel, description }
 */
function getResidencyDisplay(providerConfig) {
  const perimeter = resolvePerimeterClass(providerConfig);
  const perimeterInfo = PERIMETER_CLASSES[perimeter] || PERIMETER_CLASSES.third_party;
  const regionInfo = CLOUD_REGIONS[providerConfig?.residencyZone] || { label: providerConfig?.residencyZone || 'Unknown' };

  return {
    perimeterClass: perimeter,
    perimeterLabel: perimeterInfo.label,
    regionLabel: regionInfo.label,
    residencyZone: providerConfig?.residencyZone || 'unknown',
    trustTier: providerConfig?.trustTier || 'standard_hosted',
    description: `${perimeterInfo.label} — ${regionInfo.label}`,
    zdrEligible: perimeterInfo.zdrEligible
  };
}

/**
 * Validate that a provider labeled as self_hosted actually runs in a
 * customer or flora perimeter (not public cloud).
 *
 * Startup validation: refuses to label a public-cloud host as self_hosted.
 *
 * @param {object} providerConfig
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSelfHostedClaim(providerConfig) {
  if (providerConfig.trustTier !== 'self_hosted') {
    return { valid: true };
  }

  const { residencyZone } = providerConfig;
  const publicCloudZones = ['us_east', 'us_west', 'eu_west', 'ap_southeast', 'china'];

  if (publicCloudZones.includes(residencyZone)) {
    return {
      valid: false,
      error: `Provider ${providerConfig.provider} labeled self_hosted but residencyZone ` +
             `"${residencyZone}" is a public cloud region. Self-hosted providers must run ` +
             `in customer_perimeter or flora_perimeter.`
    };
  }

  return { valid: true };
}

module.exports = {
  PERIMETER_CLASSES,
  CLOUD_REGIONS,
  resolvePerimeterClass,
  isZDREligible,
  getResidencyDisplay,
  validateSelfHostedClaim
};
