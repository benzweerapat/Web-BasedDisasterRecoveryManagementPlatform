const {
  pool
} = require('../../db');

//ออ่าน Connection ทั้งหมดสำหรับแสดงในหน้า Connections
//อ่าน Connection หลัก
//Connection บางตัวอาจไม่มี username/password ของตัวเอง แต่ใช้ credential จาก Connection อื่น
//เชื่อมสถานะ VR
//เชื่อมสถานะ SRM
async function findAllConnections() {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "c", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
      rows = R.join(rows, "credential_source", r => views["connections"] || s.read("connections"), r => R.binary("=", R.ref(r, "id", "credential_source"), R.ref(r, "credential_source_connection_id", "c")), "LEFT JOIN");
      rows = R.join(rows, "vrs", r => views["current_vr_sync_state"] || s.read("current_vr_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "vrs"), R.ref(r, "id", "c")), "LEFT JOIN");
      rows = R.join(rows, "srms", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "srms"), R.ref(r, "id", "c")), "LEFT JOIN");
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          "id": R.ref(r, "id", "c"),
          "connectionName": R.ref(r, "connection_name", "c"),
          "systemType": R.ref(r, "system_type", "c"),
          "site": R.ref(r, "site", "c"),
          "baseUrl": R.ref(r, "base_url", "c"),
          "apiBaseUrl": R.ref(r, "api_base_url", "c"),
          "apiVersion": R.ref(r, "api_version", "c"),
          "apiSchemaVersion": R.ref(r, "api_schema_version", "c"),
          "lastVerifiedAt": R.ref(r, "last_verified_at", "c"),
          "associatedVcenterConnectionId": R.ref(r, "associated_vcenter_connection_id", "c"),
          "credentialSourceConnectionId": R.ref(r, "credential_source_connection_id", "c"),
          "username": R.fn("coalesce", [R.ref(r, "username", "c"), R.ref(r, "username", "credential_source")]),
          "verifyTls": R.ref(r, "verify_tls", "c"),
          "isActive": R.ref(r, "is_active", "c"),
          "lastTestedAt": R.ref(r, "last_tested_at", "c"),
          "lastConnectionStatus": R.ref(r, "last_connection_status", "c"),
          "lastSyncStatus": R.ref(r, "last_sync_status", "c"),
          "lastSyncAt": R.ref(r, "last_sync_at", "c"),
          "lastCollectedAt": R.binary('=', R.ref(r, "system_type", "c"), "VCENTER") ? R.ref(r, "last_sync_at", "c") : R.binary('=', R.ref(r, "system_type", "c"), "VR") ? R.ref(r, "last_successful_sync_at", "vrs") : R.binary('=', R.ref(r, "system_type", "c"), "SRM") ? R.ref(r, "last_successful_sync_at", "srms") : null,
          "collectionStatus": R.binary('=', R.ref(r, "system_type", "c"), "VCENTER") ? R.ref(r, "last_sync_status", "c") : R.binary('=', R.ref(r, "system_type", "c"), "VR") ? R.ref(r, "sync_status", "vrs") : R.binary('=', R.ref(r, "system_type", "c"), "SRM") ? R.ref(r, "core_sync_status", "srms") : null,
          "objectCount": R.binary('=', R.ref(r, "system_type", "c"), "VCENTER") ? R.scalar((parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "vc"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "base_url", "c"))));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "vm_count": R.ref(r, "vm_count", "vc")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0, 0 + Number(1)).map(x => x.value);
          })(r)) : R.binary('=', R.ref(r, "system_type", "c"), "VR") ? R.scalar((parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "vr", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "vr"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "vr"), true)));
            let groups = R.groups(rows, null);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "?column?0": R.cast(R.aggregate("count", g.filter(a => true).map(a => 1), false, null), {
                  "name": "integer"
                })
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r)) : R.binary('=', R.ref(r, "system_type", "c"), "SRM") ? R.cast(R.binary("+", R.binary("+", R.fn("coalesce", [R.scalar((parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "pg"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "pg"), true)));
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
          })(r)), 0]), R.fn("coalesce", [R.scalar((parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "rp"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "rp"), true)));
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
          })(r)), 0])), R.fn("coalesce", [R.scalar((parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "im", r => views["current_srm_inventory_mappings"] || s.read("current_srm_inventory_mappings"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "im"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "im"), true)));
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
          })(r)), 0])), {
            "name": "integer"
          }) : null,
          "lastSyncErrorCode": R.ref(r, "last_sync_error_code", "c"),
          "createdAt": R.ref(r, "created_at", "c"),
          "hasPassword": R.unary("IS NOT NULL", R.ref(r, "encrypted_password", "c"))
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      result.sort((a, b) => R.order([[R.ref(a.r, "created_at", "c"), R.ref(b.r, "created_at", "c"), "DESC", null]]));
      return result.slice(0).map(x => x.value);
    })(null));
  }, [], false);
  return rows;
}

//ค้นหา Connection ตาม ID
async function findConnectionById(id) {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "connections", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("=", R.ref(r, "id", null), p[0]));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          "id": R.ref(r, "id", null),
          "connectionName": R.ref(r, "connection_name", null),
          "systemType": R.ref(r, "system_type", null),
          "site": R.ref(r, "site", null),
          "baseUrl": R.ref(r, "base_url", null),
          "apiBaseUrl": R.ref(r, "api_base_url", null),
          "apiVersion": R.ref(r, "api_version", null),
          "apiSchemaVersion": R.ref(r, "api_schema_version", null),
          "lastVerifiedAt": R.ref(r, "last_verified_at", null),
          "associatedVcenterConnectionId": R.ref(r, "associated_vcenter_connection_id", null),
          "credentialSourceConnectionId": R.ref(r, "credential_source_connection_id", null),
          "username": R.ref(r, "username", null),
          "verifyTls": R.ref(r, "verify_tls", null),
          "isActive": R.ref(r, "is_active", null),
          "lastTestedAt": R.ref(r, "last_tested_at", null),
          "lastConnectionStatus": R.ref(r, "last_connection_status", null),
          "lastSyncStatus": R.ref(r, "last_sync_status", null),
          "lastSyncAt": R.ref(r, "last_sync_at", null),
          "lastSyncErrorCode": R.ref(r, "last_sync_error_code", null),
          "createdAt": R.ref(r, "created_at", null),
          "hasPassword": R.unary("IS NOT NULL", R.ref(r, "encrypted_password", null))
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  }, [id], false);
  return rows[0] || null;
}

//อ่าน Connection พร้อมข้อมูล credential ที่เข้ารหัสแล้ว เพื่อนำไปทดสอบเชื่อมต่อ VMware
async function findConnectionWithCredentialById(id, client = pool) {
  const {
    rows
  } = await client.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "c", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
      rows = R.join(rows, "s", r => views["connections"] || s.read("connections"), r => R.binary("=", R.ref(r, "credential_source_connection_id", "c"), R.ref(r, "id", "s")), "LEFT JOIN");
      rows = rows.filter(r => R.binary("=", R.ref(r, "id", "c"), p[0]));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          "id": R.ref(r, "id", "c"),
          "connectionName": R.ref(r, "connection_name", "c"),
          "systemType": R.ref(r, "system_type", "c"),
          "site": R.ref(r, "site", "c"),
          "baseUrl": R.ref(r, "base_url", "c"),
          "apiBaseUrl": R.ref(r, "api_base_url", "c"),
          "apiVersion": R.ref(r, "api_version", "c"),
          "apiSchemaVersion": R.ref(r, "api_schema_version", "c"),
          "lastVerifiedAt": R.ref(r, "last_verified_at", "c"),
          "associatedVcenterConnectionId": R.ref(r, "associated_vcenter_connection_id", "c"),
          "credentialSourceConnectionId": R.ref(r, "credential_source_connection_id", "c"),
          "username": R.fn("coalesce", [R.ref(r, "username", "c"), R.ref(r, "username", "s")]),
          "encryptedPassword": R.fn("coalesce", [R.ref(r, "encrypted_password", "c"), R.ref(r, "encrypted_password", "s")]),
          "encryptionIv": R.fn("coalesce", [R.ref(r, "encryption_iv", "c"), R.ref(r, "encryption_iv", "s")]),
          "encryptionAuthTag": R.fn("coalesce", [R.ref(r, "encryption_auth_tag", "c"), R.ref(r, "encryption_auth_tag", "s")]),
          "verifyTls": R.ref(r, "verify_tls", "c"),
          "isActive": R.ref(r, "is_active", "c")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  }, [id], false);
  return rows[0] || null;
}

//ใช้บันทึกผลการทดสอบ Connection
async function updateConnectionTestStatus(id, status, testedAt, client = pool) {
  await client.run((s, p) => {
    const R = s.helpers;
    const views = {};
    const rows = s.update("connections", row => {
      const r = R.rowContext(row, "connections");
      return R.binary("=", R.ref(r, "id", null), p[2]);
    }, row => {
      const r = R.rowContext(row, "connections");
      return {
        "last_connection_status": p[0],
        "last_tested_at": p[1]
      };
    });
    return R.changed(rows.length);
  }, [status, testedAt, id], true);
}
//ใช้บันทึก API metadata ที่ค้นพบจาก SRM
async function updateSrmApiDetails(id, apiBaseUrl, apiVersion, apiSchemaVersion, client = pool) {
  await client.run((s, p) => {
    const R = s.helpers;
    const views = {};
    const rows = s.update("connections", row => {
      const r = R.rowContext(row, "connections");
      return R.binary("=", R.ref(r, "id", null), p[3]);
    }, row => {
      const r = R.rowContext(row, "connections");
      return {
        "api_base_url": p[0],
        "api_version": p[1],
        "api_schema_version": p[2],
        "last_verified_at": s.now()
      };
    });
    return R.changed(rows.length);
  }, [apiBaseUrl, apiVersion, apiSchemaVersion, id], true);
}

//ใช้บันทึกว่า SRM Connection ฝั่ง Local จับคู่กับ SRM Connection ฝั่ง Remote ตัวใด
async function upsertSrmConnectionLink(localSrmId, remoteSrmId, pairingId, isActive, client = pool) {
  const {
    rows
  } = await client.run((s, p) => {
    const R = s.helpers;
    const views = {};
    const rows = s.insert("srm_connection_links", [[p[0], p[1], p[2], p[3]]].map(a => Object.fromEntries(["local_srm_connection_id", "remote_srm_connection_id", "pairing_id", "is_active"].map((k, i) => [k, a[i]]))), {
      key: row => {
        const r = R.rowContext(row, "srm_connection_links");
        return [R.ref(r, "local_srm_connection_id", null), R.ref(r, "pairing_id", null)];
      },
      change: (old, row) => {
        const r = R.rowContext(old, "srm_connection_links", {
          excluded: row
        });
        return {
          "remote_srm_connection_id": p[1],
          "is_active": p[3],
          "updated_at": s.now()
        };
      }
    });
    return R.result(rows.map(row => {
      const r = R.rowContext(row, "srm_connection_links");
      return {
        ...R.star(r, null)
      };
    }));
  }, [localSrmId, remoteSrmId, pairingId, isActive], true);
  return rows[0];
}
async function getRemoteSrmConnectionId(localSrmId, pairingId, client = pool) {
  const {
    rows
  } = await client.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "srm_connection_links", r => views["srm_connection_links"] || s.read("srm_connection_links"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "local_srm_connection_id", null), p[0]), R.binary("=", R.ref(r, "pairing_id", null), p[1])), R.binary("=", R.ref(r, "is_active", null), true)));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          "remoteSrmConnectionId": R.ref(r, "remote_srm_connection_id", null)
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  }, [localSrmId, pairingId], false);
  return rows[0] ? rows[0].remoteSrmConnectionId : null;
}
async function resolveRemoteSrmConnectionForPairing(localSrmId, pairing, client = pool) {
  const explicitId = await getRemoteSrmConnectionId(localSrmId, pairing.pairingId, client);
  if (explicitId) {
    return {
      remoteSrmConnectionId: explicitId,
      resolutionSource: 'EXPLICIT_SRM_CONNECTION_LINK'
    };
  }
  if (!pairing.localVcenterId || !pairing.remoteVcenterId) return null;
  const {
    rows
  } = await client.run((s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((views => {
      views["identity_candidates"] = [...(parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "mirror", r => views["srm_site_pairs"] || s.read("srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("!=", R.ref(r, "connection_id", "mirror"), p[0]), R.binary("=", R.ref(r, "local_vcenter_id", "mirror"), p[1])), R.binary("=", R.ref(r, "remote_vcenter_id", "mirror"), p[2])), R.binary("=", R.ref(r, "is_present", "mirror"), true)));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "remote_srm_connection_id": R.ref(r, "connection_id", "mirror"),
            "resolution_source": R.cast("SRM_PAIRING_MIRROR", {
              "name": "text"
            }),
            "priority": 1
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null), ...(parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vr_pair", r => views["vr_pairings"] || s.read("vr_pairings"), r => true, "INNER JOIN");
        rows = R.join(rows, "remote_vr", r => views["connections"] || s.read("connections"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "id", "remote_vr"), R.ref(r, "connection_id", "vr_pair")), R.binary("=", R.ref(r, "system_type", "remote_vr"), "VR")), R.binary("=", R.ref(r, "is_active", "remote_vr"), true)), "INNER JOIN");
        rows = R.join(rows, "remote_srm", r => views["connections"] || s.read("connections"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "system_type", "remote_srm"), "SRM"), R.binary("=", R.ref(r, "associated_vcenter_connection_id", "remote_srm"), R.ref(r, "associated_vcenter_connection_id", "remote_vr"))), R.binary("=", R.ref(r, "is_active", "remote_srm"), true)), "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("!=", R.ref(r, "id", "remote_srm"), p[0]), R.binary("=", R.ref(r, "local_vcenter_external_id", "vr_pair"), p[1])), R.binary("=", R.ref(r, "remote_vcenter_external_id", "vr_pair"), p[2])), R.binary("=", R.ref(r, "is_present", "vr_pair"), true)));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "remote_srm_connection_id": R.ref(r, "id", "remote_srm"),
            "resolution_source": R.cast("VR_PAIRING_IDENTITY", {
              "name": "text"
            }),
            "priority": 2
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        return result.slice(0).map(x => x.value);
      })(null)];
      return (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "identity_candidates", r => views["identity_candidates"] || s.read("identity_candidates"), r => true, "INNER JOIN");
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "remote_srm_connection_id": R.ref(r, "remote_srm_connection_id", null),
            "resolution_source": R.ref(r, "resolution_source", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "priority", null), R.ref(b.r, "priority", null), "ASC", null], [R.ref(a.r, "remote_srm_connection_id", null), R.ref(b.r, "remote_srm_connection_id", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null);
    })({
      ...views
    }));
  }, [localSrmId, pairing.remoteVcenterId, pairing.localVcenterId], false);
  const unique = new Map();
  for (const row of rows) {
    if (!unique.has(row.remote_srm_connection_id)) unique.set(row.remote_srm_connection_id, row);
  }
  if (unique.size !== 1) return null;
  const resolved = [...unique.values()][0];
  return {
    remoteSrmConnectionId: resolved.remote_srm_connection_id,
    resolutionSource: resolved.resolution_source
  };
}
module.exports = {
  findAllConnections,
  findConnectionById,
  findConnectionWithCredentialById,
  updateConnectionTestStatus,
  updateSrmApiDetails,
  upsertSrmConnectionLink,
  getRemoteSrmConnectionId,
  resolveRemoteSrmConnectionForPairing
};
