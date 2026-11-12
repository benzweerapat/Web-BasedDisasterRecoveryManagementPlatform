const crypto = require("crypto");
const { buildSafeError } = require('../utils/api-response.util');

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const expectedToken = req.session?.csrfToken;
  const suppliedToken = req.get("X-CSRF-Token");

  if (typeof expectedToken !== "string" || typeof suppliedToken !== "string") {
    console.warn(`[Security] CSRF verification failed (missing/invalid type). IP: ${req.ip}, Path: ${req.path}`, {
      expectedTokenPresent: typeof expectedToken === "string",
      suppliedTokenPresent: typeof suppliedToken === "string"
    });
    return res.status(403).json(buildSafeError(req, { type: 'CSRF_ERROR', code: 'CSRF_ERROR', httpStatus: 403, safeMessage: 'The request failed security validation' }));
  }

  const expectedBuffer = Buffer.from(expectedToken, "utf8");
  const suppliedBuffer = Buffer.from(suppliedToken, "utf8");

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return res.status(403).json(buildSafeError(req, { type: 'CSRF_ERROR', code: 'CSRF_ERROR', httpStatus: 403, safeMessage: 'The request failed security validation' }));
  }

  let matches = false;
  try {
    matches = crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  } catch (err) {
    return res.status(403).json(buildSafeError(req, { type: 'CSRF_ERROR', code: 'CSRF_ERROR', httpStatus: 403, safeMessage: 'The request failed security validation' }));
  }

  if (!matches) {
    return res.status(403).json(buildSafeError(req, { type: 'CSRF_ERROR', code: 'CSRF_ERROR', httpStatus: 403, safeMessage: 'The request failed security validation' }));
  }

  next();
};

module.exports = {
  csrfProtection
};
