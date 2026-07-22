const config = require('../../config');
const logger = require('../../utils/logger');
const { getPAL } = require('../../services/providerAbstractionLayer');

/**
 * App Kit Code Generation Service
 *
 * Calls Command Center's provider brain (PAL) to fill in application code for
 * the devops build pipeline's `generating` phase
 * (FLORA_APP_KIT_ARCHITECTURE.md §4.2). This is the only place App Kit spends
 * model tokens on CC's behalf — it goes through `providerAbstractionLayer`
 * exactly like any other CC caller, so provider routing, fallback, redaction,
 * cost calculation and ZDR audit all apply automatically. Nothing here talks
 * to a provider directly.
 *
 * Response shape (returned to the route, then to the caller as JSON):
 *   {
 *     success: true,
 *     buildId, appName,
 *     files: [{ path: string, content: string }],  // best-effort file list —
 *       always present and non-empty when generation succeeds. Populated by
 *       parsing the model's JSON output; if the model did not return valid
 *       `{"files": [...]}` JSON, this falls back to a single synthetic entry
 *       wrapping the raw text so callers never have to branch on `parsed`.
 *     parsed: boolean,          // true iff `files` came from structured JSON;
 *                                // false means `files` is the raw-text fallback
 *     raw: string,               // the model's full, unmodified text response —
 *                                // always present so a caller can re-parse or
 *                                // display it regardless of `parsed`
 *     model: { provider, model, trustTier },
 *     usage: { inputTokens, outputTokens, totalTokens },
 *     cost: { input, output, total, currency }
 *   }
 *
 * Consume this defensively: prefer `files`, fall back to `raw` if `files` looks
 * unusable (e.g. empty content, non-code single blob) for your target stack.
 */

const SKILL_REF = config.appKit.generateSkillRef;

let initialized = false;

/**
 * Lazily initialize the PAL singleton once per process, mirroring the only
 * other existing internal caller (contextOptimizationService). Unlike that
 * caller, a PAL init failure here is fatal — generation cannot proceed without it.
 */
async function ensurePalReady() {
  if (initialized) return;
  const pal = getPAL();
  await pal.initialize();
  initialized = true;
}

/**
 * Best-effort extraction of the `{"files": [...]}` JSON object the skill
 * prompt asks the model for. Models occasionally wrap JSON in prose or code
 * fences despite instructions not to, so this tolerates a leading/trailing
 * fence or stray text by locating the outermost braces.
 */
function parseFiles(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return null;
  }

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
      return null;
    }
    const valid = parsed.files.every(
      (f) => f && typeof f.path === 'string' && typeof f.content === 'string'
    );
    return valid ? parsed.files : null;
  } catch (err) {
    return null;
  }
}

/**
 * Generate application code for a build.
 * @param {object} params
 * @param {string} params.buildId
 * @param {string} params.appName
 * @param {string} params.prompt - the original natural-language request
 * @param {object} params.manifest - { dataScopes: [...], systems: [...] }
 * @returns {Promise<object>} see module-level doc comment for the response shape
 */
async function generate({ buildId, appName, prompt, manifest }) {
  await ensurePalReady();

  const pal = getPAL();

  let response;
  try {
    response = await pal.callModel(
      SKILL_REF,
      {
        requestId: buildId,
        variables: {
          appName,
          prompt,
          manifest: JSON.stringify(manifest || { dataScopes: [], systems: [] }, null, 2)
        }
      },
      {
        agentType: 'code-generation',
        temperature: config.appKit.generateTemperature,
        maxTokens: config.appKit.generateMaxTokens
      }
    );
  } catch (err) {
    logger.error('App Kit code generation failed', { buildId, appName, error: err.message });
    const e = new Error(`Code generation failed: ${err.message}`);
    e.statusCode = err.statusCode || 502;
    throw e;
  }

  const parsedFiles = parseFiles(response.content);
  const files = parsedFiles || [{ path: `${appName || 'app'}.generated.txt`, content: response.content }];

  // No TokenUsageLog hook fits here: that model requires a real Mongo `siteId`
  // (ref Site) and ObjectId `companyId`, neither of which an App Kit build has
  // at this point (buildId is a devops-issued string, not a Site). Logging
  // structured usage is the documented fallback per APP_KIT_PROJECT_CONTRACT.md
  // §4 — the project timeline (`AppKitBuildLink`, via the separate /status
  // callback) is the audit record of record for the `generating` phase.
  logger.info('App Kit code generation token usage', {
    buildId,
    appName,
    skillRef: SKILL_REF,
    provider: response.provider?.name,
    model: response.provider?.model,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
    totalTokens: response.usage?.totalTokens,
    cost: response.cost?.total,
    filesGenerated: files.length,
    parsed: Boolean(parsedFiles)
  });

  return {
    success: true,
    buildId,
    appName,
    files,
    parsed: Boolean(parsedFiles),
    raw: response.content,
    model: {
      provider: response.provider?.name,
      model: response.provider?.model,
      trustTier: response.provider?.trustTier
    },
    usage: response.usage,
    cost: response.cost
  };
}

module.exports = { generate };
