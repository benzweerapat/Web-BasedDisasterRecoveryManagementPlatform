const {
  pool
} = require('../../db');
const vrRepository = require('../repositories/vr.repository');
const vrMapper = require('./vr-mapper.service');
const srmMapper = require('./srm-mapper.service');
const {
  buildApplianceViewModel,
  parseUrlHost
} = require('./appliance-discovery.service');
const {
  getUnifiedFreshness
} = require('./collection-metadata.service');
const {
  buildFreshness,
  buildScopeFreshness,
  combineFreshness
} = require('./data-freshness.service');
const {
  buildSystemHealth
} = require('./system-health.service');
const {
  buildSrmScopeSummary,
  resolveSrmOverallState
} = require('./srm-health.service');
const number = value => value == null ? null : Number(value);

function normalizeSiteIdentity(value) {
  if (!value) return null;
  const original = String(value).trim();
  const tokens = original.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const compact = tokens.join('');
  if (tokens.includes('DC') || compact.endsWith('DC')) return 'DC';
  if (tokens.includes('DR') || compact.endsWith('DR')) return 'DR';
  return original;
}

function latestIso(values = []) {
  const dates = values.filter(Boolean).map(value => value instanceof Date ? value : new Date(value)).filter(value => !Number.isNaN(value.getTime()));
  return dates.length ? new Date(Math.max(...dates.map(value => value.getTime()))).toISOString() : null;
}
function buildHostSummaries(hostRows = [], vcenterConnectionId) {
  return hostRows.filter(host => Number(host.vcenter_connection_id) === Number(vcenterConnectionId)).map(host => {
    const cpuMhzPerCore = number(host.cpu_mhz);
    const cpuCores = number(host.cpu_cores);
    const totalCpuMhz = cpuMhzPerCore == null || cpuCores == null ? null : cpuMhzPerCore * cpuCores;
    const usedCpuMhz = number(host.cpu_usage_mhz);
    const totalMemoryBytes = number(host.total_memory_bytes);
    const memoryUsageMib = number(host.memory_usage_mib);
    const usedMemoryBytes = memoryUsageMib == null ? null : memoryUsageMib * 1048576;
    const totalStorageBytes = number(host.total_storage_bytes);
    const freeStorageBytes = number(host.free_storage_bytes);
    const usedStorageBytes = totalStorageBytes == null || freeStorageBytes == null ? null : Math.max(0, totalStorageBytes - freeStorageBytes);
    return {
      hostId: host.host_id,
      name: host.name || null,
      address: null,
      connectionState: host.connection_state || null,
      powerState: host.power_state || null,
      healthStatus: host.overall_status || null,
      vmCount: number(host.vm_count),
      capacity: {
        cpu: {
          usedMhz: usedCpuMhz,
          totalMhz: totalCpuMhz,
          usagePercent: percentage(usedCpuMhz, totalCpuMhz)
        },
        memory: {
          usedBytes: usedMemoryBytes,
          totalBytes: totalMemoryBytes,
          usagePercent: percentage(usedMemoryBytes, totalMemoryBytes)
        },
        storage: {
          usedBytes: usedStorageBytes,
          totalBytes: totalStorageBytes,
          usagePercent: percentage(usedStorageBytes, totalStorageBytes)
        }
      },
      lastSeenAt: host.last_seen_at || host.last_updated || null
    };
  });
}

function percentage(used, total) {
  const usedValue = number(used);
  const totalValue = number(total);
  if (usedValue == null || totalValue == null || totalValue <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(usedValue / totalValue * 100)));
}
function buildSiteCapacity(rows = []) {
  return rows.map(row => {
    const totalStorageBytes = number(row.total_storage_bytes);
    const freeStorageBytes = number(row.free_storage_bytes);
    const usedStorageBytes = totalStorageBytes == null || freeStorageBytes == null ? null : Math.max(0, totalStorageBytes - freeStorageBytes);
    return {
      site: row.site || null,
      hostCount: number(row.host_count),
      cpu: {
        usedMhz: number(row.used_cpu_mhz),
        totalMhz: number(row.total_cpu_mhz),
        usagePercent: percentage(row.used_cpu_mhz, row.total_cpu_mhz)
      },
      memory: {
        usedBytes: number(row.used_memory_bytes),
        totalBytes: number(row.total_memory_bytes),
        usagePercent: percentage(row.used_memory_bytes, row.total_memory_bytes)
      },
      storage: {
        usedBytes: usedStorageBytes,
        totalBytes: totalStorageBytes,
        usagePercent: percentage(usedStorageBytes, totalStorageBytes)
      }
    };
  });
}

function buildVmSummary(rows = []) {
  return rows.map(row => ({
    vmId: row.vm_id,
    name: row.name || null,
    site: row.site || null,
    primaryIp: row.primary_ip || null,
    powerState: row.power_state || null,
    lastSeenAt: row.guest_data_updated_at || row.last_seen_at || null
  }));
}
function summarizeSrmCollectionScope({
  rows = [],
  syncStates = [],
  field
} = {}) {
  const statuses = syncStates.map(row => String(row[field] || '').toUpperCase()).filter(Boolean);
  const failed = statuses.includes('FAILED') || statuses.includes('ERROR') || statuses.includes('FETCH_FAILED');
  const partial = statuses.includes('PARTIAL') || statuses.includes('SYNCING');
  const succeeded = statuses.includes('SYNCED') || statuses.includes('SUCCESS') || statuses.includes('OK');
  const hasData = rows.length > 0;
  const state = failed ? hasData ? 'STALE_WITH_DATA' : 'FAILED' : partial ? 'PARTIAL' : succeeded ? hasData ? 'SUCCESS' : 'SUCCESS_EMPTY' : 'NEVER_COLLECTED';
  const freshnessStatus = failed ? 'COLLECTION_FAILED' : partial ? 'PARTIAL' : succeeded ? 'FRESH' : 'NEVER_COLLECTED';
  const lastCollectedAt = latestIso(rows.flatMap(row => [row.lastCollectedAt, row.last_seen_at, row.updated_at, row.created_at])) || (succeeded ? latestIso(syncStates.flatMap(row => [row.updated_at, row.last_sync_started_at, row.last_successful_sync_at])) : null);
  return {
    state,
    ...buildScopeFreshness({
      syncStates,
      field,
      rows
    })
  };
}

function summarizeInventoryMappings(scopeStates = {}) {
  const states = Object.values(scopeStates).filter(Boolean);
  const failed = states.filter(scope => scope.fetchStatus === 'FAILED');
  const successful = states.filter(scope => scope.fetchStatus === 'SUCCESS');
  const unsupported = states.filter(scope => scope.fetchStatus === 'UNSUPPORTED');
  let state = 'NEVER_COLLECTED';
  let freshnessStatus = 'NEVER_COLLECTED';
  if (failed.length && successful.length) {
    state = 'PARTIAL';
    freshnessStatus = 'PARTIAL';
  } else if (failed.length) {
    const hasLastKnownGood = failed.some(scope => scope.normalizedStatus === 'PRESENT');
    state = hasLastKnownGood ? 'STALE_WITH_DATA' : 'FAILED';
    freshnessStatus = 'COLLECTION_FAILED';
  } else if (states.some(scope => scope.fetchStatus === 'PARTIAL')) {
    state = 'PARTIAL';
    freshnessStatus = 'PARTIAL';
  } else if (successful.length) {
    state = unsupported.length ? 'SUCCESS_WITH_UNSUPPORTED_SCOPE' : 'SUCCESS';
    freshnessStatus = 'FRESH';
  } else if (unsupported.length) {
    state = 'SUCCESS_WITH_UNSUPPORTED_SCOPE';
    freshnessStatus = 'NOT_AVAILABLE';
  }
  return {
    state,
    ...combineFreshness(states.filter(scope => scope.fetchStatus !== 'UNSUPPORTED')),
    scopeStates
  };
}

exports.summarizeSrmCollectionScope = summarizeSrmCollectionScope;
exports.summarizeInventoryMappings = summarizeInventoryMappings;
exports.buildHostSummaries = buildHostSummaries;
exports.buildSiteCapacity = buildSiteCapacity;
exports.buildVmSummary = buildVmSummary;
exports.normalizeSiteIdentity = normalizeSiteIdentity;

async function settleNamedScopes(loaders, endpoint = '/api/dr/overview') {
  const scopeNames = Object.keys(loaders);
  const results = await Promise.allSettled(Object.values(loaders));
  const scopeErrors = {};
  const scopeStates = {};

  const readScope = (name, fallback) => {
    const result = results[scopeNames.indexOf(name)];

    if (result?.status === 'fulfilled') {
      scopeStates[name] = {
        status: 'SUCCESS'
      };

      return result.value;
    }

    scopeStates[name] = {
      status: 'FAILED',
      errorCode: 'SCOPE_QUERY_FAILED'
    };

    scopeErrors[name] = {
      type: 'BACKEND_ERROR',
      code: 'SCOPE_QUERY_FAILED',
      httpStatus: 500,
      endpoint,
      safeMessage: `Unable to load scope ${name}`
    };

    return fallback;
  };

  return {
    readScope,
    scopeErrors,
    scopeStates
  };
}

exports._settleNamedScopes = settleNamedScopes;
async function getSrmAppliances() {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];

      rows = R.join(
        rows,
        "c",
        r => views["current_connections"] || s.read("current_connections"),
        r => true,
        "INNER JOIN"
      );

      rows = R.join(
        rows,
        "vc",
        r => views["current_connections"] || s.read("current_connections"),
        r => R.binary(
          "=",
          R.ref(r, "id", "vc"),
          R.ref(r, "associated_vcenter_connection_id", "c")
        ),
        "LEFT JOIN"
      );

      rows = R.join(
        rows,
        "srv",
        r => (parent => {
          let rows = [R.context(parent)];

          rows = R.join(
            rows,
            "s",
            r => views["current_srm_servers"] || s.read("current_srm_servers"),
            r => true,
            "INNER JOIN"
          );

          rows = rows.filter(r => R.binary(
            "AND",
            R.binary(
              "=",
              R.ref(r, "connection_id", "s"),
              R.ref(r, "id", "c")
            ),
            R.binary(
              "=",
              R.ref(r, "is_present", "s"),
              true
            )
          ));

          let groups = rows.map(r => [r]);

          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              ...R.star(r, "s")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([
            [
              R.unary("IS NOT NULL", R.ref(a.r, "address", "s"))
                ? 0
                : R.unary("IS NOT NULL", R.ref(a.r, "version", "s"))
                  ? 1
                  : 2,
              R.unary("IS NOT NULL", R.ref(b.r, "address", "s"))
                ? 0
                : R.unary("IS NOT NULL", R.ref(b.r, "version", "s"))
                  ? 1
                  : 2,
              "ASC",
              null
            ],
            [
              R.ref(a.r, "last_seen_at", "s"),
              R.ref(b.r, "last_seen_at", "s"),
              "DESC",
              null
            ]
          ]));

          return result.slice(0, 0 + Number(1)).map(x => x.value);
        })(r),
        r => true,
        "LEFT JOIN"
      );

      rows = rows.filter(r => R.binary(
        "AND",
        R.binary(
          "=",
          R.ref(r, "system_type", "c"),
          "SRM"
        ),
        R.binary(
          "=",
          R.ref(r, "is_active", "c"),
          true
        )
      ));

      let groups = rows.map(r => [r]);

      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);

        return R.expand({
          ...R.star(r, "c"),
          "associated_vcenter_name": R.ref(r, "connection_name", "vc"),
          "associated_vcenter_base_url": R.ref(r, "base_url", "vc"),
          "server_pairing_id": R.ref(r, "pairing_id", "srv"),
          "server_name": R.ref(r, "name", "srv"),
          "server_address": R.ref(r, "address", "srv"),
          "server_version": R.ref(r, "version", "srv"),
          "server_build": R.ref(r, "build", "srv"),
          "server_status": R.ref(r, "status", "srv"),
          "server_vcenter_external_id": R.ref(
            r,
            "vcenter_external_id",
            "srv"
          ),
          "server_last_seen_at": R.ref(r, "last_seen_at", "srv")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });

      result.sort((a, b) => R.order([
        [
          R.ref(a.r, "id", "c"),
          R.ref(b.r, "id", "c"),
          "ASC",
          null
        ]
      ]));

      return result.slice(0).map(x => x.value);
    })(null));
  }, [], false);

  return rows.map(row => buildApplianceViewModel({
    connection: row,

    associatedVcenter: {
      connection_name: row.associated_vcenter_name,
      base_url: row.associated_vcenter_base_url
    },

    server: {
      pairing_id: row.server_pairing_id,
      name: row.server_name,
      address: row.server_address,
      version: row.server_version,
      build: row.server_build,
      status: row.server_status,
      vcenter_external_id: row.server_vcenter_external_id,
      last_seen_at: row.server_last_seen_at
    },

    productType: 'SRM'
  }));
}
async function getProtectionGroupSummary() {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "pg")), "INNER JOIN");
      rows = R.join(rows, "ss", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "ss"), R.ref(r, "connection_id", "pg")), "LEFT JOIN");
      rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "sp"), R.ref(r, "connection_id", "pg")), R.binary("=", R.ref(r, "pairing_id", "sp"), R.ref(r, "pairing_id", "pg"))), R.binary("=", R.ref(r, "is_present", "sp"), true)), "LEFT JOIN");
      rows = R.join(rows, "pv", r => (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vm", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "vm"), R.ref(r, "connection_id", "pg")), R.binary("=", R.ref(r, "pairing_id", "vm"), R.ref(r, "pairing_id", "pg"))), R.binary("=", R.ref(r, "protection_group_id", "vm"), R.ref(r, "protection_group_id", "pg"))), R.binary("=", R.ref(r, "is_present", "vm"), true)));
        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "protected_vm_ids": R.aggregate("array_agg", g.filter(a => true).map(a => R.ref(a, "protected_vm_id", "vm")), "distinct", null),
            "vm_count": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "protected_vm_id", "vm")), "distinct", null), {
              "name": "int"
            })
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(r), r => true, "LEFT JOIN");
      rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "pg"), true));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "pg"),
          "local_site": R.ref(r, "site", "c"),
          "canonical_site_pair_key": R.ref(r, "canonical_site_pair_key", "sp"),
          "protected_vm_ids": R.ref(r, "protected_vm_ids", "pv"),
          "resolved_vm_count": R.binary("=", R.ref(r, "protected_vm_sync_status", "ss"), "SYNCED") ? R.ref(r, "vm_count", "pv") : null,
          "vm_count_resolution_status": R.binary("=", R.ref(r, "protected_vm_sync_status", "ss"), "SYNCED") ? "RESOLVED" : "SCOPE_FAILED",
          "resolved_recovery_plan_count": R.cast(null, {
            "name": "int"
          }),
          "resolved_issue_count": R.cast(null, {
            "name": "int"
          })
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  }, [], false);
  return srmMapper.buildProtectionGroupsViewModel(rows);
}
async function getRecoveryPlanSummary() {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "rp")), "INNER JOIN");
      rows = R.join(rows, "ss", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "ss"), R.ref(r, "connection_id", "rp")), "LEFT JOIN");
      rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "sp"), R.ref(r, "connection_id", "rp")), R.binary("=", R.ref(r, "pairing_id", "sp"), R.ref(r, "pairing_id", "rp"))), R.binary("=", R.ref(r, "is_present", "sp"), true)), "LEFT JOIN");
      rows = R.join(rows, "vm", r => (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "rpv", r => views["current_srm_recovery_plan_vms"] || s.read("current_srm_recovery_plan_vms"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "rpv"), R.ref(r, "connection_id", "rp")), R.binary("=", R.ref(r, "pairing_id", "rpv"), R.ref(r, "pairing_id", "rp"))), R.binary("=", R.ref(r, "recovery_plan_id", "rpv"), R.ref(r, "recovery_plan_id", "rp"))), R.binary("=", R.ref(r, "is_present", "rpv"), true)));
        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "recovery_plan_vm_ids": R.aggregate("array_agg", g.filter(a => true).map(a => R.ref(a, "recovery_plan_vm_id", "rpv")), "distinct", null),
            "vm_count": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "recovery_plan_vm_id", "rpv")), "distinct", null), {
              "name": "int"
            })
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(r), r => true, "LEFT JOIN");
      rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "rp"), true));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "rp"),
          "local_site": R.ref(r, "site", "c"),
          "canonical_site_pair_key": R.ref(r, "canonical_site_pair_key", "sp"),
          "recovery_plan_vm_ids": R.ref(r, "recovery_plan_vm_ids", "vm"),
          "resolved_vm_count": R.binary("=", R.ref(r, "recovery_plan_vm_sync_status", "ss"), "SYNCED") ? R.ref(r, "vm_count", "vm") : null,
          "vm_count_resolution_status": R.binary("=", R.ref(r, "recovery_plan_vm_sync_status", "ss"), "SYNCED") ? "RESOLVED" : "SCOPE_FAILED",
          "resolved_protection_group_count": R.cast(null, {
            "name": "int"
          }),
          "protection_group_count_resolution_status": R.binary("=", R.ref(r, "recovery_plan_sync_status", "ss"), "SYNCED") ? "RESOLVED" : "SCOPE_FAILED",
          "resolved_issue_count": R.cast(null, {
            "name": "int"
          }),
          "history_resolution_status": "NOT_AVAILABLE"
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  }, [], false);
  return srmMapper.buildRecoveryPlansViewModel(rows);
}
exports.getDrOverview = async () => {
  const loaders = {
    connections: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "vc"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "base_url", "c"))), "LEFT JOIN");
        rows = R.join(rows, "vrs", r => views["current_vr_sync_state"] || s.read("current_vr_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "vrs"), R.ref(r, "id", "c")), "LEFT JOIN");
        rows = R.join(rows, "srms", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "srms"), R.ref(r, "id", "c")), "LEFT JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_active", "c"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "id": R.ref(r, "id", "c"),
            "connection_name": R.ref(r, "connection_name", "c"),
            "system_type": R.ref(r, "system_type", "c"),
            "site": R.ref(r, "site", "c"),
            "base_url": R.ref(r, "base_url", "c"),
            "associated_vcenter_connection_id": R.ref(r, "associated_vcenter_connection_id", "c"),
            "last_connection_status": R.ref(r, "last_connection_status", "c"),
            "last_sync_status": R.ref(r, "last_sync_status", "c"),
            "last_sync_at": R.ref(r, "last_sync_at", "c"),
            "inventory_vcenter_id": R.ref(r, "vcenter_id", "vc"),
            "vcenter_display_name": R.ref(r, "display_name", "vc"),
            "vcenter_fqdn": R.ref(r, "fqdn", "vc"),
            "vcenter_site_role": R.ref(r, "site_role", "vc"),
            "cluster_count": R.ref(r, "cluster_count", "vc"),
            "host_count": R.ref(r, "host_count", "vc"),
            "vm_count": R.ref(r, "vm_count", "vc"),
            "datastore_count": R.ref(r, "datastore_count", "vc"),
            "version": R.ref(r, "version", "vc"),
            "build": R.ref(r, "build", "vc"),
            "vcenter_last_collected_at": R.ref(r, "last_update", "vc"),
            "vr_data_status": R.ref(r, "sync_status", "vrs"),
            "vr_last_collected_at": R.ref(r, "last_successful_sync_at", "vrs"),
            "srm_data_status": R.ref(r, "core_sync_status", "srms"),
            "srm_last_collected_at": R.ref(r, "last_successful_sync_at", "srms")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "id", "c"), R.ref(b.r, "id", "c"), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),
        hosts: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "h", r => views["current_hosts"] || s.read("current_hosts"), r => true, "INNER JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "h")), "INNER JOIN");
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "vc")), R.binary("=", R.ref(r, "base_url", "c"), R.ref(r, "vcenter_id", "vc"))), "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "h"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "host_id": R.ref(r, "host_id", "h"),
            "name": R.ref(r, "name", "h"),
            "connection_state": R.ref(r, "connection_state", "h"),
            "power_state": R.ref(r, "power_state", "h"),
            "overall_status": R.ref(r, "overall_status", "h"),
            "last_seen_at": R.ref(r, "last_seen_at", "h"),
            "last_updated": R.ref(r, "last_updated", "h"),
            "cpu_mhz": R.ref(r, "cpu_mhz", "h"),
            "cpu_cores": R.ref(r, "cpu_cores", "h"),
            "cpu_usage_mhz": R.ref(r, "cpu_usage_mhz", "h"),
            "total_memory_bytes": R.ref(r, "total_memory_bytes", "h"),
            "memory_usage_mib": R.ref(r, "memory_usage_mib", "h"),
            "vm_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "vm", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "vm"), R.ref(r, "vcenter_id", "h")), R.binary("=", R.ref(r, "host_moid", "vm"), R.ref(r, "host_id", "h"))), R.binary("=", R.ref(r, "is_present", "vm"), true)));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "?column?0": R.cast(R.aggregate("count", g.filter(a => true).map(a => 1), false, null), {
                    "name": "int"
                  })
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
              rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "hdm")), R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "hdm"))), "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "hdm"), R.ref(r, "vcenter_id", "h")), R.binary("=", R.ref(r, "host_moid", "hdm"), R.ref(r, "host_id", "h"))), R.binary("=", R.ref(r, "is_present", "hdm"), true)), R.binary("=", R.ref(r, "is_present", "d"), true)));
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
              rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "vcenter_id", "hdm")), R.binary("=", R.ref(r, "datastore_id", "d"), R.ref(r, "datastore_moid", "hdm"))), "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "hdm"), R.ref(r, "vcenter_id", "h")), R.binary("=", R.ref(r, "host_moid", "hdm"), R.ref(r, "host_id", "h"))), R.binary("=", R.ref(r, "is_present", "hdm"), true)), R.binary("=", R.ref(r, "is_present", "d"), true)));
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
            "vcenter_connection_id": R.ref(r, "connection_id", "vc"),
            "site": R.ref(r, "site", "c")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "site", "c"), R.ref(b.r, "site", "c"), "ASC", null], [R.ref(a.r, "name", "h"), R.ref(b.r, "name", "h"), "ASC", null], [R.ref(a.r, "host_id", "h"), R.ref(b.r, "host_id", "h"), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),
        capacity: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((views => {
        views["host_capacity"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
          rows = R.join(rows, "h", r => views["current_hosts"] || s.read("current_hosts"), r => R.binary("=", R.ref(r, "vcenter_id", "h"), R.ref(r, "base_url", "c")), "LEFT JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "c"), "VCENTER"), R.binary("=", R.ref(r, "is_active", "c"), true)));
          let groups = R.groups(rows, r => [R.ref(r, "id", "c")]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "connection_id": R.ref(r, "id", "c"),
              "host_count": R.cast(R.aggregate("count", g.filter(a => R.binary("=", R.ref(a, "is_present", "h"), true)).map(a => 1), false, null), {
                "name": "int"
              }),
              "total_cpu_mhz": R.aggregate("sum", g.filter(a => R.binary("=", R.ref(a, "is_present", "h"), true)).map(a => R.binary("*", R.cast(R.ref(a, "cpu_mhz", "h"), {
                "name": "bigint"
              }), R.cast(R.ref(a, "cpu_cores", "h"), {
                "name": "bigint"
              }))), false, null),
              "used_cpu_mhz": R.aggregate("sum", g.filter(a => R.binary("=", R.ref(a, "is_present", "h"), true)).map(a => R.cast(R.ref(a, "cpu_usage_mhz", "h"), {
                "name": "bigint"
              })), false, null),
              "total_memory_bytes": R.aggregate("sum", g.filter(a => R.binary("=", R.ref(a, "is_present", "h"), true)).map(a => R.ref(a, "total_memory_bytes", "h")), false, null),
              "used_memory_bytes": R.aggregate("sum", g.filter(a => R.binary("=", R.ref(a, "is_present", "h"), true)).map(a => R.binary("*", R.cast(R.ref(a, "memory_usage_mib", "h"), {
                "name": "bigint"
              }), 1048576)), false, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(null);

        views["datastore_capacity"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
          rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => R.binary("=", R.ref(r, "vcenter_id", "d"), R.ref(r, "base_url", "c")), "LEFT JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "c"), "VCENTER"), R.binary("=", R.ref(r, "is_active", "c"), true)));
          let groups = R.groups(rows, r => [R.ref(r, "id", "c")]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "connection_id": R.ref(r, "id", "c"),
              "total_storage_bytes": R.aggregate("sum", g.filter(a => R.binary("=", R.ref(a, "is_present", "d"), true)).map(a => R.ref(a, "capacity", "d")), false, null),
              "free_storage_bytes": R.aggregate("sum", g.filter(a => R.binary("=", R.ref(a, "is_present", "d"), true)).map(a => R.ref(a, "free_space", "d")), false, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(null);

        return (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
          rows = R.join(rows, "h", r => views["host_capacity"] || s.read("host_capacity"), r => R.binary("=", R.ref(r, "connection_id", "h"), R.ref(r, "id", "c")), "LEFT JOIN");
          rows = R.join(rows, "d", r => views["datastore_capacity"] || s.read("datastore_capacity"), r => R.binary("=", R.ref(r, "connection_id", "d"), R.ref(r, "id", "c")), "LEFT JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "c"), "VCENTER"), R.binary("=", R.ref(r, "is_active", "c"), true)));
          let groups = R.groups(rows, r => [R.ref(r, "site", "c")]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "site": R.ref(r, "site", "c"),
              "host_count": R.cast(R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "host_count", "h")), false, null), {
                "name": "int"
              }),
              "total_cpu_mhz": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "total_cpu_mhz", "h")), false, null),
              "used_cpu_mhz": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "used_cpu_mhz", "h")), false, null),
              "total_memory_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "total_memory_bytes", "h")), false, null),
              "used_memory_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "used_memory_bytes", "h")), false, null),
              "total_storage_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "total_storage_bytes", "d")), false, null),
              "free_storage_bytes": R.aggregate("sum", g.filter(a => true).map(a => R.ref(a, "free_storage_bytes", "d")), false, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "site", "c"), R.ref(b.r, "site", "c"), "ASC", null]]));
          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false),
        virtualMachines: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vm", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "vm")), "INNER JOIN");
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "vc")), R.binary("=", R.ref(r, "base_url", "c"), R.ref(r, "vcenter_id", "vc"))), "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "vm"), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "vm_id": R.ref(r, "vm_id", "vm"),
            "name": R.ref(r, "name", "vm"),
            "power_state": R.ref(r, "power_state", "vm"),
            "primary_ip": R.fn("coalesce", [R.ref(r, "primary_ip", "vm"), R.ref(r, "ip", "vm")]),
            "guest_data_updated_at": R.ref(r, "guest_data_updated_at", "vm"),
            "last_seen_at": R.ref(r, "last_seen_at", "vm"),
            "site": R.ref(r, "site", "c")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "site", "c"), R.ref(b.r, "site", "c"), "ASC", null], [R.ref(a.r, "name", "vm"), R.ref(b.r, "name", "vm"), "ASC", null], [R.ref(a.r, "vm_id", "vm"), R.ref(b.r, "vm_id", "vm"), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),
        datastores: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "d", r => views["current_datastores"] || s.read("current_datastores"), r => true, "INNER JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "d")), "LEFT JOIN");
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("OR", R.binary("OR", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "vc")), R.binary("=", R.ref(r, "base_url", "c"), R.ref(r, "vcenter_id", "d"))), R.binary("=", R.fn("replace", [R.fn("replace", [R.ref(r, "base_url", "c"), "https://", ""]), "http://", ""]), R.fn("replace", [R.fn("replace", [R.ref(r, "vcenter_id", "d"), "https://", ""]), "http://", ""]))), "LEFT JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "d"), true), R.binary("OR", R.binary("=", R.ref(r, "system_type", "c"), "VCENTER"), R.unary("IS NULL", R.ref(r, "system_type", "c")))));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "datastore_id": R.ref(r, "datastore_id", "d"),
            "name": R.ref(r, "name", "d"),
            "capacity": R.ref(r, "capacity", "d"),
            "free_space": R.ref(r, "free_space", "d"),
            "type": R.ref(r, "type", "d"),
            "site": R.ref(r, "site", "c"),
            "vcenter_connection_id": R.ref(r, "id", "c")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "site", "c"), R.ref(b.r, "site", "c"), "ASC", null], [R.ref(a.r, "name", "d"), R.ref(b.r, "name", "d"), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),
        vr: vrRepository.getOverview(),
    replications: Promise.all([vrRepository.getReplicationsSummary(), vrRepository.getVcUuidMap()]).then(([rows, vcUuidMap]) => vrMapper.buildReplicationsViewModel(rows, vcUuidMap)),
    srm: getSrmAppliances(),
    srmSitePairs: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((views => {
        views["vc_identity"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), "INNER JOIN");
          rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "LEFT JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "p"), true), R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", "p"))));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "stable_id": R.ref(r, "local_vcenter_external_id", "p"),
              "site_name": R.ref(r, "site", "c"),
              "vcenter_name": R.ref(r, "connection_name", "vc"),
              "vcenter_host": R.ref(r, "local_site_name", "p")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "local_vcenter_external_id", "p"), R.ref(b.r, "local_vcenter_external_id", "p"), "ASC", null], [R.ref(a.r, "last_seen_at", "p"), R.ref(b.r, "last_seen_at", "p"), "DESC", null]]));
          result = R.unique(result, x => [R.ref(x.r, "local_vcenter_external_id", "p")]);
          return result.slice(0).map(x => x.value);
        })(null);

        return (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
          rows = R.join(rows, "local", r => views["vc_identity"] || s.read("vc_identity"), r => R.binary("=", R.ref(r, "stable_id", "local"), R.ref(r, "local_vcenter_id", "sp")), "LEFT JOIN");
          rows = R.join(rows, "remote", r => views["vc_identity"] || s.read("vc_identity"), r => R.binary("=", R.ref(r, "stable_id", "remote"), R.ref(r, "remote_vcenter_id", "sp")), "LEFT JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "sp"), true), R.unary("IS NOT NULL", R.ref(r, "canonical_site_pair_key", "sp"))));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              ...R.star(r, "sp"),
              "local_site_identity": R.ref(r, "site_name", "local"),
              "remote_site_identity": R.ref(r, "site_name", "remote"),
              "local_vcenter_name": R.ref(r, "vcenter_name", "local"),
              "remote_vcenter_name": R.ref(r, "vcenter_name", "remote"),
              "local_vcenter_host": R.ref(r, "vcenter_host", "local"),
              "remote_vcenter_host": R.ref(r, "vcenter_host", "remote")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "connection_id", "sp"), R.ref(b.r, "connection_id", "sp"), "ASC", null], [R.ref(a.r, "last_seen_at", "sp"), R.ref(b.r, "last_seen_at", "sp"), "DESC", null]]));
          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false),
        protectionGroups: getProtectionGroupSummary(),
    recoveryPlans: getRecoveryPlanSummary(),
    health: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "site_pair_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_site_pairs", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", null), true), R.binary("=", R.ref(r, "canonical_identity_status", null), "COMPLETE")));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "canonical_site_pair_key", null)), "distinct", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "protected_vm_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_protected_vms", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "protected_vm_id", null)), "distinct", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "active_issue_count": R.binary("+", R.binary("+", R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_issues", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "issue_fingerprint", null)), "distinct", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_vr_pairing_issues", r => views["current_vr_pairing_issues"] || s.read("current_vr_pairing_issues"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "issue_fingerprint", null)), "distinct", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r))), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_vr_replication_issues", r => views["current_vr_replication_issues"] || s.read("current_vr_replication_issues"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "issue_fingerprint", null)), "distinct", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r))),
            "recent_task_count": R.binary("+", R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_vr_tasks", r => views["current_vr_tasks"] || s.read("current_vr_tasks"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_recent", null), true));
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
            })(r)), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_tasks", r => views["current_srm_tasks"] || s.read("current_srm_tasks"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_recent", null), true));
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
            })(r)))
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),
        issueDetails: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "active_issues", r => [...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "i", r => views["current_vr_replication_issues"] || s.read("current_vr_replication_issues"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "i")), "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "i"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "scope": "VR_REPLICATION",
              "issue_fingerprint": R.ref(r, "issue_fingerprint", "i"),
              "connection_id": R.ref(r, "connection_id", "i"),
              "connection_name": R.ref(r, "connection_name", "c"),
              "entity_name": R.ref(r, "entity_name", "i"),
              "issue_type": R.ref(r, "issue_type", "i"),
              "severity": R.ref(r, "severity", "i"),
              "safe_description": R.ref(r, "description", "i"),
              "last_seen_at": R.ref(r, "last_seen_at", "i")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(r), ...[...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "i", r => views["current_vr_pairing_issues"] || s.read("current_vr_pairing_issues"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "i")), "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "i"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "scope": "VR_PAIRING",
              "issue_fingerprint": R.ref(r, "issue_fingerprint", "i"),
              "connection_id": R.ref(r, "connection_id", "i"),
              "connection_name": R.ref(r, "connection_name", "c"),
              "entity_name": R.ref(r, "entity_name", "i"),
              "issue_type": R.ref(r, "issue_type", "i"),
              "severity": R.ref(r, "severity", "i"),
              "safe_description": R.ref(r, "description", "i"),
              "last_seen_at": R.ref(r, "last_seen_at", "i")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(r), ...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "i", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "i")), "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "i"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "scope": "SRM",
              "issue_fingerprint": R.ref(r, "issue_fingerprint", "i"),
              "connection_id": R.ref(r, "connection_id", "i"),
              "connection_name": R.ref(r, "connection_name", "c"),
              "entity_name": R.ref(r, "entity_name", "i"),
              "issue_type": R.ref(r, "issue_type", "i"),
              "severity": R.ref(r, "severity", "i"),
              "safe_description": R.ref(r, "safe_description", "i"),
              "last_seen_at": R.ref(r, "last_seen_at", "i")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(r)]], r => true, "INNER JOIN");
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
        result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null]]));
        return result.slice(0, 0 + Number(20)).map(x => x.value);
      })(null));
    }, [], false),
        mappings: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_inventory_mappings", r => views["current_srm_inventory_mappings"] || s.read("current_srm_inventory_mappings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "mapping_type": R.ref(r, "mapping_type", null),
            "mapping_status": R.ref(r, "mapping_status", null),
            "last_seen_at": R.ref(r, "last_seen_at", null),
            "updated_at": R.ref(r, "updated_at", null),
            "created_at": R.ref(r, "created_at", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),

    placeholderDatastores: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_placeholder_datastores", r => views["current_srm_placeholder_datastores"] || s.read("current_srm_placeholder_datastores"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "last_seen_at": R.ref(r, "last_seen_at", null),
            "updated_at": R.ref(r, "updated_at", null),
            "created_at": R.ref(r, "created_at", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),
        srmOperations: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "active_issue_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_issues", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "?column?0": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "issue_fingerprint", null)), "distinct", null), {
                    "name": "int"
                  })
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "recent_task_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_tasks", r => views["current_srm_tasks"] || s.read("current_srm_tasks"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_recent", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "?column?0": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "task_id", null)), "distinct", null), {
                    "name": "int"
                  })
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "failed_task_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_tasks", r => views["current_srm_tasks"] || s.read("current_srm_tasks"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_recent", null), true), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", null), R.ref(r, "raw_status", null), ""])]), ["FAILED", "ERROR", "CANCELLED", "TIMED_OUT"])));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "?column?0": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "task_id", null)), "distinct", null), {
                    "name": "int"
                  })
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "last_issue_seen_at": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_issues", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "max": R.aggregate("max", g.filter(a => true).map(a => R.ref(a, "last_seen_at", null)), false, null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "last_task_seen_at": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_srm_tasks", r => views["current_srm_tasks"] || s.read("current_srm_tasks"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("=", R.ref(r, "is_recent", null), true));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "max": R.aggregate("max", g.filter(a => true).map(a => R.ref(a, "last_seen_at", null)), false, null)
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
    }, [], false),
        srmScopeStates: pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_sync_state", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => true, "INNER JOIN");
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "connection_id": R.ref(r, "connection_id", null),
            "core_sync_status": R.ref(r, "core_sync_status", null),
            "pairing_sync_status": R.ref(r, "pairing_sync_status", null),
            "server_sync_status": R.ref(r, "server_sync_status", null),
            "protection_group_sync_status": R.ref(r, "protection_group_sync_status", null),
            "recovery_plan_sync_status": R.ref(r, "recovery_plan_sync_status", null),
            "mapping_sync_status": R.ref(r, "mapping_sync_status", null),
            "network_mapping_sync_status": R.ref(r, "network_mapping_sync_status", null),
            "test_network_mapping_sync_status": R.ref(r, "test_network_mapping_sync_status", null),
            "folder_mapping_sync_status": R.ref(r, "folder_mapping_sync_status", null),
            "resource_mapping_sync_status": R.ref(r, "resource_mapping_sync_status", null),
            "storage_policy_mapping_sync_status": R.ref(r, "storage_policy_mapping_sync_status", null),
            "placeholder_datastore_sync_status": R.ref(r, "placeholder_datastore_sync_status", null),
            "issue_sync_status": R.ref(r, "issue_sync_status", null),
            "task_sync_status": R.ref(r, "task_sync_status", null),
            "last_error_code": R.ref(r, "last_error_code", null),
            "last_successful_sync_at": R.ref(r, "last_successful_sync_at", null),
            "last_sync_started_at": R.ref(r, "last_sync_started_at", null),
            "updated_at": R.ref(r, "updated_at", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "connection_id", null), R.ref(b.r, "connection_id", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false),

    freshness: getUnifiedFreshness()
  };
    const {
    readScope,
    scopeErrors,
    scopeStates
  } = await settleNamedScopes(loaders);

  const connectionsResult = readScope('connections', {
    rows: []
  });

  const hostsResult = readScope('hosts', {
    rows: []
  });

  const capacityResult = readScope('capacity', {
    rows: []
  });

  const virtualMachinesResult = readScope('virtualMachines', {
    rows: []
  });

  const datastoresResult = readScope('datastores', {
    rows: []
  });

  const vrOverview = readScope('vr', []);

  const replications = readScope('replications', {
    state: 'FAILED',
    observations: [],
    canonicalReplications: [],
    unmappedObservations: [],
    metrics: {
      logicalReplicationCount: null,
      observationCount: null,
      mappedObservationCount: null,
      unmappedObservationCount: null,
      protectedCount: null,
      outgoingObservationCount: null,
      incomingObservationCount: null
    }
  });

  const srmAppliances = readScope('srm', []);

  const srmSitePairResult = readScope('srmSitePairs', {
    rows: []
  });

  const pgSummary = readScope('protectionGroups', {
    metrics: {},
    observations: [],
    canonicalGroups: []
  });

  const rpSummary = readScope('recoveryPlans', {
    metrics: {},
    observations: [],
    canonicalPlans: []
  });

  const countsResult = readScope('health', {
    rows: [{}]
  });

  const issueDetailsResult = readScope('issueDetails', {
    rows: []
  });

  const mappingResult = readScope('mappings', {
    rows: []
  });

  const placeholderDatastoreResult = readScope('placeholderDatastores', {
    rows: []
  });

  const srmOperationsResult = readScope('srmOperations', {
    rows: [{}]
  });

  const srmScopeStateResult = readScope('srmScopeStates', {
    rows: []
  });

  const freshnessBySystem = readScope('freshness', {
    vcenter: buildFreshness({
      collectionErrorType: 'BACKEND_ERROR',
      collectionErrorCode: 'FRESHNESS_QUERY_FAILED'
    }),
    vr: buildFreshness({
      collectionErrorType: 'BACKEND_ERROR',
      collectionErrorCode: 'FRESHNESS_QUERY_FAILED'
    }),
    srm: buildFreshness({
      collectionErrorType: 'BACKEND_ERROR',
      collectionErrorCode: 'FRESHNESS_QUERY_FAILED'
    }),
    overall: buildFreshness({
      collectionErrorType: 'BACKEND_ERROR',
      collectionErrorCode: 'FRESHNESS_QUERY_FAILED'
    })
  });
    const connections = connectionsResult.rows;
  const hostRows = hostsResult.rows || [];
  const datastoresRows = datastoresResult.rows || [];

  const capacityBySite = scopeStates.capacity.status === 'FAILED'
    ? []
    : buildSiteCapacity(capacityResult.rows || []);

  const virtualMachines = scopeStates.virtualMachines.status === 'FAILED'
    ? []
    : buildVmSummary(virtualMachinesResult.rows || []);

  const vcenters = connections.filter(row => row.system_type === 'VCENTER');
  const vrConnections = connections.filter(row => row.system_type === 'VR');
  const srmConnections = connections.filter(row => row.system_type === 'SRM');

  const vrByConnectionId = new Map(
    vrOverview.map(item => [item.connectionId, item])
  );

  const siteTopology = vcenters.map(vc => {
    const vrConnection = vrConnections.find(
      item => item.associated_vcenter_connection_id === vc.id
    );

    const srmConnection = srmConnections.find(
      item => item.associated_vcenter_connection_id === vc.id
    );

    const vr = vrConnection
      ? vrByConnectionId.get(vrConnection.id)
      : null;

    const hosts = buildHostSummaries(hostRows, vc.id);

    const datastores = datastoresRows.filter(
      ds => Number(ds.vcenter_connection_id) === Number(vc.id)
    );

    return {
      site: vc.site,
      displayName: vc.connection_name,
      vcenterConnectionId: vc.id,
      vcenterName: vc.vcenter_display_name || vc.connection_name,
      vcenterBaseUrl: vc.base_url,
      vcenterHost: vc.vcenter_fqdn || parseUrlHost(vc.base_url).host,
      vcenterStatus: vc.last_connection_status || vc.last_sync_status || null,
      vcenterSiteRole: vc.vcenter_site_role || null,
      clusterCount: number(vc.cluster_count),
      hostCount: scopeStates.hosts.status === 'FAILED' ? null : hosts.length,
      hosts,
      vmCount: number(vc.vm_count),
      datastoreCount: number(vc.datastore_count),
      datastores,
      vrConnectionId: vrConnection?.id || null,
      vrConnectionStatus: vr?.connectionStatus || vrConnection?.last_connection_status || null,
      vrDataStatus: vrConnection?.vr_data_status || null,
      vrLastCollectedAt: vrConnection?.vr_last_collected_at || null,
      srmConnectionId: srmConnection?.id || null,
      srmConnectionStatus: srmConnection?.last_connection_status || null,
      srmDataStatus: srmConnection?.srm_data_status || null,
      srmLastCollectedAt: srmConnection?.srm_last_collected_at || null,
      lastInventorySyncAt: vc.vcenter_last_collected_at || vc.last_sync_at || null
    };
  });
    const replicatedCountMap = new Map();

  for (const row of replications.canonicalReplications) {
    const key = normalizeSiteIdentity(row.logicalSourceSiteName);

    if (!key) continue;

    replicatedCountMap.set(
      key,
      (replicatedCountMap.get(key) || 0) + 1
    );
  }

  const replicationSites = siteTopology.length
    ? siteTopology.map(site => ({
        stableId: site.vcenterConnectionId,
        siteName: site.site
      }))
    : vrOverview.map(site => ({
        stableId: site.connectionId,
        siteName: normalizeSiteIdentity(site.siteName)
      }));

  const replicatedFromSiteCounts = replicationSites.map(site => ({
    siteStableId: site.stableId,
    siteName: normalizeSiteIdentity(site.siteName),
    logicalReplicationCount:
      replications.state === 'SUCCESS_CANONICAL'
        ? replicatedCountMap.get(site.siteName) || 0
        : null
  }));

  const activeIssueDetails = (issueDetailsResult.rows || []).filter(issue => {
    if (
      issue.scope !== 'VR_REPLICATION'
      || !/\bpaused\b/i.test(String(issue.safe_description || ''))
    ) return true;

    const replication = replications.canonicalReplications.find(
      row =>
        String(row.vmName || '').toLowerCase()
        === String(issue.entity_name || '').toLowerCase()
    );
    return !replication || String(replication.normalizedStatus || replication.rawStatus || '').toUpperCase() === 'PAUSED';
  });

  const activeIssueCount = new Set(
    activeIssueDetails
      .map(issue => issue.issue_fingerprint)
      .filter(Boolean)
  ).size;
  const vrAppliances = vrOverview.map(item => ({
    connectionId: item.connectionId,
    pairingId: item.pairingId,
    siteName: normalizeSiteIdentity(item.siteName),
    siteRole: normalizeSiteIdentity(item.siteRole || item.siteName),
    configuredSiteLabel: item.siteName,
    productType: item.productType,
    applianceName: item.applianceName,
    applianceNameAvailability: item.applianceNameAvailability,
    apiEndpointHost: item.apiEndpointHost,
    apiEndpointHostType: item.apiEndpointHostType,
    applianceIp: item.applianceIp,
    applianceHostname: item.applianceHostname,
    applianceAddressAvailability: item.applianceAddressAvailability,
    version: item.version,
    versionAvailability: item.versionAvailability,
    build: item.build,
    associatedVcenterName: item.associatedVcenterName,
    associatedVcenterHost: item.associatedVcenterHost,
    associatedVcenterStableId: item.associatedVcenterStableId,
    connectionStatus: item.connectionStatus,
    lastCollectedAt: item.lastCollectedAt
  }));

  const vcenterTopology = siteTopology.map(site => ({
    connectionId: site.vcenterConnectionId,
    displayName: site.vcenterName,
    siteName: site.site,
    siteRole: site.vcenterSiteRole,
    host: site.vcenterHost,
    connectionStatus: site.vcenterStatus,
    clusterCount: site.clusterCount,
    hostCount: site.hostCount,
    hosts: site.hosts,
    datastoreCount: site.datastoreCount,
    datastores: site.datastores,
    vmCount: site.vmCount,
    version: vcenters.find(row => row.id === site.vcenterConnectionId)?.version || null,
    build: vcenters.find(row => row.id === site.vcenterConnectionId)?.build || null,
    lastCollectedAt: site.lastInventorySyncAt
  }));

  const counts = countsResult.rows[0] || {};
  const mappingRows = mappingResult.rows || [];

  const mappingCounts = {
    observation_count: mappingRows.length,
    present_candidate_count: mappingRows.filter(row => row.mapping_status != null).length
  };

  const srmSyncStates = srmScopeStateResult.rows || [];

  const mappingScopeStates = srmMapper.buildMappingScopeStates(
    mappingRows,
    srmSyncStates
  );

  const placeholderDatastoreView =
    srmMapper.buildPlaceholderDatastoresViewModel(
      placeholderDatastoreResult.rows || [],
      srmSyncStates
    );

  const inventoryMappingScopeStates = {
    network: mappingScopeStates.NETWORK,
    testNetwork: mappingScopeStates.TEST_NETWORK,
    folder: mappingScopeStates.FOLDER,
    resource: mappingScopeStates.RESOURCE,
    storagePolicy: mappingScopeStates.STORAGE_POLICY,
    placeholderDatastores: placeholderDatastoreView.scopeState
  };

  const srmOperations = srmOperationsResult.rows?.[0] || {};
    const protectionGroupBase = summarizeSrmCollectionScope({
    rows: pgSummary.observations,
    syncStates: srmSyncStates,
    field: 'protection_group_sync_status'
  });

  const recoveryPlanBase = summarizeSrmCollectionScope({
    rows: rpSummary.observations,
    syncStates: srmSyncStates,
    field: 'recovery_plan_sync_status'
  });

  const inventoryMappingBase = summarizeInventoryMappings(inventoryMappingScopeStates);

  const protectionGroupsScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'protection_group_sync_status',
    count: pgSummary.metrics.canonicalGroupCount,
    base: protectionGroupBase
  });

  const recoveryPlansScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'recovery_plan_sync_status',
    count: rpSummary.metrics.canonicalPlanCount,
    base: recoveryPlanBase
  });

  const inventoryMappingsScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'mapping_sync_status',
    count: mappingRows.length,
    base: inventoryMappingBase
  });

  const placeholderDatastoresScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'placeholder_datastore_sync_status',
    count: placeholderDatastoreResult.rows?.length || 0,
    base: placeholderDatastoreView.scopeState ? {
      state: placeholderDatastoreView.scopeState.fetchStatus === 'SUCCESS' ? placeholderDatastoreResult.rows?.length ? 'SUCCESS' : 'SUCCESS_EMPTY' : placeholderDatastoreView.scopeState.normalizedStatus,
      freshnessStatus: placeholderDatastoreView.scopeState.freshnessStatus,
      lastCollectedAt: placeholderDatastoreView.scopeState.lastCollectedAt,
      errorCode: placeholderDatastoreView.scopeState.errorCode
    } : null
  });

  const tasksScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'task_sync_status',
    count: srmOperations.recent_task_count,
    lastCollectedAt: srmOperations.last_task_seen_at,
    operationalIssueCount: srmOperations.failed_task_count
  });

  const issuesScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'issue_sync_status',
    count: srmOperations.active_issue_count,
    lastCollectedAt: srmOperations.last_issue_seen_at,
    operationalIssueCount: srmOperations.active_issue_count
  });
    const sitePairRows = srmSitePairResult.rows || [];

  const canonicalSitePairCount = new Set(
    sitePairRows
      .map(row => row.canonical_site_pair_key)
      .filter(Boolean)
  ).size;

  const pairingScope = buildSrmScopeSummary({
    syncStates: srmSyncStates,
    field: 'pairing_sync_status',
    count: canonicalSitePairCount,
    lastCollectedAt: latestIso(
      sitePairRows.flatMap(row => [
        row.last_seen_at,
        row.updated_at
      ])
    )
  });

  const pairSites = sitePairRows.length
    ? [...new Set(
        sitePairRows
          .flatMap(row => [
            row.local_site_identity,
            row.remote_site_identity,
            row.local_site_name,
            row.remote_site_name
          ])
          .map(normalizeSiteIdentity)
          .filter(Boolean)
      )].sort((left, right) => {
        const roleOrder = value => ({
          DC: 0,
          DR: 1
        })[String(value || '').toUpperCase()] ?? 2;

        return roleOrder(left) - roleOrder(right)
          || String(left).localeCompare(String(right));
      })
    : [];

  const directionalEvidence = [
    ...(rpSummary.canonicalPlans || []),
    ...(pgSummary.canonicalGroups || []),
    ...(rpSummary.observations || []),
    ...(pgSummary.observations || [])
  ].find(
    row => row.protectedSiteName && row.recoverySiteName
  ) || null;

  const sitePair = {
    ...pairingScope,
    sites: pairSites,
    protectedSite: directionalEvidence?.protectedSiteName || null,
    recoverySite: directionalEvidence?.recoverySiteName || null,
    directionAvailability: directionalEvidence
      ? 'AVAILABLE'
      : 'NOT_AVAILABLE'
  };
    const srmHealthAppliances = srmConnections.map(connection => {
    const appliance = srmAppliances.find(item => Number(item.connectionId) === Number(connection.id)) || {};

    const sitePairEvidence = sitePairRows.find(row => Number(row.connection_id) === Number(connection.id)) || {};

    const connectionSyncStates = srmSyncStates.filter(row => Number(row.connection_id) === Number(connection.id));

    const collection = buildSrmScopeSummary({
      syncStates: connectionSyncStates,
      field: 'core_sync_status',
      count: 1,
      lastCollectedAt: connection.srm_last_collected_at
    });

    return {
      connectionId: connection.id,
      siteName: normalizeSiteIdentity(connection.site || appliance.siteName),
      siteRole: normalizeSiteIdentity(appliance.siteRole || connection.site),
      configuredSiteLabel: connection.site || appliance.siteName || null,
      displayName: appliance.applianceName || connection.connection_name || null,
      applianceHost: appliance.applianceIp || appliance.applianceHostname || appliance.apiEndpointHost || parseUrlHost(connection.base_url).host,
      associatedVcenterName: appliance.associatedVcenterName || sitePairEvidence.local_vcenter_name || null,
      associatedVcenterHost: appliance.associatedVcenterHost || sitePairEvidence.local_vcenter_host || null,
      associatedVcenterStableId: appliance.associatedVcenterStableId || sitePairEvidence.local_vcenter_id || null,
      connectionState: connection.last_connection_status || appliance.connectionStatus || null,
      collectionState: collection.state,
      freshnessStatus: collection.freshnessStatus,
      lastCollectedAt: collection.lastCollectedAt,
      errorCode: collection.errorCode,
      availability: collection.availability
    };
  });
    const srmScopes = {
    sitePair,
    protectionGroups: protectionGroupsScope,
    recoveryPlans: recoveryPlansScope,
    inventoryMappings: inventoryMappingsScope,
    placeholderDatastores: placeholderDatastoresScope,
    tasks: {
      ...tasksScope,
      failedCount: number(srmOperations.failed_task_count)
    },
    issues: issuesScope
  };

  const vrDerivedSrmEvidence = srmHealthAppliances.length ? [] : vrAppliances.map(appliance => ({
    connectionId: appliance.connectionId,
    siteName: appliance.siteName,
    siteRole: appliance.siteRole,
    displayName: null,
    applianceHost: null,
    associatedVcenterName: appliance.associatedVcenterName,
    associatedVcenterHost: appliance.associatedVcenterHost,
    connectionState: appliance.connectionStatus,
    collectionState: appliance.lastCollectedAt ? 'SUCCESS' : 'NEVER_COLLECTED',
    freshnessStatus: buildFreshness({
      lastCollectedAt: appliance.lastCollectedAt
    }).freshnessStatus,
    lastCollectedAt: appliance.lastCollectedAt,
    availability: 'VR_DERIVED',
    evidenceSource: 'VR'
  }));

  const srmOverallState = resolveSrmOverallState({
    appliances: srmHealthAppliances,
    scopes: srmScopes
  });

  const srmHealth = {
    overallState: srmOverallState,
    freshnessStatus: freshnessBySystem.srm.freshnessStatus,
    lastCollectedAt: latestIso([...srmHealthAppliances.map(item => item.lastCollectedAt), ...Object.values(srmScopes).map(scope => scope.lastCollectedAt)]),
    appliances: srmHealthAppliances,
    evidenceSource: srmHealthAppliances.length ? 'SRM' : vrDerivedSrmEvidence.length ? 'VR' : 'NONE',
    vrDerivedEvidence: vrDerivedSrmEvidence,
    sitePair,
    scopes: srmScopes
  };
    const srmScopeSummary = {
    protectionGroups: protectionGroupsScope,
    recoveryPlans: recoveryPlansScope,
    inventoryMappings: inventoryMappingsScope
  };

  const inventoryVmValues = vcenters.map(row => number(row.vm_count));

  const inventoryVmCount = scopeStates.connections.status === 'FAILED' ? null : inventoryVmValues.every(value => value !== null) ? inventoryVmValues.reduce((sum, value) => sum + value, 0) : null;

  const inventoryHostCount = scopeStates.hosts.status === 'FAILED' ? null : hostRows.length;

  const failedScopes = Object.values(scopeStates).filter(scope => scope.status === 'FAILED').length;

  const dataState = failedScopes > 0 ? 'PARTIAL' : 'SUCCESS';

  const freshness = {
    overall: freshnessBySystem.overall,
    vcenter: freshnessBySystem.vcenter,
    vr: freshnessBySystem.vr,
    srm: freshnessBySystem.srm,
    replications: freshnessBySystem.vr,
    protectionGroups: srmScopeSummary.protectionGroups,
    recoveryPlans: srmScopeSummary.recoveryPlans,
    mappings: srmScopeSummary.inventoryMappings,
    tasks: freshnessBySystem.overall
  };
    return {
    dataState,
    scopeStates,
    scopeErrors,
    freshness,
    srmScopeSummary,
    srmHealth,
    metrics: {
      activeVcenterConnectionCount: scopeStates.connections.status === 'FAILED' ? null : vcenters.filter(row => row.last_connection_status === 'CONNECTED').length,
      inventoryHostCount,
      inventoryClusterCount: vcenters.every(row => row.cluster_count != null) ? vcenters.reduce((sum, row) => sum + Number(row.cluster_count), 0) : null,
      inventoryVmCount,
      sitePairCount: number(counts.site_pair_count),
      logicalReplicationCount: replications.metrics.logicalReplicationCount,
      replicationObservationCount: replications.metrics.observationCount,
      replicationProtectedCount: replications.metrics.protectedCount,
      replicationUnmappedCount: replications.metrics.unmappedObservationCount,
      canonicalProtectionGroupCount: pgSummary.metrics.canonicalGroupCount,
      protectionGroupObservationCount: pgSummary.metrics.observationCount,
      protectionGroupUnmappedCount: pgSummary.metrics.unmappedObservationCount,
      canonicalRecoveryPlanCount: rpSummary.metrics.canonicalPlanCount,
      recoveryPlanObservationCount: rpSummary.metrics.observationCount,
      recoveryPlanUnmappedCount: rpSummary.metrics.unmappedObservationCount,
      protectedVmCount: number(counts.protected_vm_count),
      mappingObservationCount: number(mappingCounts.observation_count),
      activeIssueCount,
      recentTaskCount: number(counts.recent_task_count)
    },
    issues: activeIssueDetails.map(issue => ({
      scope: issue.scope,
      fingerprint: issue.issue_fingerprint,
      connectionId: issue.connection_id,
      connectionName: issue.connection_name,
      entityName: issue.entity_name,
      issueType: issue.issue_type,
      severity: issue.severity,
      description: issue.safe_description,
      lastSeenAt: issue.last_seen_at
    })),
    siteTopology,
    capacityBySite,
    virtualMachines,
    datastores: datastoresRows,
    topology: {
      vcenters: vcenterTopology,
      vr: vrAppliances,
      srm: srmAppliances
    },
    replicatedFromSiteCounts,
    srmAppliances,
    vrAppliances,
    sitePairComparisons: [{
      productType: 'SRM',
      title: 'Site Recovery Manager',
      sides: srmAppliances
    }, {
      productType: 'VSPHERE_REPLICATION',
      title: 'vSphere Replication',
      sides: vrAppliances
    }],
    health: {
      activeIssueCount,
      ...buildSystemHealth({
        freshness: freshnessBySystem,
        issueCount: activeIssueCount,
        issueDetails: activeIssueDetails,
        failedScopes,
        srmOverallState,
        requiredSystems: ['vcenter', 'vr', 'srm']
      })
    },
    mappingHealth: {
      observationCount: number(mappingCounts.observation_count),
      presentCandidateCount: number(mappingCounts.present_candidate_count)
    },
    dataFreshness: {
      lastVcenterSync: freshnessBySystem.vcenter.lastSuccessfulCollectionAt,
      lastVrCoreSyncAt: freshnessBySystem.vr.lastSuccessfulCollectionAt,
      lastSrmCoreSyncAt: freshnessBySystem.srm.lastSuccessfulCollectionAt
    }
  };
};
