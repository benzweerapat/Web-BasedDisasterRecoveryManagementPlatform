const {
  pool
} = require('../../db');
const {
  randomUUID
} = require('crypto');
const audit = require('../services/audit.service');
const {
  classifyOperationError
} = require('../utils/operation-error.util');
const {
  fingerprint,
  terminal,
  SafetyError
} = require('../services/srm-write-engine');

const decode = r => r && {
  id: r.task_id,
  state: r.status,
  startedAt: r.start_time,
  intent: r.operation_context,
  data: r.saga_data || {},
  user: {
    id: r.saga_data?.userId,
    username: r.username,
    role: r.requested_role
  },
  requestId: r.request_id
};

const safe = op => {
  const error = ['SUCCESS', 'ROLLBACK_SUCCESS'].includes(op.state)
    ? null
    : (op.data.error || null);
  const classifiedError = error
    ? classifyOperationError({ code: error }, { upstream: true })
    : null;

  return ({
  operationId: op.id,
  state: op.state,
  startedAt: op.startedAt,
  lastUpdated: op.data.lastUpdated || op.startedAt,
  requestedBy: op.user?.username || null,
  operation: op.intent.action,
  planName: op.data.planName || op.intent.confirmName || null,
  cancelState: op.data.cancelState || null,
  vmwareStatus: op.data.vmwareStatus || null,
  taskId: op.data.taskId || null,
  finalOutcome: op.data.finalOutcome || null,
  upstreamCode: /^SRM_HTTP_\d{3}$/.test(String(op.data.upstreamCode || '')) ? op.data.upstreamCode : null,
  refreshStatus: ['SYNCED', 'RETRYING', 'DEGRADED'].includes(op.data.refreshStatus) ? op.data.refreshStatus : null,
  observedPlanStatus: typeof op.data.observedPlanStatus === 'string' ? op.data.observedPlanStatus : null,
  reconciliationOutcome: typeof op.data.reconciliationOutcome === 'string' ? op.data.reconciliationOutcome : null,

  // A reconciled success is authoritative. Preserve historical failure details
  // in the journal, but never present a successful operation as failed.
  error,
  safeMessage: classifiedError?.safeMessage || null,
  resolvedId: op.data.resolvedId || null
  });
};

async function reserve(intent, user, requestId, key, scope) {
  const db = await pool.connect();

  try {
    await db.begin();

    // Serialize reservation and idempotency lookup; no VMware calls in this transaction.
    await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "pg_advisory_xact_lock": s.lock(R.fn("hashtextextended", [p[0], 0]))
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [`srm-idempotency:${user.username}:${key}`], false);

    const old = (await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];

        rows = R.join(
          rows,
          "tasks",
          r => views["tasks"] || s.read("tasks"),
          r => true,
          "INNER JOIN"
        );

        rows = rows.filter(r =>
          R.binary(
            "AND",
            R.binary(
              "AND",
              R.binary(
                "=",
                R.ref(r, "operation_provider", null),
                "SRM"
              ),
              R.binary(
                "=",
                R.ref(r, "username", null),
                p[0]
              )
            ),
            R.binary(
              "=",
              R.ref(r, "idempotency_key", null),
              p[1]
            )
          )
        );

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
    }, [user.username, key], false)).rows[0];

    if (old) {
      if (old.status === 'FAILED') {
        await db.run(
          s => s.remove(
            "tasks",
            r => r.task_id === old.task_id
          ),
          [],
          true
        );
      } else {
        if (old.intent_hash !== fingerprint(intent)) throw new SafetyError('IDEMPOTENCY_KEY_REUSED');

        await db.commit();
        return decode(old);
      }
    }

    const id = randomUUID();

    const {
      rows
    } = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.insert(
        "tasks",
        [[
          p[0],
          p[1],
          p[0],
          "VALIDATING",
          p[2],
          p[3],
          p[4],
          p[5],
          "SRM",
          p[6],
          p[7],
          p[8],
          p[9],
          p[10]
        ]].map(a =>
          Object.fromEntries(
            [
              "task_id",
              "name",
              "target",
              "status",
              "username",
              "requested_role",
              "request_id",
              "operation_type",
              "operation_provider",
              "srm_scope_key",
              "idempotency_key",
              "intent_hash",
              "operation_context",
              "saga_data"
            ].map((k, i) => [k, a[i]])
          )
        ),
        null
      );

      return R.result(rows.map(row => {
        const r = R.rowContext(row, "tasks");

        return {
          ...R.star(r, null)
        };
      }));
    }, [
      id,
      `SRM ${intent.kind} ${intent.action}`,
      user.username,
      user.role,
      requestId,
      `${intent.kind}.${intent.action}`,
      scope,
      key,
      fingerprint(intent),
      intent,
      {
        userId: user.id || null
      }
    ], true);

    await audit.logActivity(
      user,
      'SRM_WRITE',
      id,
      'VALIDATING',
      {
        requestId,
        intent
      },
      null,
      db
    );

    await db.commit();

    return decode(rows[0]);
  } catch (e) {
    await db.rollback();

    if (e.code === '23505') throw new SafetyError('SRM_PAIR_WRITE_IN_PROGRESS');

    throw e;
  } finally {
    db.release();
  }
}

async function transition(op, state, extra = {}) {
  const db = await pool.connect();

  try {
    await db.begin();

    const data = {
      ...op.data,
      ...extra,
      lastUpdated: new Date().toISOString()
    };

    const {
      rows
    } = await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      const rows = s.update(
        "tasks",
        row => {
          const r = R.rowContext(row, "tasks");

          return R.binary(
            "AND",
            R.binary(
              "AND",
              R.binary(
                "=",
                R.ref(r, "task_id", null),
                p[0]
              ),
              R.binary(
                "=",
                R.ref(r, "operation_provider", null),
                "SRM"
              )
            ),
            R.binary(
              "=",
              R.ref(r, "status", null),
              p[5]
            )
          );
        },
        row => {
          const r = R.rowContext(row, "tasks");

          return {
            "status": p[1],
            "saga_data": p[2],
            "upstream_task_id": p[3],
            "completed_at": p[4]
              ? s.now()
              : R.ref(r, "completed_at", null)
          };
        }
      );

      return R.result(rows.map(row => {
        const r = R.rowContext(row, "tasks");

        return {
          ...R.star(r, null)
        };
      }));
    }, [
      op.id,
      state,
      data,
      data.taskId || null,
      terminal.has(state),
      op.state
    ], true);

    if (rows.length !== 1) throw new SafetyError('JOURNAL_CONCURRENT_UPDATE');

    await audit.logActivity(
      op.user,
      'SRM_WRITE',
      op.id,
      state,
      {
        requestId: op.requestId,
        intent: op.intent,
        ...data
      },
      null,
      db
    );

    await db.commit();

    return decode(rows[0]);
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}

async function get(id) {
  return decode((await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];

      rows = R.join(
        rows,
        "tasks",
        r => views["tasks"] || s.read("tasks"),
        r => true,
        "INNER JOIN"
      );

      rows = rows.filter(r =>
        R.binary(
          "AND",
          R.binary(
            "=",
            R.ref(r, "task_id", null),
            p[0]
          ),
          R.binary(
            "=",
            R.ref(r, "operation_provider", null),
            "SRM"
          )
        )
      );

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
  }, [id], false)).rows[0]);
}

async function pending() {
  return (await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];

      rows = R.join(
        rows,
        "tasks",
        r => views["tasks"] || s.read("tasks"),
        r => true,
        "INNER JOIN"
      );

      rows = rows.filter(r =>
        R.binary(
          "AND",
          R.binary(
            "=",
            R.ref(r, "operation_provider", null),
            "SRM"
          ),
          R.binary(
            "NOT IN",
            R.ref(r, "status", null),
            [
              "SUCCESS",
              "FAILED",
              "ROLLBACK_SUCCESS",
              "RECONCILIATION_BLOCKED",
              "ROLLBACK_FAILED"
            ]
          )
        )
      );

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

      result.sort((a, b) =>
        R.order([[
          R.ref(a.r, "start_time", null),
          R.ref(b.r, "start_time", null),
          "ASC",
          null
        ]])
      );

      return result
        .slice(0, 0 + Number(50))
        .map(x => x.value);
    })(null));
  }, [], false)).rows.map(decode);
}

async function latestExecution(pairId, objectId) {
  return decode((await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];

      rows = R.join(
        rows,
        "tasks",
        r => views["tasks"] || s.read("tasks"),
        r => true,
        "INNER JOIN"
      );

      rows = rows.filter(r =>
        R.binary(
          "AND",
          R.binary(
            "AND",
            R.binary(
              "AND",
              R.binary(
                "=",
                R.ref(r, "operation_provider", null),
                "SRM"
              ),
              R.binary(
                "=",
                R.member(
                  R.ref(r, "operation_context", null),
                  "kind",
                  "->>"
                ),
                "execution"
              )
            ),
            R.binary(
              "=",
              R.member(
                R.ref(r, "operation_context", null),
                "pairId",
                "->>"
              ),
              p[0]
            )
          ),
          R.binary(
            "=",
            R.member(
              R.ref(r, "operation_context", null),
              "objectId",
              "->>"
            ),
            p[1]
          )
        )
      );

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

      result.sort((a, b) =>
        R.order([[
          R.ref(a.r, "start_time", null),
          R.ref(b.r, "start_time", null),
          "DESC",
          null
        ]])
      );

      return result
        .slice(0, 0 + Number(1))
        .map(x => x.value);
    })(null));
  }, [
    String(pairId),
    objectId
  ], false)).rows[0]);
}

async function withOperationLock(id, fn) {
  const db = await pool.connect();
  let locked = false;

  try {
    locked = (await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "locked": s.tryLock(
              R.fn(
                "hashtextextended",
                [p[0], 0]
              )
            )
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [`srm-worker:${id}`], false)).rows[0].locked;

    if (!locked) throw new SafetyError('OPERATION_BUSY');

    return await fn(await get(id));
    } finally {
    if (locked) await db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [R.context(parent)];
        let groups = rows.map(r => [r]);

        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);

          return R.expand({
            "pg_advisory_unlock": s.unlock(
              R.fn(
                "hashtextextended",
                [p[0], 0]
              )
            )
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });

        return result.slice(0).map(x => x.value);
      })(null));
    }, [`srm-worker:${id}`], false);

    db.release();
  }
}

module.exports = {
  reserve,
  transition,
  get,
  pending,
  safe,
  latestExecution,
  withOperationLock
};
