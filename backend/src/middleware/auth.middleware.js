const VALID_ROLES = new Set(["VIEWER", "OPERATOR", "ADMIN"]);
const { buildSafeError } = require('../utils/api-response.util');

const requireAuth = async (req, res, next) => {
  try {
    const user = await require('../services/accounts.service').authenticateSession(req.session);
    if (!user) return res.status(401).json(buildSafeError(req, { type: 'AUTH_ERROR', code: 'UNAUTHORIZED', httpStatus: 401, safeMessage: 'Please sign in' }));
    req.session.user = user;
    next();
  } catch (error) { next(error); }
};

const requireRole = (...allowedRoles) => {
  const normalizedAllowedRoles = new Set(
    allowedRoles.map((role) => String(role).trim().toUpperCase())
  );

  return (req, res, next) => {
    // Check if auth is present first
    if (!req.session || !req.session.user) {
      return res.status(401).json(buildSafeError(req, { type: 'AUTH_ERROR', code: 'UNAUTHORIZED', httpStatus: 401, safeMessage: 'Please sign in' }));
    }

    const role =
      typeof req.session.user.role === "string"
        ? req.session.user.role.trim().toUpperCase()
        : null;

    if (!role || !VALID_ROLES.has(role)) {
      return res.status(403).json(buildSafeError(req, { type: 'AUTHORIZATION_ERROR', code: 'FORBIDDEN', httpStatus: 403, safeMessage: 'You do not have permission to perform this action' }));
    }

    if (!normalizedAllowedRoles.has(role)) {
      return res.status(403).json(buildSafeError(req, { type: 'AUTHORIZATION_ERROR', code: 'FORBIDDEN', httpStatus: 403, safeMessage: 'You do not have permission to perform this action' }));
    }

    // Pass the safe validated role
    req.authUser = {
      ...req.session.user,
      role
    };

    next();
  };
};

module.exports = {
  requireAuth,
  requireRole
};
