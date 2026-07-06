const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const redis = require('redis');
const winston = require('winston');

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
const PORT = process.env.PORT || 4000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Database connections (with proper error handling)
const connectDatabases = async () => {
  // MongoDB connection
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      logger.info('MongoDB connected successfully');
    } catch (error) {
      logger.warn('MongoDB connection failed, running without database:', error.message);
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

// Start server
const startServer = async () => {
  await connectDatabases();

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
