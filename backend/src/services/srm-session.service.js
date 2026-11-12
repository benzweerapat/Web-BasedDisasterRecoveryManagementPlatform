const SESSION_REJECTION_CODES =
  new Set([
    'SRM_MAPPING_SESSION_REJECTED',
    'SRM_SESSION_REJECTED',
    'SRM_SESSION_EXPIRED'
  ]);

function safeHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch (_error) {
    return null;
  }
}

function createSrmSessionContext({
  connectionId,
  site,
  sitePairId = null,
  localSrmHost,
  remoteSrmHost = null,
  protocol = 'REST',
  authenticatedAt = null,
  expiresAt = null,
  sessionState =
    'NOT_AUTHENTICATED'
} = {}) {
  return {
    connectionId,
    site: site || null,
    sitePairId,

    localSrmHost:
      safeHost(localSrmHost) ||
      localSrmHost ||
      null,

    remoteSrmHost:
      safeHost(remoteSrmHost) ||
      remoteSrmHost ||
      null,

    protocol,
    authenticatedAt,
    expiresAt,
    sessionState
  };
}

function srmSessionScopeKey(
  context = {}
) {
  return [
    context.connectionId ??
      'unknown',

    context.localSrmHost ||
      'unknown-host',

    context.sitePairId ||
      'no-pair',

    context.protocol ||
      'REST'
  ].join(':');
}

function isSessionRejected(error) {
  if (!error) return false;

  if (
    SESSION_REJECTION_CODES.has(
      error.code
    )
  ) {
    return true;
  }

  const status =
    error.httpStatus ||
    error.status ||
    error.response?.status;

  return status === 401;
}

function buildSafeSessionDiagnostic({
  context = {},
  endpointPath,
  operation,
  requestId,
  error,
  attempt,
  sessionPhase
} = {}) {
  return {
    connectionId:
      context.connectionId ?? null,

    site:
      context.site || null,

    product: 'SRM',

    endpointPath:
      endpointPath || null,

    protocol:
      context.protocol ||
      error?.protocol ||
      'REST',

    httpStatus:
      error?.httpStatus ||
      error?.status ||
      error?.response?.status ||
      null,

    vmwareSafeFaultType:
      error?.safeFaultType ||
      error?.code ||
      'SRM_UPSTREAM_ERROR',

    requestId:
      requestId || null,

    sessionPhase:
      sessionPhase ||
      error?.sessionPhase ||
      'MAPPING_READ',

    operation:
      operation || null,

    attempt:
      Number(attempt) || 1,

    pairingId:
      context.sitePairId || null,

    sessionRefreshAttempted:
      Number(attempt) > 1,

    sessionScopeKey:
      srmSessionScopeKey(context)
  };
}

async function executeWithSrmSessionRetry({
  context,
  operation,
  reauthenticate,
  endpointPath,
  operationName,
  requestId,
  sessionPhase = 'MAPPING_READ',
  onDiagnostic = () => {}
} = {}) {
  if (
    typeof operation !== 'function'
  ) {
    throw new TypeError(
      'operation must be a function'
    );
  }

  if (
    typeof reauthenticate !==
    'function'
  ) {
    throw new TypeError(
      'reauthenticate must be a function'
    );
  }

  try {
    return await operation({
      attempt: 1,
      context
    });
  } catch (error) {
    if (!isSessionRejected(error)) {
      throw error;
    }

    onDiagnostic(
      buildSafeSessionDiagnostic({
        context,
        endpointPath,
        operation: operationName,
        requestId,
        error,
        attempt: 1,
        sessionPhase
      })
    );
  }

  await reauthenticate({
    context,
    requestId
  });

  try {
    return await operation({
      attempt: 2,
      context
    });
  } catch (error) {
    onDiagnostic(
      buildSafeSessionDiagnostic({
        context,
        endpointPath,
        operation: operationName,
        requestId,
        error,
        attempt: 2,
        sessionPhase
      })
    );

    throw error;
  }
}

module.exports = {
  SESSION_REJECTION_CODES,
  createSrmSessionContext,
  srmSessionScopeKey,
  isSessionRejected,
  buildSafeSessionDiagnostic,
  executeWithSrmSessionRetry
};