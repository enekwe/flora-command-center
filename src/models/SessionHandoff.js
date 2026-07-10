const mongoose = require('mongoose');

/**
 * SessionHandoff Model
 * Stores session handoff information for seamless agent transitions
 *
 * Captures complete session context including:
 * - Work completed and decisions made
 * - Remaining tasks and blockers
 * - Relevant code snippets and configuration
 * - Metadata for handoff document generation
 */

const sessionHandoffSchema = new mongoose.Schema({
  // Session Identification
  sessionId: {
    type: String,
    required: [true, 'Session ID is required'],
    index: true,
    trim: true
  },

  // Agent Information
  agentType: {
    type: String,
    required: [true, 'Agent type is required'],
    enum: {
      values: [
        'backend_architect',
        'frontend_engineer',
        'devops_engineer',
        'data_engineer',
        'qa_engineer',
        'general_assistant'
      ],
      message: '{VALUE} is not a supported agent type'
    }
  },

  // Provider Information
  provider: {
    type: String,
    required: [true, 'Provider name is required'],
    enum: {
      values: ['anthropic', 'openai', 'gemini', 'opensource'],
      message: '{VALUE} is not a supported provider'
    }
  },

  model: {
    type: String,
    trim: true
  },

  // Handoff Trigger
  triggerReason: {
    type: String,
    required: [true, 'Trigger reason is required'],
    enum: {
      values: ['CONTEXT_CAP', 'RATE_LIMIT', 'COST_LIMIT', 'ERROR_THRESHOLD', 'MANUAL', 'TASK_COMPLETION'],
      message: '{VALUE} is not a valid trigger reason'
    },
    index: true
  },

  // Session Context
  contextSummary: {
    type: String,
    required: [true, 'Context summary is required'],
    trim: true,
    maxlength: [5000, 'Context summary must be less than 5000 characters']
  },

  taskDescription: {
    type: String,
    trim: true,
    maxlength: [2000, 'Task description must be less than 2000 characters']
  },

  // Work Tracking
  decisionsMade: [{
    decision: {
      type: String,
      required: true,
      trim: true
    },
    reasoning: {
      type: String,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    impact: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    }
  }],

  workCompleted: [{
    task: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    filesModified: [String],
    timestamp: {
      type: Date,
      default: Date.now
    },
    verified: {
      type: Boolean,
      default: false
    }
  }],

  remainingTasks: [{
    task: {
      type: String,
      required: true,
      trim: true
    },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium'
    },
    description: {
      type: String,
      trim: true
    },
    estimatedEffort: {
      type: String,
      enum: ['small', 'medium', 'large', 'extra-large'],
      default: 'medium'
    },
    blockers: [String],
    dependencies: [String]
  }],

  // Technical Context
  relevantCode: [{
    filePath: {
      type: String,
      required: true
    },
    language: {
      type: String,
      trim: true
    },
    snippet: {
      type: String,
      required: true
    },
    lineNumbers: {
      start: Number,
      end: Number
    },
    context: {
      type: String,
      trim: true,
      description: 'Why this code is relevant'
    },
    modified: {
      type: Boolean,
      default: false
    }
  }],

  configurationState: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    description: 'Current configuration and environment state'
  },

  // Codebase State
  codebaseSnapshot: {
    branch: {
      type: String,
      trim: true
    },
    commit: {
      type: String,
      trim: true
    },
    uncommittedChanges: {
      type: Boolean,
      default: false
    },
    modifiedFiles: [String],
    newFiles: [String]
  },

  // Testing State
  testingState: {
    testsRun: {
      type: Boolean,
      default: false
    },
    testsPassing: {
      type: Boolean,
      default: null
    },
    testResults: {
      total: Number,
      passed: Number,
      failed: Number,
      skipped: Number
    },
    coveragePercentage: Number,
    failingTests: [{
      name: String,
      error: String,
      file: String
    }]
  },

  // Environment State
  environmentState: {
    dependencies: {
      type: Map,
      of: String,
      default: {}
    },
    environmentVariables: [{
      key: String,
      required: Boolean,
      description: String
    }],
    services: [{
      name: String,
      status: {
        type: String,
        enum: ['running', 'stopped', 'error', 'unknown']
      },
      required: Boolean
    }]
  },

  // Issues and Blockers
  issues: [{
    type: {
      type: String,
      enum: ['error', 'warning', 'blocker', 'question'],
      required: true
    },
    severity: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium'
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    context: {
      type: String,
      trim: true
    },
    attemptedSolutions: [String],
    relatedFiles: [String],
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  // Recommendations for Next Agent
  recommendations: [{
    recommendation: {
      type: String,
      required: true,
      trim: true
    },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium'
    },
    reasoning: {
      type: String,
      trim: true
    }
  }],

  // Resource References
  resourceReferences: {
    documentation: [String],
    apis: [String],
    databases: [String],
    externalServices: [String],
    relatedTickets: [String]
  },

  // Handoff Document
  handoffDocumentPath: {
    type: String,
    trim: true,
    index: true,
    description: 'Path to generated markdown handoff document'
  },

  handoffDocumentGenerated: {
    type: Boolean,
    default: false
  },

  handoffDocumentContent: {
    type: String,
    description: 'Generated markdown content'
  },

  // Metrics
  metrics: {
    tokenUsage: {
      total: Number,
      input: Number,
      output: Number
    },
    requestCount: Number,
    costAccumulated: Number,
    sessionDuration: Number,
    filesModifiedCount: Number,
    decisionsCount: Number,
    tasksCompletedCount: Number,
    tasksRemainingCount: Number
  },

  // Handoff Status
  status: {
    type: String,
    enum: {
      values: ['pending', 'generated', 'acknowledged', 'resumed', 'completed', 'expired'],
      message: '{VALUE} is not a valid status'
    },
    default: 'pending',
    index: true
  },

  // Acknowledgment
  acknowledgedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  acknowledgedAt: {
    type: Date
  },

  resumedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  resumedAt: {
    type: Date
  },

  // Metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Audit
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    index: true
  }
}, {
  timestamps: true,
  collection: 'session_handoffs'
});

// Compound Indexes
sessionHandoffSchema.index({ sessionId: 1, createdAt: -1 });
sessionHandoffSchema.index({ provider: 1, agentType: 1 });
sessionHandoffSchema.index({ status: 1, createdAt: -1 });
sessionHandoffSchema.index({ triggerReason: 1, status: 1 });

// Sparse indexes
sessionHandoffSchema.index({ handoffDocumentPath: 1 }, { sparse: true });
sessionHandoffSchema.index({ acknowledgedAt: 1 }, { sparse: true });

// TTL index for automatic cleanup of expired handoffs
sessionHandoffSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

// Virtuals

sessionHandoffSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

sessionHandoffSchema.virtual('timeUntilExpiry').get(function() {
  return Math.max(0, this.expiresAt - Date.now());
});

sessionHandoffSchema.virtual('hasBlockers').get(function() {
  return this.remainingTasks.some(task => task.blockers && task.blockers.length > 0) ||
         this.issues.some(issue => issue.type === 'blocker');
});

sessionHandoffSchema.virtual('criticalIssuesCount').get(function() {
  return this.issues.filter(issue => issue.severity === 'critical').length;
});

sessionHandoffSchema.virtual('completionPercentage').get(function() {
  const total = this.workCompleted.length + this.remainingTasks.length;
  if (total === 0) return 0;
  return (this.workCompleted.length / total) * 100;
});

// Pre-save middleware
sessionHandoffSchema.pre('save', function(next) {
  // Update metrics
  this.metrics = this.metrics || {};
  this.metrics.decisionsCount = this.decisionsMade.length;
  this.metrics.tasksCompletedCount = this.workCompleted.length;
  this.metrics.tasksRemainingCount = this.remainingTasks.length;
  this.metrics.filesModifiedCount = this.codebaseSnapshot.modifiedFiles?.length || 0;

  next();
});

// Instance Methods

/**
 * Generate handoff summary
 */
sessionHandoffSchema.methods.generateSummary = function() {
  return {
    sessionId: this.sessionId,
    agentType: this.agentType,
    provider: this.provider,
    triggerReason: this.triggerReason,
    completionPercentage: this.completionPercentage,
    tasksCompleted: this.workCompleted.length,
    tasksRemaining: this.remainingTasks.length,
    hasBlockers: this.hasBlockers,
    criticalIssues: this.criticalIssuesCount,
    status: this.status,
    createdAt: this.createdAt,
    expiresAt: this.expiresAt
  };
};

/**
 * Mark as acknowledged
 */
sessionHandoffSchema.methods.acknowledge = async function(userId) {
  this.status = 'acknowledged';
  this.acknowledgedBy = userId;
  this.acknowledgedAt = new Date();

  return this.save();
};

/**
 * Mark as resumed
 */
sessionHandoffSchema.methods.resume = async function(userId) {
  this.status = 'resumed';
  this.resumedBy = userId;
  this.resumedAt = new Date();

  return this.save();
};

/**
 * Mark as completed
 */
sessionHandoffSchema.methods.complete = async function() {
  this.status = 'completed';
  return this.save();
};

/**
 * Add decision
 */
sessionHandoffSchema.methods.addDecision = function(decision, reasoning, impact = 'medium') {
  this.decisionsMade.push({
    decision,
    reasoning,
    impact,
    timestamp: new Date()
  });
};

/**
 * Add work completed
 */
sessionHandoffSchema.methods.addWorkCompleted = function(task, description, filesModified = [], verified = false) {
  this.workCompleted.push({
    task,
    description,
    filesModified,
    verified,
    timestamp: new Date()
  });
};

/**
 * Add remaining task
 */
sessionHandoffSchema.methods.addRemainingTask = function(task, priority = 'medium', description = '', estimatedEffort = 'medium', blockers = [], dependencies = []) {
  this.remainingTasks.push({
    task,
    priority,
    description,
    estimatedEffort,
    blockers,
    dependencies
  });
};

/**
 * Add issue
 */
sessionHandoffSchema.methods.addIssue = function(type, severity, description, context = '', attemptedSolutions = [], relatedFiles = []) {
  this.issues.push({
    type,
    severity,
    description,
    context,
    attemptedSolutions,
    relatedFiles,
    timestamp: new Date()
  });
};

/**
 * Add code snippet
 */
sessionHandoffSchema.methods.addCodeSnippet = function(filePath, snippet, language = '', context = '', lineNumbers = null, modified = false) {
  this.relevantCode.push({
    filePath,
    snippet,
    language,
    context,
    lineNumbers,
    modified
  });
};

/**
 * Add recommendation
 */
sessionHandoffSchema.methods.addRecommendation = function(recommendation, priority = 'medium', reasoning = '') {
  this.recommendations.push({
    recommendation,
    priority,
    reasoning
  });
};

// Static Methods

/**
 * Find active handoffs by session
 */
sessionHandoffSchema.statics.findActiveBySession = async function(sessionId) {
  return this.find({
    sessionId,
    status: { $in: ['pending', 'generated', 'acknowledged', 'resumed'] },
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

/**
 * Find latest handoff by session
 */
sessionHandoffSchema.statics.findLatestBySession = async function(sessionId) {
  return this.findOne({ sessionId })
    .sort({ createdAt: -1 });
};

/**
 * Find pending handoffs
 */
sessionHandoffSchema.statics.findPending = async function() {
  return this.find({
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: 1 });
};

/**
 * Find handoffs requiring attention
 */
sessionHandoffSchema.statics.findRequiringAttention = async function() {
  return this.find({
    status: { $in: ['pending', 'generated'] },
    expiresAt: { $gt: new Date() },
    $or: [
      { 'issues.type': 'blocker' },
      { 'issues.severity': 'critical' },
      { 'remainingTasks.priority': 'critical' }
    ]
  }).sort({ createdAt: 1 });
};

/**
 * Get handoff statistics
 */
sessionHandoffSchema.statics.getStatistics = async function(timeframe = 24) {
  const hoursAgo = new Date(Date.now() - timeframe * 60 * 60 * 1000);

  const pipeline = [
    {
      $match: {
        createdAt: { $gte: hoursAgo }
      }
    },
    {
      $group: {
        _id: null,
        totalHandoffs: { $sum: 1 },
        byTriggerReason: {
          $push: '$triggerReason'
        },
        byStatus: {
          $push: '$status'
        },
        avgCompletionPercentage: { $avg: '$completionPercentage' },
        totalCriticalIssues: { $sum: { $size: { $filter: {
          input: '$issues',
          as: 'issue',
          cond: { $eq: ['$$issue.severity', 'critical'] }
        }}}},
        avgTasksCompleted: { $avg: { $size: '$workCompleted' } },
        avgTasksRemaining: { $avg: { $size: '$remainingTasks' } }
      }
    }
  ];

  const result = await this.aggregate(pipeline);
  return result[0] || {};
};

module.exports = mongoose.model('SessionHandoff', sessionHandoffSchema);
