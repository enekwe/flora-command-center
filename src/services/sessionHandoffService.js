const SessionHandoff = require('../models/SessionHandoff');
const TokenUsageTracker = require('../models/TokenUsageTracker');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

/**
 * SessionHandoffService
 * Manages session handoff document generation and retrieval
 *
 * Creates comprehensive handoff documents in markdown format
 * Stores metadata in MongoDB for querying and analytics
 * Generates user-friendly handoff messages with instructions
 */
class SessionHandoffService {
  constructor() {
    this.handoffDir = path.join(process.cwd(), 'docs', 'handoffs');
  }

  /**
   * Create handoff from session context
   * @param {object} sessionContext - Complete session context
   * @returns {Promise<object>} Created handoff document
   */
  async createHandoff(sessionContext) {
    try {
      const {
        sessionId,
        agentType = 'general_assistant',
        provider,
        model,
        triggerReason = 'MANUAL',
        contextSummary,
        taskDescription = '',
        decisionsMade = [],
        workCompleted = [],
        remainingTasks = [],
        relevantCode = [],
        configurationState = {},
        codebaseSnapshot = {},
        testingState = {},
        environmentState = {},
        issues = [],
        recommendations = [],
        resourceReferences = {},
        metadata = {},
        createdBy = null
      } = sessionContext;

      // Validate required fields
      if (!sessionId || !provider || !contextSummary) {
        throw new Error('Missing required fields: sessionId, provider, contextSummary');
      }

      // Get token usage metrics
      let tokenMetrics = null;
      const tracker = await TokenUsageTracker.findActiveBySession(sessionId, provider);
      if (tracker) {
        tokenMetrics = {
          total: tracker.tokensUsed,
          input: tracker.inputTokens,
          output: tracker.outputTokens,
          requestCount: tracker.requestCount,
          costAccumulated: tracker.costAccumulated,
          sessionDuration: tracker.lastUpdated - tracker.windowStart
        };
      }

      // Create handoff document
      const handoff = new SessionHandoff({
        sessionId,
        agentType,
        provider,
        model,
        triggerReason,
        contextSummary,
        taskDescription,
        decisionsMade,
        workCompleted,
        remainingTasks,
        relevantCode,
        configurationState,
        codebaseSnapshot,
        testingState,
        environmentState,
        issues,
        recommendations,
        resourceReferences,
        metrics: tokenMetrics,
        metadata,
        createdBy,
        status: 'pending'
      });

      await handoff.save();

      logger.info('Handoff document created', {
        sessionId,
        handoffId: handoff._id,
        triggerReason,
        tasksRemaining: remainingTasks.length
      });

      return {
        success: true,
        handoff: handoff.toObject({ virtuals: true })
      };
    } catch (error) {
      logger.error('Error creating handoff', {
        sessionId: sessionContext.sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Save handoff document as markdown file
   * @param {object} handoff - Handoff document (mongoose object or plain object)
   * @returns {Promise<object>} Save result with file path
   */
  async saveHandoffDocument(handoff) {
    try {
      // Ensure handoff directory exists
      await this.ensureHandoffDirectory();

      // Generate filename
      const timestamp = new Date(handoff.createdAt || Date.now())
        .toISOString()
        .split('T')[0]; // YYYY-MM-DD

      const description = this._sanitizeFilename(
        handoff.taskDescription?.substring(0, 50) ||
        handoff.contextSummary?.substring(0, 50) ||
        'handoff'
      );

      const filename = `${timestamp}-${description}.md`;
      const filePath = path.join(this.handoffDir, filename);

      // Generate markdown content
      const markdownContent = this._generateMarkdownContent(handoff);

      // Write file
      await fs.writeFile(filePath, markdownContent, 'utf8');

      // Update handoff document with file path
      if (handoff._id) {
        await SessionHandoff.findByIdAndUpdate(handoff._id, {
          handoffDocumentPath: filePath,
          handoffDocumentContent: markdownContent,
          handoffDocumentGenerated: true,
          status: 'generated'
        });
      }

      logger.info('Handoff document saved', {
        sessionId: handoff.sessionId,
        filePath
      });

      return {
        success: true,
        filePath,
        filename,
        content: markdownContent
      };
    } catch (error) {
      logger.error('Error saving handoff document', {
        sessionId: handoff.sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load handoff document
   * @param {string} handoffId - Handoff document ID
   * @returns {Promise<object>} Handoff document with content
   */
  async loadHandoff(handoffId) {
    try {
      const handoff = await SessionHandoff.findById(handoffId);

      if (!handoff) {
        throw new Error(`Handoff document not found: ${handoffId}`);
      }

      let content = handoff.handoffDocumentContent;

      // If content not stored in DB, read from file
      if (!content && handoff.handoffDocumentPath) {
        try {
          content = await fs.readFile(handoff.handoffDocumentPath, 'utf8');
        } catch (error) {
          logger.warn('Could not read handoff file', {
            handoffId,
            filePath: handoff.handoffDocumentPath,
            error: error.message
          });
        }
      }

      return {
        success: true,
        handoff: handoff.toObject({ virtuals: true }),
        content
      };
    } catch (error) {
      logger.error('Error loading handoff', {
        handoffId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load handoff by session ID
   * @param {string} sessionId - Session identifier
   * @returns {Promise<object>} Latest handoff for session
   */
  async loadHandoffBySession(sessionId) {
    try {
      const handoff = await SessionHandoff.findLatestBySession(sessionId);

      if (!handoff) {
        return {
          success: false,
          message: `No handoff found for session: ${sessionId}`
        };
      }

      return this.loadHandoff(handoff._id);
    } catch (error) {
      logger.error('Error loading handoff by session', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Format handoff message for user
   * @param {object} handoff - Handoff document
   * @returns {string} Formatted message
   */
  formatHandoffMessage(handoff) {
    const summary = handoff.generateSummary ? handoff.generateSummary() : handoff;

    const message = `
# Session Handoff Required

**Reason:** ${this._formatTriggerReason(summary.triggerReason)}
**Session ID:** ${summary.sessionId}
**Agent Type:** ${this._formatAgentType(summary.agentType)}
**Progress:** ${summary.completionPercentage?.toFixed(1)}% complete

## Quick Summary

${handoff.contextSummary}

## Work Status

- **Tasks Completed:** ${summary.tasksCompleted}
- **Tasks Remaining:** ${summary.tasksRemaining}
- **Has Blockers:** ${summary.hasBlockers ? 'Yes' : 'No'}
- **Critical Issues:** ${summary.criticalIssues}

## Next Steps

${this._formatNextSteps(handoff)}

---

${handoff.handoffDocumentPath
  ? `📄 **Full handoff document:** \`${handoff.handoffDocumentPath}\``
  : '📋 Handoff document is being generated...'
}

**Action Required:** Please review the handoff document and continue work in a new session.
${summary.hasBlockers ? '\n⚠️ **Warning:** This handoff contains blockers that need immediate attention.' : ''}
${summary.criticalIssues > 0 ? `\n🚨 **Alert:** ${summary.criticalIssues} critical issue(s) detected.` : ''}
`;

    return message.trim();
  }

  /**
   * Generate complete handoff with document
   * @param {object} sessionContext - Session context
   * @returns {Promise<object>} Complete handoff with document and message
   */
  async generateCompleteHandoff(sessionContext) {
    try {
      // Create handoff
      const { handoff } = await this.createHandoff(sessionContext);

      // Save as markdown document
      const { filePath, content } = await this.saveHandoffDocument(handoff);

      // Format user message
      const message = this.formatHandoffMessage(handoff);

      return {
        success: true,
        handoff,
        filePath,
        content,
        message
      };
    } catch (error) {
      logger.error('Error generating complete handoff', {
        sessionId: sessionContext.sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Ensure handoff directory exists
   * @private
   */
  async ensureHandoffDirectory() {
    try {
      await fs.access(this.handoffDir);
    } catch {
      await fs.mkdir(this.handoffDir, { recursive: true });
      logger.info('Created handoff directory', { path: this.handoffDir });
    }
  }

  /**
   * Generate markdown content from handoff
   * @private
   */
  _generateMarkdownContent(handoff) {
    const date = new Date(handoff.createdAt || Date.now()).toLocaleString();
    const description = handoff.taskDescription || handoff.contextSummary.substring(0, 100);

    let markdown = `# Session Handoff: ${date} - ${description}

---

## Session Information

- **Session ID:** ${handoff.sessionId}
- **Agent Type:** ${this._formatAgentType(handoff.agentType)}
- **Provider:** ${handoff.provider}${handoff.model ? ` (${handoff.model})` : ''}
- **Trigger Reason:** ${this._formatTriggerReason(handoff.triggerReason)}
- **Created:** ${date}
- **Expires:** ${new Date(handoff.expiresAt).toLocaleString()}

---

## Context Summary

${handoff.contextSummary}

${handoff.taskDescription ? `\n### Task Description\n\n${handoff.taskDescription}\n` : ''}

---

## Decisions Made

${handoff.decisionsMade && handoff.decisionsMade.length > 0
  ? handoff.decisionsMade.map((d, i) => `
### ${i + 1}. ${d.decision}

${d.reasoning ? `**Reasoning:** ${d.reasoning}\n` : ''}**Impact:** ${d.impact || 'medium'}
**Timestamp:** ${new Date(d.timestamp).toLocaleString()}
`).join('\n')
  : '*No decisions recorded*'
}

---

## Work Completed

${handoff.workCompleted && handoff.workCompleted.length > 0
  ? handoff.workCompleted.map((w, i) => `
### ${i + 1}. ${w.task} ${w.verified ? '✓' : ''}

${w.description ? `${w.description}\n` : ''}${w.filesModified && w.filesModified.length > 0
  ? `**Files Modified:**\n${w.filesModified.map(f => `- \`${f}\``).join('\n')}\n`
  : ''
}**Timestamp:** ${new Date(w.timestamp).toLocaleString()}
`).join('\n')
  : '*No work completed yet*'
}

---

## Remaining Tasks

${handoff.remainingTasks && handoff.remainingTasks.length > 0
  ? handoff.remainingTasks.map((t, i) => `
### ${i + 1}. ${t.task}

**Priority:** ${t.priority || 'medium'}
**Estimated Effort:** ${t.estimatedEffort || 'medium'}
${t.description ? `\n${t.description}\n` : ''}
${t.blockers && t.blockers.length > 0
  ? `**Blockers:**\n${t.blockers.map(b => `- ${b}`).join('\n')}\n`
  : ''
}${t.dependencies && t.dependencies.length > 0
  ? `**Dependencies:**\n${t.dependencies.map(d => `- ${d}`).join('\n')}\n`
  : ''
}`).join('\n')
  : '*No remaining tasks*'
}

---

## Issues and Blockers

${handoff.issues && handoff.issues.length > 0
  ? handoff.issues.map((issue, i) => `
### ${i + 1}. [${issue.severity?.toUpperCase() || 'MEDIUM'}] ${issue.type?.toUpperCase() || 'ERROR'}

${issue.description}

${issue.context ? `**Context:** ${issue.context}\n` : ''}
${issue.attemptedSolutions && issue.attemptedSolutions.length > 0
  ? `**Attempted Solutions:**\n${issue.attemptedSolutions.map(s => `- ${s}`).join('\n')}\n`
  : ''
}${issue.relatedFiles && issue.relatedFiles.length > 0
  ? `**Related Files:**\n${issue.relatedFiles.map(f => `- \`${f}\``).join('\n')}\n`
  : ''
}**Reported:** ${new Date(issue.timestamp).toLocaleString()}
`).join('\n')
  : '*No issues reported*'
}

---

## Relevant Code

${handoff.relevantCode && handoff.relevantCode.length > 0
  ? handoff.relevantCode.map((code, i) => `
### ${i + 1}. ${code.filePath} ${code.modified ? '(Modified)' : ''}

${code.context ? `**Context:** ${code.context}\n` : ''}
${code.lineNumbers ? `**Lines:** ${code.lineNumbers.start}-${code.lineNumbers.end}\n` : ''}

\`\`\`${code.language || ''}
${code.snippet}
\`\`\`
`).join('\n')
  : '*No code snippets provided*'
}

---

## Configuration State

${handoff.configurationState && Object.keys(handoff.configurationState).length > 0
  ? `\`\`\`json
${JSON.stringify(handoff.configurationState, null, 2)}
\`\`\``
  : '*No configuration state recorded*'
}

---

## Codebase State

${handoff.codebaseSnapshot && Object.keys(handoff.codebaseSnapshot).length > 0
  ? `
- **Branch:** ${handoff.codebaseSnapshot.branch || 'N/A'}
- **Commit:** ${handoff.codebaseSnapshot.commit || 'N/A'}
- **Uncommitted Changes:** ${handoff.codebaseSnapshot.uncommittedChanges ? 'Yes' : 'No'}

${handoff.codebaseSnapshot.modifiedFiles && handoff.codebaseSnapshot.modifiedFiles.length > 0
  ? `**Modified Files:**\n${handoff.codebaseSnapshot.modifiedFiles.map(f => `- \`${f}\``).join('\n')}\n`
  : ''
}${handoff.codebaseSnapshot.newFiles && handoff.codebaseSnapshot.newFiles.length > 0
  ? `**New Files:**\n${handoff.codebaseSnapshot.newFiles.map(f => `- \`${f}\``).join('\n')}\n`
  : ''
}`
  : '*No codebase state recorded*'
}

---

## Testing State

${handoff.testingState && Object.keys(handoff.testingState).length > 0
  ? `
- **Tests Run:** ${handoff.testingState.testsRun ? 'Yes' : 'No'}
- **Tests Passing:** ${handoff.testingState.testsPassing !== null ? (handoff.testingState.testsPassing ? 'Yes' : 'No') : 'Unknown'}

${handoff.testingState.testResults
  ? `**Test Results:**
- Total: ${handoff.testingState.testResults.total}
- Passed: ${handoff.testingState.testResults.passed}
- Failed: ${handoff.testingState.testResults.failed}
- Skipped: ${handoff.testingState.testResults.skipped}
${handoff.testingState.coveragePercentage ? `- Coverage: ${handoff.testingState.coveragePercentage}%` : ''}
`
  : ''
}${handoff.testingState.failingTests && handoff.testingState.failingTests.length > 0
  ? `**Failing Tests:**\n${handoff.testingState.failingTests.map(t => `- ${t.name} (${t.file})\n  Error: ${t.error}`).join('\n')}\n`
  : ''
}`
  : '*No testing state recorded*'
}

---

## Recommendations for Next Agent

${handoff.recommendations && handoff.recommendations.length > 0
  ? handoff.recommendations.map((r, i) => `
### ${i + 1}. [${r.priority?.toUpperCase() || 'MEDIUM'}] ${r.recommendation}

${r.reasoning ? `**Reasoning:** ${r.reasoning}` : ''}
`).join('\n')
  : '*No recommendations provided*'
}

---

## Resource References

${handoff.resourceReferences && Object.keys(handoff.resourceReferences).length > 0
  ? `
${handoff.resourceReferences.documentation && handoff.resourceReferences.documentation.length > 0
  ? `**Documentation:**\n${handoff.resourceReferences.documentation.map(d => `- ${d}`).join('\n')}\n`
  : ''
}${handoff.resourceReferences.apis && handoff.resourceReferences.apis.length > 0
  ? `**APIs:**\n${handoff.resourceReferences.apis.map(a => `- ${a}`).join('\n')}\n`
  : ''
}${handoff.resourceReferences.databases && handoff.resourceReferences.databases.length > 0
  ? `**Databases:**\n${handoff.resourceReferences.databases.map(d => `- ${d}`).join('\n')}\n`
  : ''
}${handoff.resourceReferences.externalServices && handoff.resourceReferences.externalServices.length > 0
  ? `**External Services:**\n${handoff.resourceReferences.externalServices.map(s => `- ${s}`).join('\n')}\n`
  : ''
}${handoff.resourceReferences.relatedTickets && handoff.resourceReferences.relatedTickets.length > 0
  ? `**Related Tickets:**\n${handoff.resourceReferences.relatedTickets.map(t => `- ${t}`).join('\n')}\n`
  : ''
}`
  : '*No resource references*'
}

---

## Metrics

${handoff.metrics
  ? `
- **Total Tokens:** ${handoff.metrics.tokenUsage?.total || 0}
  - Input: ${handoff.metrics.tokenUsage?.input || 0}
  - Output: ${handoff.metrics.tokenUsage?.output || 0}
- **Total Requests:** ${handoff.metrics.requestCount || 0}
- **Cost Accumulated:** $${(handoff.metrics.costAccumulated || 0).toFixed(4)}
- **Session Duration:** ${handoff.metrics.sessionDuration ? this._formatDuration(handoff.metrics.sessionDuration) : 'N/A'}
- **Files Modified:** ${handoff.metrics.filesModifiedCount || 0}
- **Decisions Made:** ${handoff.metrics.decisionsCount || 0}
- **Tasks Completed:** ${handoff.metrics.tasksCompletedCount || 0}
- **Tasks Remaining:** ${handoff.metrics.tasksRemainingCount || 0}
`
  : '*No metrics available*'
}

---

## Next Steps

1. Review all remaining tasks and prioritize critical items
2. Address any blockers or critical issues before proceeding
3. Verify all completed work and run tests
4. Continue implementation following the context and recommendations above
5. Update this handoff document as work progresses

---

*Generated by Passbook Flora - Session Handoff System*
*Handoff ID: ${handoff._id || 'pending'}*
`;

    return markdown;
  }

  /**
   * Sanitize filename
   * @private
   */
  _sanitizeFilename(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Format trigger reason
   * @private
   */
  _formatTriggerReason(reason) {
    const reasons = {
      CONTEXT_CAP: 'Context Window Capacity (95%)',
      RATE_LIMIT: 'Rate Limit Threshold (95%)',
      COST_LIMIT: 'Cost Limit Reached',
      ERROR_THRESHOLD: 'Error Threshold Exceeded',
      MANUAL: 'Manual Handoff',
      TASK_COMPLETION: 'Task Completed'
    };
    return reasons[reason] || reason;
  }

  /**
   * Format agent type
   * @private
   */
  _formatAgentType(agentType) {
    const types = {
      backend_architect: 'Backend API Architect',
      frontend_engineer: 'Frontend Engineer',
      devops_engineer: 'DevOps Engineer',
      data_engineer: 'Data Engineer',
      qa_engineer: 'QA Engineer',
      general_assistant: 'General Assistant'
    };
    return types[agentType] || agentType;
  }

  /**
   * Format next steps
   * @private
   */
  _formatNextSteps(handoff) {
    const steps = [];

    if (handoff.issues && handoff.issues.length > 0) {
      const criticalIssues = handoff.issues.filter(i => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        steps.push(`1. 🚨 Address ${criticalIssues.length} critical issue(s) immediately`);
      }
    }

    if (handoff.remainingTasks && handoff.remainingTasks.length > 0) {
      const criticalTasks = handoff.remainingTasks.filter(t => t.priority === 'critical');
      const highTasks = handoff.remainingTasks.filter(t => t.priority === 'high');

      if (criticalTasks.length > 0) {
        steps.push(`${steps.length + 1}. ⚡ Complete ${criticalTasks.length} critical task(s)`);
      }
      if (highTasks.length > 0) {
        steps.push(`${steps.length + 1}. 📋 Work on ${highTasks.length} high-priority task(s)`);
      }
    }

    if (handoff.testingState?.testsPassing === false) {
      steps.push(`${steps.length + 1}. ✅ Fix failing tests before proceeding`);
    }

    if (steps.length === 0) {
      steps.push('1. Review the handoff document');
      steps.push('2. Continue with remaining tasks');
    }

    return steps.join('\n');
  }

  /**
   * Format duration
   * @private
   */
  _formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Export singleton instance
module.exports = new SessionHandoffService();
