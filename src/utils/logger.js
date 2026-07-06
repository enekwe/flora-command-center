/**
 * Logger utility for Command Center Microservice
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logDir = process.env.LOG_DIR || path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define transports
const transports = [
  // Write all logs to console
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
      )
    ),
  }),

  // Write all error logs to error.log
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),

  // Write all logs to combined.log
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports,
  exitOnError: false,
});

// Add HTTP request logger
logger.stream = {
  write: (message) => {
    logger.info(message.substring(0, message.lastIndexOf('\n')));
  },
};

// Export logger functions with context support
module.exports = {
  error: (message, meta = {}) => {
    logger.error(message, meta);
  },

  warn: (message, meta = {}) => {
    logger.warn(message, meta);
  },

  info: (message, meta = {}) => {
    logger.info(message, meta);
  },

  http: (message, meta = {}) => {
    logger.http(message, meta);
  },

  debug: (message, meta = {}) => {
    logger.debug(message, meta);
  },

  // Log with context (useful for distributed tracing)
  logWithContext: (level, message, context = {}, meta = {}) => {
    logger.log(level, message, {
      ...meta,
      context: {
        requestId: context.requestId,
        userId: context.userId,
        companyId: context.companyId,
        service: 'command-center',
        timestamp: new Date().toISOString()
      }
    });
  },

  // Create child logger for specific modules
  child: (metadata) => {
    return logger.child(metadata);
  },

  // Performance logging
  startTimer: () => {
    return Date.now();
  },

  endTimer: (startTime, operation, meta = {}) => {
    const duration = Date.now() - startTime;
    logger.info(`Performance: ${operation} completed in ${duration}ms`, {
      ...meta,
      duration,
      operation
    });
    return duration;
  },

  // Audit logging
  audit: (action, userId, companyId, details = {}) => {
    logger.info(`AUDIT: ${action}`, {
      audit: true,
      action,
      userId,
      companyId,
      details,
      timestamp: new Date().toISOString()
    });
  },

  // Security logging
  security: (event, severity, details = {}) => {
    const level = severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info';
    logger.log(level, `SECURITY: ${event}`, {
      security: true,
      event,
      severity,
      details,
      timestamp: new Date().toISOString()
    });
  }
};