//Request ID คือ เมื่อ frontend เรียก API แต่ละครั้ง ระบบจะกำหนด ID เฉพาะ

const { randomUUID: uuidv4 } = require('node:crypto');

/**
 * Middleware to generate and attach a unique request ID to each request
 * Also sets the X-Request-ID header on the response
 */
const requestIdMiddleware = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

module.exports = requestIdMiddleware;
