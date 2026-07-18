/**
 * Command Center Microservice Configuration
 */

require('dotenv').config();

module.exports = {
  // Service configuration
  port: process.env.COMMAND_CENTER_PORT || 4000,
  environment: process.env.NODE_ENV || 'development',

  // MongoDB configuration
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/flora-command-center',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    }
  },

  // Redis configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0,
    retryStrategy: (times) => Math.min(times * 50, 2000)
  },

  // Neo4j configuration
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password'
  },

  // gRPC configuration
  grpc: {
    port: process.env.GRPC_PORT || 50051,
    host: process.env.GRPC_HOST || '0.0.0.0'
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://flora.platform'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-ID', 'X-User-ID']
  },

  // Security configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    jwtExpiration: process.env.JWT_EXPIRATION || '24h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10'),
    vaultMasterKey: process.env.VAULT_MASTER_KEY || 'change-this-master-key-in-production',
    enablePIIDetection: process.env.ENABLE_PII_DETECTION !== 'false',
    enableContextScoping: process.env.ENABLE_CONTEXT_SCOPING !== 'false'
  },

  // Data residency regions
  dataResidency: {
    defaultRegion: process.env.DEFAULT_REGION || 'us-east-1',
    gdprRegion: process.env.GDPR_REGION || 'eu-west-1',
    supportedRegions: [
      'us-east-1',
      'us-west-2',
      'eu-west-1',
      'eu-central-1',
      'ap-southeast-1',
      'ca-central-1'
    ]
  },

  // Vault configuration
  vault: {
    retentionDays: parseInt(process.env.VAULT_RETENTION_DAYS || '90'),
    encryptionAlgorithm: 'aes-256-gcm',
    compressThreshold: 1024 * 10 // Compress if larger than 10KB
  },

  // Zero Data Retention (ZDR) configuration
  zdr: {
    // ZDR tenant identifiers (comma-separated list)
    tenantIds: process.env.ZDR_TENANT_IDS ? process.env.ZDR_TENANT_IDS.split(',').filter(Boolean) : [],

    // Artifact TTL for non-ZDR tenants (hours)
    artifactTTLHours: parseInt(process.env.ARTIFACT_TTL_HOURS || '24'),

    // Purge job interval (minutes)
    purgeIntervalMinutes: parseInt(process.env.PURGE_INTERVAL_MINUTES || '60'),

    // Enable/disable artifact purge scheduling
    enableScheduledPurge: process.env.ENABLE_SCHEDULED_PURGE !== 'false',

    // Fail-closed routing for ZDR tenants
    routingFailClosed: process.env.ROUTING_FAIL_CLOSED === 'true'
  },

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100')
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    outputDir: process.env.LOG_DIR || './logs'
  },

  // Monitoring configuration
  monitoring: {
    enabled: process.env.MONITORING_ENABLED === 'true',
    prometheusPort: process.env.PROMETHEUS_PORT || 9090,
    openTelemetryEnabled: process.env.OTEL_ENABLED === 'true',
    openTelemetryEndpoint: process.env.OTEL_ENDPOINT
  },

  // Service discovery (for microservice architecture)
  serviceDiscovery: {
    enabled: process.env.SERVICE_DISCOVERY_ENABLED === 'true',
    consulHost: process.env.CONSUL_HOST || 'localhost',
    consulPort: process.env.CONSUL_PORT || 8500,
    serviceName: 'command-center',
    healthCheckInterval: '10s',
    deregisterAfter: '1m'
  },

  // Message queue configuration
  messageQueue: {
    enabled: process.env.MQ_ENABLED === 'true',
    type: process.env.MQ_TYPE || 'rabbitmq', // rabbitmq, kafka, redis-pubsub
    rabbitmq: {
      url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
      exchange: 'flora.command-center',
      queues: {
        requirements: 'command-center.requirements',
        specifications: 'command-center.specifications',
        deployments: 'command-center.deployments'
      }
    },
    kafka: {
      brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'],
      topics: {
        requirements: 'command-center-requirements',
        specifications: 'command-center-specifications',
        deployments: 'command-center-deployments'
      }
    }
  },

  // External service URLs
  externalServices: {
    workspaceServiceUrl: process.env.WORKSPACE_SERVICE_URL || 'http://localhost:4001',
    authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:4002',
    notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4003'
  },

  // RBAC Permissions (required by User model)
  PERMISSIONS: {
    'read:command-center': ['admin', 'gp', 'analyst'],
    'write:command-center': ['admin', 'gp'],
    'delete:command-center': ['admin']
  },

  // Security settings (required by User model)
  SECURITY: {
    BCRYPT_ROUNDS: 12,
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000 // 15 minutes
  },

  // JWT settings (required by User model)
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  JWT_EXPIRATION: process.env.JWT_EXPIRATION || '24h',
  REFRESH_TOKEN_EXPIRATION: process.env.REFRESH_TOKEN_EXPIRATION || '7d'
};