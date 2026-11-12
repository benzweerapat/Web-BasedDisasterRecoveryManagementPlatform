const {
  pool
} = require('../../db');
const inventorySyncService = require('./inventory-sync.service');
const vrSyncService = require('./vr-sync.service');
const srmSyncService = require('./srm-sync.service');
const syncCoordinator = require('./sync-coordinator.service');
const auditService = require('./audit.service');
const vcenterObjectResolution = require('./vcenter-object-resolution.service');
const storagePolicyResolution = require('./storage-policy-resolution.service');
const {
  randomUUID
} = require('crypto');
const {
  validateLiveCollectionResult,
  logLiveCollectionEvidence
} = require('./live-collection-evidence.service');
const DEPENDENCIES = Object.freeze({
  vcenter: [],
  vr: ['vcenter'],
  srm: ['vcenter', 'vr']
});
const SRM_SCOPE_NAMES = Object.freeze({
  pairing_sync_status: 'PAIRING',
  server_sync_status: 'SERVER',
  protection_group_sync_status: 'PROTECTION_GROUP',
  protected_vm_sync_status: 'PROTECTED_VM',
  recovery_plan_sync_status: 'RECOVERY_PLAN',
  recovery_plan_vm_sync_status: 'RECOVERY_PLAN_VM',
  network_mapping_sync_status: 'NETWORK',
  test_network_mapping_sync_status: 'TEST_NETWORK',
  folder_mapping_sync_status: 'FOLDER',
  resource_mapping_sync_status: 'RESOURCE',
  storage_policy_mapping_sync_status: 'STORAGE_POLICY',
  placeholder_datastore_sync_status: 'PLACEHOLDER_DATASTORE',
  issue_sync_status: 'ISSUE',
  task_sync_status: 'TASK'
});
const iso = value => new Date(value).toISOString();

function createSafeScopeError({
  scope,
  connectionId,
  requestId,
  code,
  endpoint = '/api/sync/all'
}) {
  const normalizedCode = code || `${String(scope).toUpperCase()}_SYNC_FAILED`;
  return {
    type: 'UPSTREAM_ERROR',
    code: normalizedCode,
    httpStatus: 502,
    endpoint,
    requestId: requestId || 'unknown',
    safeMessage: `Unable to synchronize ${scope} for connection ${connectionId}`
  };
}

function normalizeActor(requestedBy) {
  if (requestedBy && typeof requestedBy === 'object') {
    return {
      username: requestedBy.username || requestedBy.id || 'unknown',
      role: requestedBy.role || 'UNKNOWN'
    };
  }
  return {
    username: requestedBy || 'unknown',
    role: 'UNKNOWN'
  };
}
function connectionStatus(scope, value) {
  const raw = String(value || '').toUpperCase();
  if (scope === 'vcenter') return raw === 'SYNCED' ? 'SUCCESS' : 'FAILED';
  if (scope === 'vr') {
    if (raw === 'OK' || raw === 'SYNCED' || raw === 'SUCCESS') return 'SUCCESS';
    if (raw === 'PARTIAL') return 'PARTIAL';
    return 'FAILED';
  }
  if (raw === 'SYNCED' || raw === 'SUCCESS') return 'SUCCESS';
  if (raw === 'PARTIAL') return 'PARTIAL';
  return 'FAILED';
}

function failedSrmScopes(scopeStatus = {}) {
  return Object.entries(SRM_SCOPE_NAMES).filter(([field]) => ['FAILED', 'PARTIAL'].includes(scopeStatus[field])).map(([, name]) => name);
}

function summarizeOverall(scopes) {
  const statuses = Object.values(scopes).map(scope => scope.status);
  const configuredStatuses = statuses.filter(status => status !== 'NOT_CONFIGURED');
  if (configuredStatuses.length === 0 && statuses.length > 0) return 'NOT_CONFIGURED';
  if (configuredStatuses.length > 0 && configuredStatuses.every(status => status === 'SUCCESS')) return 'SUCCESS';
  if (statuses.some(status => status === 'SUCCESS' || status === 'PARTIAL')) return 'PARTIAL';
  return 'FAILED';
}

const REQUIRED_LIVE_OPERATIONS = Object.freeze({
  vr: ['GET_REPLICATIONS', 'COLLECT_OUTGOING_REPLICATIONS', 'COLLECT_INCOMING_REPLICATIONS'],
  srm: ['GET_PROTECTION_GROUPS', 'GET_RECOVERY_PLANS', 'GET_INVENTORY_MAPPINGS', 'GET_PLACEHOLDER_DATASTORES']
});

function validateRequiredScopeOperations(scope, raw) {
  const required = REQUIRED_LIVE_OPERATIONS[scope] || [];
  if (required.length === 0) return true;
  const operations = new Set((raw?.upstreamEvidence?.operations || []).map(item => item.operation));
  return required.every(operation => operations.has(operation));
}

function aggregateOperationStatus(connectionResults, operationName) {
  if (connectionResults.length === 0) return 'NOT_CONFIGURED';
  const statuses = connectionResults.map(connection => {
    if (connection.status === 'FAILED') return 'FAILED';
    return connection.upstreamEvidence?.operations?.find(item => item.operation === operationName)?.status || 'FAILED';
  });
  if (statuses.every(status => ['SUCCESS', 'SUCCESS_EMPTY'].includes(status))) return 'SUCCESS';
  if (statuses.some(status => ['SUCCESS', 'SUCCESS_EMPTY', 'PARTIAL'].includes(status))) return 'PARTIAL';
  return 'FAILED';
}
class SyncAllService {
  constructor({
    db = pool,
    inventory = inventorySyncService,
    vr = vrSyncService,
    srm = srmSyncService,
    coordinator = syncCoordinator,
    audit = auditService,
    resolutionCaches = [vcenterObjectResolution, storagePolicyResolution],
    now = () => new Date()
  } = {}) {
    this.db = db;
    this.inventory = inventory;
    this.vr = vr;
    this.srm = srm;
    this.coordinator = coordinator;
    this.audit = audit;
    this.resolutionCaches = resolutionCaches;
    this.now = now;
  }

  async _audit(actor, action, status, result, ip) {
    try {
      await this.audit.logActivity(actor, action, 'ALL_VMWARE_DATA', status, result, ip);
    } catch (_error) {
      console.error('[SyncAll] audit write failed', {
        action,
        status
      });
    }
  }

  _skippedScope(scope, dependency) {
    const at = iso(this.now());
    return {
      status: 'SKIPPED_DEPENDENCY',
      startedAt: at,
      completedAt: at,
      durationMs: 0,
      connectionsProcessed: 0,
      successfulConnections: 0,
      partialConnections: 0,
      failedConnections: 0,
      connectionResults: [],
      connections: [],
      dependency
    };
  }

  _invalidateResolutionCaches(syncRunId) {
    const entriesInvalidated = this.resolutionCaches.reduce((total, cache) => {
      if (typeof cache?.invalidateAll !== 'function') return total;
      return total + Number(cache.invalidateAll() || 0);
    }, 0);
    const result = {
      status: 'SUCCESS',
      syncRunId,
      entriesInvalidated
    };
    console.log('[SyncAll] resolution caches invalidated', result);
    return result;
  }
    async _runScope(scope, connections, runner, syncRunId, endpoint = '/api/sync/all', onProgress = null) {
    const started = this.now();
    const connectionResults = [];
    const allFailedScopes = new Set();
    if (connections.length === 0) {
      const completed = this.now();
      return {
        status: 'NOT_CONFIGURED',
        startedAt: iso(started),
        completedAt: iso(completed),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        connectionsProcessed: 0,
        successfulConnections: 0,
        partialConnections: 0,
        failedConnections: 0,
        connectionResults: [],
        connections: [],
        rowsCollected: {},
        lastCollectedAt: null
      };
    }

    if (typeof onProgress === 'function') {
      try {
        onProgress({
          type: 'SCOPE_STARTED',
          scope,
          connectionCount: connections.length,
          syncRunId
        });
      } catch (_) {}
    }
        const runConnection = async (connection) => {
      const connectionStarted = this.now();
      if (typeof onProgress === 'function') {
        try {
          onProgress({
            type: 'CONNECTION_STARTED',
            scope,
            connectionId: connection.id,
            connectionName: connection.connection_name,
            site: connection.site,
            syncRunId
          });
        } catch (_) {}
      }
      try {
        const raw = await runner(connection);
        if (!validateLiveCollectionResult(raw, {
          system: scope,
          connectionId: connection.id,
          syncRunId
        }) || !validateRequiredScopeOperations(scope, raw)) {
          const evidenceError = new Error('LIVE_UPSTREAM_EVIDENCE_MISSING');
          evidenceError.code = 'LIVE_UPSTREAM_EVIDENCE_MISSING';
          throw evidenceError;
        }
        const rawStatus = scope === 'vcenter' ? raw?.syncStatus : scope === 'srm' ? raw?.status || raw?.scopeStatus?.core_sync_status : raw?.status;
        const status = connectionStatus(scope, rawStatus);
        if (scope === 'srm') {
          for (const failedScope of failedSrmScopes(raw?.scopeStatus)) allFailedScopes.add(failedScope);
        }
        logLiveCollectionEvidence(raw.upstreamEvidence);
        const rowsCollected = raw.rowsCollected || {};
        const connResult = {
          connectionId: connection.id,
          connectionName: connection.connection_name,
          site: connection.site,
          status,
          syncRunId,
          collectorRunId: raw.collectorRunId || raw.runId || null,
          liveUpstreamRequest: true,
          startedAt: raw.upstreamEvidence.startedAt,
          completedAt: raw.upstreamEvidence.completedAt,
          durationMs: raw.upstreamEvidence.durationMs,
          rowsCollected,
          ...(scope === 'vr' ? {
            outgoingCollected: Number(rowsCollected.outgoingReplications || 0),
            incomingCollected: Number(rowsCollected.incomingReplications || 0),
            totalObservations: Number(rowsCollected.replications || 0)
          } : {}),
          upstreamEvidence: raw.upstreamEvidence,
          persistence: raw.persistence,
          canonicalization: raw.canonicalization || null,
          lastCollectedAt: raw.lastCollectedAt || raw.upstreamEvidence.completedAt
        };
        connectionResults.push(connResult);
        if (typeof onProgress === 'function') {
          try {
            onProgress({
              type: 'CONNECTION_COMPLETED',
              scope,
              connectionId: connection.id,
              connectionName: connection.connection_name,
              site: connection.site,
              status,
              durationMs: raw.upstreamEvidence.durationMs,
              rowsCollected,
              syncRunId
            });
          } catch (_) {}
        }
              } catch (error) {
        const internalScopeStatus = error?.syncScopeStatus || {};
        if (scope === 'srm') {
          for (const failedScope of failedSrmScopes(internalScopeStatus)) allFailedScopes.add(failedScope);
        }
        const safeError = createSafeScopeError({
          scope,
          connectionId: connection.id,
          requestId: syncRunId,
          code: error?.code,
          endpoint
        });
        const connResult = {
          connectionId: connection.id,
          connectionName: connection.connection_name,
          site: connection.site,
          status: 'FAILED',
          syncRunId,
          liveUpstreamRequest: false,
          startedAt: iso(connectionStarted),
          completedAt: iso(this.now()),
          rowsCollected: {},
          error: safeError
        };
        connectionResults.push(connResult);
        if (typeof onProgress === 'function') {
          try {
            onProgress({
              type: 'CONNECTION_FAILED',
              scope,
              connectionId: connection.id,
              connectionName: connection.connection_name,
              site: connection.site,
              status: 'FAILED',
              error: safeError,
              syncRunId
            });
          } catch (_) {}
        }
      }
    };

    await Promise.all(connections.map(runConnection));
    connectionResults.sort((a, b) => a.connectionId - b.connectionId);

    const completed = this.now();
    const statuses = connectionResults.map(result => result.status);
    let status = 'FAILED';
    if (statuses.length && statuses.every(value => value === 'SUCCESS')) status = 'SUCCESS';else if (statuses.some(value => value === 'SUCCESS' || value === 'PARTIAL')) status = 'PARTIAL';
    const aggregateRows = {};
    for (const connectionResult of connectionResults) {
      for (const [key, value] of Object.entries(connectionResult.rowsCollected || {})) {
        aggregateRows[key] = (aggregateRows[key] || 0) + Number(value || 0);
      }
    }
    const successfulCollectionTimes = connectionResults.filter(item => item.liveUpstreamRequest && item.lastCollectedAt).map(item => item.lastCollectedAt).sort();
    const result = {
      status,
      startedAt: iso(started),
      completedAt: iso(completed),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      connectionsProcessed: connectionResults.length,
      successfulConnections: connectionResults.filter(item => item.status === 'SUCCESS').length,
      partialConnections: connectionResults.filter(item => item.status === 'PARTIAL').length,
      failedConnections: connectionResults.filter(item => item.status === 'FAILED').length,
      connectionResults,
      connections: connectionResults,
      rowsCollected: aggregateRows,
      lastCollectedAt: successfulCollectionTimes.at(-1) || null
    };
    if (scope === 'srm') result.failedScopes = [...allFailedScopes];
    if (typeof onProgress === 'function') {
      try {
        onProgress({
          type: 'SCOPE_COMPLETED',
          scope,
          status: result.status,
          durationMs: result.durationMs,
          connectionsProcessed: result.connectionsProcessed,
          syncRunId
        });
      } catch (_) {}
    }
    return result;
  }
    async _loadActiveConnections(systemTypes) {
    const {
      rows
    } = await this.db.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "connections", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_active", null), true), R.quantified("=", R.ref(r, "system_type", null), R.cast(p[0], {
          "kind": "array",
          "arrayOf": {
            "name": "varchar"
          }
        }), "any")));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "id": R.ref(r, "id", null),
            "connection_name": R.ref(r, "connection_name", null),
            "system_type": R.ref(r, "system_type", null),
            "site": R.ref(r, "site", null),
            "associated_vcenter_connection_id": R.ref(r, "associated_vcenter_connection_id", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.binary('=', R.ref(a.r, "system_type", null), "VCENTER") ? 1 : R.binary('=', R.ref(a.r, "system_type", null), "VR") ? 2 : 3, R.binary('=', R.ref(b.r, "system_type", null), "VCENTER") ? 1 : R.binary('=', R.ref(b.r, "system_type", null), "VR") ? 2 : 3, "ASC", null], [R.ref(a.r, "id", null), R.ref(b.r, "id", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [systemTypes], false);
    return rows;
  }
    async syncVcenterData({
    actor,
    requestId,
    ip,
    syncRunId,
    coordinatorToken,
    connections,
    endpoint = '/api/sync/all',
    onProgress = null
  }) {
    const activeConnections = connections || (await this._loadActiveConnections(['VCENTER']));
    const result = await this._runScope('vcenter', activeConnections, connection => this.inventory.syncVCenterInventory(connection.id, actor, {
      ip,
      requestId,
      syncRunId,
      coordinatorToken
    }), syncRunId, endpoint, onProgress);
    result.resolutionCacheInvalidation = this._invalidateResolutionCaches(syncRunId);
    return result;
  }

  async syncVrData({
    actor,
    requestId,
    syncRunId,
    coordinatorToken,
    connections,
    endpoint = '/api/sync/vr',
    onProgress = null
  }) {
    const activeConnections = connections || (await this._loadActiveConnections(['VR']));
    const result = await this._runScope('vr', activeConnections, connection => this.vr.runSync(connection.id, {
      requestedBy: actor,
      requestId,
      syncRunId,
      coordinatorToken
    }), syncRunId, endpoint, onProgress);
    if (result.status !== 'FAILED' && typeof this.vr.getReplications === 'function') {
      try {
        const readModel = await this.vr.getReplications();
        result.result = {
          logicalReplicationCount: readModel?.metrics?.logicalReplicationCount ?? null,
          observationCount: readModel?.metrics?.observationCount ?? 0,
          mappedObservationCount: readModel?.metrics?.mappedObservationCount ?? 0,
          unmappedObservationCount: readModel?.metrics?.unmappedObservationCount ?? 0,
          outgoingObservationCount: readModel?.metrics?.outgoingObservationCount ?? 0,
          incomingObservationCount: readModel?.metrics?.incomingObservationCount ?? 0,
          collectionRunIds: readModel?.collectionRunIds || []
        };
        result.readModel = {
          status: 'SUCCESS',
          phase: 'POST_PERSISTENCE_GET_REPLICATIONS'
        };
      } catch (_error) {
        result.status = result.status === 'SUCCESS' ? 'PARTIAL' : result.status;
        result.readModel = {
          status: 'FAILED',
          code: 'VR_READ_MODEL_REBUILD_FAILED'
        };
      }
    }
    return result;
  }
    async syncSrmData({
    actor,
    requestId,
    syncRunId,
    coordinatorToken,
    connections,
    endpoint = '/api/sync/srm',
    onProgress = null
  }) {
    const activeConnections = connections || (await this._loadActiveConnections(['SRM']));
    const result = await this._runScope('srm', activeConnections, connection => this.srm.syncSrm(connection.id, actor.username, `${syncRunId}:srm:${connection.id}`, {
      requestedBy: actor,
      requestId,
      syncRunId,
      coordinatorToken
    }), syncRunId, endpoint, onProgress);
    result.result = {
      protectionGroups: {
        status: aggregateOperationStatus(result.connections, 'GET_PROTECTION_GROUPS'),
        rowsCollected: Number(result.rowsCollected.protectionGroups || 0)
      },
      recoveryPlans: {
        status: aggregateOperationStatus(result.connections, 'GET_RECOVERY_PLANS'),
        rowsCollected: Number(result.rowsCollected.recoveryPlans || 0)
      },
      inventoryMappings: {
        status: aggregateOperationStatus(result.connections, 'GET_INVENTORY_MAPPINGS'),
        rowsCollected: Number(result.rowsCollected.inventoryMappings || 0)
      },
      placeholderDatastores: {
        status: aggregateOperationStatus(result.connections, 'GET_PLACEHOLDER_DATASTORES'),
        rowsCollected: Number(result.rowsCollected.placeholderDatastores || 0)
      }
    };
    return result;
  }
    async _syncDedicatedScope(scope, {
    requestedBy,
    requestId,
    ip
  } = {}) {
    const actor = normalizeActor(requestedBy);
    const syncRunId = requestId || randomUUID();
    const system = scope.toUpperCase();
    const endpoint = `/api/sync/${scope}`;
    const coordinatorToken = this.coordinator.acquire({
      kind: `${system}_SYNC`,
      requestId: syncRunId
    });
    const started = this.now();
    await this._audit(actor, `SYNC_${system}_STARTED`, 'SUCCESS', {
      syncRunId,
      startedAt: iso(started)
    }, ip);
    try {
      const scoped = scope === 'vr' ? await this.syncVrData({
        actor,
        requestId,
        syncRunId,
        coordinatorToken,
        endpoint
      }) : await this.syncSrmData({
        actor,
        requestId,
        syncRunId,
        coordinatorToken,
        endpoint
      });
      const completed = this.now();
      const response = {
        syncRunId,
        system,
        status: scoped.status,
        startedAt: scoped.startedAt || iso(started),
        completedAt: scoped.completedAt || iso(completed),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        connections: scoped.connections,
        result: scoped.result || {},
        rowsCollected: scoped.rowsCollected,
        lastCollectedAt: scoped.lastCollectedAt
      };
      if (scope === 'srm') response.failedScopes = scoped.failedScopes || [];
      await this._audit(actor, `SYNC_${system}_COMPLETED`, response.status, {
        syncRunId,
        status: response.status,
        connectionsProcessed: response.connections.length
      }, ip);
      return response;
    } finally {
      this.coordinator.release(coordinatorToken);
    }
  }

  syncVrVmwareData(context = {}) {
    return this._syncDedicatedScope('vr', context);
  }

  syncSrmVmwareData(context = {}) {
    return this._syncDedicatedScope('srm', context);
  }
    async syncAllVmwareData({
    requestedBy,
    requestId,
    ip,
    onProgress = null
  } = {}) {
    const actor = normalizeActor(requestedBy);
    const syncRunId = requestId || randomUUID();
    const coordinatorToken = this.coordinator.acquire({
      kind: 'SYNC_ALL',
      requestId: syncRunId
    });
    const started = this.now();
    const result = {
      overallStatus: 'RUNNING',
      syncRunId,
      startedAt: iso(started),
      completedAt: null,
      durationMs: null,
      dependencyOrder: ['vcenter', 'vr', 'srm'],
      dependencies: DEPENDENCIES,
      scopes: {}
    };
    await this._audit(actor, 'SYNC_ALL_STARTED', 'SUCCESS', {
      requestId,
      syncRunId,
      startedAt: result.startedAt
    }, ip);
    console.log('[SyncAll] started', {
      requestId,
      syncRunId,
      requestedBy: actor.username,
      role: actor.role,
      startedAt: result.startedAt
    });
        try {
      const rows = await this._loadActiveConnections(['VCENTER', 'VR', 'SRM']);
      const bySystem = systemType => rows.filter(row => row.system_type === systemType);
      result.scopes.vcenter = await this.syncVcenterData({
        actor,
        requestId,
        ip,
        syncRunId,
        coordinatorToken,
        connections: bySystem('VCENTER'),
        endpoint: '/api/sync/all',
        onProgress
      });
      if (result.scopes.vcenter.status === 'FAILED') {
        result.scopes.vr = this._skippedScope('vr', 'vcenter');
        result.scopes.srm = this._skippedScope('srm', 'vcenter');
      } else {
        result.scopes.vr = await this.syncVrData({
          actor,
          requestId,
          syncRunId,
          coordinatorToken,
          connections: bySystem('VR'),
          endpoint: '/api/sync/all',
          onProgress
        });
        if (result.scopes.vr.status === 'FAILED') {
          result.scopes.srm = this._skippedScope('srm', 'vr');
        } else {
          result.scopes.srm = await this.syncSrmData({
            actor,
            requestId,
            syncRunId,
            coordinatorToken,
            connections: bySystem('SRM'),
            endpoint: '/api/sync/all',
            onProgress
          });
        }
      }
      result.overallStatus = summarizeOverall(result.scopes);
      result.systems = result.scopes;
      const completed = this.now();
      result.completedAt = iso(completed);
      result.durationMs = Math.max(0, completed.getTime() - started.getTime());
      const action = result.overallStatus === 'SUCCESS' ? 'SYNC_ALL_COMPLETED' : result.overallStatus === 'PARTIAL' ? 'SYNC_ALL_PARTIAL' : 'SYNC_ALL_FAILED';
      await this._audit(actor, action, result.overallStatus, {
        requestId,
        syncRunId,
        durationMs: result.durationMs,
        scopeStatus: Object.fromEntries(Object.entries(result.scopes).map(([scope, value]) => [scope, value.status]))
      }, ip);
      console.log('[SyncAll] completed', {
        requestId,
        syncRunId,
        requestedBy: actor.username,
        role: actor.role,
        durationMs: result.durationMs,
        overallStatus: result.overallStatus,
        scopes: Object.fromEntries(Object.entries(result.scopes).map(([scope, value]) => [scope, value.status]))
      });
      return result;
          } catch (error) {
      const completed = this.now();
      result.overallStatus = 'FAILED';
      result.completedAt = iso(completed);
      result.durationMs = Math.max(0, completed.getTime() - started.getTime());
      result.scopes.orchestration = {
        status: 'FAILED',
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
        connectionsProcessed: 0,
        error: {
          type: 'BACKEND_ERROR',
          code: error?.code || 'SYNC_ALL_START_FAILED',
          httpStatus: 500,
          endpoint: '/api/sync/all',
          requestId: syncRunId,
          safeMessage: 'Unable to start synchronization'
        }
      };
      result.systems = result.scopes;
      await this._audit(actor, 'SYNC_ALL_FAILED', 'FAILED', {
        requestId,
        syncRunId,
        durationMs: result.durationMs,
        errorCode: result.scopes.orchestration.error.code
      }, ip);
      console.error('[SyncAll] failed', {
        requestId,
        syncRunId,
        requestedBy: actor.username,
        role: actor.role,
        durationMs: result.durationMs,
        code: result.scopes.orchestration.error.code
      });
      return result;
    } finally {
      this.coordinator.release(coordinatorToken);
    }
  }
}
const service = new SyncAllService();
service.SyncAllService = SyncAllService;
service.DEPENDENCIES = DEPENDENCIES;
service.connectionStatus = connectionStatus;
service.failedSrmScopes = failedSrmScopes;
service.summarizeOverall = summarizeOverall;
module.exports = service;
