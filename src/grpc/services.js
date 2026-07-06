/**
 * gRPC Service Implementations for Command Center
 */

const logger = require('../utils/logger');
const knowledgeGraphService = require('../services/knowledgeGraphService');
const requirementExpansionService = require('../../../services/requirementExpansionService');
const contextBoundaryService = require('../../../services/contextBoundaryService');
const promptVaultService = require('../../../services/promptVaultService');
const dataResidencyService = require('../../../services/dataResidencyService');

/**
 * Expand a natural language requirement into structured format
 */
async function expandRequirement(call, callback) {
  try {
    const { requirement, context } = call.request;

    const expansion = await requirementExpansionService.expandRequirement(requirement, {
      companyId: context?.company_id,
      userId: context?.user_id,
      stackProfile: context?.stack_profile,
      industry: context?.industry,
      complianceRequirements: context?.compliance_requirements || [],
      techStack: context?.tech_stack || []
    });

    // Convert to gRPC response format
    const response = {
      structured: {
        title: expansion.structured.title,
        description: expansion.structured.description,
        functional_requirements: expansion.structured.functionalRequirements || [],
        non_functional_requirements: expansion.structured.nonFunctionalRequirements || [],
        actors: expansion.structured.actors || [],
        preconditions: expansion.structured.preconditions || [],
        postconditions: expansion.structured.postconditions || []
      },
      edge_cases: (expansion.edgeCases || []).map(ec => ({
        category: ec.category,
        scenario: ec.scenario,
        description: ec.description,
        expected_behavior: ec.expectedBehavior,
        priority: ec.priority
      })),
      security_requirements: (expansion.securityRequirements || []).map(sr => ({
        requirement: sr.requirement,
        category: sr.category,
        priority: sr.priority
      })),
      performance_requirements: {
        api: expansion.performanceRequirements?.api || {},
        database: expansion.performanceRequirements?.database || {},
        frontend: expansion.performanceRequirements?.frontend || {}
      },
      acceptance_criteria: (expansion.acceptanceCriteria || []).map(ac => ({
        given: ac.given,
        when: ac.when,
        then: ac.then
      })),
      test_scenarios: {
        unit: (expansion.testScenarios?.unit || []).map(t => ({ name: t, type: 'unit' })),
        integration: (expansion.testScenarios?.integration || []).map(t => ({ name: t, type: 'integration' })),
        e2e: (expansion.testScenarios?.e2e || []).map(t => ({ name: t, type: 'e2e' })),
        performance: (expansion.testScenarios?.performance || []).map(t => ({ name: t, type: 'performance' })),
        security: (expansion.testScenarios?.security || []).map(t => ({ name: t, type: 'security' }))
      },
      dependencies: expansion.dependencies || {
        internal: [],
        external: [],
        data: [],
        infrastructure: []
      },
      risks: (expansion.risks || []).map(r => ({
        type: r.type,
        description: r.description,
        severity: r.severity,
        mitigation: r.mitigation
      })),
      estimated_effort: {
        story_points: expansion.estimatedEffort?.storyPoints || 0,
        development_days: expansion.estimatedEffort?.developmentDays || 0,
        confidence: expansion.estimatedEffort?.confidence || 'medium'
      }
    };

    callback(null, response);
  } catch (error) {
    logger.error('gRPC expandRequirement error:', error);
    callback({
      code: grpc.status.INTERNAL,
      message: error.message
    });
  }
}

/**
 * Apply security context scoping to content
 */
async function scopeContext(call, callback) {
  try {
    const { company_id, content, operation } = call.request;

    const scoped = await contextBoundaryService.scopeContext(company_id, content, operation);

    callback(null, {
      scoped_content: scoped.scopedContent,
      original_length: scoped.originalLength,
      scoped_length: scoped.scopedLength,
      redaction_count: scoped.redactionCount,
      pii_detected: scoped.piiDetected,
      business_terms_redacted: scoped.businessTermsRedacted,
      warnings: scoped.warnings || []
    });
  } catch (error) {
    logger.error('gRPC scopeContext error:', error);
    callback({
      code: grpc.status.INTERNAL,
      message: error.message
    });
  }
}

/**
 * Store an LLM interaction in the vault
 */
async function storeInteraction(call, callback) {
  try {
    const interaction = await promptVaultService.storeInteraction(call.request);

    callback(null, {
      id: interaction._id.toString(),
      success: true,
      error: null
    });
  } catch (error) {
    logger.error('gRPC storeInteraction error:', error);
    callback(null, {
      id: null,
      success: false,
      error: error.message
    });
  }
}

/**
 * Get requirement traceability information
 */
async function getTraceability(call, callback) {
  try {
    const { requirement_id } = call.request;

    const traceability = await knowledgeGraphService.getRequirementTraceability(requirement_id);

    if (!traceability) {
      callback({
        code: grpc.status.NOT_FOUND,
        message: 'Requirement not found'
      });
      return;
    }

    // Convert dates to timestamps for gRPC
    const response = {
      requirement: {
        ...traceability.requirement,
        created_at: new Date(traceability.requirement.createdAt).getTime()
      },
      specification: traceability.specification ? {
        ...traceability.specification,
        content: JSON.stringify(traceability.specification.content),
        created_at: new Date(traceability.specification.createdAt).getTime()
      } : null,
      code: (traceability.code || []).map(c => ({
        ...c,
        created_at: new Date(c.createdAt).getTime()
      })),
      tests: (traceability.tests || []).map(t => ({
        ...t,
        created_at: new Date(t.createdAt).getTime()
      })),
      deployments: (traceability.deployments || []).map(d => ({
        ...d,
        deployed_at: new Date(d.deployedAt).getTime()
      }))
    };

    callback(null, response);
  } catch (error) {
    logger.error('gRPC getTraceability error:', error);
    callback({
      code: grpc.status.INTERNAL,
      message: error.message
    });
  }
}

/**
 * Get development metrics for a company
 */
async function getMetrics(call, callback) {
  try {
    const { company_id, start_date, end_date } = call.request;

    const metrics = await knowledgeGraphService.getDevelopmentMetrics(
      company_id,
      new Date(start_date),
      new Date(end_date)
    );

    const response = {
      period: {
        start_date,
        end_date
      },
      requirements: {
        total: metrics.requirements.total,
        completed: metrics.requirements.completed
      },
      specifications: metrics.specifications,
      code: metrics.code,
      tests: {
        total: metrics.tests.total,
        passed: metrics.tests.passed,
        average_coverage: metrics.tests.averageCoverage || 0,
        avg_unit_test_duration: metrics.tests.avgUnitTestDuration || 0
      },
      deployments: {
        total: metrics.deployments.total,
        successful: metrics.deployments.successful
      }
    };

    callback(null, response);
  } catch (error) {
    logger.error('gRPC getMetrics error:', error);
    callback({
      code: grpc.status.INTERNAL,
      message: error.message
    });
  }
}

/**
 * Create a new requirement node
 */
async function createRequirement(call, callback) {
  try {
    const requirement = await knowledgeGraphService.createRequirement(call.request);

    callback(null, {
      requirement: {
        ...requirement,
        created_at: new Date(requirement.createdAt).getTime()
      },
      success: true,
      error: null
    });
  } catch (error) {
    logger.error('gRPC createRequirement error:', error);
    callback(null, {
      requirement: null,
      success: false,
      error: error.message
    });
  }
}

/**
 * Create a new specification node
 */
async function createSpecification(call, callback) {
  try {
    const { requirement_id, specification } = call.request;

    const spec = await knowledgeGraphService.createSpecification(
      {
        ...specification,
        content: specification.content ? JSON.parse(specification.content) : {}
      },
      requirement_id
    );

    callback(null, {
      specification: {
        ...spec,
        content: JSON.stringify(spec.content),
        created_at: new Date(spec.createdAt).getTime()
      },
      success: true,
      error: null
    });
  } catch (error) {
    logger.error('gRPC createSpecification error:', error);
    callback(null, {
      specification: null,
      success: false,
      error: error.message
    });
  }
}

/**
 * Create a new code artifact node
 */
async function createCodeArtifact(call, callback) {
  try {
    const { specification_id, code } = call.request;

    const codeArtifact = await knowledgeGraphService.createCodeArtifact(code, specification_id);

    callback(null, {
      code: {
        ...codeArtifact,
        created_at: new Date(codeArtifact.createdAt).getTime()
      },
      success: true,
      error: null
    });
  } catch (error) {
    logger.error('gRPC createCodeArtifact error:', error);
    callback(null, {
      code: null,
      success: false,
      error: error.message
    });
  }
}

/**
 * Create a new test node
 */
async function createTest(call, callback) {
  try {
    const { code_id, test } = call.request;

    const testNode = await knowledgeGraphService.createTest(test, code_id);

    callback(null, {
      test: {
        ...testNode,
        created_at: new Date(testNode.createdAt).getTime()
      },
      success: true,
      error: null
    });
  } catch (error) {
    logger.error('gRPC createTest error:', error);
    callback(null, {
      test: null,
      success: false,
      error: error.message
    });
  }
}

/**
 * Create a new deployment node
 */
async function createDeployment(call, callback) {
  try {
    const { code_ids, deployment } = call.request;

    const deploymentNode = await knowledgeGraphService.createDeployment(deployment, code_ids);

    callback(null, {
      deployment: {
        ...deploymentNode,
        deployed_at: new Date(deploymentNode.deployedAt).getTime()
      },
      success: true,
      error: null
    });
  } catch (error) {
    logger.error('gRPC createDeployment error:', error);
    callback(null, {
      deployment: null,
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  expandRequirement,
  scopeContext,
  storeInteraction,
  getTraceability,
  getMetrics,
  createRequirement,
  createSpecification,
  createCodeArtifact,
  createTest,
  createDeployment
};