require('dotenv').config();
const mongoose = require('mongoose');
const ProviderConfig = require('../src/models/ProviderConfig');
const sambanovaConfig = require('../src/config/providers/sambanova');
const logger = require('../src/utils/logger');

/**
 * Seed SambaNova Cloud Provider Configurations
 *
 * Persists one ProviderConfig document per SambaNova model so the Provider
 * Abstraction Layer (PAL) can load and route to them. PAL only initializes
 * providers it finds active in the ProviderConfig collection at startup
 * (services/providerAbstractionLayer.js#initialize) — defining
 * src/config/providers/sambanova.js and src/services/providers/
 * sambanovaProvider.js alone is not enough for SambaNova to actually be
 * callable; this script is the missing link.
 *
 * Usage:
 *   node scripts/seedSambaNovaConfig.js
 *
 * Environment Variables Required:
 *   - MONGODB_URI      (shared Flora database — this service resolves
 *                        `createdBy` against the `User` collection there)
 *   - SAMBANOVA_API_KEY
 *   - SAMBANOVA_API_URL (optional, defaults to https://api.sambanova.ai/v1)
 *
 * This is safe to re-run: it upserts by (provider, modelId), so re-running
 * after updating pricing/models in src/config/providers/sambanova.js will
 * update existing documents rather than duplicate them.
 */

const CAPABILITY_TO_FLAGS = (capabilities) => ({
  supportsVision: capabilities.includes('vision'),
  supportsStreaming: true, // SambaNova's OpenAI-compatible endpoint supports `stream: true`
  supportsFunctionCalling: false, // not documented as supported by SambaNova Cloud
  supportsSystemPrompt: true
});

async function seedSambaNovaConfig() {
  if (!process.env.SAMBANOVA_API_KEY) {
    logger.error(
      'SAMBANOVA_API_KEY is not set. Set it in this service\'s environment before seeding ' +
      '(see .env.example) — the key is required so ProviderConfig documents can be created ' +
      'with a valid apiConfig.apiKey.'
    );
    process.exit(1);
  }

  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB');

    const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({ role: String }));
    const adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      throw new Error(
        'No admin user found in the connected database. ProviderConfig.createdBy requires a ' +
        'User document — confirm MONGODB_URI points at the same database as the Flora monolith ' +
        '(where admin users are created), then re-run this script.'
      );
    }
    const adminUserId = adminUser._id;

    logger.info('Starting SambaNova provider configuration seeding...', {
      models: sambanovaConfig.models.map((m) => m.id)
    });

    for (const model of sambanovaConfig.models) {
      const doc = {
        provider: 'sambanova',
        modelId: model.id,
        modelName: model.name,
        description: sambanovaConfig.description,
        apiConfig: {
          endpoint: sambanovaConfig.baseURL,
          apiKey: process.env.SAMBANOVA_API_KEY,
          version: 'v1'
        },
        capabilities: {
          maxTokens: 4096,
          contextWindow: model.contextWindow,
          ...CAPABILITY_TO_FLAGS(model.capabilities)
        },
        pricing: {
          inputTokenCost: model.costPerMToken.input,
          outputTokenCost: model.costPerMToken.output,
          currency: 'USD'
        },
        defaultParameters: {
          temperature: 0.7,
          topP: 1.0,
          maxOutputTokens: 4096,
          stopSequences: []
        },
        trustTier: sambanovaConfig.trustTier,
        residencyZone: sambanovaConfig.residencyZone,
        rateLimits: {
          requestsPerMinute: sambanovaConfig.rateLimit.requestsPerMinute,
          tokensPerMinute: sambanovaConfig.rateLimit.tokensPerMinute,
          concurrentRequests: 5
        },
        specializations: model.capabilities.includes('code') ? ['code_generation', 'code_debugging'] : ['general_purpose'],
        status: sambanovaConfig.enabled ? 'active' : 'inactive',
        priority: model.id === sambanovaConfig.defaultModel ? 60 : 50,
        isDefault: model.id === sambanovaConfig.defaultModel,
        tags: ['sambanova', 'zdr_contracted', ...(model.recommended ? ['recommended'] : [])],
        createdBy: adminUserId,
        updatedBy: adminUserId
      };

      const existing = await ProviderConfig.findOne({ provider: 'sambanova', modelId: model.id });
      if (existing) {
        Object.assign(existing, doc);
        await existing.save();
        logger.info(`Updated SambaNova config: ${model.id}`);
      } else {
        await ProviderConfig.create(doc);
        logger.info(`Created SambaNova config: ${model.id}`);
      }
    }

    logger.info('SambaNova provider configuration seeding complete', {
      count: sambanovaConfig.models.length,
      enabled: sambanovaConfig.enabled,
      note: sambanovaConfig.enabled
        ? 'Models are active — PAL will route to SambaNova on next restart.'
        : 'SAMBANOVA_ENABLED is not "true" — models were seeded as inactive. Set ' +
          'SAMBANOVA_ENABLED=true and re-run this script (or PATCH status via an admin ' +
          'endpoint) to activate them.'
    });
  } catch (error) {
    logger.error('Failed to seed SambaNova provider configuration', { error: error.message });
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  seedSambaNovaConfig();
}

module.exports = { seedSambaNovaConfig };
