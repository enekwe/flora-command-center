const logger = require('./logger');

/**
 * Log Sanitizer — ZDR-E7-S3
 *
 * CI check + runtime formatter that asserts no Customer Content fields
 * appear in logs, metrics, telemetry, or analytics.
 *
 * Guarantee G7: No Customer Code in logs, stderr, metrics, telemetry, or analytics.
 */

const FORBIDDEN_FIELD_NAMES = [
  'code', 'sourceCode', 'codeSnippet', 'snippet', 'codeContent',
  'codebaseSnapshot', 'rawCode', 'customerCode', 'fileContent',
  'promptContent', 'rawPrompt', 'userPrompt', 'systemPromptContent',
  'responseContent', 'rawResponse', 'completionContent',
  'relevantCode', 'codebaseSnapshot'
];

const CODE_INDICATORS = [
  /\bfunction\s+\w+\s*\(/,
  /\bconst\s+\w+\s*=\s*/,
  /\bimport\s+.*\s+from\s+/,
  /\bclass\s+\w+\s*[\{<]/,
  /\bdef\s+\w+\s*\(/,
  /\bpublic\s+(static\s+)?\w+/,
  /<\?php\b/,
  /<!DOCTYPE\s+html/i,
  /\bSELECT\s+.*\bFROM\b/i
];

/**
 * Check if a log entry contains Customer Content.
 *
 * @param {object|string} entry - Log entry to check
 * @returns {{ hasCode: boolean, fields: string[], indicators: string[] }}
 */
function scanForCustomerContent(entry) {
  const entryStr = typeof entry === 'string' ? entry : JSON.stringify(entry);
  const entryObj = typeof entry === 'object' ? entry : null;

  const forbiddenFieldsFound = [];
  const codeIndicatorsFound = [];

  if (entryObj) {
    for (const field of FORBIDDEN_FIELD_NAMES) {
      if (entryObj[field] && typeof entryObj[field] === 'string' && entryObj[field].length > 20) {
        forbiddenFieldsFound.push(field);
      }
    }
  }

  for (const indicator of CODE_INDICATORS) {
    if (indicator.test(entryStr)) {
      codeIndicatorsFound.push(indicator.toString());
    }
  }

  return {
    hasCode: forbiddenFieldsFound.length > 0 || codeIndicatorsFound.length > 0,
    fields: forbiddenFieldsFound,
    indicators: codeIndicatorsFound
  };
}

/**
 * Sanitize a log entry by removing Customer Content fields.
 *
 * @param {object} entry - Log entry
 * @returns {object} Sanitized entry
 */
function sanitizeLogEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return entry;

  const sanitized = { ...entry };

  for (const field of FORBIDDEN_FIELD_NAMES) {
    if (sanitized[field]) {
      const value = sanitized[field];
      if (typeof value === 'string') {
        sanitized[field] = `[REDACTED:${field}:${value.length}chars]`;
      } else if (Array.isArray(value)) {
        sanitized[field] = `[REDACTED:${field}:${value.length}items]`;
      } else {
        sanitized[field] = `[REDACTED:${field}]`;
      }
    }
  }

  return sanitized;
}

/**
 * Create a Winston format that sanitizes Customer Content from log output.
 * Integrate into the logger pipeline for ZDR compliance.
 *
 * @returns {object} Winston format
 */
function createSanitizerFormat() {
  const winston = require('winston');

  return winston.format((info) => {
    const scan = scanForCustomerContent(info);
    if (scan.hasCode) {
      logger.warn('Customer Content detected in log output — sanitizing', {
        fields: scan.fields,
        indicatorCount: scan.indicators.length
      });
      return sanitizeLogEntry(info);
    }
    return info;
  })();
}

/**
 * CI check: scan a set of log files for Customer Content.
 * Returns violations found.
 *
 * @param {string[]} logLines - Array of log lines to check
 * @returns {{ violations: number, details: Array }}
 */
function ciCheck(logLines) {
  const violations = [];

  for (let i = 0; i < logLines.length; i++) {
    const scan = scanForCustomerContent(logLines[i]);
    if (scan.hasCode) {
      violations.push({
        line: i + 1,
        fields: scan.fields,
        indicators: scan.indicators
      });
    }
  }

  return {
    violations: violations.length,
    details: violations,
    passed: violations.length === 0
  };
}

module.exports = {
  FORBIDDEN_FIELD_NAMES,
  scanForCustomerContent,
  sanitizeLogEntry,
  createSanitizerFormat,
  ciCheck
};
