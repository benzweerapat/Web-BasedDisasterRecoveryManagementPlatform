const {
  pool
} = require('../../db');

const audit =
  require('../services/audit.service');

const {
  randomUUID
} = require('crypto');

const {
  ManagementError
} = require(
  '../adapters/vmware/vr-management.adapter'
);

const safe = r => ({
  operationId: r.task_id,
  operationType: r.operation_type,
  status: r.status,
  taskId: r.upstream_task_id,
  vmId: r.vm_id,
  replicationId: r.replication_id,
  startedAt: r.start_time,
  completedAt: r.completed_at,
  refreshStatus: r.refresh_status,
  progress: r.progress
});

async function reserve(
  x,
  operation,
  input,
  user,
  requestId
) {
  const db = await pool.connect();

  try {
    await db.begin();

    const id = randomUUID();

    const context = {
      sourceVcenterId: x.source,
      targetVcenterId: x.target,
      sourceSite: x.sourceName,
      targetSite: x.targetName,
      expectedRpo: input.rpo ?? null,

      ...(
        operation === 'unconfigure'
          ? {
              stopMode:
                input.stopMode,

              retainReplicaDisks:
                input.retainReplicaDisks
            }
          : {}
      )
    };

    // An uncertain submission may have reached VMware. Keep its duplicate guard
    // until reconciliation establishes the real outcome; elapsed time is not failure.
    await db.run(
      (s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.insert(
          "tasks",

          [[
            p[0],
            p[1],
            p[0],
            "SUBMITTING",
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            p[7],
            p[8],
            p[9],
            p[10],
            p[11],
            "NOT_STARTED"
          ]].map(
            a =>
              Object.fromEntries(
                [
                  "task_id",
                  "name",
                  "target",
                  "status",
                  "username",
                  "operation_type",
                  "connection_id",
                  "remote_connection_id",
                  "pairing_row_id",
                  "vm_id",
                  "replication_id",
                  "request_id",
                  "requested_role",
                  "operation_context",
                  "refresh_status"
                ].map(
                  (k, i) => [
                    k,
                    a[i]
                  ]
                )
              )
          ),

          null
        );

        return R.changed(
          rows.length
        );
      },

      [
        id,
        `VR ${operation}`,
        user.username,
        operation,
        x.c.id,
        x.remoteConnectionId,
        x.stored.id,
        input.vmId,
        input.replicationId || null,
        requestId,
        user.role,
        context
      ],

      true
    );

    await audit.logActivity(
      user,
      `VR_${operation.toUpperCase()}`,
      id,
      'SUBMITTED',
      {
        ...context,
        vmId: input.vmId,
        replicationId:
          input.replicationId ||
          null,
        operationId: id,
        requestId
      },
      null,
      db
    );

    await db.commit();

    return id;
  } catch (e) {
    await db.rollback();

    if (e.code === '23505') {
      const existing = (
        await pending()
      ).filter(
        row => (
          row.replication_id ===
            input.replicationId &&
          row.vm_id ===
            input.vmId &&
          row.pairing_row_id ===
            x.stored.id
        )
      ).at(-1);

      const conflict =
        new ManagementError(
          'VALIDATION_ERROR',
          'VR_OPERATION_IN_PROGRESS',
          409
        );

      if (existing?.task_id) {
        conflict.operationId =
          existing.task_id;
      }

      throw conflict;
    }

    throw e;
  } finally {
    db.release();
  }
}

async function update(
  id,
  task,
  status = task.status,
  refreshStatus = 'NOT_STARTED'
) {
  const db = await pool.connect();

  try {
    await db.begin();

    const {
      rows
    } = await db.run(
      (s, p) => {
        const R = s.helpers;
        const views = {};

        const rows = s.update(
          "tasks",

          row => {
            const r =
              R.rowContext(
                row,
                "tasks"
              );

            return R.binary(
              "AND",

              R.binary(
                "=",
                R.ref(
                  r,
                  "task_id",
                  null
                ),
                p[0]
              ),

              R.unary(
                "IS NOT NULL",
                R.ref(
                  r,
                  "operation_type",
                  null
                )
              )
            );
          },

          row => {
            const r =
              R.rowContext(
                row,
                "tasks"
              );

            return {
              "status":
                R.cast(
                  p[1],
                  {
                    "name":
                      "varchar"
                  }
                ),

              "upstream_task_id":
                R.fn(
                  "coalesce",
                  [
                    p[2],
                    R.ref(
                      r,
                      "upstream_task_id",
                      null
                    )
                  ]
                ),

              "progress":
                R.fn(
                  "coalesce",
                  [
                    p[3],
                    R.ref(
                      r,
                      "progress",
                      null
                    )
                  ]
                ),

              "refresh_status":
                p[4],

              "completed_at":
                R.binary(
                  "IN",
                  R.cast(
                    p[1],
                    {
                      "name":
                        "varchar"
                    }
                  ),
                  [
                    "SUCCESS",
                    "FAILED"
                  ]
                )
                  ? s.now()
                  : R.ref(
                      r,
                      "completed_at",
                      null
                    )
            };
          }
        );

        return R.result(
          rows.map(
            row => {
              const r =
                R.rowContext(
                  row,
                  "tasks"
                );

              return {
                ...R.star(r, null)
              };
            }
          )
        );
      },

      [
        id,
        status,
        task.taskId || null,
        task.progress,
        refreshStatus
      ],

      true
    );

    if (!rows[0]) {
      throw new Error(
        'TASK_NOT_FOUND'
      );
    }

    const r = rows[0];

    await audit.logActivity(
      {
        username: r.username,
        role: r.requested_role
      },

      `VR_${r.operation_type.toUpperCase()}`,

      id,
      status,

      {
        ...r.operation_context,
        vmId: r.vm_id,
        replicationId:
          r.replication_id,
        operationId: id,
        taskId:
          r.upstream_task_id,
        requestId: r.request_id,
        refreshStatus
      },

      null,
      db
    );

    await db.commit();

    return safe(r);
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}

async function get(id) {
  const {
    rows
  } = await pool.run(
    (s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result(
        (parent => {
          let rows = [
            R.context(parent)
          ];

          rows = R.join(
            rows,
            "tasks",

            r =>
              views["tasks"] ||
              s.read("tasks"),

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
                    "task_id",
                    null
                  ),
                  p[0]
                ),

                R.unary(
                  "IS NOT NULL",
                  R.ref(
                    r,
                    "operation_type",
                    null
                  )
                )
              )
          );

          let groups =
            rows.map(r => [r]);

          let result =
            groups.flatMap(
              g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  ...R.star(r, null)
                }).map(
                  value => ({
                    value,

                    r:
                      R.projectContext(
                        r,
                        value
                      ),

                    g
                  })
                );
              }
            );

          return result
            .slice(0)
            .map(x => x.value);
        })(null)
      );
    },

    [id],
    false
  );

  return rows[0];
}

async function pending() {
  const {
    rows
  } = await pool.run(
    (s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result(
        (parent => {
          let rows = [
            R.context(parent)
          ];

          rows = R.join(
            rows,
            "tasks",

            r =>
              views["tasks"] ||
              s.read("tasks"),

            r => true,
            "INNER JOIN"
          );

          rows = rows.filter(
            r =>
              R.binary(
                "AND",

                R.binary(
                  "AND",

                  R.unary(
                    "IS NOT NULL",
                    R.ref(
                      r,
                      "operation_type",
                      null
                    )
                  ),

                  R.binary(
                    "=",

                    R.fn(
                      "coalesce",
                      [
                        R.ref(
                          r,
                          "operation_provider",
                          null
                        ),
                        "VR"
                      ]
                    ),

                    "VR"
                  )
                ),

                R.binary(
                  "IN",
                  R.ref(
                    r,
                    "status",
                    null
                  ),
                  [
                    "SUBMITTED",
                    "RUNNING",
                    "REFRESH_PENDING",
                    "UNKNOWN"
                  ]
                )
              )
          );

          let groups =
            rows.map(r => [r]);

          let result =
            groups.flatMap(
              g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  ...R.star(r, null)
                }).map(
                  value => ({
                    value,

                    r:
                      R.projectContext(
                        r,
                        value
                      ),

                    g
                  })
                );
              }
            );

          result.sort(
            (a, b) =>
              R.order([
                [
                  R.ref(
                    a.r,
                    "start_time",
                    null
                  ),

                  R.ref(
                    b.r,
                    "start_time",
                    null
                  ),

                  "ASC",
                  null
                ]
              ])
          );

          return result
            .slice(
              0,
              0 + Number(100)
            )
            .map(x => x.value);
        })(null)
      );
    },

    [],
    false
  );

  return rows;
}

module.exports = {
  reserve,
  update,
  get,
  pending,
  safe
};