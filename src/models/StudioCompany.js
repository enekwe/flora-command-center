const mongoose = require('mongoose');

const StudioCompanySchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxLength: [100, 'Company name cannot exceed 100 characters']
  },

  status: {
    type: String,
    enum: {
      values: ['Ideation', 'Scouting', 'Scrimmage', 'Training Camp', 'League', 'Graduated', 'Paused', 'Closed'],
      message: '{VALUE} is not a valid status'
    },
    default: 'Ideation',
    required: true
  },

  currentStage: {
    type: String,
    enum: {
      values: ['Scouting', 'Scrimmage', 'Training Camp', 'League'],
      message: '{VALUE} is not a valid stage'
    }
  },

  currentGate: {
    type: Number,
    min: [1, 'Gate number must be between 1 and 15'],
    max: [15, 'Gate number must be between 1 and 15']
  },

  startDate: {
    type: Date,
    default: Date.now
  },

  // Mudbook Gates (15 gates)
  gates: [{
    gateNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 15
    },
    gateName: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Submitted', 'Passed', 'Failed'],
      default: 'Not Started'
    },
    targetDate: Date,
    completedDate: Date,
    deliverables: [{
      name: {
        type: String,
        required: true
      },
      description: String,
      fileUrl: String,
      status: {
        type: String,
        enum: ['Pending', 'Submitted', 'Approved', 'Rejected'],
        default: 'Pending'
      },
      submittedAt: Date,
      approvedAt: Date
    }],
    reviewers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    feedback: String,
    score: {
      type: Number,
      min: 1,
      max: 5
    }
  }],

  // Mudbook Tasks (108 tasks)
  tasks: [{
    taskId: {
      type: Number,
      required: true,
      min: 1,
      max: 108
    },
    name: {
      type: String,
      required: true
    },
    description: String,
    category: {
      type: String,
      enum: ['Cross-Functional', 'Business', 'Product & Tech', 'Sales & Marketing', 'Operations'],
      required: true
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Completed', 'Blocked'],
      default: 'Not Started'
    },
    dueDate: Date,
    completedDate: Date,
    hoursLogged: {
      type: Number,
      default: 0,
      min: 0
    },
    dependencies: [Number], // Other task IDs
    blockers: String,
    notes: String
  }],

  // Founding Team
  foundingTeam: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      required: true
    },
    title: String,
    equity: {
      type: Number,
      min: 0,
      max: 100
    },
    joinDate: {
      type: Date,
      default: Date.now
    },
    vestingSchedule: {
      cliff: Number, // months
      vestingPeriod: Number, // months
      vestedPercentage: Number
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],

  // Lean Canvas
  leanCanvas: {
    problem: [{
      type: String,
      maxLength: 500
    }],
    solution: [{
      type: String,
      maxLength: 500
    }],
    uniqueValueProposition: {
      type: String,
      maxLength: 500
    },
    unfairAdvantage: {
      type: String,
      maxLength: 500
    },
    customerSegments: [{
      type: String,
      maxLength: 200
    }],
    channels: [{
      type: String,
      maxLength: 200
    }],
    revenueStreams: [{
      type: String,
      maxLength: 200
    }],
    costStructure: [{
      type: String,
      maxLength: 200
    }],
    keyMetrics: [{
      type: String,
      maxLength: 200
    }]
  },

  // Business Details
  industry: {
    type: String,
    maxLength: 100
  },

  businessModel: {
    type: String,
    maxLength: 200
  },

  targetMarket: {
    type: String,
    maxLength: 500
  },

  competitiveAdvantage: {
    type: String,
    maxLength: 1000
  },

  // Funding Information
  preSeedAmount: {
    type: Number,
    min: 0
  },

  seedRound: {
    amount: Number,
    valuation: Number,
    investors: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    closedDate: Date,
    termSheet: String // URL to document
  },

  seriesA: {
    targetAmount: Number,
    targetValuation: Number,
    targetDate: Date,
    status: {
      type: String,
      enum: ['Planning', 'Fundraising', 'Term Sheet', 'Closed']
    }
  },

  // Key Metrics
  metrics: {
    // Financial
    mrr: {
      type: Number,
      default: 0,
      min: 0
    },
    arr: {
      type: Number,
      default: 0,
      min: 0
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0
    },
    burnRate: {
      type: Number,
      min: 0
    },
    runway: {
      type: Number, // in months
      min: 0
    },

    // Customer
    customers: {
      type: Number,
      default: 0,
      min: 0
    },
    activeUsers: {
      type: Number,
      default: 0,
      min: 0
    },
    churnRate: {
      type: Number,
      min: 0,
      max: 100
    },
    nps: {
      type: Number,
      min: -100,
      max: 100
    },

    // Unit Economics
    cac: {
      type: Number,
      min: 0
    },
    ltv: {
      type: Number,
      min: 0
    },
    ltvCacRatio: {
      type: Number,
      min: 0
    },

    // Growth
    growthRate: {
      type: Number // percentage
    },

    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },

  // Resources & Budget
  budget: {
    allocated: {
      type: Number,
      min: 0
    },
    spent: {
      type: Number,
      min: 0,
      default: 0
    },
    remaining: {
      type: Number,
      min: 0
    }
  },

  // Documents
  documents: [{
    name: String,
    type: {
      type: String,
      enum: ['Pitch Deck', 'Financial Model', 'Business Plan', 'Legal', 'Marketing', 'Product', 'Other']
    },
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],

  // Relationships
  studioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Studio',
    required: true
  },

  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fund'
  },

  // Integration with Investment model for cap table
  investmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment'
  },

  // Meta fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  isDeleted: {
    type: Boolean,
    default: false
  },

  deletedAt: Date,

  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  tags: [String],

  notes: String,

  // ===== Token Budget Management =====

  tokenBudget: {
    enabled: {
      type: Boolean,
      default: false
    },

    allocatedTokens: {
      type: Number,
      default: 0,
      min: [0, 'Allocated tokens must be non-negative']
    },

    usedTokens: {
      type: Number,
      default: 0,
      min: [0, 'Used tokens must be non-negative']
    },

    warningThreshold: {
      type: Number,
      default: 80,  // Percentage
      min: [0, 'Warning threshold must be between 0-100'],
      max: [100, 'Warning threshold must be between 0-100']
    },

    resetPeriod: {
      type: String,
      enum: {
        values: ['none', 'monthly', 'quarterly', 'annually'],
        message: '{VALUE} is not a valid reset period'
      },
      default: 'none'
    },

    lastResetAt: Date,
    nextResetAt: Date
  },

  // ===== Company-level BYOK =====

  byokConfig: {
    enabled: {
      type: Boolean,
      default: false
    },

    provider: {
      type: String,
      enum: ['openai', 'anthropic', 'azure_openai']
    },

    apiKey: {
      type: String,  // Encrypted
      select: false
    },

    orgId: {
      type: String,
      select: false
    },

    configuredAt: Date,
    configuredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // ===== Company Formation =====

  formation: {
    // Formation status
    status: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'NOT_STARTED'
    },

    // CorpNet integration
    orderId: String, // Flora order ID
    corpnetOrderId: String, // CorpNet's order ID

    // Company details
    entityType: {
      type: String,
      enum: ['C_CORP', 'S_CORP', 'LLC']
    },

    state: {
      type: String,
      default: 'DELAWARE'
    },

    authorizedShares: {
      type: Number,
      default: 10000000
    },

    parValue: {
      type: Number,
      default: 0.00001
    },

    // EIN and incorporation details
    ein: String,
    incorporationDate: Date,
    certificateNumber: String,

    // Formation progress
    currentStep: {
      type: String,
      enum: ['NAME_RESERVATION', 'STATE_FILING', 'EIN_APPLICATION', 'REGISTERED_AGENT', 'COMPLETED']
    },

    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },

    // Timeline
    initiatedAt: Date,
    estimatedCompletion: Date,
    completedAt: Date,
    lastUpdated: Date,

    // Cost
    cost: Number,

    // Documents
    documents: [{
      type: {
        type: String,
        enum: ['CERTIFICATE_OF_INCORPORATION', 'ARTICLES_OF_ORGANIZATION', 'EIN_CONFIRMATION', 'BYLAWS', 'OPERATING_AGREEMENT', 'OTHER']
      },
      name: String,
      url: String,
      uploadedAt: { type: Date, default: Date.now }
    }],

    // 83(b) Elections
    taxElections: [{
      type: {
        type: String,
        enum: ['83B', 'QSBS']
      },
      founderEmail: String,
      filingId: String,
      filedAt: Date,
      deadline: Date,
      confirmationUrl: String,
      status: {
        type: String,
        enum: ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
      }
    }]
  },

  // ===== Cap Table =====

  capTable: {
    totalShares: {
      type: Number,
      default: 10000000
    },

    issuedShares: {
      type: Number,
      default: 0
    },

    outstandingShares: {
      type: Number,
      default: 0
    },

    parValue: {
      type: Number,
      default: 0.00001
    },

    shareholders: [{
      name: String,
      email: String,
      type: {
        type: String,
        enum: ['FOUNDER', 'EMPLOYEE', 'INVESTOR', 'ADVISOR']
      },
      shares: {
        type: Number,
        default: 0
      },
      ownershipPercentage: {
        type: Number,
        min: 0,
        max: 100
      },
      vestingSchedule: {
        cliff: Number, // months
        vestingPeriod: Number, // months
        startDate: Date
      },
      issuedDate: Date,
      certificateNumber: String
    }],

    optionPool: {
      allocated: {
        type: Number,
        default: 0
      },
      granted: {
        type: Number,
        default: 0
      },
      available: {
        type: Number,
        default: 0
      }
    },

    valuationHistory: [{
      date: Date,
      preMoney: Number,
      postMoney: Number,
      round: String,
      notes: String
    }]
  },

  // ===== Command Center Onboarding =====

  onboardingCompleted: {
    type: Boolean,
    default: false
  },

  onboardingData: {
    domainName: String,
    hostingProvider: {
      type: String,
      enum: ['shopify', 'wordpress', 'custom']
    },
    stagingSubdomain: String,
    productionDomain: String,
    dnsConfigured: Boolean,
    ideType: {
      type: String,
      enum: ['local', 'cloud']
    },
    idePath: String,
    llmProvider: {
      type: String,
      enum: ['anthropic', 'openai', 'gemini']
    },
    llmApiKeyEncrypted: {
      type: String,
      select: false  // Never include in queries by default
    },
    commsInterface: {
      type: String,
      enum: ['slack', 'email']
    },
    slackWorkspaceId: String,
    emailAddress: String,
    completedAt: Date
  }

}, {
  timestamps: true
});

// Indexes for performance
StudioCompanySchema.index({ studioId: 1, status: 1 });
StudioCompanySchema.index({ currentStage: 1, currentGate: 1 });
StudioCompanySchema.index({ 'foundingTeam.userId': 1 });
StudioCompanySchema.index({ createdAt: -1 });
StudioCompanySchema.index({ isDeleted: 1, status: 1 });
StudioCompanySchema.index({
  name: 'text',
  'leanCanvas.uniqueValueProposition': 'text',
  industry: 'text'
});

// Virtual for gate progress percentage
StudioCompanySchema.virtual('gateProgress').get(function() {
  if (!this.gates || this.gates.length === 0) return 0;
  const passedGates = this.gates.filter(g => g.status === 'Passed').length;
  return Math.round((passedGates / 15) * 100);
});

// Virtual for task completion percentage
StudioCompanySchema.virtual('taskCompletion').get(function() {
  if (!this.tasks || this.tasks.length === 0) return 0;
  const completedTasks = this.tasks.filter(t => t.status === 'Completed').length;
  return Math.round((completedTasks / 108) * 100);
});

// Virtual for budget utilization
StudioCompanySchema.virtual('budgetUtilization').get(function() {
  if (!this.budget || !this.budget.allocated || this.budget.allocated === 0) return 0;
  return Math.round((this.budget.spent / this.budget.allocated) * 100);
});

// Method to advance to next gate
StudioCompanySchema.methods.advanceGate = function() {
  if (this.currentGate < 15) {
    this.currentGate += 1;

    // Update stage based on gate
    if (this.currentGate <= 5) {
      this.currentStage = 'Scouting';
    } else if (this.currentGate <= 10) {
      this.currentStage = 'Scrimmage';
    } else if (this.currentGate <= 13) {
      this.currentStage = 'Training Camp';
    } else {
      this.currentStage = 'League';
    }

    // Update status if reaching certain milestones
    if (this.currentGate === 15 && this.status !== 'Graduated') {
      this.status = 'League';
    }
  }
  return this.save();
};

// Method to calculate runway
StudioCompanySchema.methods.calculateRunway = function() {
  if (this.metrics.burnRate && this.metrics.burnRate > 0) {
    const cashRemaining = this.budget.remaining || 0;
    this.metrics.runway = Math.floor(cashRemaining / this.metrics.burnRate);
  }
  return this.metrics.runway;
};

// Method for soft delete
StudioCompanySchema.methods.softDelete = function(userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.status = 'Closed';
  return this.save();
};

// Query helper for active companies only
StudioCompanySchema.query.activeOnly = function() {
  return this.where({ isDeleted: false });
};

// Pre-save middleware to update budget remaining
StudioCompanySchema.pre('save', function(next) {
  if (this.budget && this.budget.allocated) {
    this.budget.remaining = this.budget.allocated - (this.budget.spent || 0);
  }

  // Calculate LTV/CAC ratio
  if (this.metrics && this.metrics.ltv && this.metrics.cac && this.metrics.cac > 0) {
    this.metrics.ltvCacRatio = this.metrics.ltv / this.metrics.cac;
  }

  // Update ARR from MRR
  if (this.metrics && this.metrics.mrr) {
    this.metrics.arr = this.metrics.mrr * 12;
  }

  next();
});

// Ensure virtuals are included in JSON
StudioCompanySchema.set('toJSON', { virtuals: true });
StudioCompanySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('StudioCompany', StudioCompanySchema);