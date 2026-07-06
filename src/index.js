/**
 * Flora Command Center Microservice
 * Main entry point for the standalone Command Center service
 */

const express = require('express');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const redis = require('redis');
const { promisify } = require('util');
const winston = require('winston');
const prometheusClient = require('prom-client');

// Import services
const knowledgeGraphService = require('./services/knowledgeGraphService');
const requirementExpansionService = require('../../services/requirementExpansionService');
const contextBoundaryService = require('../../services/contextBoundaryService');
const promptVaultService = require('../../services/promptVaultService');
const dataResidencyService = require('../../services/dataResidencyService');

// Import GraphQL schema and resolvers
const typeDefs = require('./graphql/schema');
const resolvers = require('./graphql/resolvers');

// Import gRPC service implementations
const grpcServices = require('./grpc/services');

// Configuration
const config = require('./config');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Prometheus metrics
const collectDefaultMetrics = prometheusClient.collectDefaultMetrics;
collectDefaultMetrics();

// Custom metrics
const httpRequestDuration = new prometheusClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status']
});

const grpcRequestDuration = new prometheusClient.Histogram({
  name: 'grpc_request_duration_ms',
  help: 'Duration of gRPC requests in ms',
  labelNames: ['method', 'status']
});

class CommandCenterMicroservice {
  constructor() {
    this.app = express();
    this.apolloServer = null;
    this.grpcServer = null;
    this.redisClient = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize all services and connections
   */
  async initialize() {
    try {
      logger.info('Initializing Command Center Microservice...');

      // Connect to MongoDB
      await this.connectMongoDB();

      // Connect to Redis
      await this.connectRedis();

      // Initialize Neo4j for knowledge graph
      await knowledgeGraphService.initialize();

      // Setup Express middleware
      this.setupExpressMiddleware();

      // Setup REST API routes
      this.setupRESTRoutes();

      // Setup GraphQL server
      await this.setupGraphQL();

      // Setup gRPC server
      await this.setupGRPC();

      // Setup health check endpoint
      this.setupHealthCheck();

      // Setup metrics endpoint
      this.setupMetrics();

      logger.info('Command Center Microservice initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Command Center Microservice', error);
      throw error;
    }
  }

  /**
   * Connect to MongoDB
   */
  async connectMongoDB() {
    try {
      await mongoose.connect(config.mongodb.uri, config.mongodb.options);
      logger.info('Connected to MongoDB');
    } catch (error) {
      logger.error('MongoDB connection error:', error);
      throw error;
    }
  }

  /**
   * Connect to Redis
   */
  async connectRedis() {
    try {
      this.redisClient = redis.createClient(config.redis);

      this.redisClient.on('error', (err) => {
        logger.error('Redis Client Error', err);
      });

      await this.redisClient.connect();

      // Promisify Redis commands for easier use
      this.redis = {
        get: promisify(this.redisClient.get).bind(this.redisClient),
        set: promisify(this.redisClient.set).bind(this.redisClient),
        del: promisify(this.redisClient.del).bind(this.redisClient),
        exists: promisify(this.redisClient.exists).bind(this.redisClient),
        expire: promisify(this.redisClient.expire).bind(this.redisClient)
      };

      logger.info('Connected to Redis');
    } catch (error) {
      logger.error('Redis connection error:', error);
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  setupExpressMiddleware() {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS
    this.app.use(cors(config.cors));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);

    // Request logging
    this.app.use((req, res, next) => {
      const startTime = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        httpRequestDuration.observe(
          { method: req.method, route: req.route?.path || req.path, status: res.statusCode },
          duration
        );

        logger.info('HTTP Request', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${duration}ms`
        });
      });

      next();
    });
  }

  /**
   * Setup REST API routes
   */
  setupRESTRoutes() {
    const router = express.Router();

    // Requirements API
    router.post('/api/v1/requirements/expand', async (req, res) => {
      try {
        const { requirement, context } = req.body;
        const expansion = await requirementExpansionService.expandRequirement(requirement, context);
        res.json({ success: true, data: expansion });
      } catch (error) {
        logger.error('Error expanding requirement:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Security API
    router.post('/api/v1/security/scope', async (req, res) => {
      try {
        const { companyId, content, operation } = req.body;
        const scoped = await contextBoundaryService.scopeContext(companyId, content, operation);
        res.json({ success: true, data: scoped });
      } catch (error) {
        logger.error('Error scoping content:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Vault API
    router.post('/api/v1/vault/store', async (req, res) => {
      try {
        const interaction = await promptVaultService.storeInteraction(req.body);
        res.json({ success: true, data: { id: interaction._id } });
      } catch (error) {
        logger.error('Error storing interaction:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.get('/api/v1/vault/retrieve/:id', async (req, res) => {
      try {
        const interaction = await promptVaultService.retrieveInteraction(req.params.id, req.query.companyId);
        res.json({ success: true, data: interaction });
      } catch (error) {
        logger.error('Error retrieving interaction:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Data Residency API
    router.get('/api/v1/residency/region/:companyId', async (req, res) => {
      try {
        const region = await dataResidencyService.determineProcessingRegion(
          req.params.companyId,
          req.query.dataClassification
        );
        res.json({ success: true, data: region });
      } catch (error) {
        logger.error('Error determining region:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Knowledge Graph API
    router.post('/api/v1/graph/requirement', async (req, res) => {
      try {
        const requirement = await knowledgeGraphService.createRequirement(req.body);
        res.json({ success: true, data: requirement });
      } catch (error) {
        logger.error('Error creating requirement node:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.get('/api/v1/graph/traceability/:requirementId', async (req, res) => {
      try {
        const traceability = await knowledgeGraphService.getRequirementTraceability(req.params.requirementId);
        res.json({ success: true, data: traceability });
      } catch (error) {
        logger.error('Error getting traceability:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.get('/api/v1/graph/metrics/:companyId', async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const metrics = await knowledgeGraphService.getDevelopmentMetrics(
          req.params.companyId,
          new Date(startDate),
          new Date(endDate)
        );
        res.json({ success: true, data: metrics });
      } catch (error) {
        logger.error('Error getting metrics:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.use(router);
  }

  /**
   * Setup GraphQL server
   */
  async setupGraphQL() {
    this.apolloServer = new ApolloServer({
      typeDefs,
      resolvers,
      context: ({ req }) => ({
        user: req.user,
        services: {
          knowledgeGraph: knowledgeGraphService,
          requirementExpansion: requirementExpansionService,
          contextBoundary: contextBoundaryService,
          promptVault: promptVaultService,
          dataResidency: dataResidencyService
        }
      })
    });

    await this.apolloServer.start();

    this.app.use(
      '/graphql',
      expressMiddleware(this.apolloServer, {
        context: async ({ req }) => ({
          user: req.user,
          services: {
            knowledgeGraph: knowledgeGraphService,
            requirementExpansion: requirementExpansionService,
            contextBoundary: contextBoundaryService,
            promptVault: promptVaultService,
            dataResidency: dataResidencyService
          }
        })
      })
    );

    logger.info('GraphQL server setup complete');
  }

  /**
   * Setup gRPC server
   */
  async setupGRPC() {
    const PROTO_PATH = __dirname + '/grpc/command_center.proto';

    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });

    const commandCenterProto = grpc.loadPackageDefinition(packageDefinition).commandcenter;

    this.grpcServer = new grpc.Server();

    this.grpcServer.addService(commandCenterProto.CommandCenterService.service, {
      expandRequirement: grpcServices.expandRequirement,
      scopeContext: grpcServices.scopeContext,
      storeInteraction: grpcServices.storeInteraction,
      getTraceability: grpcServices.getTraceability,
      getMetrics: grpcServices.getMetrics
    });

    const grpcPort = config.grpc.port || 50051;
    this.grpcServer.bindAsync(
      `0.0.0.0:${grpcPort}`,
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) {
          logger.error('Failed to bind gRPC server:', err);
          return;
        }
        logger.info(`gRPC server listening on port ${port}`);
      }
    );
  }

  /**
   * Setup health check endpoint
   */
  setupHealthCheck() {
    this.app.get('/health', async (req, res) => {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
          redis: this.redisClient?.isOpen ? 'connected' : 'disconnected',
          neo4j: 'connected' // knowledgeGraphService handles its own connection
        },
        uptime: process.uptime()
      };

      const statusCode = health.services.mongodb === 'connected' &&
                        health.services.redis === 'connected' ? 200 : 503;

      res.status(statusCode).json(health);
    });
  }

  /**
   * Setup Prometheus metrics endpoint
   */
  setupMetrics() {
    this.app.get('/metrics', async (req, res) => {
      res.set('Content-Type', prometheusClient.register.contentType);
      const metrics = await prometheusClient.register.metrics();
      res.end(metrics);
    });
  }

  /**
   * Start the microservice
   */
  async start() {
    const port = config.port || 4000;

    this.server = this.app.listen(port, () => {
      logger.info(`Command Center Microservice listening on port ${port}`);
      logger.info(`GraphQL endpoint available at http://localhost:${port}/graphql`);
      logger.info(`REST API available at http://localhost:${port}/api/v1`);
      logger.info(`Health check available at http://localhost:${port}/health`);
      logger.info(`Metrics available at http://localhost:${port}/metrics`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('Starting graceful shutdown...');

    // Stop accepting new connections
    if (this.server) {
      this.server.close(() => {
        logger.info('HTTP server closed');
      });
    }

    // Close GraphQL server
    if (this.apolloServer) {
      await this.apolloServer.stop();
      logger.info('GraphQL server stopped');
    }

    // Close gRPC server
    if (this.grpcServer) {
      this.grpcServer.tryShutdown((err) => {
        if (err) logger.error('Error shutting down gRPC server:', err);
        else logger.info('gRPC server stopped');
      });
    }

    // Close database connections
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');

    if (this.redisClient) {
      await this.redisClient.quit();
      logger.info('Redis connection closed');
    }

    await knowledgeGraphService.cleanup();
    logger.info('Neo4j connection closed');

    logger.info('Graceful shutdown complete');
    process.exit(0);
  }
}

// Main execution
async function main() {
  const microservice = new CommandCenterMicroservice();

  try {
    await microservice.initialize();
    await microservice.start();
  } catch (error) {
    logger.error('Failed to start Command Center Microservice:', error);
    process.exit(1);
  }
}

// Start the service
if (require.main === module) {
  main();
}

module.exports = CommandCenterMicroservice;