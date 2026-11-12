const db = require('../../db');

class InventoryRepository {
  async upsertVCenterSummary(connectionId, summaryData, client = db) {
    if (!summaryData) return;

    // Preserve previous endpoint summaries; current_vcenters excludes endpoint mismatches.

    const values = [summaryData.vcenter_id, connectionId, summaryData.display_name, summaryData.fqdn, summaryData.site_role, summaryData.cluster_count, summaryData.host_count, summaryData.vm_count, summaryData.datastore_count, summaryData.product_name || null, summaryData.version || null, summaryData.build || null, summaryData.health_status || null, summaryData.database_health || null, summaryData.storage_health || null, summaryData.memory_health || null, summaryData.load_health || null, summaryData.uptime_seconds || null, summaryData.last_health_sync_at || null];

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("vcenters", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], s.now(), "CONNECTED", p[9], p[10], p[11], p[12], p[13], p[14], p[15], p[16], p[17], p[18]]].map(a => Object.fromEntries(["vcenter_id", "connection_id", "display_name", "fqdn", "site_role", "cluster_count", "host_count", "vm_count", "datastore_count", "last_update", "status", "product_name", "version", "build", "health_status", "database_health", "storage_health", "memory_health", "load_health", "uptime_seconds", "last_health_sync_at"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "vcenters");
          return [R.ref(r, "vcenter_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "vcenters", {
            excluded: row
          });

          return {
            "connection_id": R.ref(r, "connection_id", "excluded"),
            "display_name": R.ref(r, "display_name", "excluded"),
            "fqdn": R.ref(r, "fqdn", "excluded"),
            "site_role": R.ref(r, "site_role", "excluded"),
            "cluster_count": R.ref(r, "cluster_count", "excluded"),
            "host_count": R.ref(r, "host_count", "excluded"),
            "vm_count": R.ref(r, "vm_count", "excluded"),
            "datastore_count": R.ref(r, "datastore_count", "excluded"),
            "last_update": s.now(),
            "status": "CONNECTED",
            "product_name": R.fn("coalesce", [R.ref(r, "product_name", "excluded"), R.ref(r, "product_name", "vcenters")]),
            "version": R.fn("coalesce", [R.ref(r, "version", "excluded"), R.ref(r, "version", "vcenters")]),
            "build": R.fn("coalesce", [R.ref(r, "build", "excluded"), R.ref(r, "build", "vcenters")]),
            "health_status": R.fn("coalesce", [R.ref(r, "health_status", "excluded"), R.ref(r, "health_status", "vcenters")]),
            "database_health": R.fn("coalesce", [R.ref(r, "database_health", "excluded"), R.ref(r, "database_health", "vcenters")]),
            "storage_health": R.fn("coalesce", [R.ref(r, "storage_health", "excluded"), R.ref(r, "storage_health", "vcenters")]),
            "memory_health": R.fn("coalesce", [R.ref(r, "memory_health", "excluded"), R.ref(r, "memory_health", "vcenters")]),
            "load_health": R.fn("coalesce", [R.ref(r, "load_health", "excluded"), R.ref(r, "load_health", "vcenters")]),
            "uptime_seconds": R.fn("coalesce", [R.ref(r, "uptime_seconds", "excluded"), R.ref(r, "uptime_seconds", "vcenters")]),
            "last_health_sync_at": R.fn("coalesce", [R.ref(r, "last_health_sync_at", "excluded"), R.ref(r, "last_health_sync_at", "vcenters")])
          };
        }
      });

      return R.changed(rows.length);
    }, values, true);
  }
    async upsertVirtualMachines(vcenterId, vmList, client = db) {
    if (!vmList || vmList.length === 0) return;

    // We update multiple rows in batch using unnest. 
    // Basic fields only first, detailed fields in another method.
    const vm_ids = vmList.map(vm => vm.vm);
    const names = vmList.map(vm => vm.name || '');
    const power_states = vmList.map(vm => vm.power_state || 'UNKNOWN');
    const cpus = vmList.map(vm => parseInt(vm.cpu_count) || 0);
    const rams = vmList.map(vm => parseFloat(vm.memory_size_MiB) || 0.0);
    const values = [vcenterId, vm_ids, names, power_states, cpus, rams];

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("virtual_machines", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_3": R.fn("unnest", [R.cast(p[3], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_4": R.fn("unnest", [R.cast(p[4], {
              "kind": "array",
              "arrayOf": {
                "name": "int"
              }
            })]),
            "unnest_5": R.fn("unnest", [R.cast(p[5], {
              "kind": "array",
              "arrayOf": {
                "name": "real"
              }
            })]),
            "?column?6": true
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "vm_id", "name", "power_state", "cpu", "ram", "is_present"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "virtual_machines");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "vm_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "virtual_machines", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "power_state": R.ref(r, "power_state", "excluded"),
            "cpu": R.ref(r, "cpu", "excluded"),
            "ram": R.ref(r, "ram", "excluded"),
            "is_present": true
          };
        }
      });

      return R.changed(rows.length);
    }, values, true);
  }
    async upsertVirtualMachineDetails(vcenterId, vmDetailsList, client = db) {
    if (!vmDetailsList || vmDetailsList.length === 0) return;

    for (const vm of vmDetailsList) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("virtual_machines", row => {
          const r = R.rowContext(row, "virtual_machines");
          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[21]), R.binary("=", R.ref(r, "vm_id", null), p[22]));
        }, row => {
          const r = R.rowContext(row, "virtual_machines");

          return {
            "host_moid": p[0],
            "resource_pool_moid": p[1],
            "guest_os_id": p[2],
            "guest_os_full_name": p[3],
            "dns_name": p[4],
            "primary_ip": p[5],
            "ip_addresses": R.cast(p[6], {
              "name": "jsonb"
            }),
            "tools_running_status": p[7],
            "tools_version_status": p[8],
            "hardware_version": p[9],
            "configured_vcpu": p[10],
            "configured_memory_mib": p[11],
            "cpu_usage_mhz": p[12],
            "memory_usage_mib": p[13],
            "storage_committed_bytes": p[14],
            "storage_uncommitted_bytes": p[15],
            "detail_status": p[16],
            "cluster_moid": p[17],
            "parent_folder_moid": p[18],
            "usage_sampled_at": p[19],
            "detail_error_code": p[20],
            "detail_updated_at": s.now(),
            "guest_data_updated_at": s.now(),
            "last_seen_at": s.now()
          };
        });

        return R.changed(rows.length);
      }, [vm.host || null, vm.resourcePool || null, vm.guestOsId || null, vm.guestOsFullName || null, vm.dnsName || null, vm.primaryIp || null, vm.ipAddresses ? JSON.stringify(vm.ipAddresses) : null, vm.toolsRunningStatus || null, vm.toolsVersionStatus || null, vm.hardwareVersion || null, vm.configuredVcpu || null, vm.configuredMemoryMib || null, vm.cpuUsageMhz || null, vm.memoryUsageMib || null, vm.storageCommittedBytes || null, vm.storageUncommittedBytes || null, vm.detailStatus || 'COLLECTED', vm.cluster || null, vm.parentFolder || null, vm.usageSampledAt || null, vm.detailErrorCode || null, vcenterId, vm.vm], true);
    }
  }
    async upsertVmDatastores(vcenterId, vmDatastoresList, client = db) {
    if (!vmDatastoresList || vmDatastoresList.length === 0) return;

    for (const mapping of vmDatastoresList) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vm_datastore_mappings", [[p[0], p[1], p[2], true]].map(a => Object.fromEntries(["vcenter_id", "vm_moid", "datastore_moid", "is_present"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vm_datastore_mappings");
            return [R.ref(r, "vcenter_id", null), R.ref(r, "vm_moid", null), R.ref(r, "datastore_moid", null)];
          },
          change: (old, row) => {
            const r = R.rowContext(old, "vm_datastore_mappings", {
              excluded: row
            });

            return {
              "is_present": true
            };
          }
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.vm, mapping.datastore], true);
    }
  }
    async markStaleVmDatastores(vcenterId, activeVmDatastorePairs, client = db) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vm_datastore_mappings", row => {
        const r = R.rowContext(row, "vm_datastore_mappings");
        return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "vm_datastore_mappings");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [vcenterId], true);

    for (const mapping of activeVmDatastorePairs) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("vm_datastore_mappings", row => {
          const r = R.rowContext(row, "vm_datastore_mappings");

          return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.binary("=", R.ref(r, "vm_moid", null), p[1])), R.binary("=", R.ref(r, "datastore_moid", null), p[2]));
        }, row => {
          const r = R.rowContext(row, "vm_datastore_mappings");

          return {
            "is_present": true
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.vm, mapping.datastore], true);
    }
  }
    async upsertVmNetworks(vcenterId, vmNetworksList, client = db) {
    if (!vmNetworksList || vmNetworksList.length === 0) return;

    for (const mapping of vmNetworksList) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("vm_network_mappings", [[p[0], p[1], p[2], true]].map(a => Object.fromEntries(["vcenter_id", "vm_moid", "network_moid", "is_present"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "vm_network_mappings");
            return [R.ref(r, "vcenter_id", null), R.ref(r, "vm_moid", null), R.ref(r, "network_moid", null)];
          },
          change: (old, row) => {
            const r = R.rowContext(old, "vm_network_mappings", {
              excluded: row
            });

            return {
              "is_present": true
            };
          }
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.vm, mapping.network], true);
    }
  }
    async markStaleVmNetworks(vcenterId, activeVmNetworkPairs, client = db) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("vm_network_mappings", row => {
        const r = R.rowContext(row, "vm_network_mappings");
        return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "vm_network_mappings");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [vcenterId], true);

    for (const mapping of activeVmNetworkPairs) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("vm_network_mappings", row => {
          const r = R.rowContext(row, "vm_network_mappings");

          return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.binary("=", R.ref(r, "vm_moid", null), p[1])), R.binary("=", R.ref(r, "network_moid", null), p[2]));
        }, row => {
          const r = R.rowContext(row, "vm_network_mappings");

          return {
            "is_present": true
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.vm, mapping.network], true);
    }
  }
    async upsertHostDatastores(vcenterId, hostDatastoresList, client = db) {
    if (!hostDatastoresList || hostDatastoresList.length === 0) return;

    for (const mapping of hostDatastoresList) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("host_datastore_mappings", [[p[0], p[1], p[2], true]].map(a => Object.fromEntries(["vcenter_id", "host_moid", "datastore_moid", "is_present"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "host_datastore_mappings");
            return [R.ref(r, "vcenter_id", null), R.ref(r, "host_moid", null), R.ref(r, "datastore_moid", null)];
          },
          change: (old, row) => {
            const r = R.rowContext(old, "host_datastore_mappings", {
              excluded: row
            });

            return {
              "is_present": true
            };
          }
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.host, mapping.datastore], true);
    }
  }
    async markStaleHostDatastores(vcenterId, activeHostDatastorePairs, client = db) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("host_datastore_mappings", row => {
        const r = R.rowContext(row, "host_datastore_mappings");
        return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "host_datastore_mappings");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [vcenterId], true);

    for (const mapping of activeHostDatastorePairs) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("host_datastore_mappings", row => {
          const r = R.rowContext(row, "host_datastore_mappings");

          return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.binary("=", R.ref(r, "host_moid", null), p[1])), R.binary("=", R.ref(r, "datastore_moid", null), p[2]));
        }, row => {
          const r = R.rowContext(row, "host_datastore_mappings");

          return {
            "is_present": true
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.host, mapping.datastore], true);
    }
  }
    async upsertHostNetworks(vcenterId, hostNetworksList, client = db) {
    if (!hostNetworksList || hostNetworksList.length === 0) return;

    for (const mapping of hostNetworksList) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert("host_network_mappings", [[p[0], p[1], p[2], true]].map(a => Object.fromEntries(["vcenter_id", "host_moid", "network_moid", "is_present"].map((k, i) => [k, a[i]]))), {
          key: row => {
            const r = R.rowContext(row, "host_network_mappings");
            return [R.ref(r, "vcenter_id", null), R.ref(r, "host_moid", null), R.ref(r, "network_moid", null)];
          },
          change: (old, row) => {
            const r = R.rowContext(old, "host_network_mappings", {
              excluded: row
            });

            return {
              "is_present": true
            };
          }
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.host, mapping.network], true);
    }
  }
    async markStaleHostNetworks(vcenterId, activeHostNetworkPairs, client = db) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("host_network_mappings", row => {
        const r = R.rowContext(row, "host_network_mappings");
        return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "host_network_mappings");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [vcenterId], true);

    for (const mapping of activeHostNetworkPairs) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("host_network_mappings", row => {
          const r = R.rowContext(row, "host_network_mappings");

          return R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.binary("=", R.ref(r, "host_moid", null), p[1])), R.binary("=", R.ref(r, "network_moid", null), p[2]));
        }, row => {
          const r = R.rowContext(row, "host_network_mappings");

          return {
            "is_present": true
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, mapping.host, mapping.network], true);
    }
  }
    async upsertNetworks(vcenterId, list, client = db) {
    if (!list || list.length === 0) return;

    const ids = list.map(i => i.network);
    const names = list.map(i => i.name || '');

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("networks", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })])
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "network_id", "name"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "networks");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "network_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "networks", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "last_updated": s.now()
          };
        }
      });

      return R.changed(rows.length);
    }, [vcenterId, ids, names], true);
  }
    async markStaleNetworks(vcenterId, activeList, client = db) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("networks", row => {
        const r = R.rowContext(row, "networks");
        return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "networks");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [vcenterId], true);

    if (activeList && activeList.length > 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("networks", row => {
          const r = R.rowContext(row, "networks");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("=", R.ref(r, "network_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "any"));
        }, row => {
          const r = R.rowContext(row, "networks");

          return {
            "is_present": true
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeList], true);
    }
  }
    async upsertDatacenters(vcenterId, list, client = db) {
    if (!list || list.length === 0) return;

    const ids = list.map(i => i.datacenter);
    const names = list.map(i => i.name || '');

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("datacenters", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })])
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "datacenter_id", "name"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "datacenters");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "datacenter_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "datacenters", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "last_updated": s.now()
          };
        }
      });

      return R.changed(rows.length);
    }, [vcenterId, ids, names], true);
  }
    async upsertResourcePools(vcenterId, list, client = db) {
    if (!list || list.length === 0) return;

    const ids = list.map(i => i.resource_pool || i.resourcePool);
    const names = list.map(i => i.name || '');

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("resource_pools", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })])
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "pool_id", "name"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "resource_pools");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "pool_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "resource_pools", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "is_present": true
          };
        }
      });

      return R.changed(rows.length);
    }, [vcenterId, ids, names], true);
  }
    async markStaleResourcePools(vcenterId, activeList, client = db) {
    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update("resource_pools", row => {
        const r = R.rowContext(row, "resource_pools");
        return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
      }, row => {
        const r = R.rowContext(row, "resource_pools");

        return {
          "is_present": false
        };
      });

      return R.changed(rows.length);
    }, [vcenterId], true);

    if (activeList && activeList.length > 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("resource_pools", row => {
          const r = R.rowContext(row, "resource_pools");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("=", R.ref(r, "pool_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "any"));
        }, row => {
          const r = R.rowContext(row, "resource_pools");

          return {
            "is_present": true
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeList], true);
    }
  }
    async upsertClusters(vcenterId, list, client = db) {
    if (!list || list.length === 0) return;

    const ids = list.map(i => i.cluster);
    const names = list.map(i => i.name || '');

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("clusters", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })])
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "cluster_id", "name"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "clusters");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "cluster_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "clusters", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "last_updated": s.now()
          };
        }
      });

      return R.changed(rows.length);
    }, [vcenterId, ids, names], true);
  }
    async upsertHosts(vcenterId, list, client = db) {
    if (!list || list.length === 0) return;

    const ids = list.map(i => i.host);
    const names = list.map(i => i.name || '');
    const cstates = list.map(i => i.connection_state || 'UNKNOWN');
    const pstates = list.map(i => i.power_state || 'UNKNOWN');

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("hosts", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_3": R.fn("unnest", [R.cast(p[3], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_4": R.fn("unnest", [R.cast(p[4], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })])
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "host_id", "name", "connection_state", "power_state"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "hosts");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "host_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "hosts", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "connection_state": R.ref(r, "connection_state", "excluded"),
            "power_state": R.ref(r, "power_state", "excluded"),
            "last_updated": s.now()
          };
        }
      });

      return R.changed(rows.length);
    }, [vcenterId, ids, names, cstates, pstates], true);
  }
    async upsertHostDetails(vcenterId, hostDetailsList, client = db) {
    if (!hostDetailsList || hostDetailsList.length === 0) return;

    for (const host of hostDetailsList) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("hosts", row => {
          const r = R.rowContext(row, "hosts");
          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[26]), R.binary("=", R.ref(r, "host_id", null), p[27]));
        }, row => {
          const r = R.rowContext(row, "hosts");

          return {
            "cluster_moid": p[0],
            "vendor": p[1],
            "model": p[2],
            "cpu_model": p[3],
            "cpu_mhz": p[4],
            "cpu_cores": p[5],
            "cpu_threads": p[6],
            "total_memory_bytes": p[7],
            "cpu_usage_mhz": p[8],
            "memory_usage_mib": p[9],
            "esxi_version": p[10],
            "esxi_build": p[11],
            "overall_status": p[12],
            "cpu_packages": p[13],
            "esxi_product_name": p[14],
            "esxi_full_name": p[15],
            "pnic_count": p[16],
            "hba_count": p[17],
            "lun_count": p[18],
            "vswitch_count": p[19],
            "vnic_count": p[20],
            "last_updated": s.now(),
            "last_seen_at": s.now(),
            "hba_list": R.cast(p[21], {
              "name": "jsonb"
            }),
            "lun_list": R.cast(p[22], {
              "name": "jsonb"
            }),
            "vswitch_list": R.cast(p[23], {
              "name": "jsonb"
            }),
            "vnic_list": R.cast(p[24], {
              "name": "jsonb"
            }),
            "pnic_list": R.cast(p[25], {
              "name": "jsonb"
            })
          };
        });

        return R.changed(rows.length);
      }, [host.cluster || null, host.vendor || null, host.model || null, host.cpuModel || null, host.cpuMhz || null, host.cpuCores || null, host.cpuThreads || null, host.totalMemoryBytes || null, host.cpuUsageMhz || null, host.memoryUsageMib || null, host.esxiVersion || null, host.esxiBuild || null, host.overallStatus || null, host.cpuPackages || null, host.esxiProductName || null, host.esxiFullName || null, host.pnicCount || 0, host.hbaCount || 0, host.lunCount || 0, host.vswitchCount || 0, host.vnicCount || 0, JSON.stringify(host.hbaList || []), JSON.stringify(host.lunList || []), JSON.stringify(host.vswitchList || []), JSON.stringify(host.vnicList || []), JSON.stringify(host.pnicList || []), vcenterId, host.host], true);
    }
  }
    async upsertDatastores(vcenterId, list, client = db) {
    if (!list || list.length === 0) return;

    const ids = list.map(i => i.datastore);
    const names = list.map(i => i.name || '');
    const types = list.map(i => i.type || 'UNKNOWN');
    const caps = list.map(i => parseInt(i.capacity) || 0);
    const frees = list.map(i => parseInt(i.free_space) || 0);

    await client.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert("datastores", (parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "$1": p[0],
            "unnest": R.fn("unnest", [R.cast(p[1], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_2": R.fn("unnest", [R.cast(p[2], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_3": R.fn("unnest", [R.cast(p[3], {
              "kind": "array",
              "arrayOf": {
                "name": "text"
              }
            })]),
            "unnest_4": R.fn("unnest", [R.cast(p[4], {
              "kind": "array",
              "arrayOf": {
                "name": "bigint"
              }
            })]),
            "unnest_5": R.fn("unnest", [R.cast(p[5], {
              "kind": "array",
              "arrayOf": {
                "name": "bigint"
              }
            })])
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null).map(x => Object.values(x)).map(a => Object.fromEntries(["vcenter_id", "datastore_id", "name", "type", "capacity", "free_space"].map((k, i) => [k, a[i]]))), {
        key: row => {
          const r = R.rowContext(row, "datastores");
          return [R.ref(r, "vcenter_id", null), R.ref(r, "datastore_id", null)];
        },
        change: (old, row) => {
          const r = R.rowContext(old, "datastores", {
            excluded: row
          });

          return {
            "name": R.ref(r, "name", "excluded"),
            "type": R.ref(r, "type", "excluded"),
            "capacity": R.ref(r, "capacity", "excluded"),
            "free_space": R.ref(r, "free_space", "excluded"),
            "last_updated": s.now()
          };
        }
      });

      return R.changed(rows.length);
    }, [vcenterId, ids, names, types, caps, frees], true);
  }
    async markStaleDatacenters(vcenterId, activeIds, client = db) {
    if (activeIds.length === 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("datacenters", row => {
          const r = R.rowContext(row, "datacenters");
          return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
        }, row => {
          const r = R.rowContext(row, "datacenters");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId], true);
    } else {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("datacenters", row => {
          const r = R.rowContext(row, "datacenters");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("!=", R.ref(r, "datacenter_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "all"));
        }, row => {
          const r = R.rowContext(row, "datacenters");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeIds], true);
    }
  }
    async markStaleClusters(vcenterId, activeIds, client = db) {
    if (activeIds.length === 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("clusters", row => {
          const r = R.rowContext(row, "clusters");
          return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
        }, row => {
          const r = R.rowContext(row, "clusters");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId], true);
    } else {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("clusters", row => {
          const r = R.rowContext(row, "clusters");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("!=", R.ref(r, "cluster_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "all"));
        }, row => {
          const r = R.rowContext(row, "clusters");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeIds], true);
    }
  }
    async markStaleHosts(vcenterId, activeIds, client = db) {
    if (activeIds.length === 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("hosts", row => {
          const r = R.rowContext(row, "hosts");
          return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
        }, row => {
          const r = R.rowContext(row, "hosts");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId], true);
    } else {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("hosts", row => {
          const r = R.rowContext(row, "hosts");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("!=", R.ref(r, "host_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "all"));
        }, row => {
          const r = R.rowContext(row, "hosts");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeIds], true);
    }
  }
    async markStaleDatastores(vcenterId, activeIds, client = db) {
    if (activeIds.length === 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("datastores", row => {
          const r = R.rowContext(row, "datastores");
          return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
        }, row => {
          const r = R.rowContext(row, "datastores");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId], true);
    } else {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("datastores", row => {
          const r = R.rowContext(row, "datastores");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("!=", R.ref(r, "datastore_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "all"));
        }, row => {
          const r = R.rowContext(row, "datastores");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeIds], true);
    }
  }
    async markStaleVMs(vcenterId, activeVmIds, client = db) {
    if (activeVmIds.length === 0) {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("virtual_machines", row => {
          const r = R.rowContext(row, "virtual_machines");
          return R.binary("=", R.ref(r, "vcenter_id", null), p[0]);
        }, row => {
          const r = R.rowContext(row, "virtual_machines");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId], true);
    } else {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update("virtual_machines", row => {
          const r = R.rowContext(row, "virtual_machines");

          return R.binary("AND", R.binary("=", R.ref(r, "vcenter_id", null), p[0]), R.quantified("!=", R.ref(r, "vm_id", null), R.cast(p[1], {
            "kind": "array",
            "arrayOf": {
              "name": "text"
            }
          }), "all"));
        }, row => {
          const r = R.rowContext(row, "virtual_machines");

          return {
            "is_present": false
          };
        });

        return R.changed(rows.length);
      }, [vcenterId, activeVmIds], true);
    }
  }
    async getDashboardStats() {
    const scope = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => R.binary("=", R.ref(r, "connection_id", "vc"), R.ref(r, "id", "c")), "LEFT JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "system_type", "c"), "VCENTER"));

        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "known": R.binary("AND", R.binary(">", R.aggregate("count", g.filter(a => true).map(a => 1), false, null), 0), R.aggregate("bool_and", g.filter(a => true).map(a => R.unary("IS NOT NULL", R.ref(a, "vcenter_id", "vc"))), false, null))
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    if (!scope.rows[0]?.known) return Object.fromEntries(['datacenterCount', 'clusterCount', 'hostCount', 'datastoreCount', 'vmCount', 'poweredOnVmCount', 'poweredOffVmCount', 'configuredVcpuTotal', 'configuredMemoryMibTotal'].map(key => [key, null]));

    const dcResult = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_datacenters", r => views["current_datacenters"] || s.read("current_datacenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));

        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "cnt": R.aggregate("count", g.filter(a => true).map(a => 1), false, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const datacenterCount = parseInt(dcResult.rows[0].cnt);

    const clusterResult = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_clusters", r => views["current_clusters"] || s.read("current_clusters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));

        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "cnt": R.aggregate("count", g.filter(a => true).map(a => 1), false, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const clusterCount = parseInt(clusterResult.rows[0].cnt);

    const hostResult = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_hosts", r => views["current_hosts"] || s.read("current_hosts"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));

        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "cnt": R.aggregate("count", g.filter(a => true).map(a => 1), false, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const hostCount = parseInt(hostResult.rows[0].cnt);
        const datastoreResult = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_datastores", r => views["current_datastores"] || s.read("current_datastores"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));

        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "cnt": R.aggregate("count", g.filter(a => true).map(a => 1), false, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const datastoreCount = parseInt(datastoreResult.rows[0].cnt);

    const vmResult = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_virtual_machines", r => views["current_virtual_machines"] || s.read("current_virtual_machines"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));

        let groups = R.groups(rows, null);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "total_vms": R.aggregate("count", g.filter(a => true).map(a => 1), false, null),
            "on_vms": R.aggregate("sum", g.filter(a => true).map(a => R.binary("=", R.ref(a, "power_state", null), "POWERED_ON") ? 1 : 0), false, null),
            "off_vms": R.aggregate("sum", g.filter(a => true).map(a => R.binary("=", R.ref(a, "power_state", null), "POWERED_OFF") ? 1 : 0), false, null),
            "configured_vcpu_total": R.aggregate("sum", g.filter(a => true).map(a => R.fn("coalesce", [R.ref(a, "configured_vcpu", null), R.ref(a, "cpu", null)])), false, null),
            "configured_memory_mib_total": R.aggregate("sum", g.filter(a => true).map(a => R.fn("coalesce", [R.ref(a, "configured_memory_mib", null), R.ref(a, "ram", null)])), false, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const vm = vmResult.rows[0];

    return {
      datacenterCount,
      clusterCount,
      hostCount,
      datastoreCount,
      vmCount: parseInt(vm.total_vms) || 0,
      poweredOnVmCount: parseInt(vm.on_vms) || 0,
      poweredOffVmCount: parseInt(vm.off_vms) || 0,
      configuredVcpuTotal: parseInt(vm.configured_vcpu_total) || 0,
      configuredMemoryMibTotal: parseFloat(vm.configured_memory_mib_total) || 0.0
    };
  }
}

module.exports = new InventoryRepository();