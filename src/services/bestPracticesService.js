/**
 * Best Practices Alerting Service
 *
 * Provides context-aware best practice recommendations based on:
 * - Team composition (solo vs team)
 * - User role (designer, tester, primary developer, etc.)
 * - Expertise level (novice, intermediate, expert)
 */

const bestPractices = {
  // General best practices for all developers
  general: [
    {
      id: 'git-commits',
      title: 'Meaningful Git Commits',
      description: 'Use conventional commit format: feat:, fix:, docs:, etc.',
      level: ['novice', 'intermediate'],
      context: ['code-commit', 'git-workflow'],
      learnMoreUrl: '/docs/git-workflow',
    },
    {
      id: 'code-review',
      title: 'Code Review Best Practices',
      description: 'Request reviews for significant changes. Review checklist available.',
      level: ['all'],
      context: ['pull-request', 'code-review'],
      learnMoreUrl: '/docs/code-review-checklist',
    },
    {
      id: 'testing',
      title: 'Write Tests First (TDD)',
      description: 'Write tests before implementation for critical business logic.',
      level: ['intermediate', 'expert'],
      context: ['new-feature', 'bug-fix'],
      learnMoreUrl: '/docs/tdd-workflow',
    },
  ],

  // Solo developer practices
  solo: [
    {
      id: 'documentation',
      title: 'Document Your Decisions',
      description: 'Keep a decision log for future reference when working solo.',
      level: ['all'],
      context: ['architecture', 'technical-decision'],
      learnMoreUrl: '/docs/decision-log',
    },
    {
      id: 'backup-strategy',
      title: 'Backup and Version Control',
      description: 'Push to remote frequently - you are your own backup.',
      level: ['novice', 'intermediate'],
      context: ['git-workflow', 'deployment'],
      learnMoreUrl: '/docs/backup-strategy',
    },
    {
      id: 'automated-testing',
      title: 'Automate Testing',
      description: 'Set up CI/CD early - you won\'t have QA teammates.',
      level: ['all'],
      context: ['testing', 'deployment'],
      learnMoreUrl: '/docs/ci-cd-setup',
    },
  ],

  // Team-based practices
  team: [
    {
      id: 'communication',
      title: 'Clear Communication',
      description: 'Use PR descriptions, issue templates, and documentation.',
      level: ['all'],
      context: ['pull-request', 'collaboration'],
      learnMoreUrl: '/docs/team-communication',
    },
    {
      id: 'branch-strategy',
      title: 'Branch Naming Convention',
      description: 'Use consistent branch naming: feat/*, fix/*, refactor/*',
      level: ['novice', 'intermediate'],
      context: ['git-workflow', 'collaboration'],
      learnMoreUrl: '/docs/branch-strategy',
    },
    {
      id: 'code-ownership',
      title: 'Code Ownership',
      description: 'Use CODEOWNERS file to assign review responsibilities.',
      level: ['intermediate', 'expert'],
      context: ['collaboration', 'code-review'],
      learnMoreUrl: '/docs/code-ownership',
    },
  ],

  // Role-specific practices
  roles: {
    designer: [
      {
        id: 'design-tokens',
        title: 'Use Design Tokens',
        description: 'Reference design system tokens instead of hardcoded values.',
        level: ['all'],
        context: ['ui-development', 'styling'],
        learnMoreUrl: '/docs/design-system',
      },
      {
        id: 'accessibility',
        title: 'Accessibility First',
        description: 'Use semantic HTML and ARIA attributes from the start.',
        level: ['all'],
        context: ['ui-development', 'component-creation'],
        learnMoreUrl: '/docs/accessibility-guide',
      },
    ],
    tester: [
      {
        id: 'test-coverage',
        title: 'Maintain Test Coverage',
        description: 'Aim for 80%+ coverage on critical business logic.',
        level: ['all'],
        context: ['testing', 'quality-assurance'],
        learnMoreUrl: '/docs/test-coverage',
      },
      {
        id: 'edge-cases',
        title: 'Test Edge Cases',
        description: 'Include boundary values, null/undefined, and error states.',
        level: ['intermediate', 'expert'],
        context: ['testing', 'bug-fix'],
        learnMoreUrl: '/docs/edge-case-testing',
      },
    ],
    developer: [
      {
        id: 'error-handling',
        title: 'Comprehensive Error Handling',
        description: 'Always wrap async operations in try-catch blocks.',
        level: ['novice', 'intermediate'],
        context: ['error-handling', 'async-code'],
        learnMoreUrl: '/docs/error-handling',
      },
      {
        id: 'security',
        title: 'Security Best Practices',
        description: 'Validate inputs, sanitize data, use parameterized queries.',
        level: ['all'],
        context: ['api-development', 'database'],
        learnMoreUrl: '/docs/security-checklist',
      },
    ],
  },
};

class BestPracticesService {
  /**
   * Get relevant best practices based on user profile and context
   * @param {Object} userProfile - User settings
   * @param {string} context - Current context (e.g., 'code-commit', 'pull-request')
   * @returns {Array} Relevant best practices
   */
  getBestPractices(userProfile, context) {
    const {
      teamComposition = 'solo', // 'solo' or 'team'
      role = 'developer', // 'designer', 'tester', 'developer'
      expertiseLevel = 'intermediate', // 'novice', 'intermediate', 'expert'
    } = userProfile;

    const practices = [];

    // Add general practices
    practices.push(...this.filterPractices(bestPractices.general, expertiseLevel, context));

    // Add composition-specific practices (solo vs team)
    if (teamComposition === 'solo') {
      practices.push(...this.filterPractices(bestPractices.solo, expertiseLevel, context));
    } else {
      practices.push(...this.filterPractices(bestPractices.team, expertiseLevel, context));
    }

    // Add role-specific practices
    if (bestPractices.roles[role]) {
      practices.push(...this.filterPractices(bestPractices.roles[role], expertiseLevel, context));
    }

    // Deduplicate by ID
    const uniquePractices = [];
    const seenIds = new Set();

    for (const practice of practices) {
      if (!seenIds.has(practice.id)) {
        uniquePractices.push(practice);
        seenIds.add(practice.id);
      }
    }

    return uniquePractices;
  }

  /**
   * Filter practices by expertise level and context
   * @param {Array} practices - List of practices
   * @param {string} expertiseLevel - User expertise level
   * @param {string} context - Current context
   * @returns {Array} Filtered practices
   */
  filterPractices(practices, expertiseLevel, context) {
    return practices.filter(practice => {
      // Check expertise level
      const levelMatch =
        practice.level.includes('all') ||
        practice.level.includes(expertiseLevel);

      // Check context
      const contextMatch =
        !context ||
        practice.context.some(ctx => context.includes(ctx));

      return levelMatch && contextMatch;
    });
  }

  /**
   * Get practice alert for specific action
   * @param {Object} userProfile - User settings
   * @param {string} action - Action being performed (e.g., 'creating-pull-request')
   * @returns {Object|null} Alert object or null
   */
  getAlert(userProfile, action) {
    const contextMap = {
      'creating-pull-request': 'pull-request',
      'committing-code': 'code-commit',
      'creating-feature': 'new-feature',
      'fixing-bug': 'bug-fix',
      'deploying': 'deployment',
      'writing-test': 'testing',
      'creating-component': 'ui-development',
      'making-decision': 'technical-decision',
    };

    const context = contextMap[action];
    if (!context) return null;

    const practices = this.getBestPractices(userProfile, context);

    if (practices.length === 0) return null;

    // Return the most relevant practice
    return {
      type: 'info',
      practices: practices.slice(0, 3), // Top 3 most relevant
      dismissible: true,
    };
  }

  /**
   * Generate skills.md recommendations section
   * @param {Object} userProfile - User settings
   * @returns {string} Markdown content for skills.md
   */
  generateSkillsRecommendations(userProfile) {
    const allPractices = this.getBestPractices(userProfile, null);

    let markdown = `# Best Practices Recommendations\n\n`;
    markdown += `**Team Composition:** ${userProfile.teamComposition}\n`;
    markdown += `**Role:** ${userProfile.role}\n`;
    markdown += `**Expertise Level:** ${userProfile.expertiseLevel}\n\n`;
    markdown += `---\n\n`;

    for (const practice of allPractices) {
      markdown += `## ${practice.title}\n\n`;
      markdown += `${practice.description}\n\n`;
      markdown += `**Contexts:** ${practice.context.join(', ')}\n\n`;
      markdown += `[Learn More](${practice.learnMoreUrl})\n\n`;
      markdown += `---\n\n`;
    }

    return markdown;
  }

  /**
   * Update user profile settings
   * @param {string} siteId - Site identifier
   * @param {Object} updates - Profile updates
   * @returns {Object} Updated profile
   */
  async updateUserProfile(siteId, updates) {
    // In production, this would save to database
    // For now, return the updated profile
    return {
      siteId,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get best practice checklist for specific workflow
   * @param {Object} userProfile - User settings
   * @param {string} workflow - Workflow name (e.g., 'deployment', 'feature-development')
   * @returns {Array} Checklist items
   */
  getWorkflowChecklist(userProfile, workflow) {
    const checklists = {
      deployment: [
        'Run all tests and ensure they pass',
        'Update version number (semantic versioning)',
        'Update CHANGELOG.md with changes',
        'Verify environment variables are set',
        'Check database migrations are applied',
        'Confirm staging deployment is stable',
        'Tag release in Git',
        'Monitor logs after deployment',
      ],
      'feature-development': [
        'Create feature branch from main',
        'Write tests before implementation (TDD)',
        'Implement feature with small, focused commits',
        'Update documentation',
        'Run linter and fix issues',
        'Request code review',
        'Address review feedback',
        'Merge after approval',
      ],
      'bug-fix': [
        'Reproduce the bug locally',
        'Write failing test that captures the bug',
        'Implement fix',
        'Verify test now passes',
        'Check for similar issues elsewhere',
        'Update documentation if needed',
        'Create pull request with bug description',
        'Add regression test',
      ],
    };

    return checklists[workflow] || [];
  }
}

module.exports = new BestPracticesService();
