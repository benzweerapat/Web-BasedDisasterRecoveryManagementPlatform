const {
  pool
} = require('../../db');

const drOverviewService = require('../services/dr-overview.service');

const {
  sendReadResponse
} = require('../utils/api-response.util');

exports.getOverview = async (req, res, next) => {
  try {
    const data = await drOverviewService.getDrOverview();

    const scopeErrors = Object.fromEntries(
      Object.entries(data.scopeErrors || {}).map(([scope, error]) => [
        scope,
        {
          ...error,
          requestId: req.id || 'unknown'
        }
      ])
    );

    sendReadResponse(res, {
      ...data,
      scopeErrors
    }, {
      dataState: data.dataState,
      freshness: data.freshness?.overall || null
    });
  } catch (error) {
    next(error);
  }
};
exports.getUnifiedVms = async (req, res) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((views => {
        views["vc_uuid_map"] = R.unique([...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_vr_pairings", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", null)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "uuid": R.ref(r, "local_vcenter_external_id", null),
              "fqdn": R.ref(r, "local_site_name", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result = R.unique(result, x => x.value);
          return result.slice(0).map(x => x.value);
        })(null), ...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_vr_pairings", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.unary("IS NOT NULL", R.ref(r, "remote_vcenter_external_id", null)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "uuid": R.ref(r, "remote_vcenter_external_id", null),
              "fqdn": R.ref(r, "remote_site_name", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result = R.unique(result, x => x.value);
          return result.slice(0).map(x => x.value);
        })(null)]);
        return (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "v", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
          rows = R.join(rows, "m", r => views["vc_uuid_map"] || s.read("vc_uuid_map"), r => R.binary("LIKE", R.ref(r, "vcenter_id", "v"), R.binary("||", R.binary("||", "%", R.ref(r, "fqdn", "m")), "%")), "LEFT JOIN");
          rows = R.join(rows, "vr", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "source_vc_id", "vr"), R.ref(r, "uuid", "m")), R.binary("=", R.fn("coalesce", [R.fn("nullif", [R.fn("split_part", [R.ref(r, "vm_id", "vr"), ":", 2]), ""]), R.ref(r, "vm_id", "vr")]), R.ref(r, "vm_id", "v"))), R.binary("=", R.ref(r, "is_present", "vr"), true)), "LEFT JOIN");
          rows = R.join(rows, "srm", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => R.binary("AND", R.binary("AND", R.binary("=", R.fn("coalesce", [R.fn("nullif", [R.fn("split_part", [R.ref(r, "protected_vm_id", "srm"), ":", 2]), ""]), R.ref(r, "protected_vm_id", "srm")]), R.ref(r, "vm_id", "v")), R.binary("OR", R.binary("=", R.fn("split_part", [R.ref(r, "protected_vm_id", "srm"), ":", 3]), R.ref(r, "uuid", "m")), R.binary("=", R.fn("split_part", [R.ref(r, "protected_vm_id", "srm"), ":", 3]), ""))), R.binary("=", R.ref(r, "is_present", "srm"), true)), "LEFT JOIN");
          rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", "srm"), R.ref(r, "protection_group_id", "pg")), R.binary("=", R.ref(r, "is_present", "pg"), true)), "LEFT JOIN");
          rows = R.join(rows, "rpg", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "rpg")), R.binary("=", R.ref(r, "is_present", "rpg"), true)), "LEFT JOIN");
          rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", "rpg"), R.ref(r, "recovery_plan_id", "rp")), R.binary("=", R.ref(r, "is_present", "rp"), true)), "LEFT JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "v"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "vcenter_vm_id": R.ref(r, "id", "v"),
              "vm_name": R.ref(r, "name", "v"),
              "power_state": R.ref(r, "power_state", "v"),
              "vcenter_id": R.ref(r, "vcenter_id", "v"),
              "moid": R.ref(r, "vm_id", "v"),
              "replication_status": R.ref(r, "normalized_status", "vr"),
              "rpo_minutes": R.ref(r, "rpo_minutes", "vr"),
              "target_datastore_name": R.ref(r, "target_site_name", "vr"),
              "replication_server_name": R.ref(r, "canonical_replication_key", "vr"),
              "raw_protection_status": R.ref(r, "raw_protection_status", "srm"),
              "placeholder_status": R.ref(r, "placeholder_status", "srm"),
              "protection_group_name": R.ref(r, "name", "pg"),
              "recovery_plan_name": R.ref(r, "name", "rp")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "id", "v"), R.ref(b.r, "id", "v"), "ASC", null], [R.ref(a.r, "last_sync_at", "vr"), R.ref(b.r, "last_sync_at", "vr"), "DESC", null], [R.ref(a.r, "last_seen_at", "srm"), R.ref(b.r, "last_seen_at", "srm"), "DESC", null]]));
          result = R.unique(result, x => [R.ref(x.r, "id", "v")]);
          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
exports.getVmById = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((views => {
        views["vc_uuid_map"] = R.unique([...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_vr_pairings", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", null)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "uuid": R.ref(r, "local_vcenter_external_id", null),
              "fqdn": R.ref(r, "local_site_name", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result = R.unique(result, x => x.value);
          return result.slice(0).map(x => x.value);
        })(null), ...(parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_vr_pairings", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.unary("IS NOT NULL", R.ref(r, "remote_vcenter_external_id", null)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "uuid": R.ref(r, "remote_vcenter_external_id", null),
              "fqdn": R.ref(r, "remote_site_name", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result = R.unique(result, x => x.value);
          return result.slice(0).map(x => x.value);
        })(null)]);

        return (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "v", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
          rows = R.join(rows, "m", r => views["vc_uuid_map"] || s.read("vc_uuid_map"), r => R.binary("LIKE", R.ref(r, "vcenter_id", "v"), R.binary("||", R.binary("||", "%", R.ref(r, "fqdn", "m")), "%")), "LEFT JOIN");
          rows = R.join(rows, "vr", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "source_vc_id", "vr"), R.ref(r, "uuid", "m")), R.binary("=", R.fn("coalesce", [R.fn("nullif", [R.fn("split_part", [R.ref(r, "vm_id", "vr"), ":", 2]), ""]), R.ref(r, "vm_id", "vr")]), R.ref(r, "vm_id", "v"))), R.binary("=", R.ref(r, "is_present", "vr"), true)), "LEFT JOIN");
          rows = R.join(rows, "srm", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => R.binary("AND", R.binary("AND", R.binary("=", R.fn("coalesce", [R.fn("nullif", [R.fn("split_part", [R.ref(r, "protected_vm_id", "srm"), ":", 2]), ""]), R.ref(r, "protected_vm_id", "srm")]), R.ref(r, "vm_id", "v")), R.binary("OR", R.binary("=", R.fn("split_part", [R.ref(r, "protected_vm_id", "srm"), ":", 3]), R.ref(r, "uuid", "m")), R.binary("=", R.fn("split_part", [R.ref(r, "protected_vm_id", "srm"), ":", 3]), ""))), R.binary("=", R.ref(r, "is_present", "srm"), true)), "LEFT JOIN");
          rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", "srm"), R.ref(r, "protection_group_id", "pg")), R.binary("=", R.ref(r, "is_present", "pg"), true)), "LEFT JOIN");
          rows = R.join(rows, "rpg", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "rpg")), R.binary("=", R.ref(r, "is_present", "rpg"), true)), "LEFT JOIN");
          rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", "rpg"), R.ref(r, "recovery_plan_id", "rp")), R.binary("=", R.ref(r, "is_present", "rp"), true)), "LEFT JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "id", "v"), p[0]));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "vcenter_vm_id": R.ref(r, "id", "v"),
              "vm_name": R.ref(r, "name", "v"),
              "power_state": R.ref(r, "power_state", "v"),
              "vcenter_id": R.ref(r, "vcenter_id", "v"),
              "moid": R.ref(r, "vm_id", "v"),
              "replication_status": R.ref(r, "normalized_status", "vr"),
              "rpo_minutes": R.ref(r, "rpo_minutes", "vr"),
              "target_datastore_name": R.ref(r, "target_site_name", "vr"),
              "replication_server_name": R.ref(r, "canonical_replication_key", "vr"),
              "raw_protection_status": R.ref(r, "raw_protection_status", "srm"),
              "placeholder_status": R.ref(r, "placeholder_status", "srm"),
              "protection_group_name": R.ref(r, "name", "pg"),
              "recovery_plan_name": R.ref(r, "name", "rp")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "id", "v"), R.ref(b.r, "id", "v"), "ASC", null], [R.ref(a.r, "last_sync_at", "vr"), R.ref(b.r, "last_sync_at", "vr"), "DESC", null], [R.ref(a.r, "last_seen_at", "srm"), R.ref(b.r, "last_seen_at", "srm"), "DESC", null]]));
          result = R.unique(result, x => [R.ref(x.r, "id", "v")]);
          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [id], false);

    res.json({
      success: true,
      data: rows[0] || null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
