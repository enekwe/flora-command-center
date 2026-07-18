require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const redis = require('redis');
const winston = require('winston');
const rateLimit = require('express-rate-limit');

// Validate required environment variables
const validateEnvironment = () => {
  const required = ['JWT_SECRET', 'SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these variables before starting the service.');
    process.exit(1);
  } else if (missing.length > 0) {
    console.warn(`WARNING: Missing environment variables: ${missing.join(', ')}`);
    console.warn('Using development defaults - NOT SAFE FOR PRODUCTION');
  }
};

// Validate environment on startup
validateEnvironment();

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Create Express app
const app = express();
const PORT = process.env.PORT || 3015;

// Configure CORS properly
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : process.env.NODE_ENV === 'production'
    ? false // Deny all in production if not configured
    : ['http://localhost:3000', 'http://localhost:5173']; // Development defaults

// Middleware
app.use(helmet());
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  maxAge: 86400
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'command-center',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Flora Command Center',
    version: '1.0.0',
    status: 'running'
  });
});

// GraphQL endpoint placeholder
app.post('/graphql', (req, res) => {
  res.json({
    message: 'GraphQL endpoint ready for implementation',
    query: req.body.query
  });
});

// Integration routes
const slackRoutes = require('./integrations/slack/routes');
const gmailRoutes = require('./integrations/gmail/routes');
const mercuryRoutes = require('./integrations/mercury/routes');
const commandCenterRoutes = require('./routes/commandCenterRoutes');

const zdrRoutes = require('./routes/zdrRoutes');

app.use('/api/integrations/slack', slackRoutes);
app.use('/api/integrations/gmail', gmailRoutes);
app.use('/api/integrations/mercury', mercuryRoutes);
app.use('/api/command-center', commandCenterRoutes);
app.use('/api/command-center/zdr', zdrRoutes);

logger.info('Slack, Gmail, Command Center, and ZDR routes mounted');

// Database connections (with proper error handling)
const connectDatabases = async () => {
  // MongoDB connection
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      logger.info('MongoDB connected successfully');
    } catch (error) {
      logger.error('MongoDB connection failed:', {
        error: error.message,
        code: error.code,
        name: error.name
      });
      logger.warn('Running without database - some features may be limited');
    }
  } else {
    logger.info('No MongoDB URI provided, running without database');
  }

  // Redis connection
  if (process.env.REDIS_URL) {
    try {
      const redisClient = redis.createClient({
        url: process.env.REDIS_URL
      });
      redisClient.on('error', (err) => logger.warn('Redis error:', err.message));
      await redisClient.connect();
      logger.info('Redis connected successfully');
    } catch (error) {
      logger.warn('Redis connection failed:', error.message);
    }
  } else {
    logger.info('No Redis URL provided, running without cache');
  }
};

// ZDR-E0-S4 & ZDR-E0-S5: Cleanup schedulers
const scheduleCleanupJobs = async () => {
  const TokenUsageTracker = require('./models/TokenUsageTracker');
  const { getArtifactPurgeService } = require('./services/artifactPurgeService');
  const config = require('./config');

  // ZDR-E0-S5: Token usage cleanup (existing)
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const CLEANUP_RETENTION_DAYS = 30;

  const runTokenCleanup = async () => {
    try {
      logger.info('Running scheduled cleanup of old token usage sessions');
      const deletedCount = await TokenUsageTracker.cleanupOldSessions(CLEANUP_RETENTION_DAYS);
      logger.info(`Cleanup completed: ${deletedCount} old sessions deleted`);
    } catch (error) {
      logger.error('Token cleanup job failed', {
        error: error.message,
        stack: error.stack
      });
    }
  };

  // Initial token cleanup on startup (after 5 minute delay)
  setTimeout(() => {
    runTokenCleanup();
  }, 5 * 60 * 1000);

  // Schedule recurring token cleanup
  setInterval(runTokenCleanup, CLEANUP_INTERVAL);

  logger.info('Token usage cleanup job scheduled (runs daily)');

  // ZDR-E0-S4: Artifact purge service (new)
  if (config.zdr.enableScheduledPurge) {
    try {
      const artifactPurgeService = getArtifactPurgeService();
      await artifactPurgeService.initialize();
      artifactPurgeService.startScheduledPurge();
      logger.info('Artifact purge service started successfully');
    } catch (error) {
      logger.error('Failed to start artifact purge service', {
        error: error.message,
        stack: error.stack
      });
    }
  } else {
    logger.info('Artifact purge service disabled by configuration');
  }
};

// Start server
const startServer = async () => {
  await connectDatabases();

  // ZDR-E0-S4 & ZDR-E0-S5: Schedule cleanup jobs if MongoDB is connected
  if (mongoose.connection.readyState === 1) {
    await scheduleCleanupJobs();
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Command Center service running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

// Handle errors
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

// Start the service
startServer();
