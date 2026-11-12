const {
  pool
} = require('../../db');

const srmSyncService =
  require('../services/srm-sync.service');

const {
  resolveProtectionGroupsIdentity,
  resolveRecoveryPlansIdentity
} = require('../services/srm-identity.service');

const {
  resolveMappingSites
} = require('../services/mapping-resolution.service');

const vcenterObjectResolution =
  require('../services/vcenter-object-resolution.service');

const {
  getSrmFreshness
} = require('../services/collection-metadata.service');

const {
  buildFreshness,
  combineFreshness,
  deriveDataState,
  latestTimestamp
} = require('../services/data-freshness.service');

const {
  buildSafeError,
  sendReadResponse
} = require('../utils/api-response.util');

async function respondWithSrmCollection(
  res,
  data,
  scopeColumns,
  timestamps,
  options = {}
) {
  const lastCollectedAt =
    latestTimestamp(
      timestamps
    );

  let freshness;

  try {
    freshness =
      await getSrmFreshness(
        scopeColumns,
        lastCollectedAt
      );
  } catch (_error) {
    freshness =
      buildFreshness({
        lastCollectedAt,

        collectionErrorType:
          'BACKEND_ERROR',

        collectionErrorCode:
          'FRESHNESS_QUERY_FAILED'
      });
  }

  // Scope models and envelope must describe the same timestamps and collection result.
  if (
    data?.scopeStates
  ) freshness = combineFreshness(
    Object.values(
      data.scopeStates
    ).filter(
      s =>
        s.fetchStatus !==
        'UNSUPPORTED'
    )
  );
  else if (
    data?.scopeState
  ) freshness =
    data.scopeState;

  const dataState =
    options.canonicalState ===
      'CANONICAL_EMPTY_WITH_OBSERVATIONS'
      ? 'CANONICAL_EMPTY_WITH_OBSERVATIONS'
      : options.partial
        ? 'PARTIAL'
        : deriveDataState({
          hasData:
            options.hasData,

          observationCount:
            options.observationCount,

          canonicalCount:
            options.canonicalCount,

          freshnessStatus:
            freshness.freshnessStatus
        });

  const enriched =
    Array.isArray(data)
      ? data
      : {
        ...data,
        freshness,
        dataState
      };

  return sendReadResponse(
    res,
    enriched,
    {
      dataState,
      freshness
    }
  );
}

exports.syncSrm =
  async (
    req,
    res,
    next
  ) => {
    const {
      id
    } = req.params;

    try {
      const runId =
        `sync-srm-${Date.now()}`;

      const result =
        await srmSyncService
          .syncSrm(
            parseInt(id, 10),

            req.authUser
              ?.username ||
            req.session
              .user
              .username,

            runId,

            {
              requestedBy:
                req.authUser,

              requestId:
                req.id
            }
          );

      res.json({
        success: true,
        data: result,
        runId
      });
    } catch (error) {
      if (
        error.code ===
          'SYNC_IN_PROGRESS' ||
        error.message.includes(
          'SYNC_ALREADY_IN_PROGRESS'
        )
      ) {
        return res
          .status(409)
          .json(
            buildSafeError(
              req,
              {
                type:
                  'SYNC_IN_PROGRESS',

                code:
                  'SYNC_IN_PROGRESS',

                httpStatus: 409,

                safeMessage:
                  'Synchronization is already in progress. Please wait for the current operation to finish.'
              }
            )
          );
      }

      next(error);
    }
  };
  exports.getSitePairs =
  async (req, res) => {
    try {
      const {
        rows
      } = await pool.run(
        (s, p) => {
          const R = s.helpers;
          const views = {};

          return R.result((parent => {
            let rows = [
              R.context(parent)
            ];

            rows = R.join(
              rows,
              "current_srm_site_pairs",
              r =>
                views[
                  "current_srm_site_pairs"
                ] ||
                s.read(
                  "current_srm_site_pairs"
                ),
              r => true,
              "INNER JOIN"
            );

            rows = rows.filter(r =>
              R.binary(
                "=",
                R.ref(
                  r,
                  "is_present",
                  null
                ),
                true
              )
            );

            let groups =
              rows.map(r => [r]);

            let result =
              groups.flatMap(g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  ...R.star(
                    r,
                    null
                  )
                }).map(value => ({
                  value,

                  r:
                    R.projectContext(
                      r,
                      value
                    ),

                  g
                }));
              });

            result.sort(
              (a, b) =>
                R.order([
                  [
                    R.ref(
                      a.r,
                      "pairing_id",
                      null
                    ),
                    R.ref(
                      b.r,
                      "pairing_id",
                      null
                    ),
                    "ASC",
                    null
                  ],
                  [
                    R.ref(
                      a.r,
                      "last_seen_at",
                      null
                    ),
                    R.ref(
                      b.r,
                      "last_seen_at",
                      null
                    ),
                    "DESC",
                    null
                  ]
                ])
            );

            result = R.unique(
              result,
              x => [
                R.ref(
                  x.r,
                  "pairing_id",
                  null
                )
              ]
            );

            return result
              .slice(0)
              .map(x => x.value);
          })(null));
        },
        [],
        false
      );

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

exports.getSrmServers =
  async (req, res) => {
    try {
      const {
        rows
      } = await pool.run(
        (s, p) => {
          const R = s.helpers;
          const views = {};

          return R.result((parent => {
            let rows = [
              R.context(parent)
            ];

            rows = R.join(
              rows,
              "current_srm_servers",
              r =>
                views[
                  "current_srm_servers"
                ] ||
                s.read(
                  "current_srm_servers"
                ),
              r => true,
              "INNER JOIN"
            );

            rows = rows.filter(r =>
              R.binary(
                "=",
                R.ref(
                  r,
                  "is_present",
                  null
                ),
                true
              )
            );

            let groups =
              rows.map(r => [r]);

            let result =
              groups.flatMap(g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  ...R.star(
                    r,
                    null
                  )
                }).map(value => ({
                  value,

                  r:
                    R.projectContext(
                      r,
                      value
                    ),

                  g
                }));
              });

            result.sort(
              (a, b) =>
                R.order([
                  [
                    R.ref(
                      a.r,
                      "srm_id",
                      null
                    ),
                    R.ref(
                      b.r,
                      "srm_id",
                      null
                    ),
                    "ASC",
                    null
                  ],
                  [
                    R.ref(
                      a.r,
                      "last_seen_at",
                      null
                    ),
                    R.ref(
                      b.r,
                      "last_seen_at",
                      null
                    ),
                    "DESC",
                    null
                  ]
                ])
            );

            result = R.unique(
              result,
              x => [
                R.ref(
                  x.r,
                  "srm_id",
                  null
                )
              ]
            );

            return result
              .slice(0)
              .map(x => x.value);
          })(null));
        },
        [],
        false
      );

      const srmMapperService =
        require(
          '../services/srm-mapper.service'
        );

      const viewModel =
        srmMapperService
          .buildSrmServersViewModel(
            rows
          );

      res.json({
        success: true,
        data: viewModel
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };
  exports.getProtectionGroups = async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((views => {
        views["vc_identity"] = (parent => {
          let rows = [R.context(parent)];

          rows = R.join(rows, "all_vc", r => [
            ...(parent => {
              let rows = [R.context(parent)];

              rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");

              rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), "INNER JOIN");

              rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.fn("coalesce", [
                R.ref(r, "associated_vcenter_connection_id", "c"),

                R.scalar((parent => {
                  let rows = [R.context(parent)];

                  rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");

                  rows = rows.filter(r => R.binary(
                    "AND",
                    R.binary("=", R.ref(r, "system_type", null), "VCENTER"),
                    R.binary(
                      "OR",
                      R.binary("=", R.ref(r, "site", null), R.ref(r, "site", "c")),
                      R.binary(
                        "LIKE",
                        R.ref(r, "base_url", null),
                        R.binary(
                          "||",
                          R.binary("||", "%", R.ref(r, "local_site_name", "p")),
                          "%"
                        )
                      )
                    )
                  ));

                  let groups = rows.map(r => [r]);

                  let result = groups.flatMap(g => {
                    const r = g[0] || R.context(parent);

                    return R.expand({
                      "id": R.ref(r, "id", null)
                    }).map(value => ({
                      value,
                      r: R.projectContext(r, value),
                      g
                    }));
                  });

                  return result.slice(0, 0 + Number(1)).map(x => x.value);
                })(r))
              ])), "LEFT JOIN");

              rows = rows.filter(r => R.binary(
                "AND",
                R.binary("=", R.ref(r, "is_present", "p"), true),
                R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", "p"))
              ));

              let groups = rows.map(r => [r]);

              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);

                return R.expand({
                  "stable_id": R.ref(r, "local_vcenter_external_id", "p"),
                  "site_name": R.ref(r, "site", "c"),
                  "vcenter_name": R.ref(r, "connection_name", "vc"),
                  "vcenter_base_url": R.ref(r, "base_url", "vc"),
                  "priority": 10,
                  "last_seen_at": R.ref(r, "last_seen_at", "p")
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });

              return result.slice(0).map(x => x.value);
            })(r),

            ...[
              ...(parent => {
                let rows = [R.context(parent)];

                rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");

                rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "sp")), "INNER JOIN");

                rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.fn("coalesce", [
                  R.ref(r, "associated_vcenter_connection_id", "c"),

                  R.scalar((parent => {
                    let rows = [R.context(parent)];

                    rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");

                    rows = rows.filter(r => R.binary(
                      "AND",
                      R.binary("=", R.ref(r, "system_type", null), "VCENTER"),
                      R.binary(
                        "OR",
                        R.binary("=", R.ref(r, "site", null), R.ref(r, "site", "c")),
                        R.binary(
                          "LIKE",
                          R.ref(r, "base_url", null),
                          R.binary(
                            "||",
                            R.binary("||", "%", R.ref(r, "local_site_name", "sp")),
                            "%"
                          )
                        )
                      )
                    ));

                    let groups = rows.map(r => [r]);

                    let result = groups.flatMap(g => {
                      const r = g[0] || R.context(parent);

                      return R.expand({
                        "id": R.ref(r, "id", null)
                      }).map(value => ({
                        value,
                        r: R.projectContext(r, value),
                        g
                      }));
                    });

                    return result.slice(0, 0 + Number(1)).map(x => x.value);
                  })(r))
                ])), "LEFT JOIN");

                rows = rows.filter(r => R.binary(
                  "AND",
                  R.binary("=", R.ref(r, "is_present", "sp"), true),
                  R.unary("IS NOT NULL", R.ref(r, "local_vcenter_id", "sp"))
                ));

                let groups = rows.map(r => [r]);

                let result = groups.flatMap(g => {
                  const r = g[0] || R.context(parent);

                  return R.expand({
                    "stable_id": R.ref(r, "local_vcenter_id", "sp"),
                    "site_name": R.ref(r, "site", "c"),
                    "vcenter_name": R.ref(r, "connection_name", "vc"),
                    "vcenter_base_url": R.ref(r, "base_url", "vc"),
                    "priority": 10,
                    "last_seen_at": R.ref(r, "last_seen_at", "sp")
                  }).map(value => ({
                    value,
                    r: R.projectContext(r, value),
                    g
                  }));
                });

                return result.slice(0).map(x => x.value);
              })(r),

              ...(parent => {
                let rows = [R.context(parent)];

                rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");

                rows = rows.filter(r => R.binary(
                  "AND",
                  R.binary("=", R.ref(r, "system_type", "vc"), "VCENTER"),
                  R.binary("=", R.ref(r, "is_active", "vc"), true)
                ));

                let groups = rows.map(r => [r]);

                let result = groups.flatMap(g => {
                  const r = g[0] || R.context(parent);

                  return R.expand({
                    "stable_id": R.ref(r, "base_url", "vc"),
                    "site_name": R.ref(r, "site", "vc"),
                    "vcenter_name": R.ref(r, "connection_name", "vc"),
                    "vcenter_base_url": R.ref(r, "base_url", "vc"),
                    "priority": 5,
                    "last_seen_at": R.ref(r, "created_at", "vc")
                  }).map(value => ({
                    value,
                    r: R.projectContext(r, value),
                    g
                  }));
                });

                return result.slice(0).map(x => x.value);
              })(r)
            ]
          ], r => true, "INNER JOIN");

          rows = rows.filter(r =>
            R.unary(
              "IS NOT NULL",
              R.ref(r, "stable_id", null)
            )
          );

          let groups = rows.map(r => [r]);

          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              "stable_id": R.ref(r, "stable_id", null),
              "site_name": R.ref(r, "site_name", null),
              "vcenter_name": R.ref(r, "vcenter_name", null),
              "vcenter_base_url": R.ref(r, "vcenter_base_url", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([
            [
              R.ref(a.r, "stable_id", null),
              R.ref(b.r, "stable_id", null),
              "ASC",
              null
            ],
            [
              R.ref(a.r, "priority", null),
              R.ref(b.r, "priority", null),
              "DESC",
              null
            ],
            [
              R.ref(a.r, "last_seen_at", null),
              R.ref(b.r, "last_seen_at", null),
              "DESC",
              null
            ]
          ]));

          result = R.unique(
            result,
            x => [
              R.ref(x.r, "stable_id", null)
            ]
          );

          return result.slice(0).map(x => x.value);
        })(null);
                return (parent => {
          let rows = [R.context(parent)];

          rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");

          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "pg")), "INNER JOIN");

          rows = R.join(rows, "local_vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "local_vc"), R.ref(r, "associated_vcenter_connection_id", "c")), "LEFT JOIN");

          rows = R.join(rows, "ss", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "ss"), R.ref(r, "connection_id", "pg")), "LEFT JOIN");

          rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => R.binary(
            "AND",
            R.binary(
              "AND",
              R.binary("=", R.ref(r, "connection_id", "sp"), R.ref(r, "connection_id", "pg")),
              R.binary("=", R.ref(r, "pairing_id", "sp"), R.ref(r, "pairing_id", "pg"))
            ),
            R.binary("=", R.ref(r, "is_present", "sp"), true)
          ), "LEFT JOIN");

          rows = R.join(rows, "pv", r => (parent => {
            let rows = [R.context(parent)];

            rows = R.join(rows, "pvm", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");

            rows = rows.filter(r => R.binary(
              "AND",
              R.binary(
                "AND",
                R.binary(
                  "AND",
                  R.binary("=", R.ref(r, "connection_id", "pvm"), R.ref(r, "connection_id", "pg")),
                  R.binary("=", R.ref(r, "pairing_id", "pvm"), R.ref(r, "pairing_id", "pg"))
                ),
                R.binary("=", R.ref(r, "protection_group_id", "pvm"), R.ref(r, "protection_group_id", "pg"))
              ),
              R.binary("=", R.ref(r, "is_present", "pvm"), true)
            ));

            let groups = R.groups(rows, null);

            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);

              return R.expand({
                "protected_vm_ids": R.aggregate(
                  "array_agg",
                  g.filter(a => true).map(a => R.ref(a, "protected_vm_id", "pvm")),
                  "distinct",
                  null
                ),

                "protected_vms": R.aggregate(
                  "jsonb_agg",
                  g.filter(a => R.unary("IS NOT NULL", R.ref(a, "protected_vm_id", "pvm"))).map(a =>
                    R.fn("jsonb_build_object", [
                      "id", R.ref(a, "protected_vm_id", "pvm"),
                      "name", R.ref(a, "vm_name", "pvm"),
                      "sourceVmId", R.ref(a, "source_vm_id", "pvm"),
                      "targetVmId", R.ref(a, "target_vm_id", "pvm"),
                      "status", R.ref(a, "normalized_protection_status", "pvm"),
                      "placeholderStatus", R.ref(a, "placeholder_status", "pvm")
                    ])
                  ),
                  "distinct",
                  null
                ),

                "protected_vcenter_stable_id": R.aggregate(
                  "max",
                  g.filter(a => true).map(a =>
                    R.fn("split_part", [
                      R.ref(a, "protected_vm_id", "pvm"),
                      ":",
                      3
                    ])
                  ),
                  false,
                  null
                ),

                "vm_count": R.cast(
                  R.aggregate(
                    "count",
                    g.filter(a => true).map(a => R.ref(a, "protected_vm_id", "pvm")),
                    "distinct",
                    null
                  ),
                  {
                    "name": "int"
                  }
                )
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });

            return result.slice(0).map(x => x.value);
          })(r), r => true, "LEFT JOIN");

          rows = R.join(rows, "rpg", r => (parent => {
            let rows = [R.context(parent)];

            rows = R.join(rows, "rel", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => true, "INNER JOIN");

            rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => R.binary(
              "AND",
              R.binary(
                "AND",
                R.binary(
                  "AND",
                  R.binary("=", R.ref(r, "connection_id", "rp"), R.ref(r, "connection_id", "rel")),
                  R.binary("=", R.ref(r, "pairing_id", "rp"), R.ref(r, "pairing_id", "rel"))
                ),
                R.binary("=", R.ref(r, "recovery_plan_id", "rp"), R.ref(r, "recovery_plan_id", "rel"))
              ),
              R.binary("=", R.ref(r, "is_present", "rp"), true)
            ), "LEFT JOIN");

            rows = rows.filter(r => R.binary(
              "AND",
              R.binary(
                "AND",
                R.binary(
                  "AND",
                  R.binary("=", R.ref(r, "connection_id", "rel"), R.ref(r, "connection_id", "pg")),
                  R.binary("=", R.ref(r, "pairing_id", "rel"), R.ref(r, "pairing_id", "pg"))
                ),
                R.binary("=", R.ref(r, "protection_group_id", "rel"), R.ref(r, "protection_group_id", "pg"))
              ),
              R.binary("=", R.ref(r, "is_present", "rel"), true)
            ));

            let groups = R.groups(rows, null);

            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);

              return R.expand({
                "recovery_plan_count": R.cast(
                  R.aggregate(
                    "count",
                    g.filter(a => true).map(a => R.ref(a, "recovery_plan_id", "rel")),
                    "distinct",
                    null
                  ),
                  {
                    "name": "int"
                  }
                ),

                "recovery_plans": R.aggregate(
                  "jsonb_agg",
                  g.filter(a => R.unary("IS NOT NULL", R.ref(a, "recovery_plan_id", "rel"))).map(a =>
                    R.fn("jsonb_build_object", [
                      "id", R.ref(a, "recovery_plan_id", "rel"),
                      "name", R.ref(a, "name", "rp"),
                      "status", R.fn("coalesce", [
                        R.ref(a, "normalized_status", "rp"),
                        R.ref(a, "raw_status", "rp")
                      ])
                    ])
                  ),
                  "distinct",
                  null
                )
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });

            return result.slice(0).map(x => x.value);
          })(r), r => true, "LEFT JOIN");

          rows = R.join(rows, "si", r => (parent => {
            let rows = [R.context(parent)];

            rows = R.join(rows, "issue", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");

            rows = rows.filter(r => R.binary(
              "AND",
              R.binary(
                "AND",
                R.binary("=", R.ref(r, "connection_id", "issue"), R.ref(r, "connection_id", "pg")),
                R.binary("=", R.ref(r, "source_entity_id", "issue"), R.ref(r, "protection_group_id", "pg"))
              ),
              R.binary("=", R.ref(r, "is_present", "issue"), true)
            ));

            let groups = R.groups(rows, null);

            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);

              return R.expand({
                "issue_count": R.cast(
                  R.aggregate(
                    "count",
                    g.filter(a => true).map(a => R.ref(a, "issue_fingerprint", "issue")),
                    "distinct",
                    null
                  ),
                  {
                    "name": "int"
                  }
                )
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });

            return result.slice(0).map(x => x.value);
          })(r), r => true, "LEFT JOIN");

          rows = R.join(
            rows,
            "protected",
            r => views["vc_identity"] || s.read("vc_identity"),
            r => R.binary(
              "=",
              R.ref(r, "stable_id", "protected"),
              R.fn("coalesce", [
                R.ref(r, "protected_vcenter_stable_id", "pv"),
                R.ref(r, "local_vcenter_id", "sp")
              ])
            ),
            "LEFT JOIN"
          );

          rows = R.join(
            rows,
            "recovery",
            r => views["vc_identity"] || s.read("vc_identity"),
            r => R.binary(
              "=",
              R.ref(r, "stable_id", "recovery"),
              R.binary(
                "=",
                R.ref(r, "local_vcenter_id", "sp"),
                R.fn("coalesce", [
                  R.ref(r, "protected_vcenter_stable_id", "pv"),
                  R.ref(r, "local_vcenter_id", "sp")
                ])
              )
                ? R.ref(r, "remote_vcenter_id", "sp")
                : R.binary(
                  "=",
                  R.ref(r, "remote_vcenter_id", "sp"),
                  R.fn("coalesce", [
                    R.ref(r, "protected_vcenter_stable_id", "pv"),
                    R.ref(r, "local_vcenter_id", "sp")
                  ])
                )
                  ? R.ref(r, "local_vcenter_id", "sp")
                  : R.ref(r, "remote_vcenter_id", "sp")
            ),
            "LEFT JOIN"
          );

          rows = rows.filter(r =>
            R.binary(
              "=",
              R.ref(r, "is_present", "pg"),
              true
            )
          );

          let groups = rows.map(r => [r]);

          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              ...R.star(r, "pg"),

              "local_site": R.ref(r, "site", "c"),

              "observation_vcenter_stable_id": R.ref(r, "local_vcenter_id", "sp"),

              "observation_srm_name": R.ref(r, "connection_name", "c"),

              "observation_srm_base_url": R.ref(r, "base_url", "c"),

              "observation_vcenter_name": R.ref(r, "connection_name", "local_vc"),

              "observation_vcenter_base_url": R.ref(r, "base_url", "local_vc"),

              "canonical_site_pair_key": R.ref(r, "canonical_site_pair_key", "sp"),

              "protected_vm_ids": R.ref(r, "protected_vm_ids", "pv"),

              "protected_vms": R.ref(r, "protected_vms", "pv"),

              "protected_vcenter_stable_id": R.ref(r, "protected_vcenter_stable_id", "pv"),

              "resolved_vm_count": R.binary(
                "=",
                R.ref(r, "protected_vm_sync_status", "ss"),
                "SYNCED"
              )
                ? R.ref(r, "vm_count", "pv")
                : null,

              "vm_count_resolution_status": R.binary(
                "=",
                R.ref(r, "protected_vm_sync_status", "ss"),
                "SYNCED"
              )
                ? "RESOLVED"
                : "SCOPE_FAILED",

              "resolved_recovery_plan_count": R.fn("coalesce", [
                R.ref(r, "recovery_plan_count", "rpg"),
                0
              ]),

              "recovery_plans": R.ref(r, "recovery_plans", "rpg"),

              "resolved_issue_count": R.fn("coalesce", [
                R.ref(r, "issue_count", "si"),
                0
              ]),

              "protected_site_name": R.fn("coalesce", [
                R.ref(r, "source_site_name", "pg"),
                R.ref(r, "site_name", "protected"),
                R.ref(r, "local_site_name", "sp"),
                R.ref(r, "site", "c")
              ]),

              "protected_vcenter_name": R.ref(r, "vcenter_name", "protected"),

              "protected_vcenter_base_url": R.ref(r, "vcenter_base_url", "protected"),

              "recovery_site_name": R.fn("coalesce", [
                R.ref(r, "target_site_name", "pg"),
                R.ref(r, "site_name", "recovery"),
                R.ref(r, "remote_site_name", "sp")
              ]),

              "recovery_vcenter_name": R.ref(r, "vcenter_name", "recovery"),

              "recovery_vcenter_base_url": R.ref(r, "vcenter_base_url", "recovery")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([
            [
              R.ref(a.r, "last_seen_at", "pg"),
              R.ref(b.r, "last_seen_at", "pg"),
              "DESC",
              null
            ],
            [
              R.ref(a.r, "id", "pg"),
              R.ref(b.r, "id", "pg"),
              "ASC",
              null
            ]
          ]));

          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false);

    const srmMapperService =
      require('../services/srm-mapper.service');

    const viewModel =
      srmMapperService
        .buildProtectionGroupsViewModel(
          rows
        );

    return respondWithSrmCollection(
      res,
      viewModel,
      [
        'protection_group_sync_status',
        'protected_vm_sync_status'
      ],
      rows.map(
        row => row.last_seen_at
      ),
      {
        hasData:
          viewModel
            .observations
            .length > 0,

        observationCount:
          viewModel
            .metrics
            .observationCount,

        canonicalCount:
          viewModel
            .metrics
            .canonicalGroupCount,

        canonicalState:
          viewModel.state
      }
    );
  } catch (error) {
    next(error);
  }
};
exports.getRecoveryPlans = async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((views => {
        views["vc_identity"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "all_vc", r => [...(parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
            rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), "INNER JOIN");
            rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.fn("coalesce", [R.ref(r, "associated_vcenter_connection_id", "c"), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", null), "VCENTER"), R.binary("OR", R.binary("=", R.ref(r, "site", null), R.ref(r, "site", "c")), R.binary("LIKE", R.ref(r, "base_url", null), R.binary("||", R.binary("||", "%", R.ref(r, "local_site_name", "p")), "%")))));
              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "id": R.ref(r, "id", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r))])), "LEFT JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "p"), true), R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", "p"))));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "stable_id": R.ref(r, "local_vcenter_external_id", "p"),
                "site_name": R.ref(r, "site", "c"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_base_url": R.ref(r, "base_url", "vc"),
                "priority": 10,
                "last_seen_at": R.ref(r, "last_seen_at", "p")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r), ...[...(parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
            rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "sp")), "INNER JOIN");
            rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.fn("coalesce", [R.ref(r, "associated_vcenter_connection_id", "c"), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", null), "VCENTER"), R.binary("OR", R.binary("=", R.ref(r, "site", null), R.ref(r, "site", "c")), R.binary("LIKE", R.ref(r, "base_url", null), R.binary("||", R.binary("||", "%", R.ref(r, "local_site_name", "sp")), "%")))));
              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "id": R.ref(r, "id", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r))])), "LEFT JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "sp"), true), R.unary("IS NOT NULL", R.ref(r, "local_vcenter_id", "sp"))));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "stable_id": R.ref(r, "local_vcenter_id", "sp"),
                "site_name": R.ref(r, "site", "c"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_base_url": R.ref(r, "base_url", "vc"),
                "priority": 10,
                "last_seen_at": R.ref(r, "last_seen_at", "sp")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r), ...(parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "vc"), "VCENTER"), R.binary("=", R.ref(r, "is_active", "vc"), true)));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "stable_id": R.ref(r, "base_url", "vc"),
                "site_name": R.ref(r, "site", "vc"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_base_url": R.ref(r, "base_url", "vc"),
                "priority": 5,
                "last_seen_at": R.ref(r, "created_at", "vc")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r)]], r => true, "INNER JOIN");
          rows = rows.filter(r => R.unary("IS NOT NULL", R.ref(r, "stable_id", null)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "stable_id": R.ref(r, "stable_id", null),
              "site_name": R.ref(r, "site_name", null),
              "vcenter_name": R.ref(r, "vcenter_name", null),
              "vcenter_base_url": R.ref(r, "vcenter_base_url", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "stable_id", null), R.ref(b.r, "stable_id", null), "ASC", null], [R.ref(a.r, "priority", null), R.ref(b.r, "priority", null), "DESC", null], [R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null]]));
          result = R.unique(result, x => [R.ref(x.r, "stable_id", null)]);
          return result.slice(0).map(x => x.value);
        })(null);
                views["plan_counts"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_srm_recovery_plans", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", null), true));
          let groups = R.groups(rows, r => [R.ref(r, "connection_id", null)]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "connection_id": R.ref(r, "connection_id", null),
              "plan_count": R.cast(R.aggregate("count", g.filter(a => true).map(a => 1), false, null), {
                "name": "int"
              })
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          return result.slice(0).map(x => x.value);
        })(null);

        views["in_progress_plan_counts"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "current_srm_recovery_plans", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", null), true), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", null), R.ref(r, "raw_status", null), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])));
          let groups = R.groups(rows, r => [R.ref(r, "connection_id", null)]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "connection_id": R.ref(r, "connection_id", null),
              "plan_count": R.cast(R.aggregate("count", g.filter(a => true).map(a => 1), false, null), {
                "name": "int"
              })
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
          rows = R.join(rows, "rp", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "rp")), "INNER JOIN");
          rows = R.join(rows, "pc", r => views["plan_counts"] || s.read("plan_counts"), r => R.binary("=", R.ref(r, "connection_id", "pc"), R.ref(r, "connection_id", "rp")), "LEFT JOIN");
          rows = R.join(rows, "ipc", r => views["in_progress_plan_counts"] || s.read("in_progress_plan_counts"), r => R.binary("=", R.ref(r, "connection_id", "ipc"), R.ref(r, "connection_id", "rp")), "LEFT JOIN");
          rows = R.join(rows, "ss", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => R.binary("=", R.ref(r, "connection_id", "ss"), R.ref(r, "connection_id", "rp")), "LEFT JOIN");
          rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "sp"), R.ref(r, "connection_id", "rp")), R.binary("=", R.ref(r, "pairing_id", "sp"), R.ref(r, "pairing_id", "rp"))), R.binary("=", R.ref(r, "is_present", "sp"), true)), "LEFT JOIN");

          rows = R.join(rows, "rel", r => (parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "rpg", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => true, "INNER JOIN");
            rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "pg"), R.ref(r, "connection_id", "rpg")), R.binary("=", R.ref(r, "pairing_id", "pg"), R.ref(r, "pairing_id", "rpg"))), R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "rpg"))), R.binary("=", R.ref(r, "is_present", "pg"), true)), "LEFT JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "rpg"), R.ref(r, "connection_id", "rp")), R.binary("=", R.ref(r, "pairing_id", "rpg"), R.ref(r, "pairing_id", "rp"))), R.binary("=", R.ref(r, "recovery_plan_id", "rpg"), R.ref(r, "recovery_plan_id", "rp"))), R.binary("=", R.ref(r, "is_present", "rpg"), true)));
            let groups = R.groups(rows, null);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "protection_group_ids": R.aggregate("array_agg", g.filter(a => true).map(a => R.ref(a, "protection_group_id", "rpg")), "distinct", null),
                "protection_group_names": R.aggregate("array_agg", g.filter(a => R.unary("IS NOT NULL", R.ref(a, "name", "pg"))).map(a => R.ref(a, "name", "pg")), "distinct", null),
                "protection_group_count": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "protection_group_id", "rpg")), "distinct", null), {
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

          rows = R.join(rows, "vm", r => (parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "rpv", r => views["current_srm_recovery_plan_vms"] || s.read("current_srm_recovery_plan_vms"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "rpv"), R.ref(r, "connection_id", "rp")), R.binary("=", R.ref(r, "pairing_id", "rpv"), R.ref(r, "pairing_id", "rp"))), R.binary("=", R.ref(r, "recovery_plan_id", "rpv"), R.ref(r, "recovery_plan_id", "rp"))), R.binary("=", R.ref(r, "is_present", "rpv"), true)));
            let groups = R.groups(rows, null);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "recovery_plan_vm_ids": R.aggregate("array_agg", g.filter(a => true).map(a => R.ref(a, "recovery_plan_vm_id", "rpv")), "distinct", null),
                "protected_vcenter_stable_id": R.aggregate("max", g.filter(a => true).map(a => R.fn("split_part", [R.ref(a, "recovery_plan_vm_id", "rpv"), ":", 3])), false, null),
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
                    rows = R.join(rows, "si", r => (parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "issue", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "issue"), R.ref(r, "connection_id", "rp")), R.binary("=", R.ref(r, "source_entity_id", "issue"), R.ref(r, "recovery_plan_id", "rp"))), R.binary("=", R.ref(r, "is_present", "issue"), true)));
            let groups = R.groups(rows, null);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "issue_count": R.cast(R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "issue_fingerprint", "issue")), "distinct", null), {
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

          rows = R.join(rows, "operation", r => (parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "current_srm_tasks", r => views["current_srm_tasks"] || s.read("current_srm_tasks"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), R.ref(r, "connection_id", "rp")), R.binary("LIKE", R.ref(r, "task_type", null), "com.vmware.vcDr.dr.recovery.RecoveryManager.%")));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "task_id": R.ref(r, "task_id", null),
                "task_type": R.ref(r, "task_type", null),
                "description": R.ref(r, "description", null),
                "raw_status": R.ref(r, "raw_status", null),
                "normalized_status": R.ref(r, "normalized_status", null),
                "progress_percent": R.ref(r, "progress_percent", null),
                "started_at": R.ref(r, "started_at", null),
                "completed_at": R.ref(r, "completed_at", null)
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            result.sort((a, b) => R.order([[R.fn("coalesce", [R.ref(a.r, "started_at", null), R.ref(a.r, "queued_at", null), R.ref(a.r, "last_seen_at", null)]), R.fn("coalesce", [R.ref(b.r, "started_at", null), R.ref(b.r, "queued_at", null), R.ref(b.r, "last_seen_at", null)]), "DESC", "LAST"], [R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null], [R.ref(a.r, "id", null), R.ref(b.r, "id", null), "DESC", null]]));
            return result.slice(0, 0 + Number(1)).map(x => x.value);
          })(r), r => true, "LEFT JOIN");

          rows = R.join(rows, "protected", r => views["vc_identity"] || s.read("vc_identity"), r => R.binary("=", R.ref(r, "stable_id", "protected"), R.fn("coalesce", [R.ref(r, "protected_vcenter_stable_id", "vm"), R.ref(r, "local_vcenter_id", "sp")])), "LEFT JOIN");
          rows = R.join(rows, "recovery", r => views["vc_identity"] || s.read("vc_identity"), r => R.binary("=", R.ref(r, "stable_id", "recovery"), R.binary("=", R.ref(r, "local_vcenter_id", "sp"), R.fn("coalesce", [R.ref(r, "protected_vcenter_stable_id", "vm"), R.ref(r, "local_vcenter_id", "sp")])) ? R.ref(r, "remote_vcenter_id", "sp") : R.binary("=", R.ref(r, "remote_vcenter_id", "sp"), R.fn("coalesce", [R.ref(r, "protected_vcenter_stable_id", "vm"), R.ref(r, "local_vcenter_id", "sp")])) ? R.ref(r, "local_vcenter_id", "sp") : R.ref(r, "remote_vcenter_id", "sp")), "LEFT JOIN");
                    rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "rp"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              ...R.star(r, "rp"),
              "local_site": R.ref(r, "site", "c"),
              "observation_vcenter_stable_id": R.ref(r, "local_vcenter_id", "sp"),
              "canonical_site_pair_key": R.ref(r, "canonical_site_pair_key", "sp"),
              "protection_group_ids": R.ref(r, "protection_group_ids", "rel"),
              "protection_group_names": R.ref(r, "protection_group_names", "rel"),
              "resolved_protection_group_count": R.ref(r, "protection_group_count", "rel"),
              "protection_group_count_resolution_status": R.binary("=", R.ref(r, "recovery_plan_sync_status", "ss"), "SYNCED") ? "RESOLVED" : "SCOPE_FAILED",
              "recovery_plan_vm_ids": R.ref(r, "recovery_plan_vm_ids", "vm"),
              "protected_vcenter_stable_id": R.ref(r, "protected_vcenter_stable_id", "vm"),
              "resolved_vm_count": R.binary("=", R.ref(r, "recovery_plan_vm_sync_status", "ss"), "SYNCED") ? R.ref(r, "vm_count", "vm") : null,
              "vm_count_resolution_status": R.binary("=", R.ref(r, "recovery_plan_vm_sync_status", "ss"), "SYNCED") ? "RESOLVED" : "SCOPE_FAILED",
              "resolved_issue_count": R.fn("coalesce", [R.ref(r, "issue_count", "si"), 0]),
              "protected_site_name": R.fn("coalesce", [R.ref(r, "source_site_name", "rp"), R.ref(r, "site_name", "protected"), R.ref(r, "local_site_name", "sp"), R.ref(r, "site", "c")]),
              "protected_vcenter_name": R.ref(r, "vcenter_name", "protected"),
              "protected_vcenter_base_url": R.ref(r, "vcenter_base_url", "protected"),
              "recovery_site_name": R.fn("coalesce", [R.ref(r, "recovery_site_name", "rp"), R.ref(r, "site_name", "recovery"), R.ref(r, "remote_site_name", "sp")]),
              "recovery_vcenter_name": R.ref(r, "vcenter_name", "recovery"),
              "recovery_vcenter_base_url": R.ref(r, "vcenter_base_url", "recovery"),
              "operation_task_id": R.binary("OR", R.binary("=", R.ref(r, "plan_count", "pc"), 1), R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"]))) ? R.ref(r, "task_id", "operation") : null,
              "operation_status": R.binary("OR", R.binary("=", R.ref(r, "plan_count", "pc"), 1), R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"]))) ? R.ref(r, "raw_status", "operation") : null,
              "operation_progress_percent": R.binary("OR", R.binary("=", R.ref(r, "plan_count", "pc"), 1), R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"]))) ? R.ref(r, "progress_percent", "operation") : null,
              "operation_started_at": R.binary("OR", R.binary("=", R.ref(r, "plan_count", "pc"), 1), R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"]))) ? R.ref(r, "started_at", "operation") : null,
              "operation_completed_at": R.binary("OR", R.binary("=", R.ref(r, "plan_count", "pc"), 1), R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"]))) ? R.ref(r, "completed_at", "operation") : null,
              "operation_description": R.binary("OR", R.binary("=", R.ref(r, "plan_count", "pc"), 1), R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"]))) ? R.ref(r, "description", "operation") : null,
              "operation_resolution_status": R.unary("IS NULL", R.ref(r, "task_id", "operation")) ? "NOT_AVAILABLE" : R.binary("=", R.ref(r, "plan_count", "pc"), 1) ? "RESOLVED_SINGLE_PLAN_CONNECTION" : R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "plan_count", "ipc"), 1), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "normalized_status", "rp"), R.ref(r, "raw_status", "rp"), ""])]), ["RECOVERY_IN_PROGRESS", "TEST_IN_PROGRESS", "CLEANUP_IN_PROGRESS", "REPROTECT_IN_PROGRESS", "MIGRATION_IN_PROGRESS"])), R.binary("IN", R.fn("upper", [R.fn("coalesce", [R.ref(r, "raw_status", "operation"), R.ref(r, "normalized_status", "operation"), ""])]), ["RUNNING", "QUEUED", "IN_PROGRESS"])) ? "RESOLVED_UNIQUE_ACTIVE_PLAN" : "AMBIGUOUS_PLAN_TASK",
              "history_resolution_status": R.ref(r, "history_availability", "rp")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "rp"), R.ref(b.r, "last_seen_at", "rp"), "DESC", null], [R.ref(a.r, "id", "rp"), R.ref(b.r, "id", "rp"), "ASC", null]]));
          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false);

    const srmMapperService = require('../services/srm-mapper.service');
    const viewModel = srmMapperService.buildRecoveryPlansViewModel(rows);

    return respondWithSrmCollection(res, viewModel, ['recovery_plan_sync_status', 'recovery_plan_vm_sync_status'], rows.map(row => row.last_seen_at), {
      hasData: viewModel.observations.length > 0,
      observationCount: viewModel.metrics.observationCount,
      canonicalCount: viewModel.metrics.canonicalPlanCount,
      canonicalState: viewModel.state
    });
  } catch (error) {
    next(error);
  }
};
exports.getMappings = async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((views => {
        views["vc_identity"] = (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "all_vc", r => [...(parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "p", r => views["current_vr_pairings"] || s.read("current_vr_pairings"), r => true, "INNER JOIN");
            rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "p")), "INNER JOIN");
            rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.fn("coalesce", [R.ref(r, "associated_vcenter_connection_id", "c"), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", null), "VCENTER"), R.binary("OR", R.binary("=", R.ref(r, "site", null), R.ref(r, "site", "c")), R.binary("LIKE", R.ref(r, "base_url", null), R.binary("||", R.binary("||", "%", R.ref(r, "local_site_name", "p")), "%")))));
              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "id": R.ref(r, "id", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r))])), "LEFT JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "p"), true), R.unary("IS NOT NULL", R.ref(r, "local_vcenter_external_id", "p"))));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "stable_id": R.ref(r, "local_vcenter_external_id", "p"),
                "site_name": R.ref(r, "site", "c"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_base_url": R.ref(r, "base_url", "vc"),
                "priority": 10,
                "last_seen_at": R.ref(r, "last_seen_at", "p")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r), ...[...(parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
            rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "c"), R.ref(r, "connection_id", "sp")), "INNER JOIN");
            rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "id", "vc"), R.fn("coalesce", [R.ref(r, "associated_vcenter_connection_id", "c"), R.scalar((parent => {
              let rows = [R.context(parent)];
              rows = R.join(rows, "current_connections", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
              rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", null), "VCENTER"), R.binary("OR", R.binary("=", R.ref(r, "site", null), R.ref(r, "site", "c")), R.binary("LIKE", R.ref(r, "base_url", null), R.binary("||", R.binary("||", "%", R.ref(r, "local_site_name", "sp")), "%")))));
              let groups = rows.map(r => [r]);
              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);
                return R.expand({
                  "id": R.ref(r, "id", null)
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });
              return result.slice(0, 0 + Number(1)).map(x => x.value);
            })(r))])), "LEFT JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "is_present", "sp"), true), R.unary("IS NOT NULL", R.ref(r, "local_vcenter_id", "sp"))));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "stable_id": R.ref(r, "local_vcenter_id", "sp"),
                "site_name": R.ref(r, "site", "c"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_base_url": R.ref(r, "base_url", "vc"),
                "priority": 10,
                "last_seen_at": R.ref(r, "last_seen_at", "sp")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r), ...(parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "vc", r => views["current_connections"] || s.read("current_connections"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "system_type", "vc"), "VCENTER"), R.binary("=", R.ref(r, "is_active", "vc"), true)));
            let groups = rows.map(r => [r]);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "stable_id": R.ref(r, "base_url", "vc"),
                "site_name": R.ref(r, "site", "vc"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_base_url": R.ref(r, "base_url", "vc"),
                "priority": 5,
                "last_seen_at": R.ref(r, "created_at", "vc")
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(r)]], r => true, "INNER JOIN");

          rows = rows.filter(r => R.unary("IS NOT NULL", R.ref(r, "stable_id", null)));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              "stable_id": R.ref(r, "stable_id", null),
              "site_name": R.ref(r, "site_name", null),
              "vcenter_name": R.ref(r, "vcenter_name", null),
              "vcenter_base_url": R.ref(r, "vcenter_base_url", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });
          result.sort((a, b) => R.order([[R.ref(a.r, "stable_id", null), R.ref(b.r, "stable_id", null), "ASC", null], [R.ref(a.r, "priority", null), R.ref(b.r, "priority", null), "DESC", null], [R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null]]));
          result = R.unique(result, x => [R.ref(x.r, "stable_id", null)]);
          return result.slice(0).map(x => x.value);
        })(null);
                return (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "m", r => views["current_srm_inventory_mappings"] || s.read("current_srm_inventory_mappings"), r => true, "INNER JOIN");
          rows = R.join(rows, "c", r => views["current_connections"] || s.read("current_connections"), r => R.binary("=", R.ref(r, "connection_id", "m"), R.ref(r, "id", "c")), "LEFT JOIN");
          rows = R.join(rows, "sp", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "sp"), R.ref(r, "connection_id", "m")), R.binary("=", R.ref(r, "pairing_id", "sp"), R.ref(r, "pairing_id", "m"))), R.binary("=", R.ref(r, "is_present", "sp"), true)), "LEFT JOIN");
          rows = R.join(rows, "source", r => views["vc_identity"] || s.read("vc_identity"), r => R.binary("=", R.ref(r, "stable_id", "source"), R.fn("coalesce", [R.ref(r, "local_vcenter_id", "sp"), R.ref(r, "base_url", "c")])), "LEFT JOIN");
          rows = R.join(rows, "target", r => views["vc_identity"] || s.read("vc_identity"), r => R.binary("=", R.ref(r, "stable_id", "target"), R.fn("coalesce", [R.ref(r, "remote_vcenter_id", "sp"), ""])), "LEFT JOIN");

          rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "m"), true));
          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);
            return R.expand({
              ...R.star(r, "m"),
              "connection_name": R.ref(r, "connection_name", "c"),
              "connection_site": R.ref(r, "site", "c"),
              "canonical_site_pair_key": R.ref(r, "canonical_site_pair_key", "sp"),
              "local_vcenter_id": R.ref(r, "local_vcenter_id", "sp"),
              "remote_vcenter_id": R.ref(r, "remote_vcenter_id", "sp"),
              "source_site_name": R.fn("coalesce", [R.ref(r, "site_name", "source"), R.ref(r, "local_site_name", "sp"), R.ref(r, "site", "c")]),
              "source_vcenter_name": R.ref(r, "vcenter_name", "source"),
              "source_vcenter_base_url": R.ref(r, "vcenter_base_url", "source"),
              "target_site_name": R.fn("coalesce", [R.ref(r, "site_name", "target"), R.ref(r, "remote_site_name", "sp")]),
              "target_vcenter_name": R.ref(r, "vcenter_name", "target"),
              "target_vcenter_base_url": R.ref(r, "vcenter_base_url", "target")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([[R.ref(a.r, "connection_id", "m"), R.ref(b.r, "connection_id", "m"), "ASC", null], [R.ref(a.r, "mapping_id", "m"), R.ref(b.r, "mapping_id", "m"), "ASC", null], [R.ref(a.r, "last_seen_at", "m"), R.ref(b.r, "last_seen_at", "m"), "DESC", null]]));
          result = R.unique(result, x => [R.ref(x.r, "connection_id", "m"), R.ref(x.r, "mapping_id", "m")]);
          return result.slice(0).map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [], false);
        const objectRequests = rows.flatMap(row => [{
      vcenterStableId: row.local_vcenter_id,
      objectMoid: row.source_object_id,
      objectType: row.mapping_type
    }, {
      vcenterStableId: row.remote_vcenter_id,
      objectMoid: row.target_object_id,
      objectType: row.mapping_type
    }]);

    // SRM already supplies display names for most mappings. Resolving those
    // again through vCenter makes this read endpoint wait on remote API calls.
    const objectResolutions = new Array(objectRequests.length);
    const missingObjectRequests = [];

    for (let index = 0; index < objectRequests.length; index += 1) {
      const row = rows[Math.floor(index / 2)];
      const side = index % 2 === 0 ? 'source' : 'target';
      const name = row[`${side}_object_name`];

      if (typeof name === 'string' && name.trim()) {
        objectResolutions[index] = {
          objectName: name,
          objectType: row[`${side}_object_type`] || row.mapping_type,
          objectNameAvailability: 'API_PROVIDED',
          resolutionStatus: 'RESOLVED',
          resolutionSource: 'SRM_API_PROVIDED'
        };
      } else {
        missingObjectRequests.push({
          index,
          request: objectRequests[index]
        });
      }
    }

    if (missingObjectRequests.length) {
      const resolved = await vcenterObjectResolution.resolveVcenterObjects(missingObjectRequests.map(entry => entry.request));

      missingObjectRequests.forEach((entry, index) => {
        objectResolutions[entry.index] = resolved[index];
      });
    }
        const resourceHierarchyRequests = new Map();
    const storagePolicyRequests = new Map();

    for (const row of rows) {
      if (row.mapping_type === 'RESOURCE') {
        const isNamedComputeContainer = side => Boolean(row[`${side}_object_name`])
          && ['HOSTSYSTEM', 'COMPUTERESOURCE', 'CLUSTERCOMPUTERESOURCE'].includes(String(row[`${side}_object_type`] || '').toUpperCase());

        if (!isNamedComputeContainer('source')) {
          resourceHierarchyRequests.set(`${row.local_vcenter_id}|${row.source_object_id}`, {
            vcenterStableId: row.local_vcenter_id,
            resourceMoid: row.source_object_id
          });
        }

        if (!isNamedComputeContainer('target')) {
          resourceHierarchyRequests.set(`${row.remote_vcenter_id}|${row.target_object_id}`, {
            vcenterStableId: row.remote_vcenter_id,
            resourceMoid: row.target_object_id
          });
        }
      }

      if (row.mapping_type === 'STORAGE_POLICY') {
        storagePolicyRequests.set(`${row.local_vcenter_id}|${row.source_object_id}`, {
          vcenterStableId: row.local_vcenter_id,
          storageProfileId: row.source_object_id,
          apiReportedName: row.source_object_name,
          persisted: row.policy_resolution?.source
        });

        storagePolicyRequests.set(`${row.remote_vcenter_id}|${row.target_object_id}`, {
          vcenterStableId: row.remote_vcenter_id,
          storageProfileId: row.target_object_id,
          apiReportedName: row.target_object_name,
          persisted: row.policy_resolution?.target
        });
      }
    }

    const resourceHierarchyEntries = await Promise.all([...resourceHierarchyRequests.entries()].map(async ([key, request]) => [key, await vcenterObjectResolution.resolveResourceHierarchy(request)]));

    const storagePolicyEntries = await Promise.all([...storagePolicyRequests.entries()].map(async ([key, request]) => [key, request.persisted || {
      policyId: request.storageProfileId,
      apiReportedPolicyName: request.apiReportedName,
      resolvedPolicyName: null,
      policyNameAvailability: 'NOT_AVAILABLE',
      policyResolutionStatus: 'NOT_COLLECTED',
      policyResolutionSource: null,
      associatedVcenterStableId: request.vcenterStableId
    }]));

    const resourceHierarchies = new Map(resourceHierarchyEntries);
    const storagePolicies = new Map(storagePolicyEntries);
        const resolvedRows = rows.map((row, index) => {
      const source = objectResolutions[index * 2];
      const target = objectResolutions[index * 2 + 1];
      const sourceHierarchy = row.mapping_type === 'RESOURCE' ? resourceHierarchies.get(`${row.local_vcenter_id}|${row.source_object_id}`) : null;
      const targetHierarchy = row.mapping_type === 'RESOURCE' ? resourceHierarchies.get(`${row.remote_vcenter_id}|${row.target_object_id}`) : null;
      const sourceResourceDisplay = vcenterObjectResolution.selectSrmResourceDisplay(sourceHierarchy);
      const targetResourceDisplay = vcenterObjectResolution.selectSrmResourceDisplay(targetHierarchy);
      const sourcePolicy = row.mapping_type === 'STORAGE_POLICY' ? storagePolicies.get(`${row.local_vcenter_id}|${row.source_object_id}`) : null;
      const targetPolicy = row.mapping_type === 'STORAGE_POLICY' ? storagePolicies.get(`${row.remote_vcenter_id}|${row.target_object_id}`) : null;

      // Resource mapping identity is the ResourcePool MOID.  Keep its mapped
      // object name separate from the SRM-equivalent compute-container display
      // name so a generic lookup can never replace "Resources" with the MOID.
      const sourceObjectName = row.mapping_type === 'RESOURCE' ? sourceHierarchy?.resourcePool?.name || row.source_object_name || source?.objectName || null : source?.objectName || row.source_object_name || null;
      const targetObjectName = row.mapping_type === 'RESOURCE' ? targetHierarchy?.resourcePool?.name || row.target_object_name || target?.objectName || null : target?.objectName || row.target_object_name || null;
      const sourceDisplayName = row.mapping_type === 'RESOURCE' ? sourceResourceDisplay.name || row.source_object_name || source?.objectName : row.mapping_type === 'STORAGE_POLICY' ? sourcePolicy?.resolvedPolicyName : sourceObjectName;
      const targetDisplayName = row.mapping_type === 'RESOURCE' ? targetResourceDisplay.name || row.target_object_name || target?.objectName : row.mapping_type === 'STORAGE_POLICY' ? targetPolicy?.resolvedPolicyName : targetObjectName;

      return {
        ...row,
        source_vcenter_stable_id: row.local_vcenter_id || null,
        target_vcenter_stable_id: row.remote_vcenter_id || null,
        source_object_name: sourceObjectName,
        source_object_type: row.mapping_type === 'RESOURCE' ? sourceHierarchy?.resourcePool?.type || 'ResourcePool' : source?.objectType || row.source_object_type || row.mapping_type,
        source_object_name_availability: row.mapping_type === 'STORAGE_POLICY' ? sourcePolicy?.policyNameAvailability : row.mapping_type === 'RESOURCE' ? sourceHierarchy?.resourcePool?.name ? 'AVAILABLE' : row.source_object_name ? 'API_PROVIDED' : 'NOT_COLLECTED' : source?.objectName ? source.objectNameAvailability : row.source_object_name ? 'API_PROVIDED' : 'NOT_COLLECTED',
        source_object_resolution_status: row.mapping_type === 'STORAGE_POLICY' ? sourcePolicy?.policyResolutionStatus || 'NOT_COLLECTED' : row.mapping_type === 'RESOURCE' ? sourceHierarchy?.resolutionStatus || source?.resolutionStatus || 'NOT_COLLECTED' : source?.resolutionStatus || 'NOT_COLLECTED',
        source_object_resolution_source: row.mapping_type === 'STORAGE_POLICY' ? sourcePolicy?.policyResolutionSource || null : row.mapping_type === 'RESOURCE' ? sourceHierarchy?.resolutionSource || source?.resolutionSource || null : source?.resolutionSource || null,
        target_object_name: targetObjectName,
        target_object_type: row.mapping_type === 'RESOURCE' ? targetHierarchy?.resourcePool?.type || 'ResourcePool' : target?.objectType || row.target_object_type || row.mapping_type,
        target_object_name_availability: row.mapping_type === 'STORAGE_POLICY' ? targetPolicy?.policyNameAvailability : row.mapping_type === 'RESOURCE' ? targetHierarchy?.resourcePool?.name ? 'AVAILABLE' : row.target_object_name ? 'API_PROVIDED' : 'NOT_COLLECTED' : target?.objectName ? target.objectNameAvailability : row.target_object_name ? 'API_PROVIDED' : 'NOT_COLLECTED',
        target_object_resolution_status: row.mapping_type === 'STORAGE_POLICY' ? targetPolicy?.policyResolutionStatus || 'NOT_COLLECTED' : row.mapping_type === 'RESOURCE' ? targetHierarchy?.resolutionStatus || target?.resolutionStatus || 'NOT_COLLECTED' : target?.resolutionStatus || 'NOT_COLLECTED',
        target_object_resolution_source: row.mapping_type === 'STORAGE_POLICY' ? targetPolicy?.policyResolutionSource || null : row.mapping_type === 'RESOURCE' ? targetHierarchy?.resolutionSource || target?.resolutionSource || null : target?.resolutionSource || null,
        source_display_name: sourceDisplayName || null,
        source_display_type: row.mapping_type === 'RESOURCE' ? sourceResourceDisplay.type || row.source_object_type : row.mapping_type === 'STORAGE_POLICY' ? 'StoragePolicy' : source?.objectType || row.source_object_type || row.mapping_type,
        source_display_resolution_source: row.mapping_type === 'RESOURCE' ? sourceResourceDisplay.resolutionSource || (row.source_object_name ? 'SRM_API_PROVIDED' : null) : row.mapping_type === 'STORAGE_POLICY' ? sourcePolicy?.policyResolutionSource : source?.resolutionSource || 'SRM_API_PROVIDED',
        target_display_name: targetDisplayName || null,
        target_display_type: row.mapping_type === 'RESOURCE' ? targetResourceDisplay.type || row.target_object_type : row.mapping_type === 'STORAGE_POLICY' ? 'StoragePolicy' : target?.objectType || row.target_object_type || row.mapping_type,
        target_display_resolution_source: row.mapping_type === 'RESOURCE' ? targetResourceDisplay.resolutionSource || (row.target_object_name ? 'SRM_API_PROVIDED' : null) : row.mapping_type === 'STORAGE_POLICY' ? targetPolicy?.policyResolutionSource : target?.resolutionSource || 'SRM_API_PROVIDED',
        source_resource_pool: sourceHierarchy?.resourcePool || null,
        source_resource_parent: sourceHierarchy?.parent || null,
        source_compute_container: sourceHierarchy?.computeContainer || null,
        source_resource_hierarchy_status: sourceHierarchy?.resolutionStatus || null,
        source_resource_hierarchy_source: sourceHierarchy?.resolutionSource || null,
        target_resource_pool: targetHierarchy?.resourcePool || null,
        target_resource_parent: targetHierarchy?.parent || null,
        target_compute_container: targetHierarchy?.computeContainer || null,
        target_resource_hierarchy_status: targetHierarchy?.resolutionStatus || null,
        target_resource_hierarchy_source: targetHierarchy?.resolutionSource || null,
        source_api_reported_policy_name: sourcePolicy?.apiReportedPolicyName ?? null,
        source_resolved_policy_name: sourcePolicy?.resolvedPolicyName ?? null,
        source_policy_name_availability: sourcePolicy?.policyNameAvailability ?? null,
        source_policy_resolution_status: sourcePolicy?.policyResolutionStatus ?? null,
        source_policy_resolution_source: sourcePolicy?.policyResolutionSource ?? null,
        source_policy_vcenter_stable_id: sourcePolicy?.associatedVcenterStableId ?? null,
        source_policy_vcenter_host: sourcePolicy?.associatedVcenterHost ?? null,
        target_api_reported_policy_name: targetPolicy?.apiReportedPolicyName ?? null,
        target_resolved_policy_name: targetPolicy?.resolvedPolicyName ?? null,
        target_policy_name_availability: targetPolicy?.policyNameAvailability ?? null,
        target_policy_resolution_status: targetPolicy?.policyResolutionStatus ?? null,
        target_policy_resolution_source: targetPolicy?.policyResolutionSource ?? null,
        target_policy_vcenter_stable_id: targetPolicy?.associatedVcenterStableId ?? null,
        target_policy_vcenter_host: targetPolicy?.associatedVcenterHost ?? null,
        reverse_mapping: row.reverse_mapping_type || null,
        reverse_mapping_availability: row.reverse_mapping_type || row.reverse_recovery_object_id ? 'AVAILABLE' : 'NOT_PROVIDED_BY_API',
        reverse_recovery_object_id: row.reverse_recovery_object_id || null,
        reverse_recovery_object_name: row.reverse_recovery_object_name || null,
        test_network_mapping: row.test_network_mapping || null,
        test_network_id: row.test_network_mapping?.id || row.test_network_mapping?.moid || row.test_network_mapping?.value || null,
        test_network_name: row.test_network_mapping?.name || null,
        test_network_resolution_status: row.test_network_mapping ? 'API_PROVIDED' : 'NOT_PROVIDED_BY_API',
        ip_customization: row.ip_mapping || null,
        ip_customization_availability: row.ip_mapping ? 'AVAILABLE' : 'NOT_PROVIDED_BY_API'
      };
    });
        // Some SRM scopes (notably RESOURCE mappings) do not expose an explicit
    // reverse-mapping flag.  A reciprocal observation collected from the
    // opposite SRM appliance is authoritative evidence that the reverse
    // mapping exists, so expose that evidence without inventing a value.
    const reciprocalMappings = new Set(resolvedRows.map(row => [row.mapping_type, row.local_vcenter_id, row.remote_vcenter_id, row.source_object_id, row.target_object_id].map(value => value || '').join('|')));

    for (const row of resolvedRows) {
      if (row.reverse_mapping) continue;

      const reciprocalKey = [row.mapping_type, row.remote_vcenter_id, row.local_vcenter_id, row.target_object_id, row.source_object_id].map(value => value || '').join('|');

      if (!reciprocalMappings.has(reciprocalKey)) continue;

      row.reverse_mapping = 'YES';
      row.reverse_mapping_availability = 'INFERRED_FROM_RECIPROCAL_API_OBSERVATION';
    }

    const stateRes = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_sync_state", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => true, "INNER JOIN");

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "network_mapping_sync_status": R.ref(r, "network_mapping_sync_status", null),
            "test_network_mapping_sync_status": R.ref(r, "test_network_mapping_sync_status", null),
            "folder_mapping_sync_status": R.ref(r, "folder_mapping_sync_status", null),
            "resource_mapping_sync_status": R.ref(r, "resource_mapping_sync_status", null),
            "storage_policy_mapping_sync_status": R.ref(r, "storage_policy_mapping_sync_status", null),
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
    }, [], false);

    const srmMapperService = require('../services/srm-mapper.service');
    const viewModel = srmMapperService.buildMappingsViewModel(resolvedRows, stateRes.rows);

    for (const [scope, scopeState] of Object.entries(viewModel.scopeStates)) {
      if (scopeState.fetchStatus !== 'FAILED') continue;

      scopeState.error = {
        type: 'UPSTREAM_ERROR',
        code: scopeState.errorCode || 'SRM_MAPPING_FETCH_FAILED',
        httpStatus: null,
        endpoint: '/api/srm/mappings',
        requestId: req.id || null,
        safeMessage: `${scope.replaceAll('_', ' ')} Mapping fetch failed`
      };
    }

    return respondWithSrmCollection(res, viewModel, ['network_mapping_sync_status', 'test_network_mapping_sync_status', 'folder_mapping_sync_status', 'resource_mapping_sync_status', 'storage_policy_mapping_sync_status'], resolvedRows.map(row => row.last_seen_at), {
      hasData: viewModel.observations.length > 0,
      partial: viewModel.scopeStatus === 'PARTIAL',
      partialFreshness: viewModel.scopeStatus === 'PARTIAL'
    });
  } catch (error) {
    next(error);
  }
};
exports.getPlaceholderDatastores = async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "p", r => views["current_srm_placeholder_datastores"] || s.read("current_srm_placeholder_datastores"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "is_present", "p"), true));

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

        result.sort((a, b) => R.order([[R.ref(a.r, "placeholder_datastore_id", "p"), R.ref(b.r, "placeholder_datastore_id", "p"), "ASC", null], [R.ref(a.r, "last_seen_at", "p"), R.ref(b.r, "last_seen_at", "p"), "DESC", null]]));
        result = R.unique(result, x => [R.ref(x.r, "placeholder_datastore_id", "p")]);
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const identities = rows.map(row => vcenterObjectResolution.parseVmwareObjectIdentity(row.inventory_datastore_id || row.placeholder_datastore_id));

    const resolutions = await vcenterObjectResolution.resolveVcenterObjects(rows.map((row, index) => ({
      vcenterStableId: row.vcenter_external_id || identities[index]?.vcenterStableId || null,
      objectMoid: identities[index]?.objectMoid || null,
      objectType: 'DATASTORE'
    })));

    const stateRes = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_sync_state", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => true, "INNER JOIN");

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "placeholder_datastore_sync_status": R.ref(r, "placeholder_datastore_sync_status", null),
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
    }, [], false);
        const connRes = await pool.run((s) => {
      const R = s.helpers;

      return R.result((parent => {
        let rList = [R.context(parent)];
        rList = R.join(rList, "current_connections", r => s.read("current_connections"), r => true, "INNER JOIN");
        return rList.map(r => R.star(r, null));
      })(null));
    }, [], false);

    const conns = connRes.rows || [];
    const scopeFailed = stateRes.rows.some(row => row.placeholder_datastore_sync_status === 'FAILED');

    const resolvedRows = rows.map((row, index) => {
      const identity = identities[index];
      const resolution = resolutions[index];
      let inventoryMatchStatus = 'NOT_PROVIDED_BY_API';

      if (scopeFailed) inventoryMatchStatus = 'SCOPE_FAILED';
      else if (resolution?.resolutionStatus === 'RESOLVED') inventoryMatchStatus = 'RESOLVED';
      else if (resolution?.resolutionStatus === 'UNMAPPED_VCENTER') inventoryMatchStatus = 'UNMAPPED_VCENTER';
      else if (identity?.objectMoid) inventoryMatchStatus = 'DATASTORE_NOT_FOUND';

      const srmConn = conns.find(c => c.id === row.connection_id);
      const site = resolution?.siteName || srmConn?.site || (row.datastore_name?.includes('DC') ? 'DC' : row.datastore_name?.includes('DR') ? 'DR' : null);
      const vcConn = conns.find(c => c.site === site && c.system_type === 'VCENTER');
      let parsedVcHost = null;

      if (vcConn?.base_url) {
        try {
          parsedVcHost = new URL(vcConn.base_url).hostname;
        } catch {}
      }

      const vcenterHost = resolution?.vcenterHost || parsedVcHost || null;
      const vcenterStableId = resolution?.vcenterStableId || vcConn?.base_url || identity?.vcenterStableId || null;

      return {
        ...row,
        observation_id: row.id,
        site_name: site,
        site_role: site,
        vcenter_stable_id: vcenterStableId,
        vcenter_host: vcenterHost,
        datastore_moid: identity?.objectMoid || null,
        datastore_name: resolution?.objectName || row.datastore_name || null,
        datastore_name_availability: resolution?.objectName ? 'AVAILABLE' : row.datastore_name ? 'API_PROVIDED_UNVERIFIED' : 'NOT_PROVIDED_BY_API',
        inventory_match_status: inventoryMatchStatus,
        datastore_status: inventoryMatchStatus,
        capacity_bytes: resolution?.objectMetadata?.capacityBytes ?? row.capacity_bytes ?? null,
        free_space_bytes: resolution?.objectMetadata?.freeSpaceBytes ?? row.free_space_bytes ?? null,
        host_cluster_name: resolution?.objectMetadata?.clusterName || row.host_cluster_name || null,
        data_source: resolution?.resolutionStatus === 'RESOLVED' ? 'SRM_REST+POSTGRESQL_VCENTER_INVENTORY' : 'SRM_REST'
      };
    });
        const srmMapperService = require('../services/srm-mapper.service');
    const viewModel = srmMapperService.buildPlaceholderDatastoresViewModel(resolvedRows, stateRes.rows);

    if (viewModel.scopeState.fetchStatus === 'FAILED') {
      viewModel.scopeState.error = {
        type: 'UPSTREAM_ERROR',
        code: viewModel.scopeState.errorCode || 'SRM_PLACEHOLDER_DATASTORE_FETCH_FAILED',
        httpStatus: null,
        endpoint: '/api/srm/placeholder-datastores',
        requestId: req.id || null,
        safeMessage: 'Placeholder Datastore fetch failed'
      };
    }

    const observations = viewModel.observations || viewModel.data || [];

    return respondWithSrmCollection(res, viewModel, ['placeholder_datastore_sync_status'], resolvedRows.map(row => row.last_seen_at), {
      hasData: observations.length > 0,
      partial: viewModel.scopeState.fetchStatus === 'PARTIAL'
    });
  } catch (error) {
    next(error);
  }
};
exports.getIssues = async (req, res) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_issues", r => views["current_srm_issues"] || s.read("current_srm_issues"), r => true, "INNER JOIN");
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

        result.sort((a, b) => R.order([[R.ref(a.r, "issue_fingerprint", null), R.ref(b.r, "issue_fingerprint", null), "ASC", null], [R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null]]));
        result = R.unique(result, x => [R.ref(x.r, "issue_fingerprint", null)]);
        return result.slice(0).map(x => x.value);
      })(null));
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
exports.getSyncState = async (req, res) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_sync_state", r => views["current_srm_sync_state"] || s.read("current_srm_sync_state"), r => true, "INNER JOIN");

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
exports.getProtectedVms = async (req, res) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_protected_vms", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");
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

        result.sort((a, b) => R.order([[R.ref(a.r, "protected_vm_id", null), R.ref(b.r, "protected_vm_id", null), "ASC", null], [R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null]]));
        result = R.unique(result, x => [R.ref(x.r, "protected_vm_id", null)]);
        return result.slice(0).map(x => x.value);
      })(null));
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
exports.getSitePairById = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_site_pairs", r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "pairing_id", null), p[0]));

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
exports.getProtectionGroupById = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_protection_groups", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "protection_group_id", null), p[0]));

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
exports.getProtectionGroupVms = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_protected_vms", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "protection_group_id", null), p[0]), R.binary("=", R.ref(r, "is_present", null), true)));

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

        result.sort((a, b) => R.order([[R.ref(a.r, "protected_vm_id", null), R.ref(b.r, "protected_vm_id", null), "ASC", null], [R.ref(a.r, "last_seen_at", null), R.ref(b.r, "last_seen_at", null), "DESC", null]]));
        result = R.unique(result, x => [R.ref(x.r, "protected_vm_id", null)]);
        return result.slice(0).map(x => x.value);
      })(null));
    }, [id], false);

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
exports.getRecoveryPlanById = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_recovery_plans", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("=", R.ref(r, "recovery_plan_id", null), p[0]));

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
exports.getRecoveryPlanVms = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "rpv", r => views["current_srm_recovery_plan_vms"] || s.read("current_srm_recovery_plan_vms"), r => true, "INNER JOIN");

        rows = R.join(rows, "pvm", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "candidate", r => views["current_srm_protected_vms"] || s.read("current_srm_protected_vms"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "candidate"), R.ref(r, "connection_id", "rpv")), R.fn("same_value", [R.ref(r, "pairing_id", "candidate"), R.ref(r, "pairing_id", "rpv")])), R.binary("=", R.ref(r, "is_present", "candidate"), true)), R.binary("OR", R.binary("OR", R.binary("=", R.ref(r, "protected_vm_id", "candidate"), R.fn("coalesce", [R.ref(r, "protected_vm_id", "rpv"), R.ref(r, "recovery_plan_vm_id", "rpv")])), R.binary("AND", R.unary("IS NOT NULL", R.ref(r, "source_vm_id", "rpv")), R.binary("=", R.ref(r, "source_vm_id", "candidate"), R.ref(r, "source_vm_id", "rpv")))), R.binary("AND", R.binary("!=", R.fn("split_part", [R.ref(r, "recovery_plan_vm_id", "rpv"), ":", 2]), ""), R.binary("OR", R.binary("=", R.ref(r, "source_vm_id", "candidate"), R.fn("split_part", [R.ref(r, "recovery_plan_vm_id", "rpv"), ":", 2])), R.binary("LIKE", R.ref(r, "protected_vm_id", "candidate"), R.binary("||", R.binary("||", "%", R.fn("split_part", [R.ref(r, "recovery_plan_vm_id", "rpv"), ":", 2])), "%")))))));

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

          result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "candidate"), R.ref(b.r, "last_seen_at", "candidate"), "DESC", null]]));
          return result.slice(0, 0 + Number(1)).map(x => x.value);
        })(r), r => true, "LEFT JOIN");

        rows = R.join(rows, "plan_pg", r => (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "rpg", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => true, "INNER JOIN");
          rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "pg"), R.ref(r, "connection_id", "rpg")), R.fn("same_value", [R.ref(r, "pairing_id", "pg"), R.ref(r, "pairing_id", "rpg")])), R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "rpg"))), R.binary("=", R.ref(r, "is_present", "pg"), true)), "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "rpg"), R.ref(r, "connection_id", "rpv")), R.fn("same_value", [R.ref(r, "pairing_id", "rpg"), R.ref(r, "pairing_id", "rpv")])), R.binary("=", R.ref(r, "recovery_plan_id", "rpg"), R.ref(r, "recovery_plan_id", "rpv"))), R.binary("=", R.ref(r, "is_present", "rpg"), true)));

          let groups = rows.map(r => [r]);
          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              "protection_group_id": R.ref(r, "protection_group_id", "pg"),
              "name": R.ref(r, "name", "pg"),
              "raw_status": R.ref(r, "raw_status", "pg"),
              "normalized_status": R.ref(r, "normalized_status", "pg")
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) => R.order([[R.ref(a.r, "last_seen_at", "pg"), R.ref(b.r, "last_seen_at", "pg"), "DESC", null]]));
          return result.slice(0, 0 + Number(1)).map(x => x.value);
        })(r), r => true, "LEFT JOIN");

        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", "rpv"), p[0]), R.binary("=", R.ref(r, "is_present", "rpv"), true)));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            ...R.star(r, "rpv"),
            "vm_name": R.fn("coalesce", [R.ref(r, "vm_name", "pvm"), R.ref(r, "source_vm_id", "rpv"), R.ref(r, "recovery_plan_vm_id", "rpv")]),
            "raw_protection_status": R.fn("coalesce", [R.fn("nullif", [R.ref(r, "raw_protection_status", "pvm"), "UNKNOWN"]), R.fn("nullif", [R.ref(r, "recovery_settings_status", "rpv"), "UNKNOWN"]), R.fn("nullif", [R.ref(r, "mapping_status", "rpv"), "UNKNOWN"]), R.ref(r, "raw_status", "plan_pg"), "NOT_PROVIDED_BY_API"]),
            "normalized_protection_status": R.fn("coalesce", [R.fn("nullif", [R.ref(r, "normalized_protection_status", "pvm"), "UNKNOWN"]), R.fn("nullif", [R.ref(r, "raw_protection_status", "pvm"), "UNKNOWN"]), R.fn("nullif", [R.ref(r, "recovery_settings_status", "rpv"), "UNKNOWN"]), R.fn("nullif", [R.ref(r, "mapping_status", "rpv"), "UNKNOWN"]), R.ref(r, "normalized_status", "plan_pg"), R.ref(r, "raw_status", "plan_pg"), "NOT_PROVIDED_BY_API"]),
            "protection_status_source": R.binary("OR", R.unary("IS NOT NULL", R.fn("nullif", [R.ref(r, "normalized_protection_status", "pvm"), "UNKNOWN"])), R.unary("IS NOT NULL", R.fn("nullif", [R.ref(r, "raw_protection_status", "pvm"), "UNKNOWN"]))) ? "PROTECTED_VM" : R.binary("OR", R.unary("IS NOT NULL", R.fn("nullif", [R.ref(r, "recovery_settings_status", "rpv"), "UNKNOWN"])), R.unary("IS NOT NULL", R.fn("nullif", [R.ref(r, "mapping_status", "rpv"), "UNKNOWN"]))) ? "RECOVERY_PLAN_VM" : R.unary("IS NOT NULL", R.ref(r, "protection_group_id", "plan_pg")) ? "PROTECTION_GROUP" : "NOT_PROVIDED_BY_API",
            "protection_group_name": R.ref(r, "name", "plan_pg")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "connection_id", "rpv"), R.ref(b.r, "connection_id", "rpv"), "ASC", null], [R.ref(a.r, "pairing_id", "rpv"), R.ref(b.r, "pairing_id", "rpv"), "ASC", null], [R.ref(a.r, "recovery_plan_vm_id", "rpv"), R.ref(b.r, "recovery_plan_vm_id", "rpv"), "ASC", null], [R.ref(a.r, "last_seen_at", "rpv"), R.ref(b.r, "last_seen_at", "rpv"), "DESC", null]]));
        result = R.unique(result, x => [R.ref(x.r, "connection_id", "rpv"), R.ref(x.r, "pairing_id", "rpv"), R.ref(x.r, "recovery_plan_vm_id", "rpv")]);
        return result.slice(0).map(x => x.value);
      })(null));
    }, [id], false);

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
exports.getRecoveryPlanGroups = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "rpg", r => views["current_srm_recovery_plan_groups"] || s.read("current_srm_recovery_plan_groups"), r => true, "INNER JOIN");
        rows = R.join(rows, "pg", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "pg"), R.ref(r, "connection_id", "rpg")), R.fn("same_value", [R.ref(r, "pairing_id", "pg"), R.ref(r, "pairing_id", "rpg")])), R.binary("=", R.ref(r, "protection_group_id", "pg"), R.ref(r, "protection_group_id", "rpg"))), R.binary("=", R.ref(r, "is_present", "pg"), true)), "LEFT JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", "rpg"), p[0]), R.binary("=", R.ref(r, "is_present", "rpg"), true)));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            ...R.star(r, "rpg"),
            "name": R.ref(r, "name", "pg"),
            "raw_status": R.ref(r, "raw_status", "pg"),
            "normalized_status": R.ref(r, "normalized_status", "pg"),
            "raw_recovery_status": R.ref(r, "raw_recovery_status", "pg"),
            "normalized_recovery_status": R.ref(r, "normalized_recovery_status", "pg"),
            "group_type": R.ref(r, "group_type", "pg"),
            "source_site_name": R.ref(r, "source_site_name", "pg"),
            "target_site_name": R.ref(r, "target_site_name", "pg")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "connection_id", "rpg"), R.ref(b.r, "connection_id", "rpg"), "ASC", null], [R.ref(a.r, "pairing_id", "rpg"), R.ref(b.r, "pairing_id", "rpg"), "ASC", null], [R.ref(a.r, "protection_group_id", "rpg"), R.ref(b.r, "protection_group_id", "rpg"), "ASC", null], [R.ref(a.r, "last_seen_at", "rpg"), R.ref(b.r, "last_seen_at", "rpg"), "DESC", null]]));
        result = R.unique(result, x => [R.ref(x.r, "connection_id", "rpg"), R.ref(x.r, "pairing_id", "rpg"), R.ref(x.r, "protection_group_id", "rpg")]);
        return result.slice(0).map(x => x.value);
      })(null));
    }, [id], false);

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
exports.getRecoveryPlanHistory = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    // The table might not exist if it was skipped in the schema, but we'll try querying safely
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "tables", r => views["tables"] || s.read("tables"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "table_schema", null), "public"), R.binary("=", R.ref(r, "table_name", null), "srm_recovery_history")));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "table_name": R.ref(r, "table_name", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const availability = await planReadAvailability(id, 'history_availability');

    if (rows.length === 0) return res.json({
      success: true,
      availability: 'NOT_COLLECTED',
      data: []
    });

    const result = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "h", r => views["srm_recovery_history"] || s.read("srm_recovery_history"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", "h"), p[0]), R.binary("=", R.ref(r, "is_present", "h"), true)), (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "p", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "h")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "h"))), R.binary("=", R.ref(r, "recovery_plan_id", "p"), R.ref(r, "recovery_plan_id", "h"))));

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
            ...R.star(r, "h")
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "start_time", null), R.ref(b.r, "start_time", null), "ASC", "LAST"], [R.ref(a.r, "id", "h"), R.ref(b.r, "id", "h"), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [id], false);

    res.json({
      success: true,
      availability,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json(buildSafeError(req, {
      code: 'SRM_HISTORY_READ_FAILED',
      safeMessage: 'Recovery history could not be read.'
    }));
  }
};
exports.getRecoveryPlanSteps = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const viewMode = String(req.query.viewMode || 'test').toLowerCase();

    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "tables", r => views["tables"] || s.read("tables"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "table_schema", null), "public"), R.binary("=", R.ref(r, "table_name", null), "srm_recovery_plan_steps")));

        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "table_name": R.ref(r, "table_name", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);

    const availability = await planReadAvailability(id, 'test_steps_availability');

    if (rows.length === 0) return res.json({
      success: true,
      availability: 'NOT_COLLECTED',
      data: []
    });

    const result = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "s", r => views["srm_recovery_plan_steps"] || s.read("srm_recovery_plan_steps"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "recovery_plan_id", null), p[0]), R.binary("=", R.ref(r, "view_mode", null), p[1])), R.binary("=", R.ref(r, "is_present", null), true)), (parent => {
          let rows = [R.context(parent)];
          rows = R.join(rows, "p", r => views["current_srm_recovery_plans"] || s.read("current_srm_recovery_plans"), r => true, "INNER JOIN");
          rows = rows.filter(r => R.binary("AND", R.binary("AND", R.binary("=", R.ref(r, "connection_id", "p"), R.ref(r, "connection_id", "s")), R.binary("=", R.ref(r, "pairing_id", "p"), R.ref(r, "pairing_id", "s"))), R.binary("=", R.ref(r, "recovery_plan_id", "p"), R.ref(r, "recovery_plan_id", "s"))));

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
            ...R.star(r, null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        result.sort((a, b) => R.order([[R.ref(a.r, "step_number", null), R.ref(b.r, "step_number", null), "ASC", "LAST"], [R.ref(a.r, "depth", null), R.ref(b.r, "depth", null), "ASC", "LAST"], [R.ref(a.r, "id", null), R.ref(b.r, "id", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [id, viewMode], false);

    return res.json({
      success: true,
      availability,
      data: result.rows
    });
  } catch (error) {
    return res.status(500).json(buildSafeError(req, {
      code: 'SRM_STEPS_READ_FAILED',
      safeMessage: 'Recovery steps could not be read.'
    }));
  }
};
async function planReadAvailability(planId, column) {
  if (!['history_availability', 'test_steps_availability'].includes(column)) throw new Error('INVALID_SCOPE');

  const {
    rows
  } = await pool.run(s => ({
    rows: s.read("current_srm_recovery_plans").filter(r => r.recovery_plan_id === String(planId)).map(r => ({
      state: r[column]
    }))
  }), [], false);

  const states = rows.map(r => r.state || 'NOT_COLLECTED');

  return ['CONTRACT_ERROR', 'FAILED', 'TRUNCATED', 'PENDING', 'ENDPOINT_NOT_AVAILABLE', 'NOT_PROVIDED_BY_API', 'NOT_COLLECTED', 'AVAILABLE', 'AVAILABLE_EMPTY'].find(s => states.includes(s)) || 'NOT_COLLECTED';
}
exports.protectVm = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const {
      vmId,
      recoveryPlanId
    } = req.body || {};

    if (!id || !vmId) {
      return res.status(400).json(buildSafeError(req, {
        type: 'VALIDATION_ERROR',
        code: 'INVALID_ARGUMENTS',
        httpStatus: 400,
        safeMessage: 'Missing required protection group id or vmId.'
      }));
    }

    const {
      rows: pgRows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "current_srm_protection_groups", r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"), r => true, "INNER JOIN");
        rows = rows.filter(r => R.binary("AND", R.binary("OR", R.binary("=", R.ref(r, "protection_group_id", null), p[0]), R.binary("=", R.ref(r, "name", null), p[0])), R.binary("=", R.ref(r, "is_present", null), true)));

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

        return result.slice(0, 0 + Number(1)).map(x => x.value);
      })(null));
    }, [id], false);

    if (pgRows.length === 0) {
      return res.status(404).json(buildSafeError(req, {
        type: 'NOT_FOUND_ERROR',
        code: 'SRM_PROTECTION_GROUP_NOT_FOUND',
        httpStatus: 404,
        safeMessage: `Protection Group '${id}' was not found in active inventory.`
      }));
    }

    return res.status(501).json({
      ...buildSafeError(req, {
        type: 'NOT_SUPPORTED',
        code: 'SRM_REST_WRITE_UNSUPPORTED',
        httpStatus: 501,
        safeMessage: 'Protection Group assignment is not implemented by this application yet. Replication configuration is separate from SRM protection. Use the VMware SRM Client until the group reconfiguration workflow is available.'
      }),
      protectionGroupName: pgRows[0].name,
      protectionGroupId: pgRows[0].protection_group_id,
      vmId,
      recoveryPlanId: recoveryPlanId || null
    });
  } catch (error) {
    return res.status(500).json(buildSafeError(req, {
      code: 'SRM_PROTECTION_FAILED',
      httpStatus: 500,
      safeMessage: 'An error occurred while attempting to protect VM.'
    }));
  }
};
