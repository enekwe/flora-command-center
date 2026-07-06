/**
 * Knowledge Graph Service
 * Manages relationships between requirements, specs, code, tests, and deployments
 * Part of CC-E4: Knowledge Graph & Zero-Drift Docs
 */

const neo4j = require('neo4j-driver');
const logger = require('../utils/logger');
const config = require('../config');

class KnowledgeGraphService {
  constructor() {
    this.driver = null;
    this.session = null;
  }

  /**
   * Initialize Neo4j connection
   */
  async initialize() {
    try {
      this.driver = neo4j.driver(
        config.neo4j.uri,
        neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
        {
          maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 2 * 60 * 1000, // 120 seconds
        }
      );

      // Verify connectivity
      await this.driver.verifyConnectivity();
      logger.info('Neo4j connection established');

      // Create constraints and indexes
      await this.createSchemaConstraints();

      return true;
    } catch (error) {
      logger.error('Failed to initialize Neo4j', { error: error.message });
      throw error;
    }
  }

  /**
   * Create schema constraints and indexes
   */
  async createSchemaConstraints() {
    const session = this.driver.session();

    try {
      // Create uniqueness constraints
      const constraints = [
        'CREATE CONSTRAINT requirement_id IF NOT EXISTS FOR (r:Requirement) REQUIRE r.id IS UNIQUE',
        'CREATE CONSTRAINT spec_id IF NOT EXISTS FOR (s:Specification) REQUIRE s.id IS UNIQUE',
        'CREATE CONSTRAINT code_id IF NOT EXISTS FOR (c:Code) REQUIRE c.id IS UNIQUE',
        'CREATE CONSTRAINT test_id IF NOT EXISTS FOR (t:Test) REQUIRE t.id IS UNIQUE',
        'CREATE CONSTRAINT deployment_id IF NOT EXISTS FOR (d:Deployment) REQUIRE d.id IS UNIQUE',
        'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
        'CREATE CONSTRAINT company_id IF NOT EXISTS FOR (co:Company) REQUIRE co.id IS UNIQUE'
      ];

      for (const constraint of constraints) {
        try {
          await session.run(constraint);
        } catch (e) {
          // Constraint might already exist
          if (!e.message.includes('already exists')) {
            logger.warn('Constraint creation warning', { constraint, error: e.message });
          }
        }
      }

      // Create indexes for performance
      const indexes = [
        'CREATE INDEX requirement_status IF NOT EXISTS FOR (r:Requirement) ON (r.status)',
        'CREATE INDEX spec_status IF NOT EXISTS FOR (s:Specification) ON (s.status)',
        'CREATE INDEX code_file IF NOT EXISTS FOR (c:Code) ON (c.filePath)',
        'CREATE INDEX test_type IF NOT EXISTS FOR (t:Test) ON (t.type)',
        'CREATE INDEX deployment_env IF NOT EXISTS FOR (d:Deployment) ON (d.environment)',
        'CREATE INDEX created_at IF NOT EXISTS FOR (n) ON (n.createdAt)'
      ];

      for (const index of indexes) {
        try {
          await session.run(index);
        } catch (e) {
          if (!e.message.includes('already exists')) {
            logger.warn('Index creation warning', { index, error: e.message });
          }
        }
      }

      logger.info('Neo4j schema constraints and indexes created');
    } finally {
      await session.close();
    }
  }

  /**
   * Create a requirement node
   */
  async createRequirement(requirement) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        CREATE (r:Requirement {
          id: $id,
          title: $title,
          description: $description,
          status: $status,
          priority: $priority,
          category: $category,
          companyId: $companyId,
          createdBy: $createdBy,
          createdAt: datetime($createdAt),
          metadata: $metadata
        })
        RETURN r
        `,
        {
          id: requirement.id,
          title: requirement.title,
          description: requirement.description,
          status: requirement.status || 'draft',
          priority: requirement.priority || 'medium',
          category: requirement.category || 'functional',
          companyId: requirement.companyId,
          createdBy: requirement.createdBy,
          createdAt: new Date().toISOString(),
          metadata: JSON.stringify(requirement.metadata || {})
        }
      );

      return result.records[0].get('r').properties;
    } catch (error) {
      logger.error('Error creating requirement node', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Create a specification node linked to requirement
   */
  async createSpecification(spec, requirementId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (r:Requirement {id: $requirementId})
        CREATE (s:Specification {
          id: $id,
          title: $title,
          content: $content,
          status: $status,
          version: $version,
          createdAt: datetime($createdAt),
          metadata: $metadata
        })
        CREATE (r)-[:SPECIFIES]->(s)
        RETURN s, r
        `,
        {
          requirementId,
          id: spec.id,
          title: spec.title,
          content: JSON.stringify(spec.content),
          status: spec.status || 'draft',
          version: spec.version || 1,
          createdAt: new Date().toISOString(),
          metadata: JSON.stringify(spec.metadata || {})
        }
      );

      return result.records[0].get('s').properties;
    } catch (error) {
      logger.error('Error creating specification node', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Create code node linked to specification
   */
  async createCodeArtifact(code, specId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (s:Specification {id: $specId})
        CREATE (c:Code {
          id: $id,
          filePath: $filePath,
          functionName: $functionName,
          language: $language,
          linesOfCode: $linesOfCode,
          commitHash: $commitHash,
          author: $author,
          createdAt: datetime($createdAt),
          metadata: $metadata
        })
        CREATE (s)-[:IMPLEMENTS]->(c)
        RETURN c, s
        `,
        {
          specId,
          id: code.id,
          filePath: code.filePath,
          functionName: code.functionName || '',
          language: code.language,
          linesOfCode: code.linesOfCode || 0,
          commitHash: code.commitHash,
          author: code.author,
          createdAt: new Date().toISOString(),
          metadata: JSON.stringify(code.metadata || {})
        }
      );

      return result.records[0].get('c').properties;
    } catch (error) {
      logger.error('Error creating code node', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Create test node linked to code
   */
  async createTest(test, codeId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (c:Code {id: $codeId})
        CREATE (t:Test {
          id: $id,
          name: $name,
          type: $type,
          status: $status,
          coverage: $coverage,
          duration: $duration,
          testFile: $testFile,
          createdAt: datetime($createdAt),
          metadata: $metadata
        })
        CREATE (c)-[:TESTS]->(t)
        RETURN t, c
        `,
        {
          codeId,
          id: test.id,
          name: test.name,
          type: test.type || 'unit',
          status: test.status || 'pending',
          coverage: test.coverage || 0,
          duration: test.duration || 0,
          testFile: test.testFile,
          createdAt: new Date().toISOString(),
          metadata: JSON.stringify(test.metadata || {})
        }
      );

      return result.records[0].get('t').properties;
    } catch (error) {
      logger.error('Error creating test node', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Create deployment node
   */
  async createDeployment(deployment, codeIds) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        CREATE (d:Deployment {
          id: $id,
          version: $version,
          environment: $environment,
          status: $status,
          deployedBy: $deployedBy,
          deployedAt: datetime($deployedAt),
          rollbackVersion: $rollbackVersion,
          metadata: $metadata
        })
        WITH d
        UNWIND $codeIds AS codeId
        MATCH (c:Code {id: codeId})
        CREATE (c)-[:DEPLOYED_IN]->(d)
        RETURN d
        `,
        {
          id: deployment.id,
          version: deployment.version,
          environment: deployment.environment,
          status: deployment.status || 'pending',
          deployedBy: deployment.deployedBy,
          deployedAt: new Date().toISOString(),
          rollbackVersion: deployment.rollbackVersion || null,
          metadata: JSON.stringify(deployment.metadata || {}),
          codeIds
        }
      );

      return result.records[0].get('d').properties;
    } catch (error) {
      logger.error('Error creating deployment node', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Query: Get full traceability chain for a requirement
   */
  async getRequirementTraceability(requirementId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH path = (r:Requirement {id: $requirementId})-[:SPECIFIES]->
                     (s:Specification)-[:IMPLEMENTS]->
                     (c:Code)-[:TESTS]->
                     (t:Test)
        OPTIONAL MATCH (c)-[:DEPLOYED_IN]->(d:Deployment)
        RETURN r, s, collect(DISTINCT c) as code,
               collect(DISTINCT t) as tests,
               collect(DISTINCT d) as deployments
        `,
        { requirementId }
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        requirement: record.get('r').properties,
        specification: record.get('s').properties,
        code: record.get('code').map(c => c.properties),
        tests: record.get('tests').map(t => t.properties),
        deployments: record.get('deployments').map(d => d.properties)
      };
    } catch (error) {
      logger.error('Error getting requirement traceability', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Query: Find requirements without tests
   */
  async findUntestedRequirements(companyId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (r:Requirement {companyId: $companyId})
        WHERE NOT EXISTS {
          MATCH (r)-[:SPECIFIES]->(:Specification)-[:IMPLEMENTS]->
                (:Code)-[:TESTS]->(:Test {status: 'passed'})
        }
        RETURN r
        ORDER BY r.priority DESC, r.createdAt DESC
        `,
        { companyId }
      );

      return result.records.map(record => record.get('r').properties);
    } catch (error) {
      logger.error('Error finding untested requirements', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Query: Find code without requirements
   */
  async findOrphanCode(companyId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (c:Code)
        WHERE NOT EXISTS {
          MATCH (:Requirement {companyId: $companyId})-[:SPECIFIES]->
                (:Specification)-[:IMPLEMENTS]->(c)
        }
        RETURN c
        ORDER BY c.createdAt DESC
        `,
        { companyId }
      );

      return result.records.map(record => record.get('c').properties);
    } catch (error) {
      logger.error('Error finding orphan code', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Query: Impact analysis - what would be affected by a requirement change
   */
  async getImpactAnalysis(requirementId) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (r:Requirement {id: $requirementId})
        OPTIONAL MATCH (r)-[:SPECIFIES]->(s:Specification)
        OPTIONAL MATCH (s)-[:IMPLEMENTS]->(c:Code)
        OPTIONAL MATCH (c)-[:TESTS]->(t:Test)
        OPTIONAL MATCH (c)-[:DEPLOYED_IN]->(d:Deployment)
        OPTIONAL MATCH (r2:Requirement)-[:DEPENDS_ON]->(r)
        RETURN
          count(DISTINCT s) as specifications,
          count(DISTINCT c) as codeArtifacts,
          count(DISTINCT t) as tests,
          count(DISTINCT d) as deployments,
          collect(DISTINCT r2.id) as dependentRequirements
        `,
        { requirementId }
      );

      const record = result.records[0];
      return {
        requirementId,
        impact: {
          specifications: record.get('specifications').toNumber(),
          codeArtifacts: record.get('codeArtifacts').toNumber(),
          tests: record.get('tests').toNumber(),
          deployments: record.get('deployments').toNumber(),
          dependentRequirements: record.get('dependentRequirements')
        }
      };
    } catch (error) {
      logger.error('Error getting impact analysis', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Query: Get development metrics
   */
  async getDevelopmentMetrics(companyId, startDate, endDate) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (r:Requirement {companyId: $companyId})
        WHERE r.createdAt >= datetime($startDate)
          AND r.createdAt <= datetime($endDate)

        OPTIONAL MATCH (r)-[:SPECIFIES]->(s:Specification)
        OPTIONAL MATCH (s)-[:IMPLEMENTS]->(c:Code)
        OPTIONAL MATCH (c)-[:TESTS]->(t:Test)
        OPTIONAL MATCH (c)-[:DEPLOYED_IN]->(d:Deployment)

        RETURN
          count(DISTINCT r) as totalRequirements,
          count(DISTINCT s) as totalSpecifications,
          count(DISTINCT c) as totalCode,
          count(DISTINCT t) as totalTests,
          count(DISTINCT d) as totalDeployments,

          count(DISTINCT CASE WHEN r.status = 'completed' THEN r END) as completedRequirements,
          count(DISTINCT CASE WHEN t.status = 'passed' THEN t END) as passedTests,
          count(DISTINCT CASE WHEN d.status = 'success' THEN d END) as successfulDeployments,

          avg(t.coverage) as averageTestCoverage,
          avg(CASE WHEN t.type = 'unit' THEN t.duration END) as avgUnitTestDuration
        `,
        {
          companyId,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        }
      );

      const record = result.records[0];
      return {
        period: { startDate, endDate },
        requirements: {
          total: record.get('totalRequirements').toNumber(),
          completed: record.get('completedRequirements').toNumber()
        },
        specifications: record.get('totalSpecifications').toNumber(),
        code: record.get('totalCode').toNumber(),
        tests: {
          total: record.get('totalTests').toNumber(),
          passed: record.get('passedTests').toNumber(),
          averageCoverage: record.get('averageTestCoverage'),
          avgUnitTestDuration: record.get('avgUnitTestDuration')
        },
        deployments: {
          total: record.get('totalDeployments').toNumber(),
          successful: record.get('successfulDeployments').toNumber()
        }
      };
    } catch (error) {
      logger.error('Error getting development metrics', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Create a dependency relationship between requirements
   */
  async createDependency(fromRequirementId, toRequirementId, dependencyType = 'DEPENDS_ON') {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (r1:Requirement {id: $fromId})
        MATCH (r2:Requirement {id: $toId})
        CREATE (r1)-[d:${dependencyType} {
          createdAt: datetime($createdAt),
          type: $type
        }]->(r2)
        RETURN r1, r2, d
        `,
        {
          fromId: fromRequirementId,
          toId: toRequirementId,
          type: dependencyType,
          createdAt: new Date().toISOString()
        }
      );

      return {
        from: result.records[0].get('r1').properties,
        to: result.records[0].get('r2').properties,
        relationship: dependencyType
      };
    } catch (error) {
      logger.error('Error creating dependency', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get the full knowledge graph for visualization
   */
  async getKnowledgeGraph(companyId, limit = 100) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (r:Requirement {companyId: $companyId})
        WITH r
        LIMIT $limit

        OPTIONAL MATCH (r)-[rs:SPECIFIES]->(s:Specification)
        OPTIONAL MATCH (s)-[si:IMPLEMENTS]->(c:Code)
        OPTIONAL MATCH (c)-[ct:TESTS]->(t:Test)
        OPTIONAL MATCH (c)-[cd:DEPLOYED_IN]->(d:Deployment)
        OPTIONAL MATCH (r)-[rd:DEPENDS_ON]->(r2:Requirement)

        WITH collect(DISTINCT r) + collect(DISTINCT s) + collect(DISTINCT c) +
             collect(DISTINCT t) + collect(DISTINCT d) + collect(DISTINCT r2) as nodes,
             collect(DISTINCT rs) + collect(DISTINCT si) + collect(DISTINCT ct) +
             collect(DISTINCT cd) + collect(DISTINCT rd) as relationships

        RETURN nodes, relationships
        `,
        {
          companyId,
          limit: neo4j.int(limit)
        }
      );

      if (result.records.length === 0) {
        return { nodes: [], edges: [] };
      }

      const record = result.records[0];
      const nodes = record.get('nodes').map(node => ({
        id: node.properties.id,
        label: node.labels[0],
        properties: node.properties
      }));

      const relationships = record.get('relationships').map(rel => ({
        id: rel.identity.toString(),
        source: rel.startNodeElementId,
        target: rel.endNodeElementId,
        type: rel.type,
        properties: rel.properties
      }));

      return { nodes, edges: relationships };
    } catch (error) {
      logger.error('Error getting knowledge graph', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Clean up and close connections
   */
  async cleanup() {
    if (this.driver) {
      await this.driver.close();
      logger.info('Neo4j connection closed');
    }
  }
}

module.exports = new KnowledgeGraphService();