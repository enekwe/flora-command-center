const mongoose = require('mongoose');

/**
 * AppKitBuildLink
 *
 * Ties a Command Center project to a devops App Kit build and records the phase
 * transitions reported via the build-status callback (APP_KIT_PROJECT_CONTRACT.md §2.1).
 * This is the project-timeline persistence for App Kit builds; the governed data
 * touches themselves are recorded separately in ZDRAuditLedger.
 */
const timelineEventSchema = new mongoose.Schema({
  phase: { type: String, required: true },
  driftScore: { type: Number },
  driftStatus: { type: String },
  deployUrl: { type: String },
  repo: { type: String },
  error: { type: String },
  at: { type: Date, default: Date.now }
}, { _id: false });

const appKitBuildLinkSchema = new mongoose.Schema({
  buildId: { type: String, required: true, unique: true, index: true },
  projectId: { type: String, required: true, index: true },
  requestId: { type: String, index: true },
  companyId: { type: String, index: true },

  currentPhase: { type: String, default: 'accepted', index: true },
  timeline: { type: [timelineEventSchema], default: [] }
}, {
  timestamps: true,
  collection: 'appkit_build_links'
});

module.exports = mongoose.model('AppKitBuildLink', appKitBuildLinkSchema);
