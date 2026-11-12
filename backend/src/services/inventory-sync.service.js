const db = require('../../db');
const vcenterAdapter = require('../adapters/vmware/vcenter.adapter');
const cryptoService = require('../utils/encryption.util');
const inventoryRepo = require('../repositories/inventory.repository');
const AuditService = require('./audit.service');
const syncCoordinator = require('./sync-coordinator.service');
const {
  createLiveCollectionResult
} = require('./live-collection-evidence.service');

// Use a simple in-memory Set for single-flight locking per connectionId
const activeSyncLocks = new Set();
class InventorySyncService {
  async syncVCenterInventory(connectionId, actor = 'system', requestContext = {}) {
    if (activeSyncLocks.has(connectionId)) {
      const err = new Error('INVENTORY_SYNC_IN_PROGRESS');
      err.code = 'INVENTORY_SYNC_IN_PROGRESS';
      throw err;
    }
    let coordinatorToken = requestContext.coordinatorToken || null;
    let ownsCoordinator = false;
    if (!coordinatorToken) {
      coordinatorToken = syncCoordinator.acquire({
        kind: 'VCENTER_SYNC',
        requestId: requestContext.requestId,
        connectionId
      });
      ownsCoordinator = true;
    }
    activeSyncLocks.add(connectionId);
    const startTime = Date.now();
    const syncRunId = requestContext.syncRunId || requestContext.requestId || `vcenter-${connectionId}-${startTime}`;
    let dbClient = null;
    let httpClient = null;
    let sessionId = null;
    let viSessionId = null;
    let apiVersion = null;
    let conn = null;
        try {
      dbClient = await db.pool.connect();
      await AuditService.logActivity({
        username: typeof actor === 'object' ? actor.username : actor,
        role: typeof actor === 'object' ? actor.role : 'SYSTEM'
      }, 'INVENTORY_SYNC_REQUESTED', connectionId.toString(), 'SUCCESS', {
        connectionId
      }, requestContext.ip, dbClient);

      // Load connection
      const connRes = await dbClient.run((s, p) => {
        const R = s.helpers;
        const views = {};
        return R.result((parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "connections", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "id", null), p[0]), R.binary("=", R.ref(r, "system_type", null), p[1])), R.binary("=", R.ref(r, "is_active", null), true)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              ...R.star(r, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(null));
      }, [connectionId, 'VCENTER'], false);
      if (connRes.rows.length === 0) {
        throw new Error('Connection not found or inactive');
      }
      conn = connRes.rows[0];
      if (conn.last_connection_status !== 'CONNECTED') {
        const err = new Error('Connection is not CONNECTED');
        err.code = 'INVALID_STATE';
        throw err;
      }
      await dbClient.run((s, p) => {
        const R = s.helpers;
        const views = {};
        const rows = s.update("connections", row => {
          const r = R.rowContext(row, "connections");
          return R.binary("=", R.ref(r, "id", null), p[0]);
        }, row => {
          const r = R.rowContext(row, "connections");
          return {
            "last_sync_status": "SYNCING"
          };
        });
        return R.changed(rows.length);
      }, [connectionId], true);
      const password = cryptoService.decryptCredential(conn.encrypted_password, conn.encryption_iv, conn.encryption_auth_tag);

      // Login vCenter (Automation & VI/JSON)
      const loginResult = await vcenterAdapter.loginAutomation(conn.base_url, conn.username, password, conn.verify_tls);
      httpClient = loginResult.httpClient;
      sessionId = loginResult.sessionId;
      try {
        const viLoginResult = await vcenterAdapter.loginViJson(httpClient, conn.base_url, conn.username, password);
        viSessionId = viLoginResult.viSessionId;
        apiVersion = viLoginResult.apiVersion;
      } catch (e) {
        console.error('Failed VI/JSON Login:', e.message);
        throw e;
      }
            // Fetch inventory
      const datacenters = await vcenterAdapter.listDatacenters(httpClient, sessionId);
      const clusters = await vcenterAdapter.listClusters(httpClient, sessionId);
      const hosts = await vcenterAdapter.listHosts(httpClient, sessionId);
      const datastores = await vcenterAdapter.listDatastores(httpClient, sessionId);
      const vms = await vcenterAdapter.listVirtualMachines(httpClient, sessionId);
      const resourcePools = await vcenterAdapter.listResourcePools(httpClient, sessionId);

      // Fetch details and health
      const applianceHealth = await vcenterAdapter.getApplianceHealth(httpClient, sessionId);
      const networks = await vcenterAdapter.getNetworkDetails(httpClient, conn.base_url, viSessionId, apiVersion);
      const vmDetails = await vcenterAdapter.batchGetVmDetails(httpClient, conn.base_url, viSessionId, apiVersion, vms);
      const hostDetails = await vcenterAdapter.batchGetHostDetails(httpClient, conn.base_url, viSessionId, apiVersion, hosts);
      const summaryData = {
        vcenter_id: conn.base_url,
        display_name: conn.connection_name,
        fqdn: new URL(conn.base_url).hostname,
        site_role: conn.site,
        cluster_count: clusters.length,
        host_count: hosts.length,
        vm_count: vms.length,
        datastore_count: datastores.length,
        product_name: applianceHealth.productName,
        version: applianceHealth.version,
        build: applianceHealth.build,
        health_status: applianceHealth.healthStatus,
        database_health: applianceHealth.databaseHealth,
        storage_health: applianceHealth.storageHealth,
        memory_health: applianceHealth.memoryHealth,
        load_health: applianceHealth.loadHealth,
        uptime_seconds: applianceHealth.uptimeSeconds,
        last_health_sync_at: applianceHealth.lastHealthSyncAt
      };
            // Extract mappings
      const vmDatastoresList = [];
      const activeVmDatastorePairs = [];
      const vmNetworksList = [];
      const activeVmNetworkPairs = [];
      for (const vm of vmDetails) {
        if (vm.mappedDatastores) {
          for (const ds of vm.mappedDatastores) {
            vmDatastoresList.push({
              vm: vm.vm,
              datastore: ds
            });
            activeVmDatastorePairs.push({
              vm: vm.vm,
              datastore: ds
            });
          }
        }
        if (vm.mappedNetworks) {
          for (const net of vm.mappedNetworks) {
            vmNetworksList.push({
              vm: vm.vm,
              network: net
            });
            activeVmNetworkPairs.push({
              vm: vm.vm,
              network: net
            });
          }
        }
      }
      const hostDatastoresList = [];
      const activeHostDatastorePairs = [];
      const hostNetworksList = [];
      const activeHostNetworkPairs = [];
      for (const host of hostDetails) {
        if (host.mappedDatastores) {
          for (const ds of host.mappedDatastores) {
            hostDatastoresList.push({
              host: host.host,
              datastore: ds
            });
            activeHostDatastorePairs.push({
              host: host.host,
              datastore: ds
            });
          }
        }
        if (host.mappedNetworks) {
          for (const net of host.mappedNetworks) {
            hostNetworksList.push({
              host: host.host,
              network: net
            });
            activeHostNetworkPairs.push({
              host: host.host,
              network: net
            });
          }
        }
      }
            // Transaction for DB update
      await dbClient.begin();
      try {
        await inventoryRepo.upsertVCenterSummary(connectionId, summaryData, dbClient);
        await inventoryRepo.upsertDatacenters(summaryData.vcenter_id, datacenters, dbClient);
        await inventoryRepo.upsertClusters(summaryData.vcenter_id, clusters, dbClient);
        await inventoryRepo.upsertHosts(summaryData.vcenter_id, hosts, dbClient);
        await inventoryRepo.upsertHostDetails(summaryData.vcenter_id, hostDetails, dbClient);
        await inventoryRepo.upsertDatastores(summaryData.vcenter_id, datastores, dbClient);
        await inventoryRepo.upsertNetworks(summaryData.vcenter_id, networks, dbClient);
        await inventoryRepo.upsertResourcePools(summaryData.vcenter_id, resourcePools, dbClient);
        await inventoryRepo.upsertVirtualMachines(summaryData.vcenter_id, vms, dbClient);
        await inventoryRepo.upsertVirtualMachineDetails(summaryData.vcenter_id, vmDetails, dbClient);
        await inventoryRepo.upsertVmDatastores(summaryData.vcenter_id, vmDatastoresList, dbClient);
        await inventoryRepo.upsertVmNetworks(summaryData.vcenter_id, vmNetworksList, dbClient);
        await inventoryRepo.upsertHostDatastores(summaryData.vcenter_id, hostDatastoresList, dbClient);
        await inventoryRepo.upsertHostNetworks(summaryData.vcenter_id, hostNetworksList, dbClient);
        await inventoryRepo.markStaleDatacenters(summaryData.vcenter_id, datacenters.map(d => d.datacenter), dbClient);
        await inventoryRepo.markStaleClusters(summaryData.vcenter_id, clusters.map(c => c.cluster), dbClient);
        await inventoryRepo.markStaleHosts(summaryData.vcenter_id, hosts.map(h => h.host), dbClient);
        await inventoryRepo.markStaleDatastores(summaryData.vcenter_id, datastores.map(ds => ds.datastore), dbClient);
        await inventoryRepo.markStaleNetworks(summaryData.vcenter_id, networks.map(n => n.network), dbClient);
        await inventoryRepo.markStaleResourcePools(summaryData.vcenter_id, resourcePools.map(rp => rp.resource_pool), dbClient);
        await inventoryRepo.markStaleVMs(summaryData.vcenter_id, vms.map(v => v.vm), dbClient);
        await inventoryRepo.markStaleVmDatastores(summaryData.vcenter_id, activeVmDatastorePairs, dbClient);
        await inventoryRepo.markStaleVmNetworks(summaryData.vcenter_id, activeVmNetworkPairs, dbClient);
        await inventoryRepo.markStaleHostDatastores(summaryData.vcenter_id, activeHostDatastorePairs, dbClient);
        await inventoryRepo.markStaleHostNetworks(summaryData.vcenter_id, activeHostNetworkPairs, dbClient);
                await dbClient.run((s, p) => {
          const R = s.helpers;
          const views = {};
          const rows = s.update("connections", row => {
            const r = R.rowContext(row, "connections");
            return R.binary("=", R.ref(r, "id", null), p[0]);
          }, row => {
            const r = R.rowContext(row, "connections");
            return {
              "last_sync_status": "SYNCED",
              "last_sync_at": s.now(),
              "last_sync_error_code": null
            };
          });
          return R.changed(rows.length);
        }, [connectionId], true);
        // Audit Success inside the same transaction
        await AuditService.logActivity({
          username: typeof actor === 'object' ? actor.username : actor,
          role: typeof actor === 'object' ? actor.role : 'SYSTEM'
        }, 'INVENTORY_SYNC_SUCCEEDED', conn.connection_name, 'SUCCESS', {
          connectionId,
          vcenterId: conn.base_url,
          datacenterCount: datacenters.length,
          clusterCount: clusters.length,
          hostCount: hosts.length,
          datastoreCount: datastores.length,
          vmCount: vms.length,
          durationMs: Date.now() - startTime
        }, requestContext.ip, dbClient);
        await dbClient.commit();
                const completedAt = new Date();
        return {
          connectionId,
          vcenterId: conn.base_url,
          datacenterCount: datacenters.length,
          clusterCount: clusters.length,
          hostCount: hosts.length,
          datastoreCount: datastores.length,
          vmCount: vms.length,
          syncStatus: 'SYNCED',
          lastSyncAt: completedAt,
          durationMs: Date.now() - startTime,
          ...createLiveCollectionResult({
            system: 'VCENTER',
            connectionId,
            syncRunId,
            collectorRunId: syncRunId,
            startedAt: new Date(startTime),
            completedAt,
            status: 'SUCCESS',
            rowsCollected: {
              datacenters: datacenters.length,
              clusters: clusters.length,
              hosts: hosts.length,
              datastores: datastores.length,
              networks: networks.length,
              virtualMachines: vms.length,
              vmDetails: vmDetails.length,
              hostDetails: hostDetails.length
            },
            operations: [{
              operation: 'LIST_DATACENTERS',
              endpointCategory: 'VCENTER_AUTOMATION_API',
              status: 'SUCCESS',
              rowCount: datacenters.length
            }, {
              operation: 'LIST_CLUSTERS',
              endpointCategory: 'VCENTER_AUTOMATION_API',
              status: 'SUCCESS',
              rowCount: clusters.length
            }, {
              operation: 'LIST_HOSTS',
              endpointCategory: 'VCENTER_AUTOMATION_API',
              status: 'SUCCESS',
              rowCount: hosts.length
            }, {
              operation: 'LIST_DATASTORES',
              endpointCategory: 'VCENTER_AUTOMATION_API',
              status: 'SUCCESS',
              rowCount: datastores.length
            }, {
              operation: 'LIST_VIRTUAL_MACHINES',
              endpointCategory: 'VCENTER_AUTOMATION_API',
              status: 'SUCCESS',
              rowCount: vms.length
            }, {
              operation: 'GET_NETWORK_DETAILS',
              endpointCategory: 'VCENTER_VI_JSON_API',
              status: 'SUCCESS',
              rowCount: networks.length
            }, {
              operation: 'GET_VM_DETAILS',
              endpointCategory: 'VCENTER_VI_JSON_API',
              status: 'SUCCESS',
              rowCount: vmDetails.length
            }, {
              operation: 'GET_HOST_DETAILS',
              endpointCategory: 'VCENTER_VI_JSON_API',
              status: 'SUCCESS',
              rowCount: hostDetails.length
            }, {
              operation: 'GET_APPLIANCE_HEALTH',
              endpointCategory: 'VCENTER_AUTOMATION_API',
              status: 'SUCCESS',
              rowCount: 1
            }],
            canonicalization: {
              status: 'SUCCESS',
              phase: 'POST_PERSISTENCE_INVENTORY_READY'
            }
          })
        };
      } catch (txnErr) {
        await dbClient.rollback();
        throw txnErr;
      }
          } catch (err) {
      // Failure Flow
      let safeErrorCode = 'INVENTORY_SYNC_FAILED';
      let syncStatus = 'SYNC_FAILED';
      if (err.code) {
        safeErrorCode = err.code;
        if (err.code === 'INVENTORY_LIMIT_EXCEEDED') {
          syncStatus = 'LIMIT_EXCEEDED';
        }
      }
      if (dbClient) {
        try {
          await dbClient.run((s, p) => {
            const R = s.helpers;
            const views = {};
            const rows = s.update("connections", row => {
              const r = R.rowContext(row, "connections");
              return R.binary("=", R.ref(r, "id", null), p[2]);
            }, row => {
              const r = R.rowContext(row, "connections");
              return {
                "last_sync_status": p[0],
                "last_sync_error_code": p[1]
              };
            });
            return R.changed(rows.length);
          }, [syncStatus, safeErrorCode, connectionId], true);
          await AuditService.logActivity({
            username: typeof actor === 'object' ? actor.username : actor,
            role: typeof actor === 'object' ? actor.role : 'SYSTEM'
          }, 'INVENTORY_SYNC_FAILED', connectionId.toString(), 'FAILED', {
            connectionId,
            errorCode: safeErrorCode,
            durationMs: Date.now() - startTime
          }, requestContext.ip, dbClient);
        } catch (updateErr) {
          console.error('Failed to update sync failure status:', updateErr);
        }
      }
      console.error('Inventory sync failed', {
        connectionId,
        code: safeErrorCode,
        message: err.message
      });
      const returnErr = new Error('Inventory Sync Failed');
      returnErr.code = safeErrorCode;
      throw returnErr;
    } finally {
      try {
        if (httpClient && viSessionId && apiVersion) {
          await vcenterAdapter.logoutViJson(httpClient, conn.base_url, apiVersion, viSessionId).catch(err => {
            console.error('VI/JSON logout failed:', err.message);
          });
        }
      } finally {
        try {
          if (httpClient && sessionId) {
            await vcenterAdapter.logoutAutomation(httpClient, sessionId).catch(err => {
              console.error('Automation logout failed:', err.message);
            });
          }
        } finally {
          try {
            if (dbClient) {
              dbClient.release();
            }
          } finally {
            activeSyncLocks.delete(connectionId);
            if (ownsCoordinator) syncCoordinator.release(coordinatorToken);
          }
        }
      }
    }
  }
}
module.exports = new InventorySyncService();
