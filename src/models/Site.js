const mongoose = require('mongoose');

const SiteSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Site name is required'],
    trim: true,
    maxLength: [100, 'Site name cannot exceed 100 characters']
  },

  slug: {
    type: String,
    required: [true, 'Site slug is required'],
    trim: true,
    lowercase: true,
    unique: true,
    match: [/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens']
  },

  description: {
    type: String,
    maxLength: [500, 'Description cannot exceed 500 characters']
  },

  // Company Association (Required)
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudioCompany',
    required: [true, 'Company ID is required'],
    index: true
  },

  // Status
  status: {
    type: String,
    enum: {
      values: ['active', 'archived', 'suspended'],
      message: '{VALUE} is not a valid status'
    },
    default: 'active',
    index: true
  },

  // Token & Budget Configuration
  tokenConfig: {
    mode: {
      type: String,
      enum: {
        values: ['passbook_budget', 'company_byok', 'site_byok'],
        message: '{VALUE} is not a valid token mode'
      },
      required: [true, 'Token mode is required'],
      default: 'passbook_budget'
    },

    // Site-specific BYOK credentials (encrypted)
    byokProvider: {
      type: String,
      enum: ['openai', 'anthropic', 'azure_openai'],
      select: false
    },
    byokApiKey: {
      type: String,  // Encrypted
      select: false
    },
    byokOrgId: {
      type: String,
      select: false
    },

    // Budget tracking (if using Passbook budget)
    budgetAllocated: {
      type: Number,
      default: 0,
      min: [0, 'Budget allocated must be non-negative']
    },
    budgetUsed: {
      type: Number,
      default: 0,
      min: [0, 'Budget used must be non-negative']
    },
    budgetWarningThreshold: {
      type: Number,
      default: 80,  // Percentage
      min: [0, 'Warning threshold must be between 0-100'],
      max: [100, 'Warning threshold must be between 0-100']
    }
  },

  // Token Usage Metrics
  metrics: {
    totalTokensUsed: {
      type: Number,
      default: 0,
      index: true,
      min: [0, 'Total tokens used must be non-negative']
    },
    totalRequests: {
      type: Number,
      default: 0,
      min: [0, 'Total requests must be non-negative']
    },
    lastActivityAt: {
      type: Date,
      index: true
    },

    // Milestone tracking for nudges
    milestones: {
      tokensUsed100: { type: Boolean, default: false },
      daysActive7: { type: Boolean, default: false },
      platformsConnected3: { type: Boolean, default: false }
    }
  },

  // Reassignment Nudges (for "Passbook" default company sites)
  nudges: {
    lastNudgeAt: Date,
    nudgeCount: { type: Number, default: 0, min: 0 },
    dismissed: { type: Boolean, default: false },
    dismissedAt: Date,
    dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  // Audit
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user ID is required']
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Soft Delete
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // ===== Best Practices Settings =====

  bestPracticesSettings: {
    teamComposition: {
      type: String,
      enum: ['solo', 'team'],
      default: 'solo'
    },
    role: {
      type: String,
      enum: ['designer', 'tester', 'developer'],
      default: 'developer'
    },
    expertiseLevel: {
      type: String,
      enum: ['novice', 'intermediate', 'expert'],
      default: 'intermediate'
    },
    enableAlerts: {
      type: Boolean,
      default: true
    },
    enableChecklist: {
      type: Boolean,
      default: true
    },
    updatedAt: Date
  },

  // ===== Context Optimization =====

  contextOptimization: {
    lastDistilledAt: Date,
    skillsFileSize: {
      type: Number,
      default: 0
    },
    masterSkillsCreated: {
      type: Boolean,
      default: false
    },
    contextUsagePercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  }

}, {
  timestamps: true,
  collection: 'sites'
});

// Indexes
SiteSchema.index({ companyId: 1, status: 1 });
SiteSchema.index({ companyId: 1, 'metrics.totalTokensUsed': -1 });
SiteSchema.index({ createdAt: -1 });
SiteSchema.index({ slug: 1 }, { unique: true });

// Pre-save middleware to update updatedAt
SiteSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance method: Soft delete
SiteSchema.methods.softDelete = async function(userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.status = 'archived';
  return await this.save();
};

// Static method: Find active sites by company
SiteSchema.statics.findActiveByCompany = function(companyId) {
  return this.find({
    companyId,
    status: 'active',
    isDeleted: false
  }).sort({ createdAt: -1 });
};

// Static method: Find sites needing reassignment (on "Passbook" company with milestones)
SiteSchema.statics.findNeedingReassignment = async function(passbookCompanyId) {
  return this.find({
    companyId: passbookCompanyId,
    status: 'active',
    isDeleted: false,
    'nudges.dismissed': false,
    $or: [
      { 'metrics.milestones.tokensUsed100': true },
      { 'metrics.milestones.daysActive7': true },
      { 'metrics.milestones.platformsConnected3': true }
    ]
  });
};

const Site = mongoose.model('Site', SiteSchema);

module.exports = Site;
