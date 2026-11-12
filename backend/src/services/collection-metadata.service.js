const {
  pool
} = require('../../db');

const {
  buildFreshness,
  combineFreshness,
  latestTimestamp
} = require('./data-freshness.service');

const VR_SCOPE_COLUMNS = new Set([
  'sync_status',
  'visibility_sync_status',
  'vr_info_sync_status',
  'management_servers_sync_status',
  'replication_servers_sync_status',
  'pairing_issues_sync_status',
  'replication_issues_sync_status',
  'tasks_sync_status'
]);

const SRM_SCOPE_COLUMNS = new Set([
  'core_sync_status',
  'pairing_sync_status',
  'server_sync_status',
  'protection_group_sync_status',
  'protected_vm_sync_status',
  'recovery_plan_sync_status',
  'recovery_plan_vm_sync_status',
  'network_mapping_sync_status',
  'test_network_mapping_sync_status',
  'folder_mapping_sync_status',
  'resource_mapping_sync_status',
  'storage_policy_mapping_sync_status',
  'placeholder_datastore_sync_status',
  'issue_sync_status',
  'task_sync_status'
]);

function fromRows(
  rows,
  scopeColumns,
  lastCollectedAt = null
) {
  if (rows.length > 1) {
    return combineFreshness(
      rows.map(
        row =>
          fromRows(
            [row],
            scopeColumns
          )
      )
    );
  }

  const statuses = rows.flatMap(
    row =>
      scopeColumns.map(
        column => row[column]
      )
  );

  const lastSuccessfulCollectionAt =
    latestTimestamp(
      rows.map(
        row =>
          row.last_successful_sync_at
      )
    );

  const lastCollectionAttemptAt =
    latestTimestamp(
      rows.flatMap(
        row => [
          row.last_sync_started_at,
          row.updated_at
        ]
      )
    );

  const failedRow = rows.find(
    row =>
      scopeColumns.some(
        column =>
          [
            'FAILED',
            'ERROR',
            'FETCH_FAILED'
          ].includes(
            String(
              row[column] || ''
            ).toUpperCase()
          )
      )
  );

  return buildFreshness({
    lastCollectedAt:
      lastSuccessfulCollectionAt ||
      lastCollectedAt,

    lastSuccessfulCollectionAt,
    lastCollectionAttemptAt,
    scopeStatuses: statuses,

    collectionErrorType:
      failedRow
        ? 'UPSTREAM_ERROR'
        : null,

    collectionErrorCode:
      failedRow?.last_error_code ||
      null
  });
}

async function getVrFreshness(
  scopeColumn = 'sync_status',
  lastCollectedAt = null
) {
  if (
    !VR_SCOPE_COLUMNS.has(scopeColumn)
  ) {
    throw new Error(
      'Unsupported VR freshness scope'
    );
  }

  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result(
      (parent => {
        let rows = [
          R.context(parent)
        ];

        rows = R.join(
          rows,
          "c",
          r =>
            views["current_connections"] ||
            s.read("current_connections"),
          r => true,
          "INNER JOIN"
        );

        rows = R.join(
          rows,
          "s",
          r =>
            views["current_vr_sync_state"] ||
            s.read("current_vr_sync_state"),
          r =>
            R.binary(
              "=",
              R.ref(
                r,
                "connection_id",
                "s"
              ),
              R.ref(
                r,
                "id",
                "c"
              )
            ),
          "LEFT JOIN"
        );

        rows = rows.filter(
          r =>
            R.binary(
              "=",
              R.ref(
                r,
                "system_type",
                "c"
              ),
              "VR"
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
              ...R.star(r, "s")
            }).map(value => ({
              value,
              r: R.projectContext(
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
                  "id",
                  "c"
                ),
                R.ref(
                  b.r,
                  "id",
                  "c"
                ),
                "ASC",
                null
              ]
            ])
        );

        return result
          .slice(0)
          .map(x => x.value);
      })(null)
    );
  }, [], false);

  return fromRows(
    rows,
    [scopeColumn],
    lastCollectedAt
  );
}

async function getSrmFreshness(
  scopeColumns = [
    'core_sync_status'
  ],
  lastCollectedAt = null
) {
  const columns =
    scopeColumns.filter(
      column =>
        SRM_SCOPE_COLUMNS.has(column)
    );

  if (
    !columns.length ||
    columns.length !==
      scopeColumns.length
  ) {
    throw new Error(
      'Unsupported SRM freshness scope'
    );
  }

  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result(
      (parent => {
        let rows = [
          R.context(parent)
        ];

        rows = R.join(
          rows,
          "c",
          r =>
            views["current_connections"] ||
            s.read("current_connections"),
          r => true,
          "INNER JOIN"
        );

        rows = R.join(
          rows,
          "s",
          r =>
            views["current_srm_sync_state"] ||
            s.read("current_srm_sync_state"),
          r =>
            R.binary(
              "=",
              R.ref(
                r,
                "connection_id",
                "s"
              ),
              R.ref(
                r,
                "id",
                "c"
              )
            ),
          "LEFT JOIN"
        );

        rows = rows.filter(
          r =>
            R.binary(
              "=",
              R.ref(
                r,
                "system_type",
                "c"
              ),
              "SRM"
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
              ...R.star(r, "s")
            }).map(value => ({
              value,
              r: R.projectContext(
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
                  "id",
                  "c"
                ),
                R.ref(
                  b.r,
                  "id",
                  "c"
                ),
                "ASC",
                null
              ]
            ])
        );

        return result
          .slice(0)
          .map(x => x.value);
      })(null)
    );
  }, [], false);

  return fromRows(
    rows,
    columns,
    lastCollectedAt
  );
}

async function getVcenterFreshness(
  lastCollectedAt = null
) {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result(
      (parent => {
        let rows = [
          R.context(parent)
        ];

        rows = R.join(
          rows,
          "current_connections",
          r =>
            views["current_connections"] ||
            s.read("current_connections"),
          r => true,
          "INNER JOIN"
        );

        rows = rows.filter(
          r =>
            R.binary(
              "AND",
              R.binary(
                "=",
                R.ref(
                  r,
                  "system_type",
                  null
                ),
                "VCENTER"
              ),
              R.binary(
                "=",
                R.ref(
                  r,
                  "is_active",
                  null
                ),
                true
              )
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
              "last_sync_status":
                R.ref(
                  r,
                  "last_sync_status",
                  null
                ),

              "last_successful_sync_at":
                R.ref(
                  r,
                  "last_sync_at",
                  null
                ),

              "last_sync_started_at":
                R.ref(
                  r,
                  "last_sync_at",
                  null
                ),

              "last_error_code":
                R.ref(
                  r,
                  "last_sync_error_code",
                  null
                )
            }).map(value => ({
              value,
              r: R.projectContext(
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
                  "id",
                  null
                ),
                R.ref(
                  b.r,
                  "id",
                  null
                ),
                "ASC",
                null
              ]
            ])
        );

        return result
          .slice(0)
          .map(x => x.value);
      })(null)
    );
  }, [], false);

  return fromRows(
    rows,
    ['last_sync_status'],
    lastCollectedAt
  );
}

async function getUnifiedFreshness() {
  const results =
    await Promise.allSettled([
      getVcenterFreshness(),
      getVrFreshness(
        'sync_status'
      ),
      getSrmFreshness([
        'core_sync_status'
      ])
    ]);

  const safe = result =>
    result.status === 'fulfilled'
      ? result.value
      : buildFreshness({
          collectionErrorType:
            'BACKEND_ERROR',

          collectionErrorCode:
            'FRESHNESS_QUERY_FAILED'
        });

  const [
    vcenter,
    vr,
    srm
  ] = results.map(safe);

  return {
    vcenter,
    vr,
    srm,

    overall:
      combineFreshness([
        vcenter,
        vr,
        srm
      ])
  };
}

module.exports = {
  getVrFreshness,
  getSrmFreshness,
  getVcenterFreshness,
  getUnifiedFreshness
};