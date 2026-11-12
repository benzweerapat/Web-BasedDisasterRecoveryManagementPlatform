const FAILURE_STATUS_BY_CODE = Object.freeze({
  SRM_AUTH_FAILED: 'AUTH_FAILED',
  VR_AUTH_FAILED: 'AUTH_FAILED',

  CONNECTION_CREDENTIAL_NOT_CONFIGURED:
    'AUTH_FAILED',

  SRM_TARGET_NOT_ALLOWED:
    'TARGET_NOT_ALLOWED',

  VR_TARGET_NOT_ALLOWED:
    'TARGET_NOT_ALLOWED',

  ECONNABORTED: 'TIMEOUT',
  ETIMEDOUT: 'TIMEOUT',

  ECONNREFUSED: 'UNREACHABLE',
  ECONNRESET: 'UNREACHABLE',
  ENETUNREACH: 'UNREACHABLE',
  EHOSTUNREACH: 'UNREACHABLE',
  ENOTFOUND: 'UNREACHABLE',

  CERT_HAS_EXPIRED: 'TLS_ERROR',
  DEPTH_ZERO_SELF_SIGNED_CERT:
    'TLS_ERROR',
  SELF_SIGNED_CERT_IN_CHAIN:
    'TLS_ERROR',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'TLS_ERROR'
});

function resolveVmwareConnectionFailureStatus(
  error = {}
) {
  const code = String(
    error.code || ''
  ).trim().toUpperCase();

  if (FAILURE_STATUS_BY_CODE[code]) {
    return FAILURE_STATUS_BY_CODE[code];
  }

  const httpStatus = Number(
    error.statusCode ||
    error.response?.status ||
    0
  );

  if ([401, 403].includes(httpStatus)) {
    return 'AUTH_FAILED';
  }

  const safeText =
    `${code} ${error.name || ''} ${error.message || ''}`
      .toUpperCase();

  if (
    safeText.includes('AUTH') ||
    safeText.includes('CREDENTIAL')
  ) {
    return 'AUTH_FAILED';
  }

  if (
    safeText.includes('CERT') ||
    safeText.includes('TLS') ||
    safeText.includes('SSL')
  ) {
    return 'TLS_ERROR';
  }

  if (
    safeText.includes('TIMEOUT') ||
    safeText.includes('TIMED OUT')
  ) {
    return 'TIMEOUT';
  }

  if (
    safeText.includes('NETWORK') ||
    safeText.includes('UNREACHABLE')
  ) {
    return 'UNREACHABLE';
  }

  return 'DISCONNECTED';
}

module.exports = {
  resolveVmwareConnectionFailureStatus
};