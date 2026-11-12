const {
  pool
} = require('../../db');

const {
  classifyPairing
} = require('../services/vr-resolution.service');

const net = require('net');

class VRRepository {
  async getLocalConnections() {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "sc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "credential_source_connection_id", "c"), R.ref(r, "id", "sc")), "LEFT JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("=", R.ref(r, "connection_id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "LEFT JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "c"), "VR"), R.binary("=", R.ref(r, "is_active", "c"), true)));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            ...R.star(r, "c"),
            "source_username": R.ref(r, "username", "sc"),
            "source_encrypted_password": R.ref(r, "encrypted_password", "sc"),
            "source_encryption_iv": R.ref(r, "encryption_iv", "sc"),
            "source_encryption_auth_tag": R.ref(r, "encryption_auth_tag", "sc"),
            "source_system_type": R.ref(r, "system_type", "sc"),
            "source_is_active": R.ref(r, "is_active", "sc"),
            "local_vcenter_instance_uuid": R.ref(r, "vcenter_id", "vc")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    return rows;
  }
    async getRemoteConnection(remoteId) {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "sc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "credential_source_connection_id", "c"), R.ref(r, "id", "sc")), "LEFT JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("=", R.ref(r, "connection_id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "LEFT JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), p[0]), R.binary("=", R.ref(r, "is_active", "c"), true)));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            ...R.star(r, "c"),
            "source_username": R.ref(r, "username", "sc"),
            "source_encrypted_password": R.ref(r, "encrypted_password", "sc"),
            "source_encryption_iv": R.ref(r, "encryption_iv", "sc"),
            "source_encryption_auth_tag": R.ref(r, "encryption_auth_tag", "sc"),
            "source_system_type": R.ref(r, "system_type", "sc"),
            "source_is_active": R.ref(r, "is_active", "sc"),
            "local_vcenter_instance_uuid": R.ref(r, "vcenter_id", "vc")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [remoteId], false);

    return rows[0];
  }
    async getPairingLinks(localConnectionId) {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "l", r => views["vr_connection_links"] || s.read("vr_connection_links"), r => true, "INNER JOIN");
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "remote_vr_connection_id", "l"), R.ref(r, "id", "c")), "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "local_vr_connection_id", "l"), p[0]), R.binary("=", R.ref(r, "is_active", "l"), true)));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            ...R.star(r, "l"),
            "remote_url": R.ref(r, "base_url", "c")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [localConnectionId], false);

    return rows;
  }
    async findReciprocalRemoteConnection(localConnectionId, pairing) {
    const localVcenterId = pairing?.local_vc_server?.id;
    const remoteVcenterId = pairing?.remote_vc_server?.id;

    if (!pairing?.pairing_id || !localVcenterId || !remoteVcenterId || localVcenterId === remoteVcenterId) return null;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "rp", r => views["vr_pairings"] || s.read("vr_pairings"), r => true, "INNER JOIN");
        rows = R.join(rows, "c", r => views["connections"] || s.read("connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "rp")), "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("AND", R.binary("AND", R.binary("!=", R.ref(r, "connection_id", "rp"), p[0]), R.binary("=", R.ref(r, "local_vcenter_external_id", "rp"), p[1])), R.binary("=", R.ref(r, "remote_vcenter_external_id", "rp"), p[2])), R.binary("=", R.ref(r, "is_present", "rp"), true)), R.binary("=", R.ref(r, "system_type", "c"), "VR")), R.binary("=", R.ref(r, "is_active", "c"), true)));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "remote_vr_connection_id": R.ref(r, "id", "c")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "rp"), R.ref(b.r, "last_seen_at", "rp"), "DESC", null]]));
        return result.slice(0, 0 + Number(2)).map(x => x.value);
      })(null));
    }, [localConnectionId, remoteVcenterId, localVcenterId], false);

    return rows.length === 1 ? rows[0] : null;
  }
    async upsertPairingLink(localConnectionId, remoteConnectionId, pairingId) {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("vr_connection_links", [[p[0], p[1], p[2], true]].map(a => Object.fromEntries(["local_vr_connection_id", "remote_vr_connection_id", "pairing_id", "is_active"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "vr_connection_links");
          return [R.ref(r, "local_vr_connection_id", null), R.ref(r, "pairing_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "vr_connection_links", {
            excluded: row
          });

          return {
            "remote_vr_connection_id": R.ref(r, "remote_vr_connection_id", "excluded"),
            "is_active": true,
            "updated_at": s.now()
          };
        }
      });

      return R.result(rows.map(row => {
        const r = R.rowContext(row, "vr_connection_links");

        return {
          ...R.star(r, null)
        };
      }));
    }, [localConnectionId, remoteConnectionId, pairingId], true);

    return rows[0];
  }
    async upsertPairings(connectionId, pairings, syncRunId, client = pool) {
    for (const p of pairings) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_pairings", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], true, p[8], s.now()]].map(a => Object.fromEntries(["connection_id", "pairing_id", "local_vcenter_external_id", "local_site_name", "remote_vcenter_external_id", "remote_site_name", "pairing_status", "remote_session_status", "is_present", "sync_run_id", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_pairings");
            return [R.ref(r, "connection_id", null), R.ref(r, "pairing_id", null)];
          },
          change: (old, row) => {
            const r = R.rowContext(old, "vr_pairings", {
              excluded: row
            });

            return {
              "local_vcenter_external_id": R.ref(r, "local_vcenter_external_id", "excluded"),
              "local_site_name": R.ref(r, "local_site_name", "excluded"),
              "remote_vcenter_external_id": R.ref(r, "remote_vcenter_external_id", "excluded"),
              "remote_site_name": R.ref(r, "remote_site_name", "excluded"),
              "pairing_status": R.ref(r, "pairing_status", "excluded"),
              "remote_session_status": R.ref(r, "remote_session_status", "excluded"),
              "is_present": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [connectionId, p.pairing_id, p.local_vc_server?.id || null, p.local_vc_server?.name || null, p.remote_vc_server?.id || null, p.remote_vc_server?.name || null, p.local_vc_server?.server_status || null, p.remote_session_status || 'OK', syncRunId], true);
    }

    // Mark as not present if not seen in this run
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_pairings", row => {
        const r = R.rowContext(row, "vr_pairings");
        return R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("!=", R.ref(r, "sync_run_id", null), p[1]));
      }, row => {
        const r = R.rowContext(row, "vr_pairings");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [connectionId, syncRunId], true);
  }
    async upsertReplications(connectionId, pairingId, replications, syncRunId, client = pool) {
    for (const r of replications) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_replications", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], p[14], p[15], p[16], p[17], p[18], p[19], p[20], p[21], p[22], p[23], p[24], p[25], p[26], p[27], p[28], p[29], p[30], p[31], p[32], p[33], p[34], p[35], p[36], p[37], p[38], R.cast(p[39], {
          "name": "jsonb"
        }), p[40], p[41], p[42], true, p[43], s.now()]].map(a => Object.fromEntries(["connection_id", "pairing_id", "replication_id", "direction", "vm_id", "vm_name", "source_vc_id", "target_vc_id", "source_site_name", "target_site_name", "raw_type", "raw_status", "normalized_status", "rpo_minutes", "last_sync_at", "configuration_state", "recovery_state", "current_rpo_violation", "sync_progress_percent", "recovery_solution", "configuration_error_message", "configuration_error_details", "last_group_error_message", "last_group_error_details", "recovery_error_message", "target_replication_server_uuid", "last_sync_duration_seconds", "last_sync_size_bytes", "quiescing_enabled", "network_compression_enabled", "encryption_enabled", "auto_replicate_new_disks_enabled", "mpit_enabled", "mpit_instances", "mpit_days", "vm_data_sets_replication_enabled", "enhanced_replication", "disk_collection_status", "disk_collection_error_code", "replicated_disk_summary", "canonical_replication_key", "canonical_key_version", "canonical_identity_status", "is_present", "sync_run_id", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_replications");
            return [R.ref(r, "connection_id", null), R.ref(r, "pairing_id", null), R.ref(r, "replication_id", null), R.ref(r, "direction", null)];
          },
          change: (old, row) => {
            const r = R.rowContext(old, "vr_replications", {
              excluded: row
            });

            return {
              "vm_id": R.ref(r, "vm_id", "excluded"),
              "vm_name": R.ref(r, "vm_name", "excluded"),
              "source_vc_id": R.ref(r, "source_vc_id", "excluded"),
              "target_vc_id": R.ref(r, "target_vc_id", "excluded"),
              "source_site_name": R.ref(r, "source_site_name", "excluded"),
              "target_site_name": R.ref(r, "target_site_name", "excluded"),
              "raw_type": R.ref(r, "raw_type", "excluded"),
              "raw_status": R.ref(r, "raw_status", "excluded"),
              "normalized_status": R.ref(r, "normalized_status", "excluded"),
              "rpo_minutes": R.ref(r, "rpo_minutes", "excluded"),
              "last_sync_at": R.ref(r, "last_sync_at", "excluded"),
              "configuration_state": R.ref(r, "configuration_state", "excluded"),
              "recovery_state": R.ref(r, "recovery_state", "excluded"),
              "current_rpo_violation": R.ref(r, "current_rpo_violation", "excluded"),
              "sync_progress_percent": R.ref(r, "sync_progress_percent", "excluded"),
              "recovery_solution": R.ref(r, "recovery_solution", "excluded"),
              "configuration_error_message": R.ref(r, "configuration_error_message", "excluded"),
              "configuration_error_details": R.ref(r, "configuration_error_details", "excluded"),
              "last_group_error_message": R.ref(r, "last_group_error_message", "excluded"),
              "last_group_error_details": R.ref(r, "last_group_error_details", "excluded"),
              "recovery_error_message": R.ref(r, "recovery_error_message", "excluded"),
              "target_replication_server_uuid": R.ref(r, "target_replication_server_uuid", "excluded"),
              "last_sync_duration_seconds": R.ref(r, "last_sync_duration_seconds", "excluded"),
              "last_sync_size_bytes": R.ref(r, "last_sync_size_bytes", "excluded"),
              "quiescing_enabled": R.ref(r, "quiescing_enabled", "excluded"),
              "network_compression_enabled": R.ref(r, "network_compression_enabled", "excluded"),
              "encryption_enabled": R.ref(r, "encryption_enabled", "excluded"),
              "auto_replicate_new_disks_enabled": R.ref(r, "auto_replicate_new_disks_enabled", "excluded"),
              "mpit_enabled": R.ref(r, "mpit_enabled", "excluded"),
              "mpit_instances": R.ref(r, "mpit_instances", "excluded"),
              "mpit_days": R.ref(r, "mpit_days", "excluded"),
              "vm_data_sets_replication_enabled": R.ref(r, "vm_data_sets_replication_enabled", "excluded"),
              "enhanced_replication": R.ref(r, "enhanced_replication", "excluded"),
              "disk_collection_status": R.ref(r, "disk_collection_status", "excluded"),
              "disk_collection_error_code": R.ref(r, "disk_collection_error_code", "excluded"),
              "replicated_disk_summary": R.ref(r, "replicated_disk_summary", "excluded"),
              "canonical_replication_key": R.ref(r, "canonical_replication_key", "excluded"),
              "canonical_key_version": R.ref(r, "canonical_key_version", "excluded"),
              "canonical_identity_status": R.ref(r, "canonical_identity_status", "excluded"),
              "is_present": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [connectionId, pairingId, r.id, r.direction, r.vm_id, r.name, r.source_vc_id, r.target_vc_id, r.source_site_name, r.target_site_name, r.type, r.status?.status, r.normalized_status, r.rpo, r.last_sync_time ? new Date(r.last_sync_time) : null, r.configuration_state, r.recovery_state, r.current_rpo_violation, r.sync_progress, r.recovery_solution || null, r.configuration_error_message || null, r.configuration_error_details || null, r.last_group_error_message || null, r.last_group_error_details || null, r.recovery_error_message || null, r.target_replication_server_uuid || null, r.last_sync_duration, r.last_sync_size, r.quiescing_enabled, r.network_compression_enabled, r.encryption_enabled, r.auto_replicate_new_disks_enabled, r.mpit_enabled, r.mpit_instances, r.mpit_days, r.vm_data_sets_replication_enabled, r.enhanced_replication, r.disk_collection_status || null, r.disk_collection_error_code || null, r.replicated_disk_summary ? JSON.stringify(r.replicated_disk_summary) : null, r.canonical_replication_key, r.canonical_key_version, r.canonical_identity_status, syncRunId], true);
    }

    // Mark as not present if not seen in this run, scoped by pairing to allow partial failure resilience
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_replications", row => {
        const r = R.rowContext(row, "vr_replications");

        return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("=", R.ref(r, "pairing_id", null), p[1])), R.binary("!=", R.ref(r, "sync_run_id", null), p[2]));
      }, row => {
        const r = R.rowContext(row, "vr_replications");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [connectionId, pairingId, syncRunId], true);
  }
    async markReplicationsForMissingPairings(connectionId, client = pool) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_replications", row => {
        const r = R.rowContext(row, "r");

        return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), p[0]), R.binary("=", R.ref(r, "is_present", "r"), true)), R.unary("NOT", (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "p", r => views["vr_pairings"] || s.read("vr_pairings"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "r")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "r"))), R.binary("=", R.ref(r, "is_present", "p"), true)));

          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              "?column?0": 1
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          return result.slice(0).map(x => x.value);
        })(r).length > 0));
      }, row => {
        const r = R.rowContext(row, "r");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [connectionId], true);
  }
    async updateSyncState(connectionId, status, syncRunId, errorCode = null, client = pool) {
    const now = new Date();

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("vr_sync_state", [[p[0], p[1], p[2], p[3], R.binary("=", R.cast(p[1], {
        "name": "varchar"
      }), "OK") ? R.cast(p[3], {
        "name": "timestamp"
      }) : null, R.binary("=", R.cast(p[1], {
        "name": "varchar"
      }), "ERROR") ? R.cast(p[3], {
        "name": "timestamp"
      }) : null, R.binary("=", R.cast(p[1], {
        "name": "varchar"
      }), "PARTIAL") ? R.cast(p[3], {
        "name": "timestamp"
      }) : null, p[4]]].map(a => Object.fromEntries(["connection_id", "sync_status", "current_sync_run_id", "last_sync_started_at", "last_successful_sync_at", "last_failed_sync_at", "last_partial_sync_at", "last_error_code"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "vr_sync_state");
          return [R.ref(r, "connection_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "vr_sync_state", {
            excluded: row
          });

          return {
            "sync_status": R.ref(r, "sync_status", "excluded"),
            "current_sync_run_id": R.ref(r, "current_sync_run_id", "excluded"),
            "last_sync_started_at": R.ref(r, "last_sync_started_at", "excluded"),
            "last_successful_sync_at": R.binary("=", R.ref(r, "sync_status", "excluded"), "OK") ? R.ref(r, "last_sync_started_at", "excluded") : R.ref(r, "last_successful_sync_at", "vr_sync_state"),
            "last_failed_sync_at": R.binary("=", R.ref(r, "sync_status", "excluded"), "ERROR") ? R.ref(r, "last_sync_started_at", "excluded") : R.ref(r, "last_failed_sync_at", "vr_sync_state"),
            "last_partial_sync_at": R.binary("=", R.ref(r, "sync_status", "excluded"), "PARTIAL") ? R.ref(r, "last_sync_started_at", "excluded") : R.ref(r, "last_partial_sync_at", "vr_sync_state"),
            "last_error_code": R.ref(r, "last_error_code", "excluded")
          };
        }
      });

      return R.changed(rows.length);
    }, [connectionId, status, syncRunId, now, errorCode], true);
  }
    async updateSyncStateCounts(connectionId, pairingCount, replicationCount, canonicalCount, client = pool) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_sync_state", row => {
        const r = R.rowContext(row, "vr_sync_state");
        return R.binary("=", R.ref(r, "connection_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "vr_sync_state");

        return {
          "last_pairing_count": p[1],
          "last_observation_count": p[2],
          "last_canonical_replication_count": p[3]
        };
      });

      return R.changed(rows.length);
    }, [connectionId, pairingCount, replicationCount, canonicalCount], true);
  }
    async getOverview() {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "s", r => views["current_vr_sync_state"] || s.read("current_vr_sync_state"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "s")), "LEFT JOIN");
        rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "LEFT JOIN");
        rows = R.join(rows, "vp", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "p"), true)), R.unary("IS NOT NULL", R.ref(r, "local_site_name", "p"))));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "local_site_name": R.ref(r, "local_site_name", "p")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "p"), R.ref(b.r, "last_seen_at", "p"), "DESC", null]]));
          return result.slice(0, 0 + Number(1)).map(x => x.value);
        })(r), r => true, "LEFT JOIN");
        rows = R.join(rows, "ms", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "m", r => views["current_vr_management_servers"] || s.read("current_vr_management_servers"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "m"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "m"), true)), R.binary("=", R.ref(r, "server_scope", "m"), "LOCAL")));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              ...R.star(r, "m")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "m"), R.ref(b.r, "last_seen_at", "m"), "DESC", null]]));
          return result.slice(0, 0 + Number(1)).map(x => x.value);
        })(r), r => true, "LEFT JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "c"), "VR"), R.binary("=", R.ref(r, "is_active", "c"), true)));
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "id": R.ref(r, "id", "c"),
            "connection_name": R.ref(r, "connection_name", "c"),
            "site": R.ref(r, "site", "c"),
            "base_url": R.ref(r, "base_url", "c"),
            "api_base_url": R.ref(r, "api_base_url", "c"),
            "last_connection_status": R.ref(r, "last_connection_status", "c"),
            "last_verified_at": R.ref(r, "last_verified_at", "c"),
            "last_tested_at": R.ref(r, "last_tested_at", "c"),
            "sync_status": R.ref(r, "sync_status", "s"),
            "visibility_sync_status": R.ref(r, "visibility_sync_status", "s"),
            "last_successful_sync_at": R.ref(r, "last_successful_sync_at", "s"),
            "associated_vcenter_name": R.fn("coalesce", [R.ref(r, "connection_name", "vc"), R.unary("IS NOT NULL", R.ref(r, "local_site_name", "vp")) ? "vCenter observed by VR" : null]),
            "associated_vcenter_base_url": R.fn("coalesce", [R.ref(r, "base_url", "vc"), R.unary("IS NOT NULL", R.ref(r, "local_site_name", "vp")) ? R.binary("||", "https://", R.ref(r, "local_site_name", "vp")) : null]),
            "management_pairing_id": R.ref(r, "pairing_id", "ms"),
            "management_name": R.ref(r, "name", "ms"),
            "management_safe_url": R.ref(r, "safe_url", "ms"),
            "management_status": R.ref(r, "server_status", "ms"),
            "management_version": R.ref(r, "version", "ms"),
            "management_build_number": R.ref(r, "build_number", "ms"),
            "management_vc_guid": R.ref(r, "vc_guid", "ms"),
            "management_last_seen_at": R.ref(r, "last_seen_at", "ms"),
                        "last_pairing_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "p"), true)));
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
            "observation_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "r"), true)));
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
            "canonical_replication_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "r"), true)), R.binary("=", R.ref(r, "canonical_identity_status", "r"), "COMPLETE")));
              let groups = R.groups(rows, null);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "canonical_replication_key", null)), "distinct", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0).map(x => x.value);
            })(r)),
            "incoming_observation_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "r"), true)), R.binary("=", R.ref(r, "direction", "r"), "INCOMING")));
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
            "outgoing_observation_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "r"), true)), R.binary("=", R.ref(r, "direction", "r"), "OUTGOING")));
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
                        "canonical_identity_missing_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "r"), true)), R.binary("=", R.ref(r, "canonical_identity_status", "r"), "INSUFFICIENT")));
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
            "canonical_identity_conflict_count": R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), R.binary("=", R.ref(r, "is_present", "r"), true)), R.binary("=", R.ref(r, "canonical_identity_status", "r"), "CONFLICT")));
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
            })(r))
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "connection_name", "c"), R.ref(b.r, "connection_name", "c"), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const {
      buildApplianceViewModel
    } = require('../services/appliance-discovery.service');

    return rows.map(r => {
      const appliance = buildApplianceViewModel({
        connection: r,
        associatedVcenter: {
          connection_name: r.associated_vcenter_name,
          base_url: r.associated_vcenter_base_url
        },
        server: {
          pairing_id: r.management_pairing_id,
          name: r.management_name,
          safe_url: r.management_safe_url,
          server_status: r.management_status,
          version: r.management_version,
          build_number: r.management_build_number,
          vc_guid: r.management_vc_guid,
          last_seen_at: r.management_last_seen_at
        },
        productType: 'VSPHERE_REPLICATION'
      });

      return {
        id: r.id,
        connectionName: r.connection_name,
        site: r.site,
        baseUrl: r.base_url,
        ...appliance,
        vrApplianceIp: appliance.applianceIp,
        vrApplianceHostname: appliance.applianceHostname,
        coreSyncStatus: r.sync_status,
        visibilitySyncStatus: r.visibility_sync_status,
        lastCoreSyncAt: r.last_successful_sync_at,
        lastVisibilitySyncAt: r.last_successful_sync_at,
        pairingCount: parseInt(r.last_pairing_count, 10),
        canonicalReplicationCount: parseInt(r.canonical_replication_count, 10),
        replicationObservationCount: parseInt(r.observation_count, 10),
        incomingObservationCount: parseInt(r.incoming_observation_count, 10),
        outgoingObservationCount: parseInt(r.outgoing_observation_count, 10),
        canonicalIdentityMissingCount: parseInt(r.canonical_identity_missing_count, 10),
        canonicalIdentityConflictCount: parseInt(r.canonical_identity_conflict_count, 10)
      };
    });
  }
    async getVcUuidMap() {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result(R.unique([
        ...(parent => {
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
        })(null),

        ...(parent => {
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
        })(null)
      ]));
    }, [], false);

    const map = new Map();
    rows.forEach(r => map.set(r.uuid, r.fqdn));
    return map;
  }
    async getPairingsSummary() {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];

        rows = R.join(rows, "sub", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "id", "c")), "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "p"), true));

          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              ...R.star(r, "p"),
              "connection_name": R.ref(r, "connection_name", "c"),
              "local_site": R.ref(r, "site", "c")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([
            [R.ref(a.r, "pairing_id", "p"), R.ref(b.r, "pairing_id", "p"), "ASC", null],
            [R.ref(a.r, "last_seen_at", "p"), R.ref(b.r, "last_seen_at", "p"), "DESC", null]
          ]));

          result = R.unique(result, x => [
            R.ref(x.r, "pairing_id", "p")
          ]);

          return result.slice(0).map(x => x.value);
        })(r), r => true, "INNER JOIN");

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

        result.sort((a, b) => R.order([
          [R.ref(a.r, "local_site", "sub"), R.ref(b.r, "local_site", "sub"), "ASC", null],
          [R.ref(a.r, "pairing_id", "sub"), R.ref(b.r, "pairing_id", "sub"), "ASC", null]
        ]));

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    return rows.map(p => {
      const classification = classifyPairing(
        p.local_vcenter_external_id,
        p.remote_vcenter_external_id
      );

      return {
        ...p,
        is_self_pairing: classification.isSelfPairing,
        pairing_type: classification.pairingType,
        computed_remote_session_status: classification.pairingType === 'SELF'
          ? 'NOT_APPLICABLE'
          : p.remote_session_status
      };
    });
  }
    async getReplicationsSummary() {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((views => {
        views["vc_site_map"] = (parent => {
          let rows = [R.context(parent)];

          rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), R.binary("=", R.ref(r, "is_active", "c"), true)), "INNER JOIN");
          rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "LEFT JOIN");

          rows = rows.filter(r => R.binary("AND", R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", "p")), R.binary("=", R.ref(r, "is_present", "p"), true)));

          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              "uuid": R.ref(r, "local_vcenter_external_id", "p"),
              "site_label": R.ref(r, "site", "c"),
              "vcenter_name": R.ref(r, "connection_name", "vc"),
              "vcenter_base_url": R.ref(r, "base_url", "vc"),
              "observed_vcenter_host": R.ref(r, "local_site_name", "p")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result = R.unique(result, x => x.value);
          return result.slice(0).map(x => x.value);
        })(null);

        views["vc_fqdn_map"] = R.unique([
          ...(parent => {
            let rows = [R.context(parent)];

            rows = R.join(rows, "current_vr_pairings", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", null)), R.binary("=", R.ref(r, "is_present", null), true)));

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
          })(null),

          ...(parent => {
            let rows = [R.context(parent)];

            rows = R.join(rows, "current_vr_pairings", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.unary("IS NOT NULL", R.ref(r, "remote_vcenter_external_id", null)), R.binary("=", R.ref(r, "is_present", null), true)));

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
          })(null)
        ]);
                return (parent => {
          let rows = [R.context(parent)];

          rows = R.join(rows, "sub", r => (parent => {
            let rows = [R.context(parent)];

            rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
            rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "id", "c")), "INNER JOIN");
            rows = R.join(rows, "src_site", r => views["vc_site_map"] || s.read("vc_site_map"), r => R.binary("=", R.ref(r, "source_vc_id", "r"), R.ref(r, "uuid", "src_site")), "LEFT JOIN");
            rows = R.join(rows, "tgt_site", r => views["vc_site_map"] || s.read("vc_site_map"), r => R.binary("=", R.ref(r, "target_vc_id", "r"), R.ref(r, "uuid", "tgt_site")), "LEFT JOIN");
            rows = R.join(rows, "m", r => views["vc_fqdn_map"] || s.read("vc_fqdn_map"), r => R.binary("=", R.ref(r, "source_vc_id", "r"), R.ref(r, "uuid", "m")), "LEFT JOIN");

            rows = R.join(rows, "v", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => R.binary("AND", R.binary("AND", R.binary("LIKE", R.ref(r, "vcenter_id", "v"), R.binary("||", R.binary("||", "%", R.ref(r, "fqdn", "m")), "%")), R.binary("=", R.ref(r, "vm_id", "v"), R.fn("coalesce", [R.fn("nullif", [R.fn("split_part", [R.ref(r, "vm_id", "r"), ":", 2]), ""]), R.ref(r, "vm_id", "r")]))), R.binary("=", R.ref(r, "is_present", "v"), true)), "LEFT JOIN");

            rows = R.join(rows, "recovered_v", r => (parent => {
              let rows = [R.context(parent)];

              rows = R.join(rows, "candidate", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");

              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "candidate"), R.ref(r, "vcenter_base_url", "tgt_site")), R.binary("=", R.ref(r, "is_present", "candidate"), true)), R.binary("=", R.fn("lower", [R.ref(r, "name", "candidate")]), R.fn("lower", [R.ref(r, "vm_name", "r")]))), R.unary("NOT", (parent => {
                let rows = [R.context(parent)];

                rows = R.join(rows, "duplicate", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");

                rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", "duplicate"), R.ref(r, "vcenter_id", "candidate")), R.binary("=", R.ref(r, "is_present", "duplicate"), true)), R.binary("=", R.fn("lower", [R.ref(r, "name", "duplicate")]), R.fn("lower", [R.ref(r, "name", "candidate")]))), R.binary("!=", R.ref(r, "id", "duplicate"), R.ref(r, "id", "candidate"))));

                let groups = rows.map(r => [r]);
                let result = groups.flatMap(g => {
                  const r = g[0] || R.context(parent);

                  return R.expand({
                    "?column?0": 1
                  }).map(value => ({
                    value,
                    r: R.projectContext(r, value),
                    g
                  }));
                });

                return result.slice(0).map(x => x.value);
              })(r).length > 0)));

              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);

                return R.expand({
                  ...R.star(r, "candidate")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });

              result.sort((a, b) => R.order([
                [R.ref(a.r, "last_seen_at", "candidate"), R.ref(b.r, "last_seen_at", "candidate"), "DESC", "LAST"]
              ]));

              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r), r => true, "LEFT JOIN");

            rows = R.join(rows, "srm", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => R.binary("AND", R.binary("=", R.ref(r, "protected_vm_id", "srm"), R.ref(r, "vm_id", "r")), R.binary("=", R.ref(r, "is_present", "srm"), true)), "LEFT JOIN");
            rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "srm")), R.binary("=", R.ref(r, "is_present", "pg"), true)), "LEFT JOIN");
            rows = R.join(rows, "rpg", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", "rpg"), R.ref(r, "protection_group_id", "pg")), R.binary("=", R.ref(r, "is_present", "rpg"), true)), "LEFT JOIN");
            rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", "rp"), R.ref(r, "recovery_plan_id", "rpg")), R.binary("=", R.ref(r, "is_present", "rp"), true)), "LEFT JOIN");
                        rows = R.join(rows, "issue", r => (parent => {
              let rows = [R.context(parent)];

              rows = R.join(rows, "ri", r => views["current_vr_replication_issues"] || s.read("current_vr_replication_issues"), r => true, "INNER JOIN");

              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "ri"), R.ref(r, "connection_id", "r")), R.binary("=", R.ref(r, "pairing_id", "ri"), R.ref(r, "pairing_id", "r"))), R.binary("=", R.ref(r, "is_present", "ri"), true)), R.binary("OR", R.binary("OR", R.binary("=", R.ref(r, "replication_id", "ri"), R.ref(r, "replication_id", "r")), R.binary("=", R.ref(r, "canonical_replication_key", "ri"), R.ref(r, "canonical_replication_key", "r"))), R.binary("=", R.ref(r, "entity_name", "ri"), R.ref(r, "vm_name", "r")))));

              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);

                return R.expand({
                  "description": R.ref(r, "description", "ri"),
                  "severity": R.ref(r, "severity", "ri"),
                  "issue_type": R.ref(r, "issue_type", "ri"),
                  "occurred_at": R.ref(r, "occurred_at", "ri")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });

              result.sort((a, b) => R.order([
                [R.ref(a.r, "last_seen_at", "ri"), R.ref(b.r, "last_seen_at", "ri"), "DESC", null]
              ]));

              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r), r => true, "LEFT JOIN");

            rows = R.join(rows, "embedded", r => (parent => {
              let rows = [R.context(parent)];

              rows = R.join(rows, "rs", r => views["current_vr_replication_servers"] || s.read("current_vr_replication_servers"), r => true, "INNER JOIN");

              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "rs"), R.ref(r, "connection_id", "r")), R.binary("=", R.ref(r, "is_present", "rs"), true)), R.unary("IS NOT NULL", R.ref(r, "target_replication_server_uuid", "r"))), R.binary("OR", R.binary("OR", R.binary("=", R.ref(r, "server_uuid", "rs"), R.ref(r, "target_replication_server_uuid", "r")), R.binary("=", R.ref(r, "server_id", "rs"), R.ref(r, "target_replication_server_uuid", "r"))), R.binary("LIKE", R.ref(r, "server_id", "rs"), R.binary("||", "%", R.ref(r, "target_replication_server_uuid", "r"))))));

              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);

                return R.expand({
                  ...R.star(r, "rs")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });

              result.sort((a, b) => R.order([
                [
                  R.binary("=", R.ref(a.r, "server_uuid", "rs"), R.ref(a.r, "target_replication_server_uuid", "r"))
                    ? 0
                    : R.binary("=", R.ref(a.r, "server_id", "rs"), R.ref(a.r, "target_replication_server_uuid", "r"))
                      ? 1
                      : 2,
                  R.binary("=", R.ref(b.r, "server_uuid", "rs"), R.ref(b.r, "target_replication_server_uuid", "r"))
                    ? 0
                    : R.binary("=", R.ref(b.r, "server_id", "rs"), R.ref(b.r, "target_replication_server_uuid", "r"))
                      ? 1
                      : 2,
                  "ASC",
                  null
                ],
                [
                  R.binary("=", R.ref(a.r, "server_scope", "rs"), "LOCAL") ? 0 : 1,
                  R.binary("=", R.ref(b.r, "server_scope", "rs"), "LOCAL") ? 0 : 1,
                  "ASC",
                  null
                ],
                [
                  R.ref(a.r, "last_seen_at", "rs"),
                  R.ref(b.r, "last_seen_at", "rs"),
                  "DESC",
                  null
                ]
              ]));

              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r), r => true, "LEFT JOIN");

            rows = R.join(rows, "mgmt", r => (parent => {
              let rows = [R.context(parent)];

              rows = R.join(rows, "ms", r => views["current_vr_management_servers"] || s.read("current_vr_management_servers"), r => true, "INNER JOIN");

              rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "ms"), R.ref(r, "connection_id", "r")), R.binary("=", R.ref(r, "is_present", "ms"), true)), R.binary("=", R.ref(r, "server_scope", "ms"), "LOCAL")));

              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);

                return R.expand({
                  "safe_url": R.ref(r, "safe_url", "ms")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });

              result.sort((a, b) => R.order([
                [R.ref(a.r, "last_seen_at", "ms"), R.ref(b.r, "last_seen_at", "ms"), "DESC", null]
              ]));

              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r), r => true, "LEFT JOIN");
                        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "r"), true), R.binary("=", R.ref(r, "is_active", "c"), true)), R.binary("=", R.ref(r, "system_type", "c"), "VR")));

            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);

              return R.expand({
                ...R.star(r, "r"),
                "connection_name": R.ref(r, "connection_name", "c"),
                "local_site": R.ref(r, "site", "c"),
                "resolved_source_site": R.ref(r, "site_label", "src_site"),
                "resolved_target_site": R.ref(r, "site_label", "tgt_site"),
                "resolved_source_vcenter_name": R.ref(r, "vcenter_name", "src_site"),
                "resolved_target_vcenter_name": R.ref(r, "vcenter_name", "tgt_site"),
                "resolved_source_vcenter_base_url": R.ref(r, "vcenter_base_url", "src_site"),
                "resolved_target_vcenter_base_url": R.ref(r, "vcenter_base_url", "tgt_site"),
                "resolved_source_vcenter_host": R.ref(r, "observed_vcenter_host", "src_site"),
                "resolved_target_vcenter_host": R.ref(r, "observed_vcenter_host", "tgt_site"),
                "replication_server_id": R.ref(r, "server_id", "embedded"),
                "replication_server_name": R.ref(r, "name", "embedded"),
                "api_reported_server_address": R.ref(r, "hostname", "embedded"),
                "replication_server_internally_managed": R.ref(r, "internally_managed", "embedded"),
                "vr_management_safe_url": R.ref(r, "safe_url", "mgmt"),
                "protection_status": R.unary("IS NOT NULL", R.ref(r, "id", "srm")) ? "PROTECTED" : R.unary("IS NOT NULL", R.ref(r, "id", "v")) ? "NOT_PROTECTED" : "UNMAPPED",
                "protection_resolution_status": R.unary("IS NOT NULL", R.ref(r, "id", "srm")) ? "SUCCESS" : R.unary("IS NOT NULL", R.ref(r, "id", "v")) ? "NOT_IN_SRM" : "NOT_FOUND_IN_VC",
                "protection_group_id": R.ref(r, "protection_group_id", "pg"),
                "protection_group_name": R.ref(r, "name", "pg"),
                "recovery_plan_id": R.ref(r, "recovery_plan_id", "rp"),
                "recovery_plan_name": R.ref(r, "name", "rp"),
                "replication_issue_description": R.ref(r, "description", "issue"),
                "replication_issue_severity": R.ref(r, "severity", "issue"),
                "replication_issue_type": R.ref(r, "issue_type", "issue"),
                "replication_issue_occurred_at": R.ref(r, "occurred_at", "issue"),
                "vm_power_state": R.binary("AND", R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "r"), R.ref(r, "raw_status", "r"), ""])]), ["NOT_ACTIVE", "NOT ACTIVE"]), R.unary("IS NOT NULL", R.ref(r, "id", "recovered_v"))) ? R.ref(r, "power_state", "recovered_v") : R.ref(r, "power_state", "v"),
                "vm_primary_ip": R.binary("AND", R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "r"), R.ref(r, "raw_status", "r"), ""])]), ["NOT_ACTIVE", "NOT ACTIVE"]), R.unary("IS NOT NULL", R.ref(r, "id", "recovered_v"))) ? R.fn("coalesce", [R.ref(r, "primary_ip", "recovered_v"), R.ref(r, "ip", "recovered_v")]) : R.fn("coalesce", [R.ref(r, "primary_ip", "v"), R.ref(r, "ip", "v")]),
                "vm_inventory_role": R.binary("AND", R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "r"), R.ref(r, "raw_status", "r"), ""])]), ["NOT_ACTIVE", "NOT ACTIVE"]), R.unary("IS NOT NULL", R.ref(r, "id", "recovered_v"))) ? "RECOVERY_TARGET" : R.unary("IS NOT NULL", R.ref(r, "id", "v")) ? "SOURCE_VM" : "NOT_AVAILABLE",
                "vm_inventory_vcenter_id": R.binary("AND", R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "r"), R.ref(r, "raw_status", "r"), ""])]), ["NOT_ACTIVE", "NOT ACTIVE"]), R.unary("IS NOT NULL", R.ref(r, "id", "recovered_v"))) ? R.ref(r, "vcenter_id", "recovered_v") : R.ref(r, "vcenter_id", "v"),
                "vm_inventory_vm_id": R.binary("AND", R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "r"), R.ref(r, "raw_status", "r"), ""])]), ["NOT_ACTIVE", "NOT ACTIVE"]), R.unary("IS NOT NULL", R.ref(r, "id", "recovered_v"))) ? R.ref(r, "vm_id", "recovered_v") : R.ref(r, "vm_id", "v")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });

            result.sort((a, b) => R.order([
              [R.ref(a.r, "id", "r"), R.ref(b.r, "id", "r"), "ASC", null],
              [R.ref(a.r, "last_seen_at", "srm"), R.ref(b.r, "last_seen_at", "srm"), "DESC", null]
            ]));

            result = R.unique(result, x => [
              R.ref(x.r, "id", "r")
            ]);

            return result.slice(0).map(x => x.value);
          })(r), r => true, "INNER JOIN");

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

          result.sort((a, b) => R.order([
            [R.ref(a.r, "vm_name", "sub"), R.ref(b.r, "vm_name", "sub"), "ASC", null]
          ]));

          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false);

    return rows;
  }
    async upsertManagementServers(connectionId, servers, syncRunId, client = pool) {
    for (const s of servers) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_management_servers", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], p[14], true, p[15], s.now()]].map(a => Object.fromEntries(["connection_id", "pairing_id", "vrms_id", "server_scope", "name", "safe_url", "server_status", "version", "build_number", "vc_guid", "vc_name", "extension_key", "certificate_warning_count", "certificate_status", "certificate_not_after", "is_present", "sync_run_id", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_management_servers");

            return [
              R.ref(r, "connection_id", null),
              R.fn("coalesce", [R.ref(r, "pairing_id", null), ""]),
              R.ref(r, "vrms_id", null),
              R.ref(r, "server_scope", null)
            ];
          },

          change: (old, row) => {
            const r = R.rowContext(old, "vr_management_servers", {
              excluded: row
            });

            return {
              "name": R.ref(r, "name", "excluded"),
              "safe_url": R.ref(r, "safe_url", "excluded"),
              "server_status": R.ref(r, "server_status", "excluded"),
              "version": R.ref(r, "version", "excluded"),
              "build_number": R.ref(r, "build_number", "excluded"),
              "vc_guid": R.ref(r, "vc_guid", "excluded"),
              "vc_name": R.ref(r, "vc_name", "excluded"),
              "extension_key": R.ref(r, "extension_key", "excluded"),
              "certificate_warning_count": R.ref(r, "certificate_warning_count", "excluded"),
              "certificate_status": R.ref(r, "certificate_status", "excluded"),
              "certificate_not_after": R.ref(r, "certificate_not_after", "excluded"),
              "is_present": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        s.pairing_id || null,
        s.vrms_id,
        s.server_scope,
        s.name,
        s.safe_url,
        s.server_status,
        s.version,
        s.build_number,
        s.vc_guid,
        s.vc_name,
        s.extension_key,
        s.certificate_warning_count || 0,
        s.certificate_status,
        s.certificate_not_after,
        syncRunId
      ], true);
    }

    // Mark absent servers in the same scope as not present
    if (servers.length > 0) {
      const scope = servers[0].server_scope;
      const pairingId = servers[0].pairing_id || null;

      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("vr_management_servers", row => {
          const r = R.rowContext(row, "vr_management_servers");

          return R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("=", R.ref(r, "server_scope", null), p[1])), R.binary("=", R.fn("coalesce", [R.ref(r, "pairing_id", null), ""]), R.fn("coalesce", [p[2], ""]))), R.binary("!=", R.ref(r, "sync_run_id", null), p[3]));
        }, row => {
          const r = R.rowContext(row, "vr_management_servers");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        scope,
        pairingId || '',
        syncRunId
      ], true);
    }
  }
    async upsertReplicationServers(connectionId, servers, syncRunId, client = pool) {
    for (const s of servers) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_replication_servers", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], true, p[14], s.now()]].map(a => Object.fromEntries(["connection_id", "pairing_id", "vrms_id", "server_id", "server_scope", "server_uuid", "name", "hostname", "safe_configuration_url", "connected", "decommissioned", "internally_managed", "replication_count", "safe_fault", "is_present", "sync_run_id", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_replication_servers");

            return [
              R.ref(r, "connection_id", null),
              R.fn("coalesce", [R.ref(r, "pairing_id", null), ""]),
              R.fn("coalesce", [R.ref(r, "vrms_id", null), ""]),
              R.ref(r, "server_id", null),
              R.ref(r, "server_scope", null)
            ];
          },

          change: (old, row) => {
            const r = R.rowContext(old, "vr_replication_servers", {
              excluded: row
            });

            return {
              "server_uuid": R.ref(r, "server_uuid", "excluded"),
              "name": R.ref(r, "name", "excluded"),
              "hostname": R.ref(r, "hostname", "excluded"),
              "safe_configuration_url": R.ref(r, "safe_configuration_url", "excluded"),
              "connected": R.ref(r, "connected", "excluded"),
              "decommissioned": R.ref(r, "decommissioned", "excluded"),
              "internally_managed": R.ref(r, "internally_managed", "excluded"),
              "replication_count": R.ref(r, "replication_count", "excluded"),
              "safe_fault": R.ref(r, "safe_fault", "excluded"),
              "is_present": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        s.pairing_id || null,
        s.vrms_id || null,
        s.server_id,
        s.server_scope,
        s.server_uuid,
        s.name,
        s.hostname,
        s.safe_configuration_url,
        s.connected,
        s.decommissioned,
        s.internally_managed,
        s.replication_count,
        s.safe_fault,
        syncRunId
      ], true);
    }

    if (servers.length > 0) {
      const scope = servers[0].server_scope;
      const pairingId = servers[0].pairing_id || null;
      const vrmsId = servers[0].vrms_id || null;

      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("vr_replication_servers", row => {
          const r = R.rowContext(row, "vr_replication_servers");

          return R.binary("AND", R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("=", R.ref(r, "server_scope", null), p[1])), R.binary("=", R.fn("coalesce", [R.ref(r, "pairing_id", null), ""]), R.fn("coalesce", [p[2], ""]))), R.binary("=", R.fn("coalesce", [R.ref(r, "vrms_id", null), ""]), R.fn("coalesce", [p[3], ""]))), R.binary("!=", R.ref(r, "sync_run_id", null), p[4]));
        }, row => {
          const r = R.rowContext(row, "vr_replication_servers");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        scope,
        pairingId || '',
        vrmsId || '',
        syncRunId
      ], true);
    }
  }
    async upsertPairingIssues(connectionId, pairingId, issues, syncRunId, client = pool) {
    for (const i of issues) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_pairing_issues", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], true, p[10], s.now(), s.now()]].map(a => Object.fromEntries(["connection_id", "pairing_id", "issue_fingerprint", "entity", "entity_name", "description", "occurred_at", "raw_status", "severity", "issue_type", "is_present", "sync_run_id", "first_seen_at", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_pairing_issues");

            return [
              R.ref(r, "connection_id", null),
              R.ref(r, "pairing_id", null),
              R.ref(r, "issue_fingerprint", null)
            ];
          },

          change: (old, row) => {
            const r = R.rowContext(old, "vr_pairing_issues", {
              excluded: row
            });

            return {
              "entity_name": R.fn("coalesce", [
                R.ref(r, "entity_name", "excluded"),
                R.ref(r, "entity_name", "vr_pairing_issues")
              ]),
              "is_present": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        pairingId,
        i.issue_fingerprint,
        i.entity,
        i.entity_name,
        i.description,
        i.occurred_at,
        i.raw_status,
        i.severity,
        i.issue_type,
        syncRunId
      ], true);
    }

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_pairing_issues", row => {
        const r = R.rowContext(row, "vr_pairing_issues");

        return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("=", R.ref(r, "pairing_id", null), p[1])), R.binary("!=", R.ref(r, "sync_run_id", null), p[2]));
      }, row => {
        const r = R.rowContext(row, "vr_pairing_issues");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [
      connectionId,
      pairingId,
      syncRunId
    ], true);
  }
    async upsertReplicationIssues(connectionId, pairingId, issues, syncRunId, client = pool) {
    for (const i of issues) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_replication_issues", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], true, p[14], s.now(), s.now()]].map(a => Object.fromEntries(["connection_id", "pairing_id", "replication_id", "canonical_replication_key", "direction", "mapping_status", "issue_fingerprint", "entity", "entity_name", "description", "occurred_at", "raw_status", "severity", "issue_type", "is_present", "sync_run_id", "first_seen_at", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_replication_issues");

            return [
              R.ref(r, "connection_id", null),
              R.ref(r, "pairing_id", null),
              R.ref(r, "issue_fingerprint", null)
            ];
          },

          change: (old, row) => {
            const r = R.rowContext(old, "vr_replication_issues", {
              excluded: row
            });

            return {
              "mapping_status": R.ref(r, "mapping_status", "excluded"),
              "replication_id": R.fn("coalesce", [
                R.ref(r, "replication_id", "excluded"),
                R.ref(r, "replication_id", "vr_replication_issues")
              ]),
              "canonical_replication_key": R.fn("coalesce", [
                R.ref(r, "canonical_replication_key", "excluded"),
                R.ref(r, "canonical_replication_key", "vr_replication_issues")
              ]),
              "direction": R.fn("coalesce", [
                R.ref(r, "direction", "excluded"),
                R.ref(r, "direction", "vr_replication_issues")
              ]),
              "entity_name": R.fn("coalesce", [
                R.ref(r, "entity_name", "excluded"),
                R.ref(r, "entity_name", "vr_replication_issues")
              ]),
              "is_present": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        pairingId,
        i.replication_id,
        i.canonical_replication_key,
        i.direction,
        i.mapping_status,
        i.issue_fingerprint,
        i.entity,
        i.entity_name,
        i.description,
        i.occurred_at,
        i.raw_status,
        i.severity,
        i.issue_type,
        syncRunId
      ], true);
    }

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_replication_issues", row => {
        const r = R.rowContext(row, "vr_replication_issues");

        return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("=", R.ref(r, "pairing_id", null), p[1])), R.binary("!=", R.ref(r, "sync_run_id", null), p[2]));
      }, row => {
        const r = R.rowContext(row, "vr_replication_issues");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [
      connectionId,
      pairingId,
      syncRunId
    ], true);
  }
    async upsertTasks(connectionId, tasks, syncRunId, client = pool) {
    // 1. Mark everything as not recent
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_tasks", row => {
        const r = R.rowContext(row, "vr_tasks");

        return R.binary(
          "=",
          R.ref(r, "connection_id", null),
          p[0]
        );
      }, row => {
        const r = R.rowContext(row, "vr_tasks");

        return {
          "is_recent": false
        };
      });

      return R.changed(rows.length);
    }, [connectionId], true);

    // 2. Upsert current snapshot, marking them as recent
    for (const t of tasks) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vr_tasks", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], p[14], p[15], p[16], p[17], true, p[18], s.now(), s.now()]].map(a => Object.fromEntries(["connection_id", "task_id", "description", "description_id", "entity", "entity_name", "raw_status", "normalized_status", "progress_percent", "queued_at", "started_at", "completed_at", "safe_error_message", "safe_error_details", "safe_result_summary", "result_truncated", "normalization_status", "normalization_error_code", "is_recent", "sync_run_id", "first_seen_at", "last_seen_at"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vr_tasks");

            return [
              R.ref(r, "connection_id", null),
              R.ref(r, "task_id", null)
            ];
          },

          change: (old, row) => {
            const r = R.rowContext(old, "vr_tasks", {
              excluded: row
            });

            return {
              "description": R.fn("coalesce", [
                R.ref(r, "description", "excluded"),
                R.ref(r, "description", "vr_tasks")
              ]),
              "raw_status": R.ref(r, "raw_status", "excluded"),
              "normalized_status": R.ref(r, "normalized_status", "excluded"),
              "progress_percent": R.ref(r, "progress_percent", "excluded"),
              "started_at": R.fn("coalesce", [
                R.ref(r, "started_at", "excluded"),
                R.ref(r, "started_at", "vr_tasks")
              ]),
              "completed_at": R.fn("coalesce", [
                R.ref(r, "completed_at", "excluded"),
                R.ref(r, "completed_at", "vr_tasks")
              ]),
              "safe_error_message": R.ref(r, "safe_error_message", "excluded"),
              "safe_error_details": R.ref(r, "safe_error_details", "excluded"),
              "safe_result_summary": R.ref(r, "safe_result_summary", "excluded"),
              "result_truncated": R.ref(r, "result_truncated", "excluded"),
              "normalization_status": R.ref(r, "normalization_status", "excluded"),
              "normalization_error_code": R.ref(r, "normalization_error_code", "excluded"),
              "is_recent": true,
              "sync_run_id": R.ref(r, "sync_run_id", "excluded"),
              "last_seen_at": s.now()
            };
          }
        });

        return R.changed(rows.length);
      }, [
        connectionId,
        t.task_id,
        t.description,
        t.description_id,
        t.entity,
        t.entity_name,
        t.raw_status,
        t.normalized_status,
        t.progress_percent,
        t.queued_at,
        t.started_at,
        t.completed_at,
        t.safe_error_message,
        t.safe_error_details,
        t.safe_result_summary,
        t.result_truncated,
        t.normalization_status,
        t.normalization_error_code,
        syncRunId
      ], true);
    }
  }
    async updateVisibilitySyncState(connectionId, status, syncRunId, statuses, counts, client = pool) {
    const {
      vrInfo,
      managementServers,
      replicationServers,
      pairingIssues,
      replicationIssues,
      tasks
    } = statuses;

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vr_sync_state", row => {
        const r = R.rowContext(row, "vr_sync_state");

        return R.binary(
          "=",
          R.ref(r, "connection_id", null),
          p[11]
        );
      }, row => {
        const r = R.rowContext(row, "vr_sync_state");

        return {
          "visibility_sync_status": p[0],
          "visibility_sync_run_id": p[1],
          "vr_info_sync_status": p[2],
          "management_servers_sync_status": p[3],
          "replication_servers_sync_status": p[4],
          "pairing_issues_sync_status": p[5],
          "replication_issues_sync_status": p[6],
          "tasks_sync_status": p[7],
          "last_issue_count": p[8],
          "last_server_count": p[9],
          "last_task_count": p[10],
          "updated_at": s.now()
        };
      });

      return R.changed(rows.length);
    }, [
      status,
      syncRunId,
      vrInfo,
      managementServers,
      replicationServers,
      pairingIssues,
      replicationIssues,
      tasks,
      counts.issues,
      counts.servers,
      counts.tasks,
      connectionId
    ], true);
  }
    async getIssues(connectionId = null, client = pool) {
    let where = connectionId ? 'AND connection_id = $1' : '';
    let params = connectionId ? [connectionId] : [];

    const pIssues = await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((() => {
        let rows = [R.context(null)];

        rows = R.join(rows, "current_vr_pairing_issues", r => views["current_vr_pairing_issues"] || s.read("current_vr_pairing_issues"), r => true, "INNER JOIN");

        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", null), true), R.binary("OR", R.unary("IS NULL", p[0]), R.binary("=", R.ref(r, "connection_id", null), p[0]))));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(null);

          return R.expand({
            ...R.star(r, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([
          [R.ref(a.r, "occurred_at", null), R.ref(b.r, "occurred_at", null), "DESC", "LAST"]
        ]));

        return result.slice(0).map(x => x.value);
      })());
    }, [connectionId], false);

    const rIssues = await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((() => {
        let rows = [R.context(null)];

        rows = R.join(rows, "current_vr_replication_issues", r => views["current_vr_replication_issues"] || s.read("current_vr_replication_issues"), r => true, "INNER JOIN");

        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", null), true), R.binary("OR", R.unary("IS NULL", p[0]), R.binary("=", R.ref(r, "connection_id", null), p[0]))));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(null);

          return R.expand({
            ...R.star(r, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([
          [R.ref(a.r, "occurred_at", null), R.ref(b.r, "occurred_at", null), "DESC", "LAST"]
        ]));

        return result.slice(0).map(x => x.value);
      })());
    }, [connectionId], false);

    return {
      pairingIssues: pIssues.rows,
      replicationIssues: rIssues.rows
    };
  }
    async getServers(connectionId = null, client = pool) {
    let where = connectionId ? 'AND connection_id = $1' : '';
    let params = connectionId ? [connectionId] : [];

    const mgt = await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((() => {
        let rows = [R.context(null)];

        rows = R.join(rows, "sub", r => (() => {
          let rows = [R.context(r)];

          rows = R.join(rows, "current_vr_management_servers", r => views["current_vr_management_servers"] || s.read("current_vr_management_servers"), r => true, "INNER JOIN");

          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", null), true), R.binary("OR", R.unary("IS NULL", p[0]), R.binary("=", R.ref(r, "connection_id", null), p[0]))));

          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(r);

            return R.expand({
              ...R.star(r, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([
            [R.ref(a.r, "vrms_id", null), R.ref(b.r, "vrms_id", null), "ASC", null],
            [R.ref(a.r, "server_scope", null), R.ref(b.r, "server_scope", null), "ASC", null]
          ]));

          result = R.unique(result, x => [
            R.ref(x.r, "vrms_id", null)
          ]);

          return result.slice(0).map(x => x.value);
        })(), r => true, "INNER JOIN");

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(null);

          return R.expand({
            ...R.star(r, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([
          [R.ref(a.r, "name", null), R.ref(b.r, "name", null), "ASC", null]
        ]));

        return result.slice(0).map(x => x.value);
      })());
    }, [connectionId], false);

    const rep = await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((() => {
        let rows = [R.context(null)];

        rows = R.join(rows, "sub", r => (() => {
          let rows = [R.context(r)];

          rows = R.join(rows, "current_vr_replication_servers", r => views["current_vr_replication_servers"] || s.read("current_vr_replication_servers"), r => true, "INNER JOIN");

          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", null), true), R.binary("OR", R.unary("IS NULL", p[0]), R.binary("=", R.ref(r, "connection_id", null), p[0]))));

          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(r);

            return R.expand({
              ...R.star(r, null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([
            [R.ref(a.r, "server_uuid", null), R.ref(b.r, "server_uuid", null), "ASC", null],
            [R.ref(a.r, "server_scope", null), R.ref(b.r, "server_scope", null), "ASC", null]
          ]));

          result = R.unique(result, x => [
            R.ref(x.r, "server_uuid", null)
          ]);

          return result.slice(0).map(x => x.value);
        })(), r => true, "INNER JOIN");

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(null);

          return R.expand({
            ...R.star(r, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([
          [R.ref(a.r, "name", null), R.ref(b.r, "name", null), "ASC", null]
        ]));

        return result.slice(0).map(x => x.value);
      })());
    }, [connectionId], false);

    return {
      managementServers: mgt.rows,
      replicationServers: rep.rows
    };
  }
    async getTasks(connectionId = null, query = {}, client = pool) {
    let params = [];

    if (connectionId) {
      params.push(connectionId);
    }

    if (query.taskId) {
      params.push(query.taskId);
    }

    const {
      rows
    } = await client.run(s => ({
      rows: s.read('current_vr_tasks')
        .filter(r =>
          r.is_recent &&
          (!connectionId || r.connection_id === Number(connectionId)) &&
          (!query.taskId || r.task_id === query.taskId)
        )
        .sort((a, b) => s.helpers.order([
          [a.started_at, b.started_at, 'DESC', 'LAST']
        ]))
        .slice(0, 1000)
    }), [], false);

    return rows;
  }
}

module.exports = new VRRepository();
