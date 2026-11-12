const {
  pool
} = require('../../db');

const tasks =
  require(
    '../repositories/vr-management.repository'
  );

const management =
  require(
    './vr-management.service'
  );

const adapter =
  require(
    '../adapters/vmware/vr-management.adapter'
  );

let running = false;

async function readOperationObservations(
  row,
  includePeers = false
) {
  const {
    rows: observed
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
            "current_vr_replications",

            r =>
              views["current_vr_replications"] ||
              s.read(
                "current_vr_replications"
              ),

            r => true,
            "INNER JOIN"
          );

          rows = rows.filter(
            r =>
              R.binary(
                "AND",

                R.binary(
                  "AND",

                  R.binary(
                    "AND",

                    R.binary(
                      "OR",

                      p[4],

                      R.binary(
                        "=",

                        R.ref(
                          r,
                          "connection_id",
                          null
                        ),

                        p[0]
                      )
                    ),

                    R.binary(
                      "=",

                      R.ref(
                        r,
                        "vm_id",
                        null
                      ),

                      p[1]
                    )
                  ),

                  R.binary(
                    "=",

                    R.ref(
                      r,
                      "source_vc_id",
                      null
                    ),

                    p[2]
                  )
                ),

                R.binary(
                  "=",

                  R.ref(
                    r,
                    "target_vc_id",
                    null
                  ),

                  p[3]
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
                  "connection_id":
                    R.ref(
                      r,
                      "connection_id",
                      null
                    ),

                  "raw_status":
                    R.ref(
                      r,
                      "raw_status",
                      null
                    ),

                  "rpo_minutes":
                    R.ref(
                      r,
                      "rpo_minutes",
                      null
                    ),

                  "last_sync_at":
                    R.ref(
                      r,
                      "last_sync_at",
                      null
                    )
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

    [
      row.connection_id,
      row.vm_id,

      row.operation_context
        .sourceVcenterId,

      row.operation_context
        .targetVcenterId,

      includePeers
    ],

    false
  );

  return observed;
}

function unknownOutcomeConfirmed(
  row,
  observed
) {
  if (
    row.operation_type ===
    'unconfigure'
  ) {
    return observed.length === 0;
  }

  const source =
    observed.find(
      item =>
        item.connection_id ===
        row.connection_id
    );

  if (!source) return false;

  if (
    row.operation_type === 'pause'
  ) {
    return source.raw_status ===
      'PAUSED';
  }

  if (
    row.operation_type === 'resume'
  ) {
    return ![
      'PAUSED',
      'UNKNOWN'
    ].includes(source.raw_status);
  }

  if (
    [
      'configure',
      'reconfigure'
    ].includes(row.operation_type)
  ) {
    return row.operation_context
      ?.expectedRpo == null ||

      Number(
        source.rpo_minutes
      ) ===

      Number(
        row.operation_context
          .expectedRpo
      );
  }

  if (
    row.operation_type === 'sync'
  ) {
    const synchronizedAt =
      Date.parse(
        source.last_sync_at || ''
      );

    const submittedAt =
      Date.parse(
        row.start_time || ''
      );

    return Number.isFinite(
      synchronizedAt
    ) &&
      Number.isFinite(
        submittedAt
      ) &&
      synchronizedAt >= submittedAt;
  }

  return false;
}

async function tick() {
  if (running) return;

  running = true;

  try {
    // UNKNOWN submissions require reconciliation, not a synthetic timeout failure.
    for (
      const row of
      await tasks.pending()
    ) {
      try {
        let status = row.status;

        if (status === 'UNKNOWN') {
          const observed =
            await readOperationObservations(
              row,

              row.operation_type ===
                'unconfigure'
            );

          if (
            !unknownOutcomeConfirmed(
              row,
              observed
            )
          ) {
            continue;
          }

          await tasks.update(
            row.task_id,
            {},
            'SUCCESS',
            'SUCCESS'
          );

          continue;
        }

        if (
          status !==
          'REFRESH_PENDING'
        ) {
          const task =
            await management.withPair(
              row.pairing_row_id,

              async x => {
                // Endpoint edits must not silently transfer a task to a different server.
                if (
                  x.c.id !==
                    row.connection_id ||

                  x.source !==
                    row.operation_context
                      ?.sourceVcenterId ||

                  x.target !==
                    row.operation_context
                      ?.targetVcenterId
                ) {
                  throw adapter.fail(
                    'TASK_SCOPE_CHANGED'
                  );
                }

                const r =
                  await adapter.request(
                    x.c,
                    x.session,
                    'GET',

                    `/tasks/${adapter.segment(
                      row.upstream_task_id
                    )}`
                  );

                return adapter.parseTask(
                  r.data
                );
              }
            );

          status =
            task.status === 'SUCCESS'
              ? 'REFRESH_PENDING'
              : task.status;

          if (
            status !== row.status
          ) {
            await tasks.update(
              row.task_id,
              task,
              status,

              status ===
                'REFRESH_PENDING'
                ? 'PENDING'
                : 'NOT_STARTED'
            );
          }
        }

        if (
          status ===
          'REFRESH_PENDING'
        ) {
          const sync =
            require(
              './vr-sync.service'
            );

          // Start with the authoritative source connection. Operations that
          // retain a row can be verified locally; removal must also clear any
          // peer observation that would keep the deleted replication visible.
          const result =
            await sync.runSync(
              row.connection_id,
              {
                requestedBy: {
                  username:
                    row.username,

                  role:
                    row.requested_role
                },

                requestId:
                  row.request_id
              }
            );

          if (
            ![
              'OK',
              'SUCCESS'
            ].includes(
              result?.status
            )
          ) {
            throw adapter.fail(
              'POST_OPERATION_COLLECTION_FAILED'
            );
          }

          const removing =
            row.operation_type ===
            'unconfigure';

          let observed =
            await readOperationObservations(
              row,
              removing
            );

          if (removing) {
            // The API also displays peer observations. A missing source row is
            // insufficient while a cached peer row still advertises replication.
            if (
              observed.some(
                item =>
                  item.connection_id ===
                  row.connection_id
              )
            ) {
              throw adapter.fail(
                'READ_MODEL_NOT_CONVERGED'
              );
            }

            const peers = [
              ...new Set(
                observed.map(
                  item =>
                    item.connection_id
                )
              )
            ];

            for (
              const connectionId
              of peers
            ) {
              const peerResult =
                await sync.runSync(
                  connectionId,
                  {
                    requestedBy: {
                      username:
                        row.username,

                      role:
                        row.requested_role
                    },

                    requestId:
                      row.request_id
                  }
                );

              if (
                ![
                  'OK',
                  'SUCCESS'
                ].includes(
                  peerResult?.status
                )
              ) {
                throw adapter.fail(
                  'POST_OPERATION_COLLECTION_FAILED'
                );
              }
            }

            observed =
              await readOperationObservations(
                row,
                true
              );
          }

          if (
            row.operation_type ===
              'unconfigure'
              ? observed.length !== 0
              : observed.length !== 1
          ) {
            throw adapter.fail(
              'READ_MODEL_NOT_CONVERGED'
            );
          }

          if (
            row.operation_type ===
              'pause' &&

            observed[0].raw_status !==
              'PAUSED'
          ) {
            throw adapter.fail(
              'READ_MODEL_NOT_CONVERGED'
            );
          }

          if (
            row.operation_type ===
              'resume' &&

            [
              'PAUSED',
              'UNKNOWN'
            ].includes(
              observed[0].raw_status
            )
          ) {
            throw adapter.fail(
              'READ_MODEL_NOT_CONVERGED'
            );
          }

          if (
            [
              'configure',
              'reconfigure'
            ].includes(
              row.operation_type
            ) &&

            Number(
              observed[0].rpo_minutes
            ) !==

            row.operation_context
              .expectedRpo
          ) {
            throw adapter.fail(
              'READ_MODEL_NOT_CONVERGED'
            );
          }

          await tasks.update(
            row.task_id,
            {},
            'SUCCESS',
            'SUCCESS'
          );
        }
      } catch (_) {
        // Keep nonterminal work and its duplicate guard. Poll/collection failure is not operation success.
        if (
          row.status ===
            'REFRESH_PENDING' &&

          row.refresh_status !==
            'RETRY_PENDING'
        ) {
          await tasks.update(
            row.task_id,
            {},
            'REFRESH_PENDING',
            'RETRY_PENDING'
          );
        }
      }
    }
  } finally {
    running = false;
  }
}

async function start() {
  // A crash while posting may have reached VMware. Require reconciliation, never replay the POST.
  await pool.run(
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
              "=",

              R.ref(
                r,
                "status",
                null
              ),

              "SUBMITTING"
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
            "status": "UNKNOWN"
          };
        }
      );

      return R.changed(
        rows.length
      );
    },

    [],
    true
  );

  const timer = setInterval(
    () =>
      tick().catch(() => {}),
    5000
  );

  timer.unref();

  return timer;
}

module.exports = {
  tick,
  start
};