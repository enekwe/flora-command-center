/**
 * Context Optimization Service
 *
 * Automatically manages LLM context windows by:
 * 1. Monitoring chat token usage
 * 2. Distilling conversations at 50% context capacity
 * 3. Auto-generating skills.md files from chat history
 * 4. Managing master/context-specific skills routing (5% threshold)
 */

const fs = require('fs').promises;
const path = require('path');

// PAL is now available in the microservice
const { getPAL } = require('./providerAbstractionLayer');

class ContextOptimizationService {
  constructor() {
    this.pal = null;
    this.contextThreshold = 0.5; // 50% of context window
    this.skillsThreshold = 0.05; // 5% of context window
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      this.pal = getPAL();
      await this.pal.initialize();
      console.log('Context Optimization Service initialized with PAL');
    } catch (error) {
      console.warn('Failed to initialize PAL:', error.message);
      console.warn('Context optimization will work for non-AI features');
      this.pal = null;
    }
    this.initialized = true;
  }

  /**
   * Calculate approximate token count for text
   * Using rough estimate: 1 token ≈ 4 characters
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if chat should be distilled
   * @param {Array} chatHistory - Array of chat messages
   * @param {number} maxContextTokens - Maximum context window size
   * @returns {boolean}
   */
  shouldDistill(chatHistory, maxContextTokens) {
    const totalTokens = chatHistory.reduce((sum, msg) => {
      return sum + this.estimateTokens(msg.content || '');
    }, 0);

    const percentUsed = totalTokens / maxContextTokens;
    return percentUsed >= this.contextThreshold;
  }

  /**
   * Distill chat history into concise skills/knowledge
   * @param {Array} chatHistory - Array of chat messages
   * @param {string} provider - LLM provider (qwen, glm, deepseek, anthropic, openai, gemini)
   * @returns {Promise<string>} Distilled content for skills.md
   */
  async distillChat(chatHistory, provider = 'qwen') {
    await this.ensureInitialized();

    if (!this.pal) {
      throw new Error(
        'PAL (Provider Abstraction Layer) is not initialized. ' +
        'AI-powered chat distillation requires PAL to be configured. ' +
        'Please check your provider configurations and ensure MongoDB is connected.'
      );
    }

    // Build context from chat history
    const chatText = chatHistory
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n\n');

    // Use PAL to distill the conversation
    const response = await this.pal.callModel('distill-conversation', {
      variables: {
        conversation: chatText,
        focusAreas: [
          'Technical decisions and rationale',
          'Architecture patterns',
          'Best practices discovered',
          'Common pitfalls to avoid',
          'Useful code patterns',
          'Configuration guidelines',
        ].join(', '),
      },
    }, {
      provider,
      temperature: 0.3, // Lower temperature for focused distillation
      maxTokens: 4000,
    });

    return response.content;
  }

  /**
   * Generate or update skills.md file
   * @param {string} siteId - Site identifier
   * @param {string} distilledContent - Distilled chat content
   * @param {string} skillsDirectory - Path to skills directory
   */
  async updateSkillsFile(siteId, distilledContent, skillsDirectory) {
    const skillsPath = path.join(skillsDirectory, `site-${siteId}-skills.md`);

    try {
      // Check if file exists
      const exists = await this.fileExists(skillsPath);

      if (exists) {
        // Append to existing file with timestamp
        const timestamp = new Date().toISOString();
        const appendContent = `\n\n---\n\n## Updated: ${timestamp}\n\n${distilledContent}`;

        await fs.appendFile(skillsPath, appendContent, 'utf8');
      } else {
        // Create new file
        const initialContent = `# Skills & Knowledge - Site ${siteId}\n\nAuto-generated from chat distillation.\n\n**Last Updated:** ${new Date().toISOString()}\n\n---\n\n${distilledContent}`;

        await fs.writeFile(skillsPath, initialContent, 'utf8');
      }

      return skillsPath;
    } catch (error) {
      console.error('Error updating skills file:', error);
      throw error;
    }
  }

  /**
   * Check if skills.md file exceeds 5% of context window
   * @param {string} skillsPath - Path to skills file
   * @param {number} maxContextTokens - Maximum context window size
   * @returns {Promise<boolean>}
   */
  async skillsExceedsThreshold(skillsPath, maxContextTokens) {
    try {
      const content = await fs.readFile(skillsPath, 'utf8');
      const tokens = this.estimateTokens(content);
      const percentUsed = tokens / maxContextTokens;

      return percentUsed > this.skillsThreshold;
    } catch (error) {
      // File doesn't exist or can't be read
      return false;
    }
  }

  /**
   * Create master skills.md with index
   * @param {string} siteId - Site identifier
   * @param {string} skillsDirectory - Path to skills directory
   * @returns {Promise<string>} Path to master skills file
   */
  async createMasterSkills(siteId, skillsDirectory) {
    const masterPath = path.join(skillsDirectory, `site-${siteId}-master-skills.md`);
    const skillsPath = path.join(skillsDirectory, `site-${siteId}-skills.md`);

    try {
      // Read existing skills content
      const skillsContent = await fs.readFile(skillsPath, 'utf8');

      // Extract sections for categorization (simple approach)
      const sections = this.extractSections(skillsContent);

      // Create master index
      const masterContent = `# Master Skills Index - Site ${siteId}\n\nThis is the master index for context-specific skills.\n\n**Last Updated:** ${new Date().toISOString()}\n\n## Context Categories\n\n${sections.map((section, index) => {
        const contextFile = `site-${siteId}-skills-context-${index + 1}.md`;
        return `### ${section.title}\n- **File:** \`${contextFile}\`\n- **Priority:** ${section.priority || 'normal'}\n- **Topics:** ${section.topics || 'General'}\n`;
      }).join('\n')}\n\n## Routing Rules\n\n1. Check user query keywords against context categories\n2. Load relevant context-specific skills file\n3. Fall back to general skills if no specific match\n\n## Usage\n\nWhen context window approaches capacity, reference only the relevant context-specific skills file instead of loading all skills.\n`;

      await fs.writeFile(masterPath, masterContent, 'utf8');

      // Split original skills into context-specific files
      await this.splitSkillsIntoContexts(siteId, sections, skillsDirectory);

      return masterPath;
    } catch (error) {
      console.error('Error creating master skills:', error);
      throw error;
    }
  }

  /**
   * Extract sections from skills content
   * @param {string} content - Skills file content
   * @returns {Array} Array of section objects
   */
  extractSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = null;

    for (const line of lines) {
      // Detect section headers (## or ###)
      if (line.startsWith('## ') || line.startsWith('### ')) {
        if (currentSection) {
          sections.push(currentSection);
        }

        const title = line.replace(/^##+ /, '').trim();
        currentSection = {
          title,
          content: [],
          priority: 'normal',
          topics: title,
        };
      } else if (currentSection) {
        currentSection.content.push(line);
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Split skills into context-specific files
   * @param {string} siteId - Site identifier
   * @param {Array} sections - Extracted sections
   * @param {string} skillsDirectory - Path to skills directory
   */
  async splitSkillsIntoContexts(siteId, sections, skillsDirectory) {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const contextPath = path.join(
        skillsDirectory,
        `site-${siteId}-skills-context-${i + 1}.md`
      );

      const content = `# ${section.title}\n\n**Priority:** ${section.priority}\n**Topics:** ${section.topics}\n\n${section.content.join('\n')}`;

      await fs.writeFile(contextPath, content, 'utf8');
    }
  }

  /**
   * Get relevant context skills based on query
   * @param {string} siteId - Site identifier
   * @param {string} query - User query
   * @param {string} skillsDirectory - Path to skills directory
   * @returns {Promise<string>} Relevant skills content
   */
  async getRelevantSkills(siteId, query, skillsDirectory) {
    const masterPath = path.join(skillsDirectory, `site-${siteId}-master-skills.md`);

    try {
      // Check if master skills exists
      const hasMaster = await this.fileExists(masterPath);

      if (!hasMaster) {
        // Use regular skills file
        const skillsPath = path.join(skillsDirectory, `site-${siteId}-skills.md`);
        return await fs.readFile(skillsPath, 'utf8');
      }

      // Read master index
      const masterContent = await fs.readFile(masterPath, 'utf8');

      // Simple keyword matching to find relevant context
      // (In production, you might use embeddings or more sophisticated matching)
      const contextFiles = this.extractContextFiles(masterContent, query);

      if (contextFiles.length === 0) {
        // Return general skills if no specific match
        const skillsPath = path.join(skillsDirectory, `site-${siteId}-skills.md`);
        return await fs.readFile(skillsPath, 'utf8');
      }

      // Load relevant context files
      const contexts = await Promise.all(
        contextFiles.map(async (file) => {
          const filePath = path.join(skillsDirectory, file);
          return await fs.readFile(filePath, 'utf8');
        })
      );

      return contexts.join('\n\n---\n\n');
    } catch (error) {
      console.error('Error getting relevant skills:', error);
      throw error;
    }
  }

  /**
   * Extract context file names based on query
   * @param {string} masterContent - Master skills content
   * @param {string} query - User query
   * @returns {Array<string>} Relevant context file names
   */
  extractContextFiles(masterContent, query) {
    // Simple keyword extraction from query
    const queryKeywords = query.toLowerCase().split(/\s+/);

    // Extract sections from master
    const sections = masterContent.match(/### .+\n- \*\*File:\*\* `(.+)`\n- \*\*Priority:\*\* .+\n- \*\*Topics:\*\* (.+)/g) || [];

    const relevantFiles = [];

    for (const section of sections) {
      const fileMatch = section.match(/`([^`]+)`/);
      const topicsMatch = section.match(/\*\*Topics:\*\* (.+)/);

      if (fileMatch && topicsMatch) {
        const fileName = fileMatch[1];
        const topics = topicsMatch[1].toLowerCase();

        // Check if any query keyword matches topics
        const hasMatch = queryKeywords.some(keyword =>
          topics.includes(keyword) && keyword.length > 3
        );

        if (hasMatch) {
          relevantFiles.push(fileName);
        }
      }
    }

    return relevantFiles;
  }

  /**
   * Check if file exists
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>}
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure service is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Main workflow: Monitor and optimize context
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} Optimization result
   */
  async optimizeContext(options) {
    const {
      siteId,
      chatHistory,
      maxContextTokens,
      provider = 'qwen',
      skillsDirectory,
    } = options;

    await this.ensureInitialized();

    const result = {
      distilled: false,
      masterCreated: false,
      skillsPath: null,
      masterPath: null,
    };

    // Check if distillation is needed
    if (this.shouldDistill(chatHistory, maxContextTokens)) {
      console.log(`Context threshold reached for site ${siteId}. Starting distillation...`);

      // Distill chat
      const distilledContent = await this.distillChat(chatHistory, provider);

      // Update skills file
      result.skillsPath = await this.updateSkillsFile(siteId, distilledContent, skillsDirectory);
      result.distilled = true;

      console.log(`Skills file updated: ${result.skillsPath}`);

      // Check if skills file exceeds 5% threshold
      const exceedsThreshold = await this.skillsExceedsThreshold(result.skillsPath, maxContextTokens);

      if (exceedsThreshold) {
        console.log(`Skills file exceeds 5% threshold. Creating master index...`);

        // Create master skills with context routing
        result.masterPath = await this.createMasterSkills(siteId, skillsDirectory);
        result.masterCreated = true;

        console.log(`Master skills created: ${result.masterPath}`);
      }
    }

    return result;
  }
}

module.exports = new ContextOptimizationService();
