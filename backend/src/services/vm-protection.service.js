const {
  pool
} = require('../../db');

const {
  parseVmwareObjectIdentity
} = require('./vcenter-object-resolution.service');

function classifyVmProtection({
  vcenterStableId,
  vmMoid,
  protectedVmScopeStatus,
  protectedMatch
}) {
  if (protectedMatch) {
    return {
      protectionStatus: 'PROTECTED',
      protectionResolutionStatus: 'RESOLVED_PROTECTED_MATCH',
      protectionGroupId: protectedMatch.protectionGroupId || null,
      protectionGroupName: protectedMatch.protectionGroupName || null
    };
  }

  if (!vcenterStableId) {
    return {
      protectionStatus: 'UNMAPPED',
      protectionResolutionStatus: 'UNMAPPED_VCENTER'
    };
  }

  if (!vmMoid) {
    return {
      protectionStatus: 'UNMAPPED',
      protectionResolutionStatus: 'UNMAPPED_VM'
    };
  }

  if (protectedVmScopeStatus !== 'SYNCED') {
    return {
      protectionStatus: 'UNPROTECTED',
      protectionResolutionStatus: protectedVmScopeStatus ? 'SCOPE_FAILED' : 'NOT_COLLECTED'
    };
  }

  return {
    protectionStatus: 'UNPROTECTED',
    protectionResolutionStatus: 'RESOLVED_NO_PROTECTED_MATCH'
  };
}
async function loadVmProtectionEvidence(db = pool) {
  const [contextResult, protectedResult] = await Promise.all([db.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");

      rows = R.join(rows, "srm_pair", r => (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "srm", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "sp"), R.ref(r, "id", "srm")), R.binary("=", R.ref(r, "is_present", "sp"), true)), "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "system_type", "srm"), "SRM"), R.binary("=", R.ref(r, "is_active", "srm"), true)), R.binary("=", R.ref(r, "associated_vcenter_connection_id", "srm"), R.ref(r, "id", "vc"))));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "local_vcenter_id": R.ref(r, "local_vcenter_id", "sp")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "sp"), R.ref(b.r, "last_seen_at", "sp"), "DESC", null]]));
        return result.slice(0, 0 + Number(1)).map(x => x.value);
      })(r), r => true, "LEFT JOIN");

      rows = R.join(rows, "vr_pair", r => (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vr", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "vp", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "vp"), R.ref(r, "id", "vr")), R.binary("=", R.ref(r, "is_present", "vp"), true)), "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "system_type", "vr"), "VR"), R.binary("=", R.ref(r, "is_active", "vr"), true)), R.binary("=", R.ref(r, "associated_vcenter_connection_id", "vr"), R.ref(r, "id", "vc"))));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "local_vcenter_external_id": R.ref(r, "local_vcenter_external_id", "vp")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "vp"), R.ref(b.r, "last_seen_at", "vp"), "DESC", null]]));
        return result.slice(0, 0 + Number(1)).map(x => x.value);
      })(r), r => true, "LEFT JOIN");

      rows = R.join(rows, "srm_scope", r => (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "srm", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "ss", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "ss"), R.ref(r, "id", "srm")), "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "system_type", "srm"), "SRM"), R.binary("=", R.ref(r, "is_active", "srm"), true)), R.binary("=", R.ref(r, "associated_vcenter_connection_id", "srm"), R.ref(r, "id", "vc"))));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "protected_vm_sync_status": R.ref(r, "protected_vm_sync_status", "ss")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "updated_at", "ss"), R.ref(b.r, "updated_at", "ss"), "DESC", null]]));
        return result.slice(0, 0 + Number(1)).map(x => x.value);
      })(r), r => true, "LEFT JOIN");

      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "vc"), "VCENTER"), R.binary("=", R.ref(r, "is_active", "vc"), true)));

      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);

        return R.expand({
          "vcenter_id": R.ref(r, "base_url", "vc"),
          "vcenter_stable_id": R.fn("coalesce", [R.ref(r, "local_vcenter_id", "srm_pair"), R.ref(r, "local_vcenter_external_id", "vr_pair")]),
          "protected_vm_sync_status": R.ref(r, "protected_vm_sync_status", "srm_scope")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });

      return result.slice(0).map(x => x.value);
    })(null));
  }, [], false),
  db.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "pvm", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");
      rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "pg"), R.ref(r, "connection_id", "pvm")), R.binary("=", R.ref(r, "pairing_id", "pg"), R.ref(r, "pairing_id", "pvm"))), R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "pvm"))), R.binary("=", R.ref(r, "is_present", "pg"), true)), "LEFT JOIN");
      rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "pvm"), true));

      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);

        return R.expand({
          "protected_vm_id": R.ref(r, "protected_vm_id", "pvm"),
          "protection_group_id": R.ref(r, "protection_group_id", "pvm"),
          "protection_group_name": R.ref(r, "name", "pg")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });

      return result.slice(0).map(x => x.value);
    })(null));
  }, [], false)]);
    const contexts = new Map(contextResult.rows.map(row => [row.vcenter_id, {
    vcenterStableId: row.vcenter_stable_id || null,
    protectedVmScopeStatus: row.protected_vm_sync_status || null
  }]));

  const protectedVms = new Map();
  const protectedVmNames = new Map();

  for (const row of protectedResult.rows) {
    if (row.vm_name) {
      protectedVmNames.set(String(row.vm_name).toLowerCase(), {
        protectionGroupId: row.protection_group_id || null,
        protectionGroupName: row.protection_group_name || null
      });
    }

    const identity = parseVmwareObjectIdentity(row.protected_vm_id);

    if (!identity || identity.objectType !== 'VIRTUALMACHINE') continue;

    const key = `${identity.vcenterStableId}|${identity.objectMoid}`;

    if (!protectedVms.has(key)) {
      protectedVms.set(key, {
        protectionGroupId: row.protection_group_id || null,
        protectionGroupName: row.protection_group_name || null
      });
    }
  }

  return {
    contexts,
    protectedVms,
    protectedVmNames
  };
}

function resolveVmProtection(evidence, {
  vcenterId,
  vmMoid,
  vmName
}) {
  const context = evidence.contexts.get(vcenterId);
  const key = context?.vcenterStableId && vmMoid ? `${context.vcenterStableId}|${vmMoid}` : null;
  const protectedMatch = (key ? evidence.protectedVms.get(key) : null) || (vmName ? evidence.protectedVmNames?.get(String(vmName).toLowerCase()) : null);

  return classifyVmProtection({
    vcenterStableId: context?.vcenterStableId || null,
    vmMoid,
    protectedVmScopeStatus: context?.protectedVmScopeStatus || null,
    protectedMatch
  });
}

module.exports = {
  classifyVmProtection,
  loadVmProtectionEvidence,
  resolveVmProtection
};
