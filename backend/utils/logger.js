/**
 * Structured JSON Logger with Correlation IDs
 * Provides consistent logging across the backend services with request tracking
 */

const fs = require("fs");
const path = require("path");

// Ensure logs directory exists
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

class StructuredLogger {
  constructor(serviceName = "Chesster") {
    this.serviceName = serviceName;
    this.correlationId = null;
    this.requestMetadata = {};
  }

  /**
   * Set correlation ID for request tracking
   * @param {string} correlationId - Unique identifier for request tracking
   */
  setCorrelationId(correlationId) {
    this.correlationId = correlationId;
  }

  /**
   * Get or generate correlation ID
   * @returns {string} Correlation ID
   */
  getCorrelationId() {
    if (!this.correlationId) {
      this.correlationId = this.generateId();
    }
    return this.correlationId;
  }

  /**
   * Generate unique ID for correlation tracking
   * @returns {string} Unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set request metadata for context
   * @param {object} metadata - Additional metadata to track
   */
  setRequestMetadata(metadata) {
    this.requestMetadata = { ...this.requestMetadata, ...metadata };
  }

  /**
   * Clear request context
   */
  clearContext() {
    this.correlationId = null;
    this.requestMetadata = {};
  }

  /**
   * Format log entry with structured JSON
   * @private
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {object} data - Additional data
   * @returns {object} Structured log entry
   */
  formatLogEntry(level, message, data = {}) {
    return {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      correlationId: this.getCorrelationId(),
      message,
      ...this.requestMetadata,
      ...data,
    };
  }

  /**
   * Write log to console and file
   * @private
   * @param {object} logEntry - Formatted log entry
   */
  writeLog(logEntry) {
    const jsonLog = JSON.stringify(logEntry);
    
    // Console output for development
    if (process.env.NODE_ENV !== "production") {
      console.log(jsonLog);
    }

    // File output for production
    const logFile = path.join(logsDir, `${logEntry.level}.log`);
    fs.appendFileSync(logFile, jsonLog + "\n", { encoding: "utf-8" });

    // Also write to combined log
    const combinedLogFile = path.join(logsDir, "combined.log");
    fs.appendFileSync(combinedLogFile, jsonLog + "\n", { encoding: "utf-8" });
  }

  /**
   * Log info level message
   * @param {string} message - Log message
   * @param {object} data - Additional context data
   */
  info(message, data = {}) {
    const logEntry = this.formatLogEntry("INFO", message, data);
    this.writeLog(logEntry);
  }

  /**
   * Log error level message
   * @param {string} message - Log message
   * @param {Error|object} error - Error object or data
   */
  error(message, error = {}) {
    const errorData = error instanceof Error
      ? {
          errorMessage: error.message,
          errorStack: error.stack,
          errorName: error.name,
        }
      : error;

    const logEntry = this.formatLogEntry("ERROR", message, {
      ...errorData,
      severity: "high",
    });
    this.writeLog(logEntry);
  }

  /**
   * Log warning level message
   * @param {string} message - Log message
   * @param {object} data - Additional context data
   */
  warn(message, data = {}) {
    const logEntry = this.formatLogEntry("WARN", message, data);
    this.writeLog(logEntry);
  }

  /**
   * Log debug level message
   * @param {string} message - Log message
   * @param {object} data - Additional context data
   */
  debug(message, data = {}) {
    if (process.env.DEBUG === "true") {
      const logEntry = this.formatLogEntry("DEBUG", message, data);
      this.writeLog(logEntry);
    }
  }

  /**
   * Log performance metrics
   * @param {string} operationName - Name of operation
   * @param {number} duration - Duration in milliseconds
   * @param {object} data - Additional context data
   */
  logPerformance(operationName, duration, data = {}) {
    const logEntry = this.formatLogEntry("PERFORMANCE", operationName, {
      durationMs: duration,
      isSlowQuery: duration > 1000,
      ...data,
    });
    this.writeLog(logEntry);
  }

  /**
   * Express middleware for correlation ID and request logging
   * @returns {function} Express middleware
   */
  requestMiddleware() {
    return (req, res, next) => {
      // Generate or use existing correlation ID
      const correlationId =
        req.headers["x-correlation-id"] || this.generateId();
      this.setCorrelationId(correlationId);

      // Set correlation ID in response headers
      res.set("X-Correlation-ID", correlationId);

      // Track request metadata
      this.setRequestMetadata({
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      // Log request start
      this.info("Request started", {
        method: req.method,
        path: req.path,
        query: req.query,
      });

      // Capture response time
      const startTime = Date.now();

      // Hook response finish
      res.on("finish", () => {
        const duration = Date.now() - startTime;
        this.info("Request completed", {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: duration,
        });
        this.clearContext();
      });

      next();
    };
  }
}

// Create singleton instance
const logger = new StructuredLogger("Chesster-Backend");

module.exports = logger;
