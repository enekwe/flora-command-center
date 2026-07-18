const logger = require('../utils/logger');

/**
 * Tenant Isolation Middleware — ZDR-E3-S2
 *
 * Asserts that the caller's companyId owns the requested resource.
 * Cross-tenant access attempts return 403 (guarantee G6).
 *
 * Usage:
 *   router.get('/handoff/:sessionId', authMiddleware, tenantIsolation('sessionId'), handler)
 *
 * @param {string} resourceParam - Route parameter name containing the resource identifier
 * @param {object} options - { model, idField, companyIdField }
 */
function tenantIsolation(resourceParam, options = {}) {
  const {
    model = null,
    idField = 'sessionId',
    companyIdField = 'companyId'
  } = options;

  return async (req, res, next) => {
    try {
      const callerCompanyId = req.headers['x-company-id'] || req.user?.companyId;
      const resourceId = req.params[resourceParam] || req.body[resourceParam];

      if (!callerCompanyId) {
        logger.warn('Tenant isolation: missing caller companyId', {
          path: req.path,
          ip: req.ip
        });
        return res.status(401).json({
          success: false,
          error: 'Company identification required',
          code: 'MISSING_COMPANY_ID'
        });
      }

      if (!resourceId) {
        return next();
      }

      // If a model is provided, verify ownership
      if (model) {
        const query = { [idField]: resourceId };
        const resource = await model.findOne(query).select(companyIdField).lean();

        if (!resource) {
          return res.status(404).json({
            success: false,
            error: 'Resource not found',
            code: 'NOT_FOUND'
          });
        }

        if (resource[companyIdField] && resource[companyIdField] !== callerCompanyId) {
          logger.warn('Tenant isolation: cross-tenant access blocked', {
            callerCompanyId,
            resourceCompanyId: resource[companyIdField],
            resourceParam,
            resourceId,
            path: req.path
          });

          return res.status(403).json({
            success: false,
            error: 'Access denied: resource belongs to another tenant',
            code: 'CROSS_TENANT_ACCESS_DENIED'
          });
        }
      }

      // Attach companyId to request for downstream use
      req.companyId = callerCompanyId;
      next();

    } catch (error) {
      logger.error('Tenant isolation middleware error', {
        error: error.message,
        path: req.path
      });
      next(error);
    }
  };
}

/**
 * Lightweight tenant context middleware.
 * Extracts and validates companyId from request headers/user,
 * attaches to req for downstream handlers.
 */
function tenantContext(req, res, next) {
  const companyId = req.headers['x-company-id'] || req.user?.companyId;

  if (companyId) {
    req.companyId = companyId;
  }

  next();
}

module.exports = {
  tenantIsolation,
  tenantContext
};
