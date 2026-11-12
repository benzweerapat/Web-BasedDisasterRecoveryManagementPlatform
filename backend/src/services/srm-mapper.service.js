const {
  partitionCanonicalAndUnmapped
} = require(
  './entity-partition.service'
);

const crypto = require('crypto');

const {
  parseUrlHost
} = require(
  './appliance-discovery.service'
);

function evaluateCanonicalStateMachine(
  observations,
  canonicalRows
) {
  if (observations.length === 0) {
    return 'SUCCESS_EMPTY';
  }

  if (canonicalRows.length > 0) {
    return 'SUCCESS_CANONICAL';
  }

  return 'CANONICAL_EMPTY_WITH_OBSERVATIONS';
}

exports.buildSrmServersViewModel = (
  rawRows
) => {
  return rawRows.map(
    row => {
      let parsedAddress = {
        original: row.address
      };

      try {
        if (
          row.address &&
          row.address.startsWith('{')
        ) {
          parsedAddress =
            JSON.parse(row.address);
        }
      } catch(e) {}

      return {
        ...row,

        apiReportedServerAddress:
          parsedAddress.original,

        apiEndpointHost:
          parsedAddress.apiEndpointHost ||
          null,

        apiEndpointHostType:
          parsedAddress.apiEndpointHostType ||
          null,

        applianceIp:
          parsedAddress.applianceIp ||
          null,

        applianceSource:
          parsedAddress.applianceIp
            ? 'API_OR_ENDPOINT'
            : 'NOT_PROVIDED_BY_API',

        applianceAvailability:
          parsedAddress.applianceIp
            ? 'AVAILABLE'
            : 'NOT_PROVIDED_BY_API'
      };
    }
  );
};
exports.buildProtectionGroupsViewModel = (
  rawRows
) => {
  const mapObservation = obs => {
    return {
      observationId:
        obs.id,

      observationSiteName:
        obs.local_site,

      observationSrmName:
        obs.observation_srm_name ||
        null,

      observationSrmHost:
        parseUrlHost(
          obs.observation_srm_base_url
        ).host,

      observationVcenterName:
        obs.observation_vcenter_name ||
        null,

      observationVcenterHost:
        parseUrlHost(
          obs.observation_vcenter_base_url
        ).host,

      connectionId:
        obs.connection_id,

      pairingId:
        obs.pairing_id,

      protectionGroupId:
        obs.protection_group_id,

      stableProtectionGroupId:
        obs._resolvedCanonicalKey ||
        null,

      peerProtectionGroupId:
        null,

      name:
        obs.name,

      description:
        obs.description,

      rawStatus:
        obs.raw_status || null,

      normalizedStatus:
        obs.normalized_status ||
        obs.raw_status ||
        null,

      protectionStatus:
        obs.normalized_status ||
        obs.raw_status ||
        null,

      rawRecoveryStatus:
        obs.raw_recovery_status ||
        null,

      normalizedRecoveryStatus:
        obs.normalized_recovery_status ||
        obs.raw_recovery_status ||
        null,

      recoveryStatus:
        obs.normalized_recovery_status ||
        obs.raw_recovery_status ||
        null,

      protectedSiteName:
        obs.protected_site_name ||
        obs.source_site_name ||
        null,

      protectedVcenterName:
        obs.protected_vcenter_name ||
        null,

      protectedVcenterHost:
        parseUrlHost(
          obs.protected_vcenter_base_url
        ).host,

      recoverySiteName:
        obs.recovery_site_name ||
        obs.target_site_name ||
        null,

      recoveryVcenterName:
        obs.recovery_vcenter_name ||
        null,

      recoveryVcenterHost:
        parseUrlHost(
          obs.recovery_vcenter_base_url
        ).host,

      type:
        obs.group_type ||
        obs.type ||
        null,

      replicationType:
        obs.group_type ||
        obs.type ||
        null,

      protectionType:
        obs.group_type ||
        obs.type ||
        null,

      vmCount:
        obs.resolved_vm_count == null
          ? null
          : Number(
              obs.resolved_vm_count
            ),

      vmCountResolutionStatus:
        obs.vm_count_resolution_status ||
        'UNMAPPED',

      protectedVmCount:
        obs.resolved_vm_count == null
          ? null
          : Number(
              obs.resolved_vm_count
            ),

      protectedVms:
        Array.isArray(
          obs.protected_vms
        )
          ? obs.protected_vms
          : [],

      recoveryPlanCount:
        obs.resolved_recovery_plan_count ==
          null
          ? null
          : Number(
              obs.resolved_recovery_plan_count
            ),

      recoveryPlans:
        Array.isArray(
          obs.recovery_plans
        )
          ? obs.recovery_plans
          : [],

      issueCount:
        obs.resolved_issue_count ==
          null
          ? null
          : Number(
              obs.resolved_issue_count
            ),

      lastCollectedAt:
        obs.last_seen_at,

      lastObservationAt:
        obs.last_seen_at
    };
  };

  const mapCanonical =
    groupRows => {
      const primary =
        groupRows.find(
          row =>
            row.protected_vcenter_stable_id &&
            row.protected_vcenter_stable_id ===
              row.observation_vcenter_stable_id
        ) ||
        groupRows[0];

      const mappedPrimary =
        mapObservation(primary);

      return {
        ...mappedPrimary,

        canonicalKey:
          primary._resolvedCanonicalKey,

        canonicalIdentityStatus:
          'COMPLETE',

        canonicalIdentityEvidence:
          primary._canonicalEvidence,

        observationCount:
          groupRows.length,

        observations:
          groupRows.map(
            mapObservation
          )
      };
    };

  rawRows.forEach(
    r => {
      const stableVmIds =
        Array.isArray(
          r.protected_vm_ids
        )
          ? [
              ...r.protected_vm_ids
            ].sort()
          : [];

      const identityMaterial =
        r.canonical_site_pair_key &&
        stableVmIds.length > 0
          ? [
              'PG',
              r.canonical_site_pair_key,
              stableVmIds
            ]
          : (
              r.canonical_site_pair_key &&
              r.name
                ? [
                    'PG',
                    r.canonical_site_pair_key,

                    String(r.name)
                      .trim()
                      .toLowerCase(),

                    r.group_type ||
                    null
                  ]
                : null
            );

      r._resolvedCanonicalKey =
        identityMaterial
          ? `pg-v2-${crypto
              .createHash('sha256')
              .update(
                JSON.stringify(
                  identityMaterial
                )
              )
              .digest('hex')}`
          : null;

      r._canonicalEvidence =
        stableVmIds.length > 0
          ? 'SITE_PAIR+PROTECTED_VM_STABLE_IDS'
          : (
              identityMaterial
                ? 'SITE_PAIR+NAME+TYPE'
                : 'INSUFFICIENT_IDENTITY'
            );

      r.canonical_key =
        r._resolvedCanonicalKey;

      r.canonical_identity_status =
        r._resolvedCanonicalKey
          ? 'COMPLETE'
          : 'INSUFFICIENT';
    }
  );

  const {
    canonicalRows,
    mappedObservations,
    unmappedObservations
  } = partitionCanonicalAndUnmapped(
    rawRows,
    'canonical_key',
    mapCanonical,
    mapObservation
  );

  const state =
    evaluateCanonicalStateMachine(
      rawRows,
      canonicalRows
    );

  return {
    metrics: {
      canonicalGroupCount:
        state ===
        'CANONICAL_EMPTY_WITH_OBSERVATIONS'
          ? null
          : canonicalRows.length,

      observationCount:
        rawRows.length,

      unmappedObservationCount:
        unmappedObservations.length
    },

    state,

    canonicalGroups:
      canonicalRows,

    canonicalRows,

    mappedObservationIds:
      mappedObservations.map(
        row =>
          row.observationId
      ),

    unmappedObservations,

    observations:
      rawRows.map(
        mapObservation
      )
  };
};
exports.buildRecoveryPlansViewModel = (
  rawRows
) => {
  const mapObservation = obs => {
    const historyResolutionStatus =
      obs.history_resolution_status ||
      'NOT_AVAILABLE';

    return {
      observationId: obs.id,

      observationSiteName:
        obs.local_site,

      connectionId:
        obs.connection_id,

      pairingId:
        obs.pairing_id,

      recoveryPlanId:
        obs.recovery_plan_id,

      stableRecoveryPlanId:
        obs._resolvedCanonicalKey ||
        null,

      peerRecoveryPlanId: null,

      name: obs.name,

      rawStatus:
        obs.raw_status || null,

      normalizedStatus:
        obs.normalized_status ||
        obs.raw_status ||
        null,

      protectedSiteName:
        obs.protected_site_name ||
        obs.source_site_name ||
        null,

      protectedVcenterName:
        obs.protected_vcenter_name ||
        null,

      protectedVcenterHost:
        parseUrlHost(
          obs.protected_vcenter_base_url
        ).host,

      recoverySiteName:
        obs.recovery_site_name ||
        obs.target_site_name ||
        null,

      recoveryVcenterName:
        obs.recovery_vcenter_name ||
        null,

      recoveryVcenterHost:
        parseUrlHost(
          obs.recovery_vcenter_base_url
        ).host,

      protectionGroupCount:
        obs.resolved_protection_group_count ==
          null
          ? null
          : Number(
              obs.resolved_protection_group_count
            ),

      protectionGroupCountResolutionStatus:
        obs.protection_group_count_resolution_status ||
        'UNMAPPED',

      protectionGroupIds: [
        ...new Set(
          (
            obs.protection_group_ids ||
            []
          )
            .filter(Boolean)
            .map(String)
        )
      ],

      protectionGroupNames: [
        ...new Set(
          (
            obs.protection_group_names ||
            []
          )
            .filter(Boolean)
            .map(String)
        )
      ],

      vmCount:
        obs.resolved_vm_count == null
          ? null
          : Number(
              obs.resolved_vm_count
            ),

      vmCountResolutionStatus:
        obs.vm_count_resolution_status ||
        'UNMAPPED',

      issueCount:
        obs.resolved_issue_count == null
          ? null
          : Number(
              obs.resolved_issue_count
            ),

      operationTaskId:
        obs.operation_task_id ||
        null,

      operationStatus:
        obs.operation_status ||
        null,

      operationProgressPercent:
        obs.operation_progress_percent ==
          null
          ? null
          : Number(
              obs.operation_progress_percent
            ),

      operationStartedAt:
        obs.operation_started_at ||
        null,

      operationCompletedAt:
        obs.operation_completed_at ||
        null,

      operationDescription:
        obs.operation_description ||
        null,

      operationResolutionStatus:
        obs.operation_resolution_status ||
        'NOT_AVAILABLE',

      lastRunType:
        obs.last_run_type,

      lastRunStatus:
        obs.last_run_status ||
        (
          historyResolutionStatus ===
          'AVAILABLE_EMPTY'
            ? 'NO_HISTORY_IN_RANGE'
            : 'NOT_AVAILABLE'
        ),

      lastRunStartedAt:
        obs.last_run_started_at,

      lastRunCompletedAt:
        obs.last_run_completed_at,

      lastRunDuration:
        obs.last_run_duration,

      historyResolutionStatus,

      lastCollectedAt:
        obs.last_seen_at,

      lastObservationAt:
        obs.last_seen_at
    };
  };

  const mapCanonical =
    groupRows => {
      // A canonical row may arrive newest-first from the recovery appliance.
      // Resolve its actionable observation by stable vCenter identity, not labels
      // such as "DC" versus "srm-DC", which need not be equal.
      const primary =
        groupRows.find(
          row =>
            row.protected_vcenter_stable_id &&
            row.protected_vcenter_stable_id ===
              row.observation_vcenter_stable_id
        ) ||

        groupRows.find(
          row =>
            row.local_site &&
            row.protected_site_name &&
            row.local_site ===
              row.protected_site_name
        ) ||

        groupRows[0];

      const mappedPrimary =
        mapObservation(primary);

      return {
        ...mappedPrimary,

        canonicalKey:
          primary._resolvedCanonicalKey,

        canonicalIdentityStatus:
          'COMPLETE',

        canonicalIdentityEvidence:
          primary._canonicalEvidence,

        observationCount:
          groupRows.length,

        observations:
          groupRows.map(
            mapObservation
          )
      };
    };

  rawRows.forEach(
    r => {
      // Recovery plans are independently named objects. Two plans may legally
      // contain the same protection groups/VMs, so VM membership cannot be used
      // as the canonical identity or the rows collapse into one plan.
      const identityMaterial =
        r.canonical_site_pair_key &&
        r.name
          ? [
              'RP',
              r.canonical_site_pair_key,

              String(r.name)
                .trim()
                .toLowerCase()
            ]
          : null;

      r._resolvedCanonicalKey =
        identityMaterial
          ? `rp-v2-${crypto
              .createHash('sha256')
              .update(
                JSON.stringify(
                  identityMaterial
                )
              )
              .digest('hex')}`
          : null;

      r._canonicalEvidence =
        identityMaterial
          ? 'SITE_PAIR+NAME'
          : 'INSUFFICIENT_IDENTITY';

      r.canonical_key =
        r._resolvedCanonicalKey;

      r.canonical_identity_status =
        r._resolvedCanonicalKey
          ? 'COMPLETE'
          : 'INSUFFICIENT';
    }
  );

  const {
    canonicalRows,
    mappedObservations,
    unmappedObservations
  } = partitionCanonicalAndUnmapped(
    rawRows,
    'canonical_key',
    mapCanonical,
    mapObservation
  );

  const state =
    evaluateCanonicalStateMachine(
      rawRows,
      canonicalRows
    );

  return {
    metrics: {
      canonicalPlanCount:
        state ===
        'CANONICAL_EMPTY_WITH_OBSERVATIONS'
          ? null
          : canonicalRows.length,

      observationCount:
        rawRows.length,

      unmappedObservationCount:
        unmappedObservations.length
    },

    state,

    canonicalPlans:
      canonicalRows,

    canonicalRows,

    mappedObservationIds:
      mappedObservations.map(
        row =>
          row.observationId
      ),

    unmappedObservations,

    observations:
      rawRows.map(
        mapObservation
      )
  };
};

const {
  resolveMappingSites
} = require(
  './mapping-resolution.service'
);
const MAPPING_SCOPE_DEFINITIONS =
  Object.freeze({
    NETWORK:
      'network_mapping_sync_status',

    TEST_NETWORK:
      'test_network_mapping_sync_status',

    FOLDER:
      'folder_mapping_sync_status',

    RESOURCE:
      'resource_mapping_sync_status',

    STORAGE_POLICY:
      'storage_policy_mapping_sync_status'
  });

function validDate(value) {
  if (!value) return null;

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function latestIso(values = []) {
  const dates = values
    .map(validDate)
    .filter(Boolean);

  if (!dates.length) {
    return null;
  }

  return new Date(
    Math.max(
      ...dates.map(
        date => date.getTime()
      )
    )
  ).toISOString();
}

const {
  buildScopeFreshness
} = require(
  './data-freshness.service'
);

function buildMappingScopeStates(
  rawRows = [],
  syncStates = []
) {
  const states =
    Array.isArray(syncStates)
      ? syncStates
      : (
          syncStates
            ? [syncStates]
            : []
        );

  return Object.fromEntries(
    Object.entries(
      MAPPING_SCOPE_DEFINITIONS
    ).map(
      ([type, field]) => {
        const values = states
          .map(
            row =>
              String(
                row[field] || ''
              ).toUpperCase()
          )
          .filter(Boolean);

        const rowsForScope =
          rawRows.filter(
            row =>
              row.mapping_type ===
              type
          );

        const hasLastKnownGood =
          rowsForScope.length > 0;

        const failed =
          values.includes('FAILED') ||
          values.includes(
            'FETCH_FAILED'
          ) ||
          values.includes('ERROR');

        const partial =
          values.includes('PARTIAL') ||
          values.includes('SYNCING');

        const succeeded =
          values.includes('SYNCED') ||
          values.includes('SUCCESS') ||
          values.includes('OK');

        const unsupported =
          values.length > 0 &&
          values.every(
            value =>
              value === 'UNSUPPORTED'
          );

        let normalizedStatus =
          'NEVER_SYNCED';

        let fetchStatus =
          'NOT_ATTEMPTED';

        let freshnessStatus =
          'NEVER_COLLECTED';

        let stale = false;

        if (failed) {
          normalizedStatus =
            hasLastKnownGood
              ? 'PRESENT'
              : 'FETCH_FAILED';

          fetchStatus = 'FAILED';

          freshnessStatus =
            'COLLECTION_FAILED';

          stale = hasLastKnownGood;
        } else if (partial) {
          normalizedStatus =
            hasLastKnownGood
              ? 'PRESENT'
              : 'PARTIAL';

          fetchStatus = 'PARTIAL';
          freshnessStatus = 'PARTIAL';
          stale = hasLastKnownGood;
        } else if (succeeded) {
          normalizedStatus =
            hasLastKnownGood
              ? 'PRESENT'
              : 'SUCCESS_EMPTY';

          fetchStatus = 'SUCCESS';
          freshnessStatus = 'FRESH';
        } else if (unsupported) {
          normalizedStatus =
            'UNSUPPORTED';

          fetchStatus =
            'UNSUPPORTED';

          freshnessStatus =
            'NOT_AVAILABLE';
        }

        const lastKnownGoodAt =
          latestIso(
            rowsForScope.flatMap(
              row => [
                row.last_seen_at,
                row.updated_at,
                row.created_at
              ]
            )
          );

        const successfulEmptyAt =
          !hasLastKnownGood &&
          succeeded
            ? latestIso(
                states
                  .filter(
                    row =>
                      [
                        'SYNCED',
                        'SUCCESS',
                        'OK'
                      ].includes(
                        String(
                          row[field] ||
                          ''
                        ).toUpperCase()
                      )
                  )
                  .flatMap(
                    row => [
                      row.updated_at,
                      row.last_sync_started_at,
                      row.last_successful_sync_at
                    ]
                  )
              )
            : null;

        const lastCollectedAt =
          lastKnownGoodAt ||
          successfulEmptyAt;

        const failedState =
          states.find(
            row =>
              [
                'FAILED',
                'FETCH_FAILED',
                'ERROR'
              ].includes(
                String(
                  row[field] || ''
                ).toUpperCase()
              )
          );

        const freshness =
          buildScopeFreshness({
            syncStates: states,
            field,
            rows: rowsForScope
          });

        return [
          type,
          {
            status:
              normalizedStatus,

            normalizedStatus,
            fetchStatus,
            freshnessStatus,
            stale,

            sourceStatuses:
              values,

            errorCode:
              failedState
                ?.last_error_code ||
              null,

            lastCollectedAt,

            lastSuccessfulCollectionAt:
              lastCollectedAt,

            lastCollectionAttemptAt:
              latestIso(
                states.flatMap(
                  row => [
                    row.last_sync_started_at,
                    row.updated_at
                  ]
                )
              ),

            ...freshness,

            stale:
              failed || partial
                ? hasLastKnownGood
                : freshness.isDataStale,

            isDataStale:
              failed || partial
                ? hasLastKnownGood
                : freshness.isDataStale
          }
        ];
      }
    )
  );
}

exports.buildMappingScopeStates =
  buildMappingScopeStates;

exports.MAPPING_SCOPE_DEFINITIONS =
  MAPPING_SCOPE_DEFINITIONS;
  exports.buildMappingsViewModel = (
  rawRows,
  syncStates = []
) => {
  const scopeStates =
    buildMappingScopeStates(
      rawRows,
      syncStates
    );

  const mappedRows =
    rawRows.map(
      r => {
        const scopeState =
          scopeStates[
            r.mapping_type
          ] || {
            normalizedStatus:
              'NEVER_SYNCED',

            fetchStatus:
              'NOT_ATTEMPTED',

            freshnessStatus:
              'NEVER_COLLECTED',

            stale: false,
            errorCode: null
          };

        const sitePairContext = {
          localSiteName:
            r.source_site_name ||
            r.connection_site ||
            null,

          remoteSiteName:
            r.target_site_name ||
            null,

          localVcenterStableId:
            r.local_vcenter_id ||
            null,

          remoteVcenterStableId:
            r.remote_vcenter_id ||
            null,

          localVcenterName:
            r.source_vcenter_name ||
            null,

          remoteVcenterName:
            r.target_vcenter_name ||
            null,

          localVcenterHost:
            parseUrlHost(
              r.source_vcenter_base_url
            ).host,

          remoteVcenterHost:
            parseUrlHost(
              r.target_vcenter_base_url
            ).host
        };

        const resolution =
          resolveMappingSites(
            {
              ...r,
              fetch_status: null,
              stale: false
            },

            sitePairContext
          );

        const normalizedStatus =
          resolution.mappingStatus;

        return {
          ...r,

          mappingKey:
            `${r.connection_id}:${r.pairing_id || 'none'}:${r.mapping_id}`,

          observationSiteName:
            r.connection_site ||
            null,

          resolved_source_site:
            resolution.sourceSite,

          resolved_target_site:
            resolution.targetSite,

          source_vcenter_name:
            resolution
              .sourceVcenterName,

          source_vcenter_host:
            resolution
              .sourceVcenterHost,

          target_vcenter_name:
            resolution
              .targetVcenterName,

          target_vcenter_host:
            resolution
              .targetVcenterHost,

          normalized_status:
            normalizedStatus,

          resolved_mapping_status:
            normalizedStatus,

          site_resolution_status:
            resolution
              .siteResolutionStatus,

          site_resolution_evidence:
            resolution
              .siteResolutionEvidence,

          fetch_status:
            scopeState.fetchStatus,

          freshness_status:
            scopeState.freshnessStatus,

          stale:
            scopeState.stale,

          collection_error_code:
            scopeState.errorCode,

          last_collected_at:
            scopeState.lastCollectedAt,

          last_successful_collection_at:
            scopeState
              .lastSuccessfulCollectionAt,

          last_collection_attempt_at:
            scopeState
              .lastCollectionAttemptAt
        };
      }
    );

  const counts = {
    totalObservationCount:
      mappedRows.length,

    NETWORK:
      mappedRows.filter(
        r =>
          r.mapping_type ===
          'NETWORK'
      ).length,

    TEST_NETWORK:
      mappedRows.filter(
        r =>
          r.mapping_type ===
          'TEST_NETWORK'
      ).length,

    FOLDER:
      mappedRows.filter(
        r =>
          r.mapping_type ===
          'FOLDER'
      ).length,

    RESOURCE:
      mappedRows.filter(
        r =>
          r.mapping_type ===
          'RESOURCE'
      ).length,

    STORAGE_POLICY:
      mappedRows.filter(
        r =>
          r.mapping_type ===
          'STORAGE_POLICY'
      ).length
  };

  const stateValues =
    Object.values(scopeStates);

  const hasCollectionFailure =
    stateValues.some(
      item =>
        item.fetchStatus ===
        'FAILED'
    );

  const hasPartialCollection =
    stateValues.some(
      item =>
        item.fetchStatus ===
        'PARTIAL'
    );

  const hasUnsupportedScope =
    stateValues.some(
      item =>
        item.fetchStatus ===
        'UNSUPPORTED'
    );

  const scopeStatus =
    hasCollectionFailure ||
    hasPartialCollection
      ? 'PARTIAL'
      : (
          hasUnsupportedScope
            ? 'SUCCESS_WITH_UNSUPPORTED_SCOPE'
            : 'SUCCESS'
        );

  return {
    metrics: {
      ...counts,

      presentCount:
        mappedRows.filter(
          row =>
            row.resolved_mapping_status ===
            'PRESENT'
        ).length,

      unmappedCount:
        mappedRows.filter(
          row =>
            row.resolved_mapping_status ===
            'UNMAPPED_IDENTITY'
        ).length,

      failedCount:
        Object.values(
          scopeStates
        ).filter(
          item =>
            item.fetchStatus ===
            'FAILED'
        ).length,

      unsupportedCount:
        Object.values(
          scopeStates
        ).filter(
          item =>
            item.normalizedStatus ===
            'UNSUPPORTED'
        ).length
    },

    observations:
      mappedRows,

    data:
      mappedRows,

    scopeStates,
    scopeStatus,

    isDataStale:
      Object.values(
        scopeStates
      ).some(
        item => item.stale
      )
  };
};
exports.buildPlaceholderDatastoresViewModel = (
  rawRows,
  syncState
) => {
  const syncStates =
    Array.isArray(syncState)
      ? syncState
      : (
          syncState
            ? [syncState]
            : []
        );

  const statuses =
    syncStates
      .map(
        row =>
          String(
            row.placeholder_datastore_sync_status ||
            ''
          ).toUpperCase()
      )
      .filter(Boolean);

  const failed =
    statuses.includes('FAILED') ||
    statuses.includes('ERROR');

  const partial =
    statuses.includes('PARTIAL') ||
    statuses.includes('SYNCING');

  const succeeded =
    statuses.includes('SYNCED') ||
    statuses.includes('SUCCESS') ||
    statuses.includes('OK');

  const hasData =
    rawRows.length > 0;

  const normalizedStatus =
    failed
      ? (
          hasData
            ? 'PRESENT'
            : 'FETCH_FAILED'
        )
      : (
          partial
            ? (
                hasData
                  ? 'PRESENT'
                  : 'PARTIAL'
              )
            : (
                succeeded
                  ? (
                      hasData
                        ? 'PRESENT'
                        : 'SUCCESS_EMPTY'
                    )
                  : 'NEVER_SYNCED'
              )
        );

  const fetchStatus =
    failed
      ? 'FAILED'
      : (
          partial
            ? 'PARTIAL'
            : (
                succeeded
                  ? 'SUCCESS'
                  : 'NOT_ATTEMPTED'
              )
        );

  const freshness =
    buildScopeFreshness({
      syncStates,

      field:
        'placeholder_datastore_sync_status',

      rows:
        rawRows
    });

  const freshnessStatus =
    freshness.freshnessStatus;

  const lastCollectedAt =
    latestIso(
      rawRows.flatMap(
        row => [
          row.last_seen_at,
          row.updated_at,
          row.created_at
        ]
      )
    ) ||

    (
      succeeded
        ? latestIso(
            syncStates.flatMap(
              row => [
                row.updated_at,
                row.last_sync_started_at,
                row.last_successful_sync_at
              ]
            )
          )
        : null
    );

  const safeErrorCode =
    failed || partial
      ? (
          syncStates.find(
            row =>
              row.last_error_code
          )?.last_error_code ||
          'API_FAILURE'
        )
      : null;

  const scopeState = {
    status:
      normalizedStatus,

    normalizedStatus,
    fetchStatus,
    freshnessStatus,

    stale:
      hasData &&
      (
        failed ||
        partial
      ),

    errorCode:
      safeErrorCode,

    lastCollectedAt,

    lastSuccessfulCollectionAt:
      lastCollectedAt,

    lastCollectionAttemptAt:
      latestIso(
        syncStates.flatMap(
          row => [
            row.last_sync_started_at,
            row.updated_at
          ]
        )
      ),

    ...freshness,

    stale:
      freshness.isDataStale
  };

  return {
    data:
      rawRows,

    observations:
      rawRows,

    scopeStatus:
      normalizedStatus,

    scopeState,
    freshnessStatus,
    safeErrorCode,

    isDataStale:
      scopeState.stale
  };
};
exports.buildPlaceholderDatastoresViewModel = (
  rawRows,
  syncState
) => {
  const syncStates =
    Array.isArray(syncState)
      ? syncState
      : (
          syncState
            ? [syncState]
            : []
        );

  const statuses =
    syncStates
      .map(
        row =>
          String(
            row.placeholder_datastore_sync_status ||
            ''
          ).toUpperCase()
      )
      .filter(Boolean);

  const failed =
    statuses.includes('FAILED') ||
    statuses.includes('ERROR');

  const partial =
    statuses.includes('PARTIAL') ||
    statuses.includes('SYNCING');

  const succeeded =
    statuses.includes('SYNCED') ||
    statuses.includes('SUCCESS') ||
    statuses.includes('OK');

  const hasData =
    rawRows.length > 0;

  const normalizedStatus =
    failed
      ? (
          hasData
            ? 'PRESENT'
            : 'FETCH_FAILED'
        )
      : (
          partial
            ? (
                hasData
                  ? 'PRESENT'
                  : 'PARTIAL'
              )
            : (
                succeeded
                  ? (
                      hasData
                        ? 'PRESENT'
                        : 'SUCCESS_EMPTY'
                    )
                  : 'NEVER_SYNCED'
              )
        );

  const fetchStatus =
    failed
      ? 'FAILED'
      : (
          partial
            ? 'PARTIAL'
            : (
                succeeded
                  ? 'SUCCESS'
                  : 'NOT_ATTEMPTED'
              )
        );

  const freshness =
    buildScopeFreshness({
      syncStates,

      field:
        'placeholder_datastore_sync_status',

      rows:
        rawRows
    });

  const freshnessStatus =
    freshness.freshnessStatus;

  const lastCollectedAt =
    latestIso(
      rawRows.flatMap(
        row => [
          row.last_seen_at,
          row.updated_at,
          row.created_at
        ]
      )
    ) ||

    (
      succeeded
        ? latestIso(
            syncStates.flatMap(
              row => [
                row.updated_at,
                row.last_sync_started_at,
                row.last_successful_sync_at
              ]
            )
          )
        : null
    );

  const safeErrorCode =
    failed || partial
      ? (
          syncStates.find(
            row =>
              row.last_error_code
          )?.last_error_code ||
          'API_FAILURE'
        )
      : null;

  const scopeState = {
    status:
      normalizedStatus,

    normalizedStatus,
    fetchStatus,
    freshnessStatus,

    stale:
      hasData &&
      (
        failed ||
        partial
      ),

    errorCode:
      safeErrorCode,

    lastCollectedAt,

    lastSuccessfulCollectionAt:
      lastCollectedAt,

    lastCollectionAttemptAt:
      latestIso(
        syncStates.flatMap(
          row => [
            row.last_sync_started_at,
            row.updated_at
          ]
        )
      ),

    ...freshness,

    stale:
      freshness.isDataStale
  };

  return {
    data:
      rawRows,

    observations:
      rawRows,

    scopeStatus:
      normalizedStatus,

    scopeState,
    freshnessStatus,
    safeErrorCode,

    isDataStale:
      scopeState.stale
  };
};