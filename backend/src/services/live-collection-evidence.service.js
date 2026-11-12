const ALLOWED_OPERATION_STATUSES =
  new Set([
    'SUCCESS',
    'PARTIAL',
    'SUCCESS_EMPTY',
    'FAILED'
  ]);

const iso = value => {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

const safeRowCount = value => {
  const number = Number(value);

  return Number.isFinite(number) &&
    number >= 0
    ? Math.trunc(number)
    : 0;
};

function sanitizeRowsCollected(
  rowsCollected = {}
) {
  return Object.fromEntries(
    Object.entries(rowsCollected)
      .filter(
        ([key]) =>
          /^[A-Za-z][A-Za-z0-9_]*$/
            .test(key)
      )
      .map(
        ([key, value]) => [
          key,
          safeRowCount(value)
        ]
      )
  );
}

function sanitizeOperations(
  operations = []
) {
  return operations.map(operation => ({
    operation:
      String(
        operation.operation ||
        'UNKNOWN'
      )
        .replace(
          /[^A-Z0-9_:-]/gi,
          '_'
        )
        .toUpperCase(),

    endpointCategory:
      String(
        operation.endpointCategory ||
        'VMWARE_API'
      )
        .replace(
          /[^A-Z0-9_:-]/gi,
          '_'
        )
        .toUpperCase(),

    status:
      ALLOWED_OPERATION_STATUSES.has(
        String(
          operation.status || ''
        ).toUpperCase()
      )
        ? String(
            operation.status
          ).toUpperCase()
        : 'FAILED',

    rowCount:
      safeRowCount(
        operation.rowCount
      )
  }));
}

function createLiveCollectionResult({
  system,
  connectionId,
  syncRunId,
  collectorRunId = null,
  startedAt,
  completedAt,
  status = 'SUCCESS',
  rowsCollected = {},
  operations = [],
  canonicalization = null
}) {
  const safeRows =
    sanitizeRowsCollected(
      rowsCollected
    );

  const safeOperations =
    sanitizeOperations(
      operations
    );

  const start = iso(startedAt);
  const complete = iso(completedAt);

  const normalizedStatus =
    [
      'SUCCESS',
      'PARTIAL'
    ].includes(
      String(status).toUpperCase()
    )
      ? String(status).toUpperCase()
      : 'FAILED';

  return {
    syncRunId,
    collectorRunId,
    liveUpstreamRequest: true,
    rowsCollected: safeRows,

    persistence: {
      status: 'SUCCESS',
      committed: true
    },

    canonicalization:
      canonicalization || {
        status: 'SUCCESS',
        phase:
          'POST_PERSISTENCE_READ_MODEL_READY'
      },

    lastCollectedAt: complete,

    upstreamEvidence: {
      syncRunId,

      system:
        String(system || '')
          .toUpperCase(),

      connectionId,
      startedAt: start,
      completedAt: complete,

      durationMs: Math.max(
        0,
        new Date(complete).getTime() -
        new Date(start).getTime()
      ),

      status: normalizedStatus,

      endpointCategories: [
        ...new Set(
          safeOperations.map(
            item =>
              item.endpointCategory
          )
        )
      ],

      operations: safeOperations,
      rowsCollected: safeRows
    }
  };
}

function validateLiveCollectionResult(
  raw,
  {
    system,
    connectionId,
    syncRunId
  }
) {
  const evidence =
    raw?.upstreamEvidence;

  const operations =
    evidence?.operations;

  const hasSuccessfulOperation =
    Array.isArray(operations) &&
    operations.length > 0 &&
    operations.some(
      operation =>
        [
          'SUCCESS',
          'PARTIAL',
          'SUCCESS_EMPTY'
        ].includes(
          operation.status
        )
    );

  return Boolean(
    raw?.liveUpstreamRequest === true &&
    raw?.persistence?.status ===
      'SUCCESS' &&
    raw?.persistence?.committed ===
      true &&
    raw?.syncRunId === syncRunId &&
    evidence?.syncRunId ===
      syncRunId &&
    evidence?.system ===
      String(system || '')
        .toUpperCase() &&
    String(evidence?.connectionId) ===
      String(connectionId) &&
    Date.parse(evidence?.startedAt) &&
    Date.parse(evidence?.completedAt) &&
    hasSuccessfulOperation
  );
}

function logLiveCollectionEvidence(
  evidence,
  logger = console
) {
  if (!evidence) return;

  logger.log(
    '[VMwareLiveCollection]',
    {
      syncRunId: evidence.syncRunId,
      system: evidence.system,
      connectionId:
        evidence.connectionId,
      endpointCategories:
        evidence.endpointCategories,
      startedAt: evidence.startedAt,
      completedAt:
        evidence.completedAt,
      durationMs: evidence.durationMs,
      status: evidence.status,
      rowsCollected:
        evidence.rowsCollected
    }
  );
}

module.exports = {
  createLiveCollectionResult,
  validateLiveCollectionResult,
  logLiveCollectionEvidence,
  sanitizeRowsCollected,
  sanitizeOperations
};