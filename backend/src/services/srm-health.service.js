const {
  buildScopeFreshness,
  buildFreshness
} = require('./data-freshness.service');

const SUCCESS_STATES = new Set([
  'AVAILABLE',
  'CONNECTED',
  'FRESH',
  'HEALTHY',
  'OK',
  'PRESENT',
  'RESOLVED',
  'SUCCESS',
  'SUCCESS_EMPTY',
  'SUCCESS_WITH_UNSUPPORTED_SCOPE',
  'SYNCED'
]);

const PARTIAL_STATES = new Set([
  'COLLECTION_FAILED',
  'PARTIAL',
  'STALE',
  'STALE_WITH_DATA',
  'SYNCING',
  'WARNING'
]);

const FAILED_STATES = new Set([
  'AUTH_FAILED',
  'CRITICAL',
  'DISCONNECTED',
  'ERROR',
  'FAILED',
  'FETCH_FAILED',
  'INTERNAL_ERROR',
  'TARGET_NOT_ALLOWED',
  'TIMEOUT',
  'TLS_ERROR',
  'UNAVAILABLE',
  'UNREACHABLE'
]);

const NEVER_STATES = new Set([
  'NEVER_COLLECTED'
]);

function upper(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function latestIso(values = []) {
  const dates = values
    .filter(Boolean)
    .map(
      value =>
        value instanceof Date
          ? value
          : new Date(value)
    )
    .filter(
      value =>
        !Number.isNaN(value.getTime())
    );

  return dates.length
    ? new Date(
        Math.max(
          ...dates.map(
            value => value.getTime()
          )
        )
      ).toISOString()
    : null;
}

function scopeSeverity(scope = {}) {
  const connectionState =
    upper(scope.connectionState);

  if (FAILED_STATES.has(connectionState)) {
    return 'FAILED';
  }

  const values = [
    scope.state,
    scope.collectionState,
    scope.freshnessStatus
  ]
    .map(upper)
    .filter(Boolean);

  if (
    values.some(
      value => FAILED_STATES.has(value)
    )
  ) {
    return 'FAILED';
  }

  if (
    values.some(
      value => PARTIAL_STATES.has(value)
    )
  ) {
    return 'PARTIAL';
  }

  if (
    values.some(
      value => NEVER_STATES.has(value)
    )
  ) {
    return 'NEVER_COLLECTED';
  }

  if (
    Object.prototype.hasOwnProperty.call(
      scope,
      'connectionState'
    ) &&
    !connectionState
  ) {
    return values.some(
      value => SUCCESS_STATES.has(value)
    )
      ? 'PARTIAL'
      : 'NOT_AVAILABLE';
  }

  if (
    values.some(
      value => SUCCESS_STATES.has(value)
    ) ||
    SUCCESS_STATES.has(connectionState)
  ) {
    return 'HEALTHY';
  }

  return 'NOT_AVAILABLE';
}

function buildSrmScopeSummary({
  syncStates = [],
  field,
  count = null,
  lastCollectedAt = null,
  base = null,
  operationalIssueCount = 0
} = {}) {
  const statuses = syncStates
    .map(row => upper(row[field]))
    .filter(Boolean);

  const failedRow = syncStates.find(
    row =>
      FAILED_STATES.has(
        upper(row[field])
      )
  );

  const failed = statuses.some(
    status => FAILED_STATES.has(status)
  );

  const partial = statuses.some(
    status => PARTIAL_STATES.has(status)
  );

  const succeeded = statuses.some(
    status => SUCCESS_STATES.has(status)
  );

  const numericCount =
    count == null
      ? null
      : Number(count);

  const hasData =
    numericCount != null &&
    numericCount > 0;

  let state =
    base?.state || 'NOT_AVAILABLE';

  let freshnessStatus =
    base?.freshnessStatus ||
    'NOT_AVAILABLE';

  if (!base) {
    if (failed) {
      state = hasData
        ? 'STALE_WITH_DATA'
        : 'FAILED';

      freshnessStatus =
        'COLLECTION_FAILED';
    } else if (partial) {
      state = 'PARTIAL';
      freshnessStatus = 'PARTIAL';
    } else if (succeeded) {
      state = hasData
        ? 'SUCCESS'
        : 'SUCCESS_EMPTY';

      freshnessStatus = 'FRESH';
    } else if (
      statuses.length === 0 &&
      syncStates.length > 0
    ) {
      state = 'NEVER_COLLECTED';

      freshnessStatus =
        'NEVER_COLLECTED';
    }
  }

  if (
    Number(operationalIssueCount) > 0 &&
    [
      'SUCCESS',
      'SUCCESS_EMPTY'
    ].includes(upper(state))
  ) {
    state = 'PARTIAL';
  }

  const resolvedLastCollectedAt =
    base?.lastCollectedAt ||
    lastCollectedAt ||
    (
      succeeded
        ? latestIso(
            syncStates.flatMap(
              row => [
                row.last_successful_sync_at,
                row.updated_at
              ]
            )
          )
        : null
    );

  const errorCode =
    base?.errorCode ||
    failedRow?.last_error_code ||
    null;

  const availability =
    statuses.length ||
    numericCount != null
      ? 'AVAILABLE'
      : 'NOT_AVAILABLE';

  return {
    ...base,

    ...(
      base?.collectionAgeSeconds !==
        undefined
        ? base
        : syncStates.length
          ? buildScopeFreshness({
              syncStates,
              field
            })
          : buildFreshness({
              lastCollectedAt:
                resolvedLastCollectedAt,

              scopeStatuses:
                statuses
            })
    ),

    state,
    count: numericCount,
    errorCode,
    availability
  };
}

function resolveSrmOverallState({
  appliances = [],
  scopes = {}
} = {}) {
  const scopeValues =
    Object.values(scopes)
      .filter(Boolean);

  if (!appliances.length) {
    return 'NOT_AVAILABLE';
  }

  const applianceSeverities =
    appliances.map(scopeSeverity);

  if (
    applianceSeverities.every(
      state => state === 'FAILED'
    )
  ) {
    return 'FAILED';
  }

  const allSeverities = [
    ...applianceSeverities,
    ...scopeValues.map(scopeSeverity)
  ];

  const lastCollectedAt = latestIso([
    ...appliances.map(
      item => item.lastCollectedAt
    ),

    ...scopeValues.map(
      item => item.lastCollectedAt
    )
  ]);

  if (
    !lastCollectedAt &&
    allSeverities.every(
      state =>
        [
          'NEVER_COLLECTED',
          'NOT_AVAILABLE'
        ].includes(state)
    )
  ) {
    return 'NEVER_COLLECTED';
  }

  if (
    allSeverities.some(
      state =>
        ['FAILED', 'PARTIAL']
          .includes(state)
    )
  ) {
    return 'PARTIAL';
  }

  if (
    allSeverities.length &&
    allSeverities.every(
      state => state === 'HEALTHY'
    )
  ) {
    return 'HEALTHY';
  }

  return 'NOT_AVAILABLE';
}

module.exports = {
  buildSrmScopeSummary,
  resolveSrmOverallState,
  scopeSeverity
};