const express = require('express');
const router = express.Router();

const {
  pool
} = require('../../db');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.middleware');

const inventoryRepo = require('../repositories/inventory.repository');

const {
  getVcenterFreshness
} = require('../services/collection-metadata.service');

const {
  deriveDataState
} = require('../services/data-freshness.service');

const {
  sendReadResponse
} = require('../utils/api-response.util');

const {
  loadVmProtectionEvidence,
  resolveVmProtection
} = require('../services/vm-protection.service');

const vrSyncService = require('../services/vr-sync.service');

const numberOrNull = value => value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value);

const createApiEndpoint = (path, tableName) => {
  router.get(path, requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
    try {
      const {
        rows
      } = await pool.run(s => s.helpers.result(s.read(tableName)), [], false);

      res.json(rows);
    } catch (err) {
      next(err);
    }
  });
};
router.get('/networks', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_networks", r => views["current_networks"] || s.read("current_networks"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
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
        result.sort((a, b) => R.order([[R.ref(a.r, "name", null), R.ref(b.r, "name", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    next(err);
  }
});
router.get('/resource-pools', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_resource_pools", r => views["current_resource_pools"] || s.read("current_resource_pools"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
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
        result.sort((a, b) => R.order([[R.ref(a.r, "name", null), R.ref(b.r, "name", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    next(err);
  }
});

// Simple endpoints
createApiEndpoint('/replications', 'replications');
createApiEndpoint('/protection-groups', 'protection_groups');
createApiEndpoint('/recovery-plans', 'recovery_plans');
createApiEndpoint('/mappings', 'mappings');
router.get('/dashboard', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const stats = await inventoryRepo.getDashboardStats();
    const overview = await require('../services/dr-overview.service').getDrOverview();

    // Fetch connections
    const connRes = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", null), "VCENTER"), R.binary("=", R.ref(r, "is_active", null), true)));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "connection_name": R.ref(r, "connection_name", null),
            "site": R.ref(r, "site", null),
            "base_url": R.ref(r, "base_url", null),
            "last_sync_status": R.ref(r, "last_sync_status", null),
            "last_sync_at": R.ref(r, "last_sync_at", null),
            "last_sync_error_code": R.ref(r, "last_sync_error_code", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const sites = [];
    let connectedVcenterCount = 0;
    let lastGlobalSync = null;

    for (const c of connRes.rows) {
      if (c.last_sync_status === 'SYNCED') connectedVcenterCount++;

      if (!lastGlobalSync || c.last_sync_at && c.last_sync_at > lastGlobalSync) {
        lastGlobalSync = c.last_sync_at;
      }

      const vcenterRes = await pool.run((s, p) => {
        const R = s.helpers;
        const views = {};
        return R.result((parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_vcenters", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", null), p[0]));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "vm_count": R.ref(r, "vm_count", null),
              "host_count": R.ref(r, "host_count", null),
              "datastore_count": R.ref(r, "datastore_count", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(null));
      }, [c.base_url], false);

      const vcData = vcenterRes.rows[0] || {};

      sites.push({
        site: c.site,
        baseUrl: c.base_url,
        connectionStatus: c.last_sync_status === 'SYNCED' ? 'CONNECTED' : 'DISCONNECTED',
        syncStatus: c.last_sync_status,
        vmCount: numberOrNull(vcData.vm_count),
        hostCount: numberOrNull(vcData.host_count),
        datastoreCount: numberOrNull(vcData.datastore_count),
        lastSuccessfulSyncAt: c.last_sync_at
      });
    }

    const freshness = await getVcenterFreshness(lastGlobalSync);

    const dataState = deriveDataState({
      hasData: sites.length > 0,
      freshnessStatus: freshness.freshnessStatus
    });

    sendReadResponse(res, {
      connectedVcenterCount,
      datacenterCount: stats.datacenterCount,
      clusterCount: stats.clusterCount,
      hostCount: stats.hostCount,
      datastoreCount: stats.datastoreCount,
      vmCount: stats.vmCount,
      poweredOnVmCount: stats.poweredOnVmCount,
      poweredOffVmCount: stats.poweredOffVmCount,
      configuredVcpuTotal: stats.configuredVcpuTotal,
      configuredMemoryMibTotal: stats.configuredMemoryMibTotal,
      replicationCount: overview.metrics.logicalReplicationCount,
      replicationObservationCount: overview.metrics.replicationObservationCount,
      protectionGroupCount: overview.metrics.canonicalProtectionGroupCount,
      recoveryPlanCount: overview.metrics.canonicalRecoveryPlanCount,
      issueCount: overview.metrics.activeIssueCount,
      health: overview.health,
      sites,
      lastSuccessfulSyncAt: lastGlobalSync,
      lastSyncStatus: connectedVcenterCount === connRes.rows.length && connRes.rows.length > 0 ? 'SYNCED' : connRes.rows.length > 0 ? 'PARTIAL' : 'NEVER_SYNCED',
      freshness,
      dataState
    }, {
      dataState,
      freshness
    });
  } catch (err) {
    next(err);
  }
});
router.get('/vms', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      site,
      powerState,
      toolsStatus,
      protectionStatus,
      search
    } = req.query;
    const params = [];
    let paramCount = 1;
    if (site && site !== 'ALL') {
      params.push(site);
    }
    if (powerState && powerState !== 'ALL') {
      params.push(powerState);
    }
    if (search) {
      params.push(`%${search}%`);
    }
    const {
      rows
    } = await pool.run((s, p) => {
      const result = ((s, p) => {
        const R = s.helpers;
        const views = {};
        return R.result((parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "vms", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
          rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "vms")), "INNER JOIN");
          rows = R.join(rows, "h", r => views["current_hosts"] || s.read("current_hosts"), r => R.binary("AND", R.binary("=", R.ref(r, "host_id", "h"), R.ref(r, "host_moid", "vms")), R.binary("=", R.ref(r, "vcenter_id", "h"), R.ref(r, "vcenter_id", "vms"))), "LEFT JOIN");
          rows = R.join(rows, "c", r => views["current_clusters"] || s.read("current_clusters"), r => R.binary("AND", R.binary("=", R.ref(r, "cluster_id", "c"), R.fn("coalesce", [R.ref(r, "cluster_moid", "vms"), R.ref(r, "cluster_moid", "h")])), R.binary("=", R.ref(r, "vcenter_id", "c"), R.ref(r, "vcenter_id", "vms"))), "LEFT JOIN");
          rows = R.join(rows, "rp", r => views["current_resource_pools"] || s.read("current_resource_pools"), r => R.binary("AND", R.binary("=", R.ref(r, "pool_id", "rp"), R.ref(r, "resource_pool_moid", "vms")), R.binary("=", R.ref(r, "vcenter_id", "rp"), R.ref(r, "vcenter_id", "vms"))), "LEFT JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "vms"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              ...R.star(r, "vms"),
              "site_role": R.ref(r, "site", "conn"),
              "connection_name": R.ref(r, "connection_name", "conn"),
              "host_name": R.ref(r, "name", "h"),
              "cluster_name": R.ref(r, "name", "c"),
              "resource_pool_name": R.ref(r, "name", "rp"),
              "mapped_datastores": R.scalar((parent => {
                let rows = [R.context(parent)];
                rows = R.join(rows, "vdm", r => views["vm_datastore_mappings"] || s.read("vm_datastore_mappings"), r => true, "INNER JOIN");
                rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "vdm")), R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "vms"))), "INNER JOIN");
                rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "vm_moid", "vdm"), R.ref(r, "vm_id", "vms")), R.binary("=", R.ref(r, "vcenter_id", "vdm"), R.ref(r, "vcenter_id", "vms"))));
                let groups = R.groups(rows, null);
                let result = groups.flatMap(g => {
                  const r = g[0] || R.context(parent);
                  return R.expand({
                    "json_agg": R.aggregate("json_agg", g.filter(a => true).map(a => R.ref(a, "name", "d")), false, null)
                  }).map(value => ({
                    value,
                    r: R.projectContext(r, value),
                    g
                  }));
                });
                return result.slice(0).map(x => x.value);
              })(r)),
              "mapped_networks": R.scalar((parent => {
                let rows = [R.context(parent)];
                rows = R.join(rows, "vnm", r => views["vm_network_mappings"] || s.read("vm_network_mappings"), r => true, "INNER JOIN");
                rows = R.join(rows, "n", r => views["current_networks"] || s.read("current_networks"), r => R.binary("AND", R.binary("=", R.ref(r, "network_id", "n"), R.ref(r, "network_moid", "vnm")), R.binary("=", R.ref(r, "vcenter_id", "n"), R.ref(r, "vcenter_id", "vms"))), "INNER JOIN");
                rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "vm_moid", "vnm"), R.ref(r, "vm_id", "vms")), R.binary("=", R.ref(r, "vcenter_id", "vnm"), R.ref(r, "vcenter_id", "vms"))));
                let groups = R.groups(rows, null);
                let result = groups.flatMap(g => {
                  const r = g[0] || R.context(parent);
                  return R.expand({
                    "json_agg": R.aggregate("json_agg", g.filter(a => true).map(a => R.ref(a, "name", "n")), false, null)
                  }).map(value => ({
                    value,
                    r: R.projectContext(r, value),
                    g
                  }));
                });
                return result.slice(0).map(x => x.value);
              })(r))
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(null));
      })(s, p);
      result.rows = result.rows.filter(r => (!site || site === 'ALL' || r.site_role === site) && (!powerState || powerState === 'ALL' || r.power_state === powerState) && (!search || String(r.name || '').toLowerCase().includes(String(search).toLowerCase())));
      result.rowCount = result.rows.length;
      return result;
    }, [], false);

    const protectionEvidence = await loadVmProtectionEvidence();

    let mappedVms = rows.map(row => {
      const protection = resolveVmProtection(protectionEvidence, {
        vcenterId: row.vcenter_id,
        vcenterName: row.connection_name,
        vmMoid: row.vm_id,
        vmName: row.name
      });
      return {
        id: row.id,
        vcenterId: row.vcenter_id,
        vcenterName: row.connection_name,
        vmId: row.vm_id,
        name: row.name,
        site: row.site_role || 'UNMAPPED',
        powerState: row.power_state,
        host: row.host_name || 'Not reported',
        cluster: row.cluster_name || row.cluster_moid || null,
        datastores: row.mapped_datastores ? row.mapped_datastores.join(', ') : 'Not mapped',
        networks: row.mapped_networks ? row.mapped_networks.join(', ') : 'Not mapped',
        configuredVcpu: row.configured_vcpu || row.cpu,
        configuredMemoryMib: row.configured_memory_mib || row.ram,
        configuredMemoryGiB: row.configured_memory_mib || row.ram ? (row.configured_memory_mib || row.ram) / 1024 : null,
        guestOs: row.guest_os_full_name || row.os,
        toolsStatus: row.tools_running_status || row.tools_status || 'Unavailable',
        primaryIp: row.primary_ip || row.ip || null,
        resourcePool: row.resource_pool_name || row.resource_pool_moid || null,
        ...protection,
        detailStatus: row.detail_status || 'UNAVAILABLE',
        lastSeenAt: row.guest_data_updated_at
      };
    });

    if (protectionStatus && protectionStatus !== 'ALL') {
      mappedVms = mappedVms.filter(vm => vm.protectionStatus === protectionStatus);
    }

    res.json({
      success: true,
      data: mappedVms
    });
  } catch (err) {
    next(err);
  }
});
router.get('/vms/:id/details', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vms", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
        // Reduce the working set to the requested VM before joining the rest of
        // the inventory. Joining every VM first becomes noticeably expensive
        // on larger vCenters and makes an expanded row appear stuck loading.
        rows = rows.filter(r => R.binary("OR", R.binary("=", R.cast(R.ref(r, "id", "vms"), {
          "name": "text"
        }), p[0]), R.binary("AND", R.binary("=", R.ref(r, "vm_id", "vms"), p[0]), R.binary("=", R.ref(r, "vcenter_id", "vms"), p[1]))));
        rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "vms")), "INNER JOIN");
        rows = R.join(rows, "h", r => views["current_hosts"] || s.read("current_hosts"), r => R.binary("AND", R.binary("=", R.ref(r, "host_id", "h"), R.ref(r, "host_moid", "vms")), R.binary("=", R.ref(r, "vcenter_id", "h"), R.ref(r, "vcenter_id", "vms"))), "LEFT JOIN");
        rows = R.join(rows, "c", r => views["current_clusters"] || s.read("current_clusters"), r => R.binary("AND", R.binary("=", R.ref(r, "cluster_id", "c"), R.fn("coalesce", [R.ref(r, "cluster_moid", "vms"), R.ref(r, "cluster_moid", "h")])), R.binary("=", R.ref(r, "vcenter_id", "c"), R.ref(r, "vcenter_id", "vms"))), "LEFT JOIN");
        rows = R.join(rows, "rp", r => views["current_resource_pools"] || s.read("current_resource_pools"), r => R.binary("AND", R.binary("=", R.ref(r, "pool_id", "rp"), R.ref(r, "resource_pool_moid", "vms")), R.binary("=", R.ref(r, "vcenter_id", "rp"), R.ref(r, "vcenter_id", "vms"))), "LEFT JOIN");
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "vms"),
            "site_role": R.ref(r, "site", "conn"),
            "connection_name": R.ref(r, "connection_name", "conn"),
            "host_name": R.ref(r, "name", "h"),
            "cluster_name": R.ref(r, "name", "c"),
            "resource_pool_name": R.ref(r, "name", "rp")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.binary("=", R.cast(R.ref(a.r, "id", "vms"), {
          "name": "text"
        }), p[0]) ? 0 : 1, R.binary("=", R.cast(R.ref(b.r, "id", "vms"), {
          "name": "text"
        }), p[0]) ? 0 : 1, "ASC", null]]));
        return result.slice(0, 0 + Number(1)).map(x => x.value);
      })(null));
    }, [req.params.id, req.query.vcenterId || null], false);

    if (rows.length === 0) return res.status(404).json({
      success: false,
      message: 'VM not found'
    });

    const row = rows[0];
    const protectionEvidence = await loadVmProtectionEvidence();

    const protection = resolveVmProtection(protectionEvidence, {
      vcenterId: row.vcenter_id,
      vmMoid: row.vm_id
    });
    const protectionContext = protectionEvidence.contexts.get(row.vcenter_id);
    const hasRecoveryProvider = Boolean(protectionContext?.vcenterStableId);

    let replicationRows = [];
    let replicationAvailability = hasRecoveryProvider ? 'AVAILABLE' : 'NOT_CONFIGURED';

    if (hasRecoveryProvider) {
      try {
        const replicationReadModel = await vrSyncService.getReplications();

        replicationRows = (replicationReadModel?.canonicalReplications || []).filter(replication => replication.vmInventoryVmId === row.vm_id && replication.vmInventoryVcenterId === row.vcenter_id || !replication.vmInventoryVmId && String(replication.vmName || '').toLowerCase() === String(row.name || '').toLowerCase()).map(replication => ({
          canonicalReplicationKey: replication.canonicalReplicationKey || null,
          replicationId: replication.replicationId || null,
          status: replication.normalizedStatus || replication.rawStatus || null,
          rawStatus: replication.rawStatus || null,
          rpoMinutes: replication.rpoMinutes ?? null,
          protectionGroupName: replication.protectionGroupName || null,
          sourceSiteName: replication.logicalSourceSiteName || null,
          sourceVcenterHost: replication.logicalSourceVcenterHost || null,
          targetSiteName: replication.logicalTargetSiteName || null,
          targetVrName: replication.targetVrName || null,
          targetVcenterName: replication.logicalTargetVcenterName || null,
          targetVcenterHost: replication.logicalTargetVcenterHost || null,
          recoveryPlanName: replication.recoveryPlanName || null,
          replicatedDiskSummary: replication.replicatedDiskSummary || null,
          lastCollectedAt: replication.lastCollectedAt || null
        }));
      } catch (_replicationError) {
        // VM inventory detail remains available when the isolated VR read scope fails.
        replicationAvailability = 'NOT_AVAILABLE';
      }
    }

    const targetDatastoreInventory = replicationRows.length > 0
      ? await pool.run(s => ({
        rows: s.read('current_datastores')
          .filter(datastore => datastore.is_present === true)
          .map(datastore => ({
            name: datastore.name,
            capacityBytes: datastore.capacity,
            freeSpaceBytes: datastore.free_space,
            vcenterId: datastore.vcenter_id
          }))
      }), [], false)
      : { rows: [] };

    replicationRows = replicationRows.map(replication => {
      const destinationNames = replication.replicatedDiskSummary?.destinationDatastores || [];
      const targetHost = String(replication.targetVcenterHost || '').toLowerCase();

      const targetDatastores = destinationNames.map(name => {
        const datastore = targetDatastoreInventory.rows.find(candidate =>
          candidate.name === name
          && (!targetHost || String(candidate.vcenterId || '').toLowerCase().includes(targetHost))
        ) || targetDatastoreInventory.rows.find(candidate => candidate.name === name);

        return {
          name,
          capacityBytes: datastore?.capacityBytes ?? null,
          freeSpaceBytes: datastore?.freeSpaceBytes ?? null
        };
      });

      return { ...replication, targetDatastores };
    });

    const datastoresRes = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vdm", r => views["vm_datastore_mappings"] || s.read("vm_datastore_mappings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vm_moid", "vdm"), p[0]), R.binary("=", R.ref(r, "vcenter_id", "vdm"), p[1])), R.binary("=", R.ref(r, "is_present", "vdm"), true)));
        rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "vdm")), R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "vdm"))), "INNER JOIN");
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "name": R.ref(r, "name", "d")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [row.vm_id, row.vcenter_id], false);

    const networksRes = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vnm", r => views["vm_network_mappings"] || s.read("vm_network_mappings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vm_moid", "vnm"), p[0]), R.binary("=", R.ref(r, "vcenter_id", "vnm"), p[1])), R.binary("=", R.ref(r, "is_present", "vnm"), true)));
        rows = R.join(rows, "n", r => views["current_networks"] || s.read("current_networks"), r => R.binary("AND", R.binary("=", R.ref(r, "network_id", "n"), R.ref(r, "network_moid", "vnm")), R.binary("=", R.ref(r, "vcenter_id", "n"), R.ref(r, "vcenter_id", "vnm"))), "INNER JOIN");
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "name": R.ref(r, "name", "n")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [row.vm_id, row.vcenter_id], false);

    res.json({
      success: true,
      data: {
        id: row.id,
        vcenterId: row.vcenter_id,
        vcenterName: row.connection_name,
        vmId: row.vm_id,
        name: row.name,
        site: row.site_role,
        powerState: row.power_state,
        guestOs: row.guest_os_full_name,
        dnsName: row.dns_name,
        primaryIp: row.primary_ip,
        ipAddresses: row.ip_addresses || [],
        toolsRunningStatus: row.tools_running_status,
        toolsVersionStatus: row.tools_version_status,
        hardwareVersion: row.hardware_version,
        host: row.host_name,
        cluster: row.cluster_name || row.cluster_moid,
        resourcePool: row.resource_pool_name || row.resource_pool_moid,
        datastores: datastoresRes.rows.map(d => d.name),
        networks: networksRes.rows.map(n => n.name),
        configuredVcpu: row.configured_vcpu,
        configuredMemoryMib: row.configured_memory_mib,
        cpuUsageMhz: row.cpu_usage_mhz,
        memoryUsageMib: row.memory_usage_mib,
        storageCommittedBytes: row.storage_committed_bytes,
        storageUncommittedBytes: row.storage_uncommitted_bytes,
        detailStatus: row.detail_status,
        lastCollectedTimestamp: row.guest_data_updated_at,
        replicationAvailability,
        replications: replicationRows,
        ...protection
      }
    });
  } catch (err) {
    next(err);
  }
});
router.get('/hosts', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "h", r => views["current_hosts"] || s.read("current_hosts"), r => true, "INNER JOIN");
        rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "h")), "INNER JOIN");
        rows = R.join(rows, "c", r => views["current_clusters"] || s.read("current_clusters"), r => R.binary("AND", R.binary("=", R.ref(r, "cluster_id", "c"), R.ref(r, "cluster_moid", "h")), R.binary("=", R.ref(r, "vcenter_id", "c"), R.ref(r, "vcenter_id", "h"))), "LEFT JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "h"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "h"),
            "site_role": R.ref(r, "site", "conn"),
            "connection_name": R.ref(r, "connection_name", "conn"),
            "cluster_name": R.ref(r, "name", "c"),
            "vm_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "vms", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "host_moid", "vms"), R.ref(r, "host_id", "h")), R.binary("=", R.ref(r, "is_present", "vms"), true)), R.binary("=", R.ref(r, "vcenter_id", "vms"), R.ref(r, "vcenter_id", "h"))));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => 1), false, null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "total_storage_bytes": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "hdm", r => views["host_datastore_mappings"] || s.read("host_datastore_mappings"), r => true, "INNER JOIN");
              rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "hdm")), R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "hdm"))), "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "host_moid", "hdm"), R.ref(r, "host_id", "h")), R.binary("=", R.ref(r, "vcenter_id", "hdm"), R.ref(r, "vcenter_id", "h"))), R.binary("=", R.ref(r, "is_present", "hdm"), true)));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "sum": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "capacity", "d")), false, null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "free_storage_bytes": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "hdm", r => views["host_datastore_mappings"] || s.read("host_datastore_mappings"), r => true, "INNER JOIN");
              rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "hdm")), R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "hdm"))), "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "host_moid", "hdm"), R.ref(r, "host_id", "h")), R.binary("=", R.ref(r, "vcenter_id", "hdm"), R.ref(r, "vcenter_id", "h"))), R.binary("=", R.ref(r, "is_present", "hdm"), true)));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "sum": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "free_space", "d")), false, null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "datastores": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "hdm", r => views["host_datastore_mappings"] || s.read("host_datastore_mappings"), r => true, "INNER JOIN");
              rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "hdm")), R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "hdm"))), "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "host_moid", "hdm"), R.ref(r, "host_id", "h")), R.binary("=", R.ref(r, "vcenter_id", "hdm"), R.ref(r, "vcenter_id", "h"))), R.binary("=", R.ref(r, "is_present", "hdm"), true)));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "string_agg": R.aggregate("string_agg", g.filter(a => true).map(a => R.ref(a, "name", "d")), false, ", ")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "networks": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "hnm", r => views["host_network_mappings"] || s.read("host_network_mappings"), r => true, "INNER JOIN");
              rows = R.join(rows, "n", r => views["current_networks"] || s.read("current_networks"), r => R.binary("AND", R.binary("=", R.ref(r, "network_id", "n"), R.ref(r, "network_moid", "hnm")), R.binary("=", R.ref(r, "vcenter_id", "n"), R.ref(r, "vcenter_id", "hnm"))), "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "host_moid", "hnm"), R.ref(r, "host_id", "h")), R.binary("=", R.ref(r, "vcenter_id", "hnm"), R.ref(r, "vcenter_id", "h"))), R.binary("=", R.ref(r, "is_present", "hnm"), true)));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "string_agg": R.aggregate("string_agg", g.filter(a => true).map(a => R.ref(a, "name", "n")), false, ", ")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "pnic_count": R.ref(r, "pnic_count", "h"),
            "hba_count": R.ref(r, "hba_count", "h"),
            "lun_count": R.ref(r, "lun_count", "h"),
            "vswitch_count": R.ref(r, "vswitch_count", "h"),
            "vnic_count": R.ref(r, "vnic_count", "h"),
            "hba_list": R.ref(r, "hba_list", "h"),
            "lun_list": R.ref(r, "lun_list", "h"),
            "vswitch_list": R.ref(r, "vswitch_list", "h"),
            "vnic_list": R.ref(r, "vnic_list", "h"),
            "pnic_list": R.ref(r, "pnic_list", "h")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const mapped = rows.map(row => ({
      hostId: row.host_id,
      vcenterId: row.vcenter_id,
      vcenterName: row.connection_name,
      name: row.name,
      site: row.site_role,
      cluster: row.cluster_name || row.cluster_moid || null,
      connectionState: row.connection_state,
      powerState: row.power_state,
      vmCount: numberOrNull(row.vm_count),
      hardware: {
        vendor: row.vendor,
        model: row.model,
        cpuModel: row.cpu_model
      },
      capacity: {
        cpuCores: row.cpu_cores,
        cpuThreads: row.cpu_threads,
        cpuMhz: row.cpu_mhz,
        cpuUsageMhz: row.cpu_usage_mhz,
        totalMemoryBytes: row.total_memory_bytes,
        memoryUsageMib: row.memory_usage_mib,
        totalStorageBytes: row.total_storage_bytes,
        freeStorageBytes: row.free_storage_bytes
      },
      datastores: row.datastores || null,
      networks: row.networks || null,
      pnicCount: row.pnic_count || 0,
      hbaCount: row.hba_count || 0,
      lunCount: row.lun_count || 0,
      vswitchCount: row.vswitch_count || 0,
      vnicCount: row.vnic_count || 0,
      hbaList: typeof row.hba_list === 'string' ? JSON.parse(row.hba_list) : row.hba_list || [],
      lunList: typeof row.lun_list === 'string' ? JSON.parse(row.lun_list) : row.lun_list || [],
      vswitchList: typeof row.vswitch_list === 'string' ? JSON.parse(row.vswitch_list) : row.vswitch_list || [],
      vnicList: typeof row.vnic_list === 'string' ? JSON.parse(row.vnic_list) : row.vnic_list || [],
      pnicList: typeof row.pnic_list === 'string' ? JSON.parse(row.pnic_list) : row.pnic_list || [],
      currentUsage: {
        cpuUsagePct: row.cpu_usage_mhz && row.cpu_mhz && row.cpu_cores ? Math.round(row.cpu_usage_mhz / (row.cpu_mhz * row.cpu_cores) * 100) : 0,
        memoryUsagePct: row.memory_usage_mib && row.total_memory_bytes ? Math.round(row.memory_usage_mib * 1048576 / row.total_memory_bytes * 100) : 0,
        storageUsagePct: row.total_storage_bytes && row.free_storage_bytes ? Math.round((row.total_storage_bytes - row.free_storage_bytes) / row.total_storage_bytes * 100) : 0
      },
      version: row.esxi_version,
      build: row.esxi_build,
      overallStatus: row.overall_status,
      lastSeenAt: row.last_updated
    }));

    res.json({
      success: true,
      data: mapped
    });
  } catch (err) {
    next(err);
  }
});
router.get('/vcenters', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "c"), R.ref(r, "vcenter_id", "vc")), "INNER JOIN");
        rows = R.join(rows, "h", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_hosts", r => views["current_hosts"] || s.read("current_hosts"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
          let groups = R.groups(rows, r => [R.ref(r, "vcenter_id", null)]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "vcenter_id": R.ref(r, "vcenter_id", null),
              "total_cpu_mhz": R.aggregate("sum", g.filter(a => true).map(a => R.binary("*", R.cast(R.ref(a, "cpu_mhz", null), {
                "name": "bigint"
              }), R.ref(a, "cpu_cores", null))), false, null),
              "used_cpu_mhz": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "cpu_usage_mhz", null)), false, null),
              "total_mem_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "total_memory_bytes", null)), false, null),
              "used_mem_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.binary("*", R.cast(R.ref(a, "memory_usage_mib", null), {
                "name": "bigint"
              }), 1048576)), false, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(r), r => R.binary("=", R.ref(r, "vcenter_id", "h"), R.ref(r, "vcenter_id", "vc")), "LEFT JOIN");

        rows = R.join(rows, "d", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_datastores", r => views["current_datastores"] || s.read("current_datastores"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
          let groups = R.groups(rows, r => [R.ref(r, "vcenter_id", null)]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "vcenter_id": R.ref(r, "vcenter_id", null),
              "total_storage_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "capacity", null)), false, null),
              "free_storage_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "free_space", null)), false, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(r), r => R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "vc")), "LEFT JOIN");

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "vc"),
            "site_role": R.ref(r, "site", "c"),
            "connection_name": R.ref(r, "connection_name", "c"),
            "connection_last_collected_at": R.ref(r, "last_sync_at", "c"),
            "last_connection_status": R.ref(r, "last_connection_status", "c"),
            "last_sync_status": R.ref(r, "last_sync_status", "c"),
            "total_cpu_mhz": R.ref(r, "total_cpu_mhz", "h"),
            "used_cpu_mhz": R.ref(r, "used_cpu_mhz", "h"),
            "total_mem_bytes": R.ref(r, "total_mem_bytes", "h"),
            "used_mem_bytes": R.ref(r, "used_mem_bytes", "h"),
            "total_storage_bytes": R.ref(r, "total_storage_bytes", "d"),
            "free_storage_bytes": R.ref(r, "free_storage_bytes", "d")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const mappedRows = rows.map(r => {
      const cpuPct = r.total_cpu_mhz != null && r.used_cpu_mhz != null && Number(r.total_cpu_mhz) > 0 ? Math.round(Number(r.used_cpu_mhz) / Number(r.total_cpu_mhz) * 100) : null;
      const memPct = r.total_mem_bytes != null && r.used_mem_bytes != null && Number(r.total_mem_bytes) > 0 ? Math.round(Number(r.used_mem_bytes) / Number(r.total_mem_bytes) * 100) : null;
      const storageUsed = r.total_storage_bytes != null && r.free_storage_bytes != null ? Number(r.total_storage_bytes) - Number(r.free_storage_bytes) : null;
      const storagePct = storageUsed != null && Number(r.total_storage_bytes) > 0 ? Math.round(storageUsed / Number(r.total_storage_bytes) * 100) : null;

      return {
        ...r,
        site: r.site_role,
        connectionName: r.connection_name,
        lastCollectedAt: r.last_updated || r.connection_last_collected_at || null,
        connectionStatus: r.last_connection_status || r.last_sync_status || null,
        capacityUsage: {
          cpu: cpuPct == null ? null : `${cpuPct}%`,
          memory: memPct == null ? null : `${memPct}%`,
          storage: storagePct == null ? null : `${storagePct}%`
        }
      };
    });

    const freshness = await getVcenterFreshness();

    const dataState = deriveDataState({
      hasData: mappedRows.length > 0,
      freshnessStatus: freshness.freshnessStatus
    });

    sendReadResponse(res, mappedRows, {
      dataState,
      freshness
    });
  } catch (err) {
    next(err);
  }
});
router.get('/datacenters', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "t", r => views["current_datacenters"] || s.read("current_datacenters"), r => true, "INNER JOIN");
        rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "t")), "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "t"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "t"),
            "site_role": R.ref(r, "site", "conn")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    res.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        site: r.site_role
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.get('/clusters', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "t", r => views["current_clusters"] || s.read("current_clusters"), r => true, "INNER JOIN");
        rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "t")), "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "t"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "t"),
            "site_role": R.ref(r, "site", "conn")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    res.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        site: r.site_role
      }))
    });
  } catch (err) {
    next(err);
  }
});
router.get('/datastores', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "t", r => views["current_datastores"] || s.read("current_datastores"), r => true, "INNER JOIN");
        rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "t")), "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "t"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "t"),
            "site_role": R.ref(r, "site", "conn")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    res.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        site: r.site_role
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

router.get('/networks', requireAuth, requireRole("VIEWER", "OPERATOR", "ADMIN"), async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "n", r => views["current_networks"] || s.read("current_networks"), r => true, "INNER JOIN");
        rows = R.join(rows, "conn", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "base_url", "conn"), R.ref(r, "vcenter_id", "n")), "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "n"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            ...R.star(r, "n"),
            "site_role": R.ref(r, "site", "conn")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    next(err);
  }
});
