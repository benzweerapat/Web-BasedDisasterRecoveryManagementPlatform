const {
  DATA_FRESHNESS_WARNING_SECONDS,
  DATA_FRESHNESS_CRITICAL_SECONDS
} = require('../config/data-freshness.config');

const FRESHNESS_STATUSES = Object.freeze([
  'FRESH',
  'STALE',
  'NEVER_COLLECTED',
  'COLLECTION_FAILED',
  'PARTIAL',
  'NOT_AVAILABLE'
]);

const DATA_STATES = Object.freeze([
  'SUCCESS',
  'SUCCESS_EMPTY',
  'STALE_WITH_DATA',
  'PARTIAL',
  'FAILED',
  'CONTRACT_ERROR',
  'CANONICAL_EMPTY_WITH_OBSERVATIONS'
]);

const SUCCESS_STATUSES = new Set([
  'OK',
  'SUCCESS',
  'SYNCED',
  'CONNECTED'
]);

const PARTIAL_STATUSES = new Set([
  'PARTIAL',
  'PARTIALLY_SYNCED',
  'SYNCING'
]);

const FAILED_STATUSES = new Set([
  'ERROR',
  'FAILED',
  'FETCH_FAILED',
  'DISCONNECTED'
]);

function validDate(value) {
  if (!value) return null;

  const date = value instanceof Date
    ? value
    : new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function iso(value) {
  return validDate(value)?.toISOString() || null;
}

function latestTimestamp(values = []) {
  const dates = values
    .map(validDate)
    .filter(Boolean);

  if (!dates.length) return null;

  return new Date(
    Math.max(...dates.map(value => value.getTime()))
  );
}

function normalizeStatuses(statuses = []) {
  return statuses
    .flat()
    .filter(
      value =>
        value !== null &&
        value !== undefined &&
        value !== ''
    )
    .map(
      value =>
        String(value).trim().toUpperCase()
    );
}

function buildFreshness({
  lastCollectedAt = null,
  lastSuccessfulCollectionAt = null,
  lastCollectionAttemptAt = null,
  collectionErrorType = null,
  collectionErrorCode = null,
  scopeStatuses = [],
  notAvailable = false,
  now = new Date()
} = {}) {
  const statuses = normalizeStatuses(scopeStatuses);

  const collected = validDate(lastCollectedAt);

  const successful =
    validDate(lastSuccessfulCollectionAt) ||
    collected;

  const attempted =
    validDate(lastCollectionAttemptAt);

  const ageBase = successful || collected;

  const ageSeconds = ageBase
    ? Math.max(
        0,
        Math.floor(
          (
            (validDate(now) || new Date()).getTime() -
            ageBase.getTime()
          ) / 1000
        )
      )
    : null;

  let freshnessStatus;

  if (notAvailable) {
    freshnessStatus = 'NOT_AVAILABLE';
  } else if (
    collectionErrorType ||
    collectionErrorCode ||
    statuses.some(
      status => FAILED_STATUSES.has(status)
    )
  ) {
    freshnessStatus = 'COLLECTION_FAILED';
  } else if (
    statuses.some(
      status => PARTIAL_STATUSES.has(status)
    )
  ) {
    freshnessStatus = 'PARTIAL';
  } else if (!ageBase) {
    freshnessStatus = 'NEVER_COLLECTED';
  } else if (
    ageSeconds > DATA_FRESHNESS_WARNING_SECONDS
  ) {
    freshnessStatus = 'STALE';
  } else {
    freshnessStatus = 'FRESH';
  }

  return {
    freshnessStatus,
    lastCollectedAt: iso(collected),
    lastSuccessfulCollectionAt: iso(successful),
    lastCollectionAttemptAt: iso(attempted),
    collectionAgeSeconds: ageSeconds,
    ageSeconds,

    isDataStale:
      freshnessStatus === 'STALE' ||
      (
        ageBase !== null &&
        ['PARTIAL', 'COLLECTION_FAILED']
          .includes(freshnessStatus)
      ),

    collectionErrorType:
      collectionErrorType ||
      (
        freshnessStatus === 'COLLECTION_FAILED'
          ? 'UPSTREAM_ERROR'
          : null
      ),

    collectionErrorCode:
      collectionErrorCode || null,

    staleSeverity:
      ageSeconds != null &&
      ageSeconds > DATA_FRESHNESS_CRITICAL_SECONDS
        ? 'CRITICAL'
        : (
            freshnessStatus === 'STALE'
              ? 'WARNING'
              : null
          )
  };
}

function deriveDataState({
  hasData,
  observationCount = null,
  canonicalCount = null,
  freshnessStatus,
  scopeFailed = false
} = {}) {
  if (
    observationCount > 0 &&
    canonicalCount === 0
  ) {
    return 'CANONICAL_EMPTY_WITH_OBSERVATIONS';
  }

  if (
    scopeFailed ||
    freshnessStatus === 'COLLECTION_FAILED'
  ) {
    return hasData
      ? 'STALE_WITH_DATA'
      : 'FAILED';
  }

  if (freshnessStatus === 'PARTIAL') {
    return 'PARTIAL';
  }

  return hasData
    ? 'SUCCESS'
    : 'SUCCESS_EMPTY';
}

function combineFreshness(
  models = [],
  overrides = {}
) {
  const usable = models.filter(Boolean);

  if (!usable.length) {
    return buildFreshness({
      notAvailable: true,
      ...overrides
    });
  }

  const statuses = usable.map(
    item => item.freshnessStatus
  );

  const priority = [
    'COLLECTION_FAILED',
    'PARTIAL',
    'NEVER_COLLECTED',
    'STALE',
    'NOT_AVAILABLE',
    'FRESH'
  ];

  const freshnessStatus =
    priority.find(
      status => statuses.includes(status)
    ) || 'NOT_AVAILABLE';

  // Aggregate age describes the oldest required scope, never the newest one.
  const oldest = values =>
    values.every(value => validDate(value))
      ? new Date(
          Math.min(
            ...values.map(
              value => validDate(value).getTime()
            )
          )
        )
      : null;

  const lastCollectedAt = oldest(
    usable.map(item => item.lastCollectedAt)
  );

  const lastSuccessfulCollectionAt = oldest(
    usable.map(
      item => item.lastSuccessfulCollectionAt
    )
  );

  const lastCollectionAttemptAt = latestTimestamp(
    usable.map(
      item => item.lastCollectionAttemptAt
    )
  );

  const base = buildFreshness({
    lastCollectedAt,
    lastSuccessfulCollectionAt,
    lastCollectionAttemptAt,

    collectionErrorType:
      freshnessStatus === 'COLLECTION_FAILED'
        ? 'UPSTREAM_ERROR'
        : null,

    collectionErrorCode:
      usable.find(
        item => item.collectionErrorCode
      )?.collectionErrorCode || null
  });

  const age = usable.every(
    item => item.collectionAgeSeconds != null
  )
    ? Math.max(
        ...usable.map(
          item => item.collectionAgeSeconds
        )
      )
    : null;

  return {
    ...base,
    freshnessStatus,
    collectionAgeSeconds: age,
    ageSeconds: age,

    isDataStale:
      usable.some(
        item =>
          item.isDataStale ||
          item.freshnessStatus === 'STALE'
      ),

    ...overrides
  };
}

// A successful old collection is stale. Failed scopes keep their last known data.
// NEVER_COLLECTED and NOT_AVAILABLE are the existing API aliases for never synced/unknown.
function buildScopeFreshness({
  syncStates = [],
  field,
  rows = [],
  now = new Date(),
  notAvailable = false
} = {}) {
  if (!syncStates.length) {
    return buildFreshness({
      notAvailable,
      now
    });
  }

  return combineFreshness(
    syncStates.map(state => {
      const observations = rows.filter(
        row =>
          row.connection_id ===
          state.connection_id
      );

      const status = String(
        state[field] || ''
      ).toUpperCase();

      const collected = SUCCESS_STATUSES.has(status)
        ? (
            state.last_successful_sync_at ||
            latestTimestamp(
              observations.map(
                row => row.last_seen_at
              )
            )
          )
        : (
            latestTimestamp(
              observations.map(
                row => row.last_seen_at
              )
            ) ||
            state.last_successful_sync_at
          );

      return buildFreshness({
        lastCollectedAt: collected,
        lastSuccessfulCollectionAt: collected,
        lastCollectionAttemptAt:
          state.last_sync_started_at,

        scopeStatuses: [status],

        collectionErrorCode:
          FAILED_STATUSES.has(status)
            ? state.last_error_code
            : null,

        notAvailable:
          status === 'UNSUPPORTED',

        now
      });
    }),
    {}
  );
}

module.exports = {
  FRESHNESS_STATUSES,
  DATA_STATES,
  SUCCESS_STATUSES,
  PARTIAL_STATUSES,
  FAILED_STATUSES,
  buildFreshness,
  buildScopeFreshness,
  combineFreshness,
  deriveDataState,
  latestTimestamp
};