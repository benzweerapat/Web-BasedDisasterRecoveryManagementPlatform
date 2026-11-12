// Native record projections migrated from the original application.
module.exports = {
  "current_connections": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "c", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_active", "c"), true), R.binary("OR", R.binary("=", R.ref(r, "system_type", "c"), "VCENTER"), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["connections"] || s.read("connections"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), R.binary("=", R.ref(r, "is_active", "vc"), true)), R.binary("=", R.ref(r, "system_type", "vc"), "VCENTER")));
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
          ...R.star(r, "c")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vcenters": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "v", r => views["vcenters"] || s.read("vcenters"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "v")), R.binary("=", R.ref(r, "base_url", "c"), R.ref(r, "vcenter_id", "v"))), R.binary("=", R.ref(r, "system_type", "c"), "VCENTER")), "INNER JOIN");
      rows = rows.filter(r => R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_update", "v"), R.ref(r, "scope_invalidated_at", "c"))));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "v")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_virtual_machines": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["virtual_machines"] || s.read("virtual_machines"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_hosts": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["hosts"] || s.read("hosts"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_clusters": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["clusters"] || s.read("clusters"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_datacenters": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["datacenters"] || s.read("datacenters"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_datastores": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["datastores"] || s.read("datastores"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_networks": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["networks"] || s.read("networks"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_resource_pools": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["resource_pools"] || s.read("resource_pools"), r => true, "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "vc", r => views["current_vcenters"] || s.read("current_vcenters"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "vcenter_id", "vc"), R.ref(r, "vcenter_id", "t")));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_pairings": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "p", r => views["vr_pairings"] || s.read("vr_pairings"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "p"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "p"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "p"), R.ref(r, "scope_invalidated_at", "vc")))));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "p")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_sync_state": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "s", r => views["vr_sync_state"] || s.read("vr_sync_state"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "s")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_sync_started_at", "s"), R.ref(r, "scope_invalidated_at", "c"))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_sync_started_at", "s"), R.ref(r, "scope_invalidated_at", "vc")))));
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
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_site_pairs": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "p", r => views["srm_site_pairs"] || s.read("srm_site_pairs"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "p"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "p"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "p"), R.ref(r, "scope_invalidated_at", "vc")))));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "p")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_sync_state": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "s", r => views["srm_sync_state"] || s.read("srm_sync_state"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "s")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_sync_started_at", "s"), R.ref(r, "scope_invalidated_at", "c"))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_sync_started_at", "s"), R.ref(r, "scope_invalidated_at", "vc")))));
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
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_replications": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["vr_replications"] || s.read("vr_replications"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_pairing_issues": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["vr_pairing_issues"] || s.read("vr_pairing_issues"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_replication_issues": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["vr_replication_issues"] || s.read("vr_replication_issues"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      })(r).length > 0), R.binary("OR", R.binary("AND", R.unary("IS NULL", R.ref(r, "replication_id", "t")), R.unary("IS NULL", R.ref(r, "canonical_replication_key", "t"))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "r", r => views["current_vr_replications"] || s.read("current_vr_replications"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "r"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "r"), R.ref(r, "pairing_id", "t"))), R.binary("OR", R.binary("AND", R.unary("IS NOT NULL", R.ref(r, "replication_id", "t")), R.binary("=", R.ref(r, "replication_id", "r"), R.ref(r, "replication_id", "t"))), R.binary("AND", R.unary("IS NULL", R.ref(r, "replication_id", "t")), R.binary("=", R.ref(r, "canonical_replication_key", "r"), R.ref(r, "canonical_replication_key", "t"))))));
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
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_management_servers": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["vr_management_servers"] || s.read("vr_management_servers"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "pairing_id", "t")), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_replication_servers": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["vr_replication_servers"] || s.read("vr_replication_servers"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "pairing_id", "t")), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_servers": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_servers"] || s.read("srm_servers"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "pairing_id", "t")), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_protection_groups": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_protection_groups"] || s.read("srm_protection_groups"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_recovery_plans": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_recovery_plans"] || s.read("srm_recovery_plans"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_protected_vms": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_protected_vms"] || s.read("srm_protected_vms"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))), R.binary("=", R.ref(r, "protection_group_id", "p"), R.ref(r, "protection_group_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_recovery_plan_vms": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_recovery_plan_vms"] || s.read("srm_recovery_plan_vms"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))), R.binary("=", R.ref(r, "recovery_plan_id", "p"), R.ref(r, "recovery_plan_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_recovery_plan_groups": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_recovery_plan_groups"] || s.read("srm_recovery_plan_groups"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))), R.binary("=", R.ref(r, "recovery_plan_id", "p"), R.ref(r, "recovery_plan_id", "t"))));
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
      })(r).length > 0), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))), R.binary("=", R.ref(r, "protection_group_id", "p"), R.ref(r, "protection_group_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_inventory_mappings": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_inventory_mappings"] || s.read("srm_inventory_mappings"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_placeholder_datastores": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_placeholder_datastores"] || s.read("srm_placeholder_datastores"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "pairing_id", "t")), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_issues": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_issues"] || s.read("srm_issues"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_present", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "pairing_id", "t")), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
      })(r).length > 0)), R.binary("OR", R.binary("OR", R.binary("NOT IN", R.ref(r, "issue_scope", "t"), ["PROTECTION_GROUP", "RECOVERY_PLAN"]), R.binary("AND", R.binary("=", R.ref(r, "issue_scope", "t"), "PROTECTION_GROUP"), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))), R.binary("=", R.ref(r, "protection_group_id", "p"), R.ref(r, "source_entity_id", "t"))));
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
      })(r).length > 0)), R.binary("AND", R.binary("=", R.ref(r, "issue_scope", "t"), "RECOVERY_PLAN"), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))), R.binary("=", R.ref(r, "recovery_plan_id", "p"), R.ref(r, "source_entity_id", "t"))));
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
      })(r).length > 0))));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_vr_tasks": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["vr_tasks"] || s.read("vr_tasks"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "VR")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_recent", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), true));
      let groups = rows.map(r => [r]);
      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);
        return R.expand({
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  },
  "current_srm_tasks": (s, p) => {
    const R = s.helpers;
    const views = {};
    return R.result((parent => {
      let rows = [R.context(parent)];
      rows = R.join(rows, "t", r => views["srm_tasks"] || s.read("srm_tasks"), r => true, "INNER JOIN");
      rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("AND", R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "system_type", "c"), "SRM")), "INNER JOIN");
      rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "INNER JOIN");
      rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "is_recent", "t"), true), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "c")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "c")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "scope_invalidated_at", "vc")), R.binary(">=", R.ref(r, "last_seen_at", "t"), R.ref(r, "scope_invalidated_at", "vc")))), R.binary("OR", R.unary("IS NULL", R.ref(r, "pairing_id", "t")), (parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "t")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "t"))));
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
          ...R.star(r, "t")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });
      return result.slice(0).map(x => x.value);
    })(null));
  }
};
