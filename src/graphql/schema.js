/**
 * GraphQL Schema for Command Center Microservice
 */

const { gql } = require('graphql');

const typeDefs = gql`
  scalar Date
  scalar JSON

  # Enums
  enum RequirementStatus {
    DRAFT
    EXPANDED
    VALIDATED
    APPROVED
    IN_DEVELOPMENT
    TESTING
    COMPLETED
    ARCHIVED
  }

  enum RequirementPriority {
    CRITICAL
    HIGH
    MEDIUM
    LOW
  }

  enum TestType {
    UNIT
    INTEGRATION
    E2E
    PERFORMANCE
    SECURITY
  }

  enum DeploymentEnvironment {
    DEVELOPMENT
    STAGING
    PRODUCTION
  }

  enum DataClassification {
    PUBLIC
    INTERNAL
    CONFIDENTIAL
    RESTRICTED
  }

  # Types
  type Requirement {
    id: ID!
    title: String!
    description: String
    status: RequirementStatus!
    priority: RequirementPriority!
    category: String
    companyId: String!
    createdBy: String!
    createdAt: Date!
    metadata: JSON
    specifications: [Specification]
    traceability: Traceability
  }

  type Specification {
    id: ID!
    title: String!
    content: JSON!
    status: String!
    version: Int!
    requirementId: String!
    createdAt: Date!
    metadata: JSON
    codeArtifacts: [CodeArtifact]
  }

  type CodeArtifact {
    id: ID!
    filePath: String!
    functionName: String
    language: String!
    linesOfCode: Int
    commitHash: String!
    author: String!
    createdAt: Date!
    tests: [Test]
    deployments: [Deployment]
  }

  type Test {
    id: ID!
    name: String!
    type: TestType!
    status: String!
    coverage: Float
    duration: Int
    testFile: String
    createdAt: Date!
    metadata: JSON
  }

  type Deployment {
    id: ID!
    version: String!
    environment: DeploymentEnvironment!
    status: String!
    deployedBy: String!
    deployedAt: Date!
    rollbackVersion: String
    metadata: JSON
  }

  type Traceability {
    requirementId: String!
    specifications: [Specification]
    code: [CodeArtifact]
    tests: [Test]
    deployments: [Deployment]
  }

  type RequirementExpansion {
    structured: StructuredRequirement!
    edgeCases: [EdgeCase]!
    securityRequirements: [SecurityRequirement]!
    performanceRequirements: PerformanceRequirements!
    acceptanceCriteria: [AcceptanceCriteria]!
    testScenarios: TestScenarios!
    dependencies: Dependencies!
    risks: [Risk]!
    estimatedEffort: EstimatedEffort!
  }

  type StructuredRequirement {
    title: String!
    description: String!
    functionalRequirements: [String]!
    nonFunctionalRequirements: [String]!
    actors: [String]!
    preconditions: [String]!
    postconditions: [String]!
    businessRules: [BusinessRule]!
    dataRequirements: [DataRequirement]!
    interfaceRequirements: [InterfaceRequirement]!
  }

  type EdgeCase {
    category: String!
    scenario: String!
    description: String!
    expectedBehavior: String!
    priority: String!
  }

  type SecurityRequirement {
    requirement: String!
    category: String!
    priority: String!
  }

  type PerformanceRequirements {
    api: APIPerformance
    database: DatabasePerformance
    frontend: FrontendPerformance
  }

  type APIPerformance {
    responseTime: String
    throughput: String
    errorRate: String
    availability: String
  }

  type DatabasePerformance {
    queryTime: String
    connectionPool: String
    indexing: String
    caching: String
  }

  type FrontendPerformance {
    initialLoad: String
    interactionDelay: String
    bundleSize: String
    lighthouse: String
  }

  type AcceptanceCriteria {
    given: String!
    when: String!
    then: String!
  }

  type TestScenarios {
    unit: [TestScenario]!
    integration: [TestScenario]!
    e2e: [TestScenario]!
    performance: [TestScenario]!
    security: [TestScenario]!
  }

  type TestScenario {
    name: String!
    type: String!
  }

  type BusinessRule {
    id: String!
    rule: String!
    validation: String!
  }

  type DataRequirement {
    entity: String!
    attributes: [String]!
    constraints: [String]!
  }

  type InterfaceRequirement {
    type: String!
    description: String!
    specifications: [String]!
  }

  type Dependencies {
    internal: [String]!
    external: [String]!
    data: [String]!
    infrastructure: [String]!
  }

  type Risk {
    type: String!
    description: String!
    severity: String!
    mitigation: String!
  }

  type EstimatedEffort {
    storyPoints: Int!
    developmentDays: Float!
    confidence: String!
  }

  type ScopedContent {
    scopedContent: String!
    originalLength: Int!
    scopedLength: Int!
    redactionCount: Int!
    piiDetected: Boolean!
    businessTermsRedacted: Int!
    warnings: [String]!
  }

  type VaultEntry {
    id: ID!
    requestId: String!
    companyId: String!
    userId: String!
    timestamp: Date!
    operation: String!
    model: String!
    tokenUsage: TokenUsage!
    cost: Float!
    security: SecurityMetadata!
  }

  type TokenUsage {
    promptTokens: Int!
    completionTokens: Int!
    totalTokens: Int!
  }

  type SecurityMetadata {
    scopingLevel: String!
    piiDetected: Boolean!
    redactionCount: Int!
    dataClassification: DataClassification!
  }

  type DevelopmentMetrics {
    period: Period!
    requirements: RequirementMetrics!
    specifications: Int!
    code: Int!
    tests: TestMetrics!
    deployments: DeploymentMetrics!
  }

  type Period {
    startDate: Date!
    endDate: Date!
  }

  type RequirementMetrics {
    total: Int!
    completed: Int!
  }

  type TestMetrics {
    total: Int!
    passed: Int!
    averageCoverage: Float
    avgUnitTestDuration: Float
  }

  type DeploymentMetrics {
    total: Int!
    successful: Int!
  }

  type ImpactAnalysis {
    requirementId: String!
    impact: Impact!
  }

  type Impact {
    specifications: Int!
    codeArtifacts: Int!
    tests: Int!
    deployments: Int!
    dependentRequirements: [String]!
  }

  type KnowledgeGraph {
    nodes: [GraphNode]!
    edges: [GraphEdge]!
  }

  type GraphNode {
    id: String!
    label: String!
    properties: JSON!
  }

  type GraphEdge {
    id: String!
    source: String!
    target: String!
    type: String!
    properties: JSON
  }

  # Input Types
  input RequirementInput {
    title: String!
    description: String
    priority: RequirementPriority
    category: String
    companyId: String!
    createdBy: String!
    metadata: JSON
  }

  input SpecificationInput {
    title: String!
    content: JSON!
    version: Int
    metadata: JSON
  }

  input CodeArtifactInput {
    filePath: String!
    functionName: String
    language: String!
    linesOfCode: Int
    commitHash: String!
    author: String!
    metadata: JSON
  }

  input TestInput {
    name: String!
    type: TestType!
    status: String
    coverage: Float
    duration: Int
    testFile: String
    metadata: JSON
  }

  input DeploymentInput {
    version: String!
    environment: DeploymentEnvironment!
    deployedBy: String!
    rollbackVersion: String
    metadata: JSON
  }

  input ExpansionContext {
    companyId: String!
    userId: String!
    stackProfile: String
    industry: String
    complianceRequirements: [String]
    techStack: [String]
  }

  # Queries
  type Query {
    # Requirements
    requirement(id: ID!): Requirement
    requirements(companyId: String!, status: RequirementStatus, limit: Int = 20): [Requirement]!

    # Requirement Expansion
    expandRequirement(requirement: String!, context: ExpansionContext): RequirementExpansion!

    # Traceability
    getTraceability(requirementId: String!): Traceability
    getImpactAnalysis(requirementId: String!): ImpactAnalysis

    # Metrics
    getDevelopmentMetrics(companyId: String!, startDate: Date!, endDate: Date!): DevelopmentMetrics!

    # Knowledge Graph
    getKnowledgeGraph(companyId: String!, limit: Int = 100): KnowledgeGraph!
    findUntestedRequirements(companyId: String!): [Requirement]!
    findOrphanCode(companyId: String!): [CodeArtifact]!

    # Security & Vault
    retrieveVaultEntry(id: ID!, companyId: String!): VaultEntry
    getVaultStats(companyId: String!, startDate: Date, endDate: Date): JSON

    # Data Residency
    getProcessingRegion(companyId: String!, dataClassification: DataClassification!): JSON
  }

  # Mutations
  type Mutation {
    # Requirements
    createRequirement(input: RequirementInput!): Requirement!
    updateRequirement(id: ID!, input: RequirementInput!): Requirement!
    deleteRequirement(id: ID!): Boolean!

    # Specifications
    createSpecification(requirementId: String!, input: SpecificationInput!): Specification!
    updateSpecification(id: ID!, input: SpecificationInput!): Specification!

    # Code Artifacts
    createCodeArtifact(specificationId: String!, input: CodeArtifactInput!): CodeArtifact!
    updateCodeArtifact(id: ID!, input: CodeArtifactInput!): CodeArtifact!

    # Tests
    createTest(codeId: String!, input: TestInput!): Test!
    updateTest(id: ID!, status: String!, results: JSON): Test!

    # Deployments
    createDeployment(codeIds: [String]!, input: DeploymentInput!): Deployment!
    updateDeployment(id: ID!, status: String!): Deployment!

    # Dependencies
    createDependency(fromRequirementId: String!, toRequirementId: String!, type: String!): Boolean!

    # Security
    scopeContent(companyId: String!, content: String!, operation: String!): ScopedContent!
    storeVaultEntry(
      companyId: String!
      userId: String!
      prompt: String!
      response: String!
      metadata: JSON!
    ): VaultEntry!
  }

  # Subscriptions
  type Subscription {
    requirementUpdated(companyId: String!): Requirement!
    deploymentStatusChanged(environment: DeploymentEnvironment!): Deployment!
    testCompleted(requirementId: String!): Test!
  }
`;

module.exports = typeDefs;