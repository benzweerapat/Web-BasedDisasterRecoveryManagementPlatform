const ERROR_TYPES = Object.freeze({
  400: 'VALIDATION_ERROR',
  401: 'AUTH_ERROR',
  403: 'AUTHORIZATION_ERROR',
  404: 'NOT_FOUND_ERROR',
  409: 'CONFLICT_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'UPSTREAM_ERROR'
});

function safeEndpoint(req) {
  return req?.originalUrl?.split('?')[0] || req?.path || 'unknown';
}

function buildSafeError(req, {
  type,
  code,
  httpStatus = 500,
  safeMessage
} = {}) {
  const normalizedStatus = Number(httpStatus) || 500;
  const errorType = type || ERROR_TYPES[normalizedStatus] || 'BACKEND_ERROR';
  const errorCode = code || errorType;
  return {
    success: false,
    error: {
      type: errorType,
      code: errorCode,
      httpStatus: normalizedStatus,
      endpoint: safeEndpoint(req),
      requestId: req?.id || 'unknown',
      safeMessage: safeMessage || 'The operation could not be completed'
    },
    requestId: req?.id || 'unknown'
  };
}

function sendReadResponse(res, data, { dataState = 'SUCCESS', freshness = null } = {}) {
  return res.json({
    success: true,
    state: dataState,
    freshness,
    data,
    requestId: res.req?.id || 'unknown'
  });
}

module.exports = {
  buildSafeError,
  sendReadResponse,
  safeEndpoint
};
