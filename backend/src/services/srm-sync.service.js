const srmAdapter =
  require('../adapters/vmware/srm.adapter');

const srmMappingSoapAdapter =
  require('../adapters/vmware/srm-mapping-soap.adapter');

const connectionRepository =
  require('../repositories/connection.repository');

const srmRepository =
  require('../repositories/srm.repository');

const srmNormalizer =
  require('./srm-normalizer.service');

const {
  decryptCredential
} = require('../utils/encryption.util');

const {
  pool
} = require('../../db');

const syncCoordinator =
  require('./sync-coordinator.service');

const {
  createLiveCollectionResult
} = require('./live-collection-evidence.service');

const {
  resolveVmwareConnectionFailureStatus
} = require('./vmware-connection-status.service');

const {
  createSrmSessionContext,
  executeWithSrmSessionRetry
} = require('./srm-session.service');

const syncLocks = new Map();

const SOAP_RESULT_KEYS = Object.freeze({
  NETWORK:
    'networkMappings',

  FOLDER:
    'folderMappings',

  RESOURCE:
    'resourcePoolMappings',

  TEST_NETWORK:
    'testNetworkMappings'
});

const MAPPING_SCOPE_STATUS_FIELDS =
  Object.freeze([
    'network_mapping_sync_status',
    'test_network_mapping_sync_status',
    'folder_mapping_sync_status',
    'resource_mapping_sync_status',
    'storage_policy_mapping_sync_status',
    'placeholder_datastore_sync_status'
  ]);

function summarizeMappingSyncStatus(
  scopeStatus = {}
) {
  const statuses =
    MAPPING_SCOPE_STATUS_FIELDS
      .map(
        field =>
          scopeStatus[field]
      );

  if (
    statuses.some(
      status =>
        status === 'FAILED' ||
        status === 'PARTIAL'
    )
  ) return 'PARTIAL';

  if (
    statuses.some(
      status =>
        status === 'SYNCING' ||
        !status
    )
  ) return 'FAILED';

  if (
    statuses.some(
      status =>
        status === 'UNSUPPORTED'
    )
  ) return 'SYNCED_WITH_UNSUPPORTED_SCOPE';

  return statuses.every(
    status =>
      status === 'SYNCED'
  )
    ? 'SYNCED'
    : 'FAILED';
}

function finalizeInterruptedScopeStatuses(
  scopeStatus = {}
) {
  for (
    const key of
    Object.keys(scopeStatus)
  ) {
    if (
      key.endsWith(
        '_sync_status'
      ) &&
      scopeStatus[key] ===
        'SYNCING'
    ) scopeStatus[key] =
      'FAILED';
  }

  scopeStatus.mapping_sync_status =
    summarizeMappingSyncStatus(
      scopeStatus
    );

  return scopeStatus;
}

// Empty authoritative parent catalogues have no child requests to perform.
function summarizeCoreSyncStatus(state) {
  const statuses =
    Object.entries(state)
      .filter(
        ([key]) =>
          key.endsWith(
            '_sync_status'
          ) &&
          key !==
            'core_sync_status'
      )
      .map(
        ([, value]) =>
          value
      );

  return statuses.some(
    value =>
      [
        'FAILED',
        'PARTIAL',
        'SYNCING'
      ].includes(value)
  )
    ? 'PARTIAL'
    : 'SYNCED';
}

function finalizeEmptyChildScopes(
  state,
  protectionGroups,
  recoveryPlans
) {
  for (
    const [
      parent,
      child,
      rows
    ] of [
      [
        'protection_group_sync_status',
        'protected_vm_sync_status',
        protectionGroups
      ],
      [
        'recovery_plan_sync_status',
        'recovery_plan_vm_sync_status',
        recoveryPlans
      ]
    ]
  ) {
    if (
      state[parent] ===
        'SYNCED' &&
      rows.length === 0 &&
      state[child] ===
        'SYNCING'
    ) state[child] =
      'SYNCED';
  }
}

function mappingEndpointPath(
  pairingId,
  srmId,
  restType
) {
  return `/pairings/${pairingId}/srms/${srmId}/inventory-mappings/${restType}`;
}

function normalizeSoapMappings(
  rows = []
) {
  return rows.map(
    mapping => ({
      id:
        `${mapping.primaryObject?.value || 'unknown'}-${mapping.secondaryObject?.value || 'unknown'}`,

      source: {
        id:
          mapping.primaryObject
            ?.value ||
          null,

        name:
          mapping.primaryObject
            ?.value ||
          null,

        type:
          mapping.primaryObject
            ?.type ||
          null
      },

      target: {
        id:
          mapping.secondaryObject
            ?.value ||
          null,

        name:
          mapping.secondaryObject
            ?.value ||
          null,

        type:
          mapping.secondaryObject
            ?.type ||
          null
      },

      status:
        'SOAP_SYNCED'
    })
  );
}

function deduplicateMappingObservations(
  rows = []
) {
  const unique = new Map();

  for (const row of rows) {
    const key = [
      row.connection_id,
      row.pairing_id || '',
      row.srm_id,
      row.mapping_id
    ].join('|');

    unique.set(key, row);
  }

  return [
    ...unique.values()
  ];
}

function validateRestMappingContract(
  mappingType,
  rows = []
) {
  const expectedTypes = {
    NETWORK:
      new Set([
        'Network',
        'DistributedVirtualPortgroup',
        'OpaqueNetwork'
      ]),

    TEST_NETWORK:
      new Set([
        'Network',
        'DistributedVirtualPortgroup',
        'OpaqueNetwork'
      ]),

    FOLDER:
      new Set([
        'Folder'
      ]),

    RESOURCE:
      new Set([
        'ResourcePool',
        'ComputeResource',
        'ClusterComputeResource',
        'HostSystem'
      ]),

    STORAGE_POLICY:
      new Set([
        'StorageProfile'
      ])
  }[mappingType];

  if (
    !expectedTypes ||
    rows.length === 0
  ) return rows;

  const actualTypes =
    rows.map(row => {
      const value =
        row.primary_object ||
        row.source?.id ||
        null;

      return 
        typeof value ===
          'string' &&
        value.includes(':')
      
        ? value.split(
          ':',
          1
        )[0]
        : row.source?.type ||
          null;
    }).filter(Boolean);

  if (
    actualTypes.length > 0 &&
    actualTypes.some(
      type =>
        !expectedTypes.has(type)
    )
  ) {
    const error =
      new Error(
        `SRM REST mapping contract does not represent ${mappingType}`
      );

    error.code =
      'SRM_MAPPING_REST_CONTRACT_UNSUPPORTED';

    error.protocol = 'REST';

    error.sessionPhase =
      'CONTRACT_VALIDATION';

    error.safeFaultType =
      'REST_MAPPING_OBJECT_TYPE_MISMATCH';

    throw error;
  }

  return rows;
}

function safeSessionLog(diagnostic) {
  console.warn(
    '[SRM Mapping Session]',
    diagnostic
  );
}

class SrmSyncService {
  async syncSrm(
    localConnectionId,
    username,
    runId,
    requestContext = {}
  ) {
    if (
      syncLocks.has(
        localConnectionId
      )
    ) {
      throw new Error(
        `SYNC_ALREADY_IN_PROGRESS`
      );
    }

    let coordinatorToken =
      requestContext
        .coordinatorToken ||
      null;

    let ownsCoordinator = false;

    if (!coordinatorToken) {
      coordinatorToken =
        syncCoordinator.acquire({
          kind: 'SRM_SYNC',

          requestId:
            requestContext.requestId,

          connectionId:
            localConnectionId
        });

      ownsCoordinator = true;
    }

    syncLocks.set(
      localConnectionId,
      runId
    );

    const parentSyncRunId =
      requestContext.syncRunId ||
      requestContext.requestId ||
      runId;

    const collectionStartedAt =
      new Date();

    const scopeStatus = {
      core_sync_status:
        'SYNCING',

      pairing_sync_status:
        'SYNCING',

      server_sync_status:
        'SYNCING',

      protection_group_sync_status:
        'SYNCING',

      protected_vm_sync_status:
        'SYNCING',

      recovery_plan_sync_status:
        'SYNCING',

      recovery_plan_vm_sync_status:
        'SYNCING',

      mapping_sync_status:
        'SYNCING',

      network_mapping_sync_status:
        'SYNCING',

      test_network_mapping_sync_status:
        'SYNCING',

      folder_mapping_sync_status:
        'SYNCING',

      resource_mapping_sync_status:
        'SYNCING',

      storage_policy_mapping_sync_status:
        'SYNCING',

      placeholder_datastore_sync_status:
        'SYNCING',

      issue_sync_status:
        'SYNCING',

      task_sync_status:
        'SYNCING',

      last_error_code: null,

      last_sync_started_at:
        new Date(),

      sync_run_id: runId
    };

    let localConnection;
    let localSessionId = null;

    let localSessionAuthenticated =
      false;

    let sessionContext = null;

    const pairingSessionContexts =
      new Map();

    try {
      console.log(
        `Starting SRM sync for connection ${localConnectionId} (Run: ${runId})`
      );

      localConnection =
        await connectionRepository
          .findConnectionWithCredentialById(
            localConnectionId
          );

      if (
        !localConnection ||
        localConnection.systemType !==
          'SRM'
      ) {
        throw new Error(
          'INVALID_SRM_CONNECTION'
        );
      }

      await srmRepository
        .upsertSyncState(
          localConnectionId,
          scopeStatus
        );

      const localBaseUrl =
        localConnection.baseUrl;

      const verifyTls =
        localConnection.verifyTls;

      const localPassword =
        localConnection
          .encryptedPassword
          ? decryptCredential(
            localConnection
              .encryptedPassword,

            localConnection
              .encryptionIv,

            localConnection
              .encryptionAuthTag
          )
          : null;

      const authenticateLocal =
        async (
          sessionState =
            'AUTHENTICATED'
        ) => {
          localSessionId =
            await srmAdapter
              .loginLocal(
                localBaseUrl,
                localConnection
                  .username,
                localPassword,
                verifyTls
              );

          localSessionAuthenticated =
            true;

          await connectionRepository
            .updateConnectionTestStatus(
              localConnectionId,
              'CONNECTED',
              new Date()
            )
            .catch(() => {});

          sessionContext =
            createSrmSessionContext({
              connectionId:
                localConnectionId,

              site:
                localConnection.site,

              localSrmHost:
                localBaseUrl,

              protocol:
                'REST',

              authenticatedAt:
                new Date()
                  .toISOString(),

              sessionState
            });

          return localSessionId;
        };

      const establishPairingSession =
        async pairingContext => {
          if (
            !pairingContext ||
            pairingContext.isSelf
          ) return;

          await srmAdapter
            .createRemoteSession(
              localBaseUrl,
              localSessionId,
              pairingContext
                .pairingId,
              pairingContext
                .remoteConnection
                .username,
              pairingContext
                .remotePassword,
              verifyTls
            );

          pairingContext
            .remoteSessionState =
            'CONNECTED';
        };

      const reauthenticateForMappings =
        async () => {
          if (localSessionId) {
            await srmAdapter
              .logoutLocal(
                localBaseUrl,
                localSessionId,
                verifyTls
              );

            localSessionId = null;
          }

          await authenticateLocal(
            'REAUTHENTICATED'
          );

          for (
            const pairingContext of
            pairingSessionContexts
              .values()
          ) {
            await establishPairingSession(
              pairingContext
            );
          }
        };

      // 1. Local Login. The raw token remains function-local and is never logged or persisted.
      await authenticateLocal();

      let localApplianceInfo = null;

      try {
        localApplianceInfo =
          await srmAdapter
            .getApplianceInfo(
              localBaseUrl,
              localSessionId,
              verifyTls
            );
      } catch (e) {
        console.warn(
          `Failed to get appliance info for ${localBaseUrl}`
        );
      }

      const {
        URL
      } = require('url');

      const net = require('net');

      const apiEndpointHost =
        new URL(
          localBaseUrl
        ).hostname;

      const apiEndpointHostType =
        net.isIP(apiEndpointHost)
          ? 'IP'
          : 'FQDN';

      const applianceIp =
        localApplianceInfo &&
        localApplianceInfo.ip ||
        (
          apiEndpointHostType ===
            'IP'
            ? apiEndpointHost
            : null
        );
              // We will store all fetched data in memory first
      let sitePairs = [];
      let servers = [];
      let protectionGroups = [];
      let protectedVms = [];
      let recoveryPlans = [];
      let recoveryPlanGroups = [];
      let recoveryPlanVms = [];

      const fetchedPlanGroups = [],
        fetchedPlanVms = [];

      let recoveryHistory = [];
      let recoveryPlanSteps = [];

      let recoveryPlanStepFetchFailures =
        0;

      let mappings = [];
      let datastores = [];
      let issues = [];
      let tasks = [];
      let syncedMappingTypes = [];

      try {
        const rawSitePairs =
          await srmAdapter
            .getSitePairs(
              localBaseUrl,
              localSessionId,
              verifyTls
            )
            .catch(error => {
              scopeStatus
                .pairing_sync_status =
                'FAILED';

              scopeStatus
                .last_error_code =
                /^SRM_HTTP_\d{3}$/
                  .test(
                    String(
                      error?.code ||
                      ''
                    )
                  )
                  ? error.code
                  : 'SRM_SITE_PAIR_COLLECTION_FAILED';

              return null;
            });

        if (rawSitePairs) {
          sitePairs =
            srmNormalizer
              .normalizeSitePairs(
                localConnectionId,
                rawSitePairs,
                runId
              );

          scopeStatus
            .pairing_sync_status =
            'SYNCED';

          scopeStatus
            .last_pairing_count =
            sitePairs.length;

          for (
            const pair of
            sitePairs
          ) {
            const isSelf =
              pair.local_vcenter_id &&
              pair.local_vcenter_id ===
                pair.remote_vcenter_id;

            pair.pairing_type =
              isSelf
                ? 'SELF'
                : 'CROSS_SITE';

            if (!isSelf) {
              const remoteResolution =
                await connectionRepository
                  .resolveRemoteSrmConnectionForPairing(
                    localConnectionId,
                    {
                      pairingId:
                        pair.pairing_id,

                      localVcenterId:
                        pair.local_vcenter_id,

                      remoteVcenterId:
                        pair.remote_vcenter_id
                    }
                  );

              if (
                remoteResolution
                  ?.remoteSrmConnectionId
              ) {
                const remoteConn =
                  await connectionRepository
                    .findConnectionWithCredentialById(
                      remoteResolution
                        .remoteSrmConnectionId
                    );

                if (remoteConn) {
                  try {
                    const remotePassword =
                      remoteConn
                        .encryptedPassword
                        ? decryptCredential(
                          remoteConn
                            .encryptedPassword,

                          remoteConn
                            .encryptionIv,

                          remoteConn
                            .encryptionAuthTag
                        )
                        : null;

                    const pairingContext = {
                      pairingId:
                        pair.pairing_id,

                      isSelf: false,

                      remoteConnection:
                        remoteConn,

                      remotePassword,

                      resolutionSource:
                        remoteResolution
                          .resolutionSource,

                      remoteSessionState:
                        'AUTHENTICATING'
                    };

                    pairingSessionContexts
                      .set(
                        pair.pairing_id,
                        pairingContext
                      );

                    await establishPairingSession(
                      pairingContext
                    );

                    pair.remote_session_status =
                      'CONNECTED';
                  } catch (e) {
                    pair.remote_session_status =
                      'ERROR';

                    safeSessionLog({
                      connectionId:
                        localConnectionId,

                      site:
                        localConnection.site ||
                        null,

                      product:
                        'SRM',

                      endpointPath:
                        `/pairings/${pair.pairing_id}/remote-session`,

                      protocol:
                        'REST',

                      httpStatus:
                        e.httpStatus ||
                        e.response?.status ||
                        null,

                      vmwareSafeFaultType:
                        e.code ||
                        'SRM_REMOTE_SESSION_FAILED',

                      requestId:
                        requestContext
                          .requestId ||
                        null,

                      sessionPhase:
                        'PAIRING_REMOTE_AUTH',

                      operation:
                        'CreateRemoteSession',

                      attempt: 1
                    });
                  }
                }
              } else {
                pair.remote_session_status =
                  'UNRESOLVED';
              }
            } else {
              pair.remote_session_status =
                'NOT_APPLICABLE';

              pairingSessionContexts
                .set(
                  pair.pairing_id,
                  {
                    pairingId:
                      pair.pairing_id,

                    isSelf: true
                  }
                );
            }
          }
        }
                // Each pairing owns its observations. A failed pair must not be overwritten by a later successful pair.
        const failedPairScopes =
          new Map();

        for (
          const rawPair of
          rawSitePairs || []
        ) {
          const pair =
            sitePairs.find(
              p =>
                p.pairing_id ===
                rawPair.pairing_id
            );

          if (!pair) throw new Error(
            'SRM_PAIR_IDENTITY_UNRESOLVED'
          );

          // Servers (extracted from this pairing and enhanced with local discovery)
          const rawServers = [
            rawPair.local_srm_server,
            rawPair.remote_srm_server
          ].filter(Boolean);

          if (
            rawServers &&
            rawServers.length > 0
          ) {
            // Inject discovered fields into local server
            const localServer =
              rawServers.find(
                s =>
                  s.id ===
                  rawPair
                    .local_srm_server
                    ?.id
              );

            if (localServer) {
              localServer
                ._discovered_api_host =
                apiEndpointHost;

              localServer
                ._discovered_api_host_type =
                apiEndpointHostType;

              localServer
                ._discovered_appliance_ip =
                applianceIp;

              if (localApplianceInfo) {
                localServer.version =
                  localApplianceInfo
                    .version ||
                  localServer.version;

                localServer.build =
                  localApplianceInfo
                    .build ||
                  localServer.build;
              }
            }

            servers.push(
              ...srmNormalizer
                .normalizeSrmServers(
                  localConnectionId,
                  pair.pairing_id,
                  rawServers,
                  runId
                )
            );

            scopeStatus
              .server_sync_status =
              'SYNCED';
          }

          // Tasks
          const rawTasks =
            await srmAdapter
              .getTasks(
                localBaseUrl,
                localSessionId,
                verifyTls
              )
              .catch(() => {
                scopeStatus
                  .task_sync_status =
                  'FAILED';

                return null;
              });

          if (rawTasks) {
            tasks =
              srmNormalizer
                .normalizeTasks(
                  localConnectionId,
                  rawTasks,
                  runId
                );

            scopeStatus
              .task_sync_status =
              'SYNCED';
          }

          const pairingId =
            pair.pairing_id;

          const srmId =
            rawPair
              .local_srm_server
              ?.id;

          // Protection Groups
          let rawPgs = null;

          if (pairingId) rawPgs =
            await srmAdapter
              .getProtectionGroups(
                localBaseUrl,
                localSessionId,
                pairingId,
                verifyTls
              )
              .catch(() => {
                scopeStatus
                  .protection_group_sync_status =
                  'FAILED';

                return null;
              });

          if (rawPgs) {
            const pairProtectionGroups =
              srmNormalizer
                .normalizeProtectionGroups(
                  localConnectionId,
                  pairingId,
                  rawPgs,
                  runId
                );

            protectionGroups.push(
              ...pairProtectionGroups
            );

            scopeStatus
              .protection_group_sync_status =
              'SYNCED';

            scopeStatus
              .last_protection_group_count =
              protectionGroups.length;

            // Protected VMs and PG Issues
            for (
              const pg of
              pairProtectionGroups
            ) {
              const rawVms =
                await srmAdapter
                  .getProtectedVms(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    pg.protection_group_id,
                    verifyTls
                  )
                  .catch(() => {
                    scopeStatus
                      .protected_vm_sync_status =
                      'PARTIAL';

                    return null;
                  });

              if (rawVms) {
                protectedVms.push(
                  ...srmNormalizer
                    .normalizeProtectedVms(
                      localConnectionId,
                      pairingId,
                      pg.protection_group_id,
                      rawVms,
                      runId
                    )
                );

                if (
                  scopeStatus
                    .protected_vm_sync_status ===
                  'SYNCING'
                ) scopeStatus
                  .protected_vm_sync_status =
                  'SYNCED';
              }

              const rawPgIssues =
                await srmAdapter
                  .getProtectionGroupIssues(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    pg.protection_group_id,
                    verifyTls
                  )
                  .catch(
                    () => null
                  );

              if (
                rawPgIssues
              ) issues.push(
                ...srmNormalizer
                  .normalizeIssues(
                    localConnectionId,
                    pairingId,
                    'PROTECTION_GROUP',
                    pg.protection_group_id,
                    rawPgIssues,
                    runId
                  )
              );
            }
          }

          // Recovery Plans
          let rawRps = null;

          if (pairingId) rawRps =
            await srmAdapter
              .getRecoveryPlans(
                localBaseUrl,
                localSessionId,
                pairingId,
                verifyTls
              )
              .catch(() => {
                scopeStatus
                  .recovery_plan_sync_status =
                  'FAILED';

                return null;
              });

          if (rawRps) {
            const pairRecoveryPlans =
              srmNormalizer
                .normalizeRecoveryPlans(
                  localConnectionId,
                  pairingId,
                  rawRps,
                  runId
                );

            recoveryPlans.push(
              ...pairRecoveryPlans
            );

            scopeStatus
              .recovery_plan_sync_status =
              'SYNCED';

            scopeStatus
              .last_recovery_plan_count =
              recoveryPlans.length;

            for (
              const rp of
              pairRecoveryPlans
            ) {
              const rGroups =
                await srmAdapter
                  .getRecoveryPlanGroups(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    rp.recovery_plan_id,
                    verifyTls
                  )
                  .catch(
                    () => null
                  );

              if (rGroups) {
                recoveryPlanGroups.push(
                  ...srmNormalizer
                    .normalizeRecoveryPlanGroups(
                      localConnectionId,
                      pairingId,
                      rp.recovery_plan_id,
                      rGroups,
                      runId
                    )
                );

                fetchedPlanGroups.push({
                  pairingId,
                  planId:
                    rp.recovery_plan_id
                });
              }

              const rVms =
                await srmAdapter
                  .getRecoveryPlanVms(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    rp.recovery_plan_id,
                    verifyTls
                  )
                  .catch(() => {
                    scopeStatus
                      .recovery_plan_vm_sync_status =
                      'PARTIAL';

                    return null;
                  });

              if (rVms) {
                fetchedPlanVms.push({
                  pairingId,
                  planId:
                    rp.recovery_plan_id
                });

                recoveryPlanVms.push(
                  ...srmNormalizer
                    .normalizeRecoveryPlanVms(
                      localConnectionId,
                      pairingId,
                      rp.recovery_plan_id,
                      rVms,
                      runId
                    )
                );

                if (
                  scopeStatus
                    .recovery_plan_vm_sync_status ===
                  'SYNCING'
                ) scopeStatus
                  .recovery_plan_vm_sync_status =
                  'SYNCED';
              }

              rp.read_availability_collected_at =
                new Date();

              const rHistory =
                await srmAdapter
                  .getRecoveryHistory(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    rp.recovery_plan_id,
                    verifyTls
                  )
                  .catch(error => {
                    rp.history_availability =
                      error.availability ||
                      'FAILED';

                    rp.history_task_id =
                      error.taskId ||
                      null;

                    return null;
                  });

              if (rHistory) {
                rp.history_availability =
                  rHistory.length
                    ? 'AVAILABLE'
                    : 'AVAILABLE_EMPTY';

                rp.history_task_id =
                  null;

                recoveryHistory.push(
                  ...srmNormalizer
                    .normalizeHistory(
                      localConnectionId,
                      pairingId,
                      rp.recovery_plan_id,
                      rHistory,
                      runId
                    )
                );
              }

              const rSteps =
                await srmAdapter
                  .getRecoverySteps(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    rp.recovery_plan_id,
                    'test',
                    verifyTls
                  )
                  .catch(error => {
                    rp.test_steps_availability =
                      error.availability ||
                      'FAILED';

                    recoveryPlanStepFetchFailures +=
                      1;

                    return null;
                  });

              if (rSteps) {
                rp.test_steps_availability =
                  rSteps.length
                    ? 'AVAILABLE'
                    : 'AVAILABLE_EMPTY';

                recoveryPlanSteps.push(
                  ...srmNormalizer
                    .normalizeRecoverySteps(
                      localConnectionId,
                      pairingId,
                      rp.recovery_plan_id,
                      'test',
                      rSteps,
                      runId
                    )
                );
              }

              const rIssues =
                await srmAdapter
                  .getRecoveryPlanIssues(
                    localBaseUrl,
                    localSessionId,
                    pairingId,
                    rp.recovery_plan_id,
                    verifyTls
                  )
                  .catch(
                    () => null
                  );

              if (
                rIssues
              ) issues.push(
                ...srmNormalizer
                  .normalizeIssues(
                    localConnectionId,
                    pairingId,
                    'RECOVERY_PLAN',
                    rp.recovery_plan_id,
                    rIssues,
                    runId
                  )
              );
            }
          }
                    // Mappings
          if (pairingId && srmId) {
            const mappingTypes = [
              {
                type: 'networks',
                field:
                  'network_mapping_sync_status',
                clean: 'NETWORK'
              },
              {
                type: 'test-networks',
                field:
                  'test_network_mapping_sync_status',
                clean: 'TEST_NETWORK'
              },
              {
                type: 'folders',
                field:
                  'folder_mapping_sync_status',
                clean: 'FOLDER'
              },
              {
                type: 'resources',
                field:
                  'resource_mapping_sync_status',
                clean: 'RESOURCE'
              },
              {
                type:
                  'storage-policies',
                field:
                  'storage_policy_mapping_sync_status',
                clean:
                  'STORAGE_POLICY'
              }
            ];

            for (
              const def of
              mappingTypes
            ) {
              let rawMaps = null;
              let dataSource = 'REST';

              try {
                const endpointPath =
                  mappingEndpointPath(
                    pairingId,
                    srmId,
                    def.type
                  );

                const mappingContext = {
                  ...sessionContext,

                  sitePairId:
                    pairingId,

                  remoteSrmHost:
                    pairingSessionContexts
                      .get(pairingId)
                      ?.remoteConnection
                      ?.baseUrl ||
                    null,

                  sessionState:
                    pairingSessionContexts
                      .get(pairingId)
                      ?.isSelf
                      ? 'AUTHENTICATED'
                      : 'PAIRED'
                };

                rawMaps =
                  await executeWithSrmSessionRetry({
                    context:
                      mappingContext,

                    operation: () =>
                      srmAdapter
                        .getInventoryMappings(
                          localBaseUrl,
                          localSessionId,
                          pairingId,
                          srmId,
                          def.type,
                          verifyTls
                        ),

                    reauthenticate:
                      reauthenticateForMappings,

                    endpointPath,

                    operationName:
                      `GetInventoryMappings:${def.clean}`,

                    requestId:
                      requestContext
                        .requestId,

                    sessionPhase:
                      'MAPPING_READ',

                    onDiagnostic:
                      safeSessionLog
                  });

                rawMaps =
                  validateRestMappingContract(
                    def.clean,
                    rawMaps
                  );

                scopeStatus[def.field] =
                  'SYNCED';
              } catch (err) {
                if (
                  [
                    'SRM_MAPPING_ENDPOINT_UNSUPPORTED',
                    'SRM_MAPPING_REST_CONTRACT_UNSUPPORTED',
                    'SRM_MAPPING_REST_SERVER_ERROR'
                  ].includes(err.code)
                ) {
                  if (
                    srmMappingSoapAdapter
                      .supportsMappingType(
                        def.clean
                      )
                  ) {
                    try {
                      const soapResult =
                        await srmMappingSoapAdapter
                          .fetchMappings(
                            localBaseUrl,
                            verifyTls,
                            localConnection
                              .username,
                            localPassword,
                            [def.clean]
                          );

                      const soapData =
                        soapResult[
                          SOAP_RESULT_KEYS[
                            def.clean
                          ]
                        ];

                      if (
                        soapData === null ||
                        soapData ===
                          undefined
                      ) {
                        throw new Error(
                          'SOAP_MAPPING_READ_FAILED'
                        );
                      }

                      rawMaps =
                        normalizeSoapMappings(
                          soapData
                        );

                      dataSource =
                        'SOAP_SDK';

                      scopeStatus[
                        def.field
                      ] = 'SYNCED';
                    } catch (soapErr) {
                      console.error(
                        'SRM SOAP mapping read failed',
                        {
                          connectionId:
                            localConnectionId,

                          mappingType:
                            def.clean,

                          code:
                            soapErr.code ||
                            'SRM_MAPPING_SOAP_FAILED'
                        }
                      );

                      scopeStatus[
                        def.field
                      ] = 'FAILED';

                      scopeStatus
                        .last_error_code =
                        'SRM_MAPPING_SOAP_FAILED';
                    }
                  } else if (
                    err.code ===
                    'SRM_MAPPING_ENDPOINT_UNSUPPORTED'
                  ) {
                    scopeStatus[
                      def.field
                    ] = 'UNSUPPORTED';
                  } else {
                    scopeStatus[
                      def.field
                    ] = 'FAILED';

                    scopeStatus
                      .last_error_code =
                      err.code;
                  }
                } else {
                  console.error(
                    'SRM mapping read failed',
                    {
                      connectionId:
                        localConnectionId,

                      mappingType:
                        def.clean,

                      protocol:
                        err.protocol ||
                        'REST',

                      httpStatus:
                        err.httpStatus ||
                        err.response
                          ?.status ||
                        null,

                      code:
                        err.code ||
                        'API_FAILURE',

                      requestId:
                        requestContext
                          .requestId ||
                        null
                    }
                  );

                  scopeStatus[
                    def.field
                  ] = 'FAILED';

                  scopeStatus
                    .last_error_code =
                    err.code ||
                    'API_FAILURE';
                }
              }

              if (
                rawMaps &&
                scopeStatus[
                  def.field
                ] === 'SYNCED'
              ) {
                const normMaps =
                  srmNormalizer
                    .normalizeMappings(
                      localConnectionId,
                      pairingId,
                      srmId,
                      rawMaps,
                      def.clean,
                      runId
                    );

                normMaps.forEach(m => {
                  m.data_source =
                    dataSource;

                  m.policy_resolution =
                    null;
                });

                if (
                  def.clean ===
                  'STORAGE_POLICY'
                ) {
                  const resolver =
                    require(
                      './storage-policy-resolution.service'
                    );

                  const pair =
                    sitePairs.find(
                      p =>
                        p.pairing_id ===
                        pairingId
                    );

                  for (
                    const mapping of
                    normMaps
                  ) {
                    mapping.policy_resolution = {
                      source:
                        await resolver
                          .resolveStoragePolicy({
                            vcenterStableId:
                              pair?.local_vcenter_id,

                            storageProfileId:
                              mapping.source_object_id,

                            apiReportedName:
                              mapping.source_object_name
                          }),

                      target:
                        await resolver
                          .resolveStoragePolicy({
                            vcenterStableId:
                              pair?.remote_vcenter_id,

                            storageProfileId:
                              mapping.target_object_id,

                            apiReportedName:
                              mapping.target_object_name
                          }),

                      collectedAt:
                        new Date()
                          .toISOString()
                    };
                  }
                }

                mappings.push(
                  ...normMaps
                );

                syncedMappingTypes.push(
                  def.clean
                );
              }
            }

            mappings =
              deduplicateMappingObservations(
                mappings
              );

            scopeStatus
              .last_mapping_count =
              mappings.length;

            // Placeholder Datastores
            const rawDs =
              await srmAdapter
                .getPlaceholderDatastores(
                  localBaseUrl,
                  localSessionId,
                  pairingId,
                  srmId,
                  verifyTls
                )
                .catch(() => {
                  scopeStatus
                    .placeholder_datastore_sync_status =
                    'FAILED';

                  return null;
                });

            if (rawDs) {
              datastores.push(
                ...srmNormalizer
                  .normalizePlaceholderDatastores(
                    localConnectionId,
                    pairingId,
                    srmId,
                    rawDs,
                    runId
                  )
              );

              scopeStatus
                .placeholder_datastore_sync_status =
                'SYNCED';

              scopeStatus
                .last_placeholder_datastore_count =
                datastores.length;
            }
          }
                    for (
            const [
              key,
              value
            ] of Object.entries(
              scopeStatus
            )
          ) {
            if (
              key.endsWith(
                '_status'
              ) &&
              [
                'FAILED',
                'PARTIAL',
                'UNSUPPORTED'
              ].includes(value)
            ) {
              if (
                failedPairScopes
                  .get(key) !==
                'FAILED'
              ) failedPairScopes
                .set(
                  key,
                  value
                );
            }
          }
        } // all stable pairings

        for (
          const [
            key,
            value
          ] of failedPairScopes
        ) scopeStatus[key] = value;

        const typeScope = {
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
        };

        syncedMappingTypes = [
          ...new Set(
            syncedMappingTypes
          )
        ].filter(
          type =>
            scopeStatus[
              typeScope[type]
            ] === 'SYNCED'
        );

        scopeStatus
          .last_protection_group_count =
          protectionGroups.length;

        scopeStatus
          .last_recovery_plan_count =
          recoveryPlans.length;

        scopeStatus
          .last_placeholder_datastore_count =
          datastores.length;

        scopeStatus
          .issue_sync_status =
          'SYNCED';

        scopeStatus
          .last_issue_count =
          issues.length;

        finalizeEmptyChildScopes(
          scopeStatus,
          protectionGroups,
          recoveryPlans
        );

        // Keep the legacy aggregate column authoritative instead of leaving a
        // value from an earlier run. The API still derives per-scope freshness
        // from the dedicated scope columns below.
        if (
          scopeStatus
            .pairing_sync_status ===
            'SYNCED' &&
          sitePairs.length === 0
        ) {
          // A verified empty pairing catalogue has no child scopes to request.
          // Do not leave them SYNCING or misreport the empty mapping set as FAILED.
          for (
            const key of
            Object.keys(scopeStatus)
          ) if (
            key.endsWith(
              '_sync_status'
            ) &&
            scopeStatus[key] ===
              'SYNCING'
          ) scopeStatus[key] =
            'SYNCED';
        } else {
          // A partial run may complete without throwing (for example the site-pair
          // endpoint failed and there are no child scopes to iterate). Close those
          // unattempted scopes now so the UI never reports a finished run as active.
          finalizeInterruptedScopeStatuses(
            scopeStatus
          );
        }

        scopeStatus
          .mapping_sync_status =
          summarizeMappingSyncStatus(
            scopeStatus
          );
      } catch (innerErr) {
        // Broad API failure
        scopeStatus
          .core_sync_status =
          'FAILED';

        scopeStatus
          .last_error_code =
          innerErr.code ||
          'API_FAILURE';

        throw innerErr;
      }

      // Check overall status
      scopeStatus
        .core_sync_status =
        summarizeCoreSyncStatus(
          scopeStatus
        );

      // All network calls done. Now open DB transaction.
      const client =
        await pool.connect();

      try {
        await client.begin();

        if (
          scopeStatus
            .pairing_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertScope(
              'srm_site_pairs',
              [
                'connection_id',
                'pairing_id'
              ],
              sitePairs,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_site_pairs',
              localConnectionId,
              runId,
              client
            );
        }

        if (
          scopeStatus
            .server_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertScope(
              'srm_servers',
              [
                'connection_id',
                'pairing_id',
                'srm_id'
              ],
              servers,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_servers',
              localConnectionId,
              runId,
              client
            );
        }

        if (
          scopeStatus
            .protection_group_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertScope(
              'srm_protection_groups',
              [
                'connection_id',
                'pairing_id',
                'protection_group_id'
              ],
              protectionGroups,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_protection_groups',
              localConnectionId,
              runId,
              client
            );
        }

        if (
          scopeStatus
            .protected_vm_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertScope(
              'srm_protected_vms',
              [
                'connection_id',
                'pairing_id',
                'protection_group_id',
                'protected_vm_id'
              ],
              protectedVms,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_protected_vms',
              localConnectionId,
              runId,
              client
            );
        }

        if (
          scopeStatus
            .recovery_plan_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertScope(
              'srm_recovery_plans',
              [
                'connection_id',
                'pairing_id',
                'recovery_plan_id'
              ],
              recoveryPlans,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_recovery_plans',
              localConnectionId,
              runId,
              client
            );

          if (
            recoveryPlanGroups
              .length > 0
          ) await srmRepository
            .upsertScope(
              'srm_recovery_plan_groups',
              [
                'connection_id',
                'pairing_id',
                'recovery_plan_id',
                'protection_group_id'
              ],
              recoveryPlanGroups,
              client
            );

          if (
            recoveryPlanVms
              .length > 0
          ) await srmRepository
            .upsertScope(
              'srm_recovery_plan_vms',
              [
                'connection_id',
                'pairing_id',
                'recovery_plan_id',
                'recovery_plan_vm_id'
              ],
              recoveryPlanVms,
              client
            );

          await srmRepository
            .markMissingPlanChildren(
              'srm_recovery_plan_groups',
              localConnectionId,
              runId,
              fetchedPlanGroups,
              client
            );

          await srmRepository
            .markMissingPlanChildren(
              'srm_recovery_plan_vms',
              localConnectionId,
              runId,
              fetchedPlanVms,
              client
            );

          if (
            recoveryHistory.length >
            0
          ) await srmRepository
            .upsertScope(
              'srm_recovery_history',
              [
                'connection_id',
                'pairing_id',
                'recovery_plan_id',
                'history_id'
              ],
              recoveryHistory,
              client
            );

          if (
            recoveryPlanSteps
              .length > 0
          ) await srmRepository
            .upsertScope(
              'srm_recovery_plan_steps',
              [
                'connection_id',
                'pairing_id',
                'recovery_plan_id',
                'view_mode',
                'step_id'
              ],
              recoveryPlanSteps,
              client
            );
        }

        if (
          mappings.length > 0
        ) {
          await srmRepository
            .upsertExpressionScope(
              'srm_inventory_mappings',
              "connection_id, COALESCE(pairing_id, ''), srm_id, mapping_id",
              mappings,
              client
            );
        }

        if (
          syncedMappingTypes
            .length > 0
        ) {
          await srmRepository
            .markMissingMappingsNotPresent(
              localConnectionId,
              runId,
              syncedMappingTypes,
              client
            );
        }

        if (
          scopeStatus
            .placeholder_datastore_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertExpressionScope(
              'srm_placeholder_datastores',
              "connection_id, COALESCE(pairing_id, ''), srm_id, placeholder_datastore_id",
              datastores,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_placeholder_datastores',
              localConnectionId,
              runId,
              client
            );
        }

        if (
          scopeStatus
            .issue_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertExpressionScope(
              'srm_issues',
              "connection_id, COALESCE(pairing_id, ''), issue_fingerprint",
              issues,
              client
            );

          await srmRepository
            .markMissingNotPresent(
              'srm_issues',
              localConnectionId,
              runId,
              client
            );
        }

        if (
          scopeStatus
            .task_sync_status ===
          'SYNCED'
        ) {
          await srmRepository
            .upsertScope(
              'srm_tasks',
              [
                'connection_id',
                'task_id'
              ],
              tasks,
              client
            );

          // Set old tasks is_recent = false
          await client.run(
            (s, p) => {
              const R = s.helpers;
              const views = {};

              const rows = s.update(
                "srm_tasks",
                row => {
                  const r =
                    R.rowContext(
                      row,
                      "srm_tasks"
                    );

                  return R.binary(
                    "AND",
                    R.binary(
                      "AND",
                      R.binary(
                        "=",
                        R.ref(
                          r,
                          "connection_id",
                          null
                        ),
                        p[0]
                      ),
                      R.binary(
                        "!=",
                        R.ref(
                          r,
                          "sync_run_id",
                          null
                        ),
                        p[1]
                      )
                    ),
                    R.binary(
                      "=",
                      R.ref(
                        r,
                        "is_recent",
                        null
                      ),
                      true
                    )
                  );
                },
                row => {
                  const r =
                    R.rowContext(
                      row,
                      "srm_tasks"
                    );

                  return {
                    "is_recent":
                      false,

                    "updated_at":
                      s.now()
                  };
                }
              );

              return R.changed(
                rows.length
              );
            },
            [
              localConnectionId,
              runId
            ],
            true
          );
        }

        await require(
          './current-scope.service'
        ).reconcileCurrentChildren(
          client,
          'SRM',
          localConnectionId
        );

        await client.commit();
      } catch (err) {
        await client.rollback();
        throw err;
      } finally {
        client.release();
      }
            scopeStatus
        .last_successful_sync_at =
        new Date();

      await srmRepository
        .upsertSyncState(
          localConnectionId,
          scopeStatus
        );

      const collectionCompletedAt =
        new Date();

      const operationStatus =
        value => {
          if (
            value === 'SYNCED' ||
            value ===
              'SYNCED_WITH_UNSUPPORTED_SCOPE'
          ) return 'SUCCESS';

          if (
            value === 'UNSUPPORTED'
          ) return 'SUCCESS_EMPTY';

          if (
            value === 'PARTIAL'
          ) return 'PARTIAL';

          return 'FAILED';
        };

      return {
        status:
          scopeStatus
            .core_sync_status,

        scopeStatus,
        runId,

        connectionId:
          localConnectionId,

        ...createLiveCollectionResult({
          system: 'SRM',

          connectionId:
            localConnectionId,

          syncRunId:
            parentSyncRunId,

          collectorRunId:
            runId,

          startedAt:
            collectionStartedAt,

          completedAt:
            collectionCompletedAt,

          status:
            scopeStatus
              .core_sync_status ===
              'SYNCED'
              ? 'SUCCESS'
              : 'PARTIAL',

          rowsCollected: {
            sitePairs:
              sitePairs.length,

            servers:
              servers.length,

            protectionGroups:
              protectionGroups.length,

            protectedVms:
              protectedVms.length,

            recoveryPlans:
              recoveryPlans.length,

            recoveryPlanGroups:
              recoveryPlanGroups.length,

            recoveryPlanVms:
              recoveryPlanVms.length,

            recoveryPlanSteps:
              recoveryPlanSteps.length,

            inventoryMappings:
              mappings.length,

            placeholderDatastores:
              datastores.length,

            issues:
              issues.length,

            tasks:
              tasks.length
          },

          operations: [
            {
              operation:
                'GET_SITE_PAIRS',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .pairing_sync_status
                ),

              rowCount:
                sitePairs.length
            },
            {
              operation:
                'GET_PROTECTION_GROUPS',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .protection_group_sync_status
                ),

              rowCount:
                protectionGroups.length
            },
            {
              operation:
                'GET_PROTECTED_VMS',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .protected_vm_sync_status
                ),

              rowCount:
                protectedVms.length
            },
            {
              operation:
                'GET_RECOVERY_PLANS',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .recovery_plan_sync_status
                ),

              rowCount:
                recoveryPlans.length
            },
            {
              operation:
                'GET_RECOVERY_PLAN_RELATIONSHIPS',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .recovery_plan_vm_sync_status
                ),

              rowCount:
                recoveryPlanGroups
                  .length +
                recoveryPlanVms
                  .length
            },
            {
              operation:
                'GET_RECOVERY_PLAN_STEPS',

              endpointCategory:
                'SRM_REST_API',

              status:
                recoveryPlanStepFetchFailures >
                0
                  ? 'NOT_AVAILABLE'
                  : recoveryPlanSteps
                      .length > 0
                    ? 'SUCCESS'
                    : 'SUCCESS_EMPTY',

              rowCount:
                recoveryPlanSteps
                  .length,

              errorCode:
                recoveryPlanStepFetchFailures >
                0
                  ? 'SRM_RECOVERY_STEPS_NOT_AVAILABLE'
                  : null
            },
            {
              operation:
                'GET_INVENTORY_MAPPINGS',

              endpointCategory:
                'SRM_REST_OR_SOAP_API',

              status:
                operationStatus(
                  scopeStatus
                    .mapping_sync_status
                ),

              rowCount:
                mappings.length
            },
            {
              operation:
                'GET_PLACEHOLDER_DATASTORES',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .placeholder_datastore_sync_status
                ),

              rowCount:
                datastores.length
            },
            {
              operation:
                'GET_TASKS',

              endpointCategory:
                'SRM_REST_API',

              status:
                operationStatus(
                  scopeStatus
                    .task_sync_status
                ),

              rowCount:
                tasks.length
            }
          ],

          canonicalization: {
            status: 'SUCCESS',

            phase:
              'POST_PERSISTENCE_READ_MODEL_READY',

            protectionGroupRows:
              protectionGroups.length,

            recoveryPlanRows:
              recoveryPlans.length,

            mappingRows:
              mappings.length
          }
        })
      };
    } catch (error) {
      console.error(
        'SRM sync failed',
        {
          connectionId:
            localConnectionId,

          code:
            require(
              '../utils/operation-error.util'
            )
              .classifyOperationError(
                error,
                {
                  upstream: true
                }
              )
              .code,

          requestId:
            requestContext
              .requestId ||
            null
        }
      );

      if (
        localConnection &&
        !localSessionAuthenticated
      ) {
        const connectionStatus =
          resolveVmwareConnectionFailureStatus(
            error
          );

        await connectionRepository
          .updateConnectionTestStatus(
            localConnectionId,
            connectionStatus,
            new Date()
          )
          .catch(() => {});
      }

      // A run that exits early must never leave a scope looking active forever.
      // Mark only unfinished scopes as failed; completed/unsupported scopes retain
      // their authoritative result from this attempt.
      finalizeInterruptedScopeStatuses(
        scopeStatus
      );

      scopeStatus
        .core_sync_status =
        'FAILED';

      scopeStatus
        .last_failed_sync_at =
        new Date();

      scopeStatus
        .last_error_code =
        error.code ||
        'UNKNOWN_ERROR';

      await srmRepository
        .upsertSyncState(
          localConnectionId,
          scopeStatus
        )
        .catch(() => {});

      error.syncScopeStatus = {
        ...scopeStatus
      };

      throw error;
    } finally {
      if (
        localSessionId &&
        localConnection
      ) {
        await srmAdapter
          .logoutLocal(
            localConnection.baseUrl,
            localSessionId,
            localConnection.verifyTls
          )
          .catch(() => {});
      }

      syncLocks.delete(
        localConnectionId
      );

      if (
        ownsCoordinator
      ) syncCoordinator.release(
        coordinatorToken
      );
    }
  }
}

module.exports =
  new SrmSyncService();

module.exports.SrmSyncService =
  SrmSyncService;

module.exports._internals = {
  mappingEndpointPath,
  normalizeSoapMappings,
  deduplicateMappingObservations,
  validateRestMappingContract,
  summarizeMappingSyncStatus,
  finalizeInterruptedScopeStatuses,
  finalizeEmptyChildScopes,
  summarizeCoreSyncStatus,
  SOAP_RESULT_KEYS
};