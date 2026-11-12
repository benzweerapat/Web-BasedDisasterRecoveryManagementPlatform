const {
  pool
} = require('../../db');

const journal =
  require('../repositories/srm-write.repository');

const {
  withGateway
} = require('./srm-write-gateway');

const {
  step,
  SafetyError
} = require('./srm-write-engine');

const {
  classifyOperationError
} = require('../utils/operation-error.util');

let running = false;

const concurrency = Math.max(
  1,
  Math.min(
    6,
    Number(
      process.env.SRM_WRITE_CONCURRENCY ||
      4
    )
  )
);

function resourceKey(item) {
  const intent =
    item?.intent ||
    {};

  const resource =
    intent.objectId
    ||
    (
      intent.kind === 'mapping'
        ? `${intent.mappingType}:${intent.sourceObject || intent.expected?.sourceObject}`
        : intent.changes?.name
    )
    ||
    item.id;

  return `${intent.pairId || 'unknown'}:${intent.kind || 'unknown'}:${resource}`;
}

async function processItem(item) {
  const lock =
    await pool.connect();

  let locked = false;

  const key =
    resourceKey(item);

  try {
    locked = (
      await lock.run(
        (s, p) => {
          const R = s.helpers;

          return R.result((parent => {
            let rows = [
              R.context(parent)
            ];

            let groups =
              rows.map(r => [r]);

            return groups.flatMap(g => {
              const r =
                g[0] ||
                R.context(parent);

              return R.expand({
                "locked": s.tryLock(
                  R.fn(
                    "hashtextextended",
                    [p[0], 0]
                  )
                )
              }).map(value => ({
                value,
                r: R.projectContext(
                  r,
                  value
                ),
                g
              }));
            }).slice(0).map(
              x => x.value
            );
          })(null));
        },
        [
          `srm-worker:${key}`
        ],
        false
      )
    ).rows[0].locked;

    if (!locked) return;

    const op =
      await journal.get(item.id);

    try {
      await withGateway(
        op.intent,
        g =>
          op.intent.kind ===
            'execution'
            ? require(
              './recovery-execution'
            ).step(
              op,
              g,
              journal
            )
            : step(
              op,
              g,
              journal
            )
      );
    } catch (e) {
      const safe =
        classifyOperationError(
          e,
          {
            upstream: true
          }
        );

      const elapsed =
        Date.now() -
        new Date(
          op.startedAt
        ).getTime();

      const transientSession = [
        'SRM_SESSION_BUSY',
        'SRM_SESSION_LOGIN_UNCERTAIN',
        'SRM_SESSION_CLEANUP_FAILED'
      ].includes(e.code);

      const shouldFailValidation =
        op.state === 'VALIDATING' &&
        !transientSession &&
        (
          e.definite ||
          e instanceof SafetyError ||
          [
            'INVALID_STATE',
            'VALIDATION_ERROR',
            'WRITE_CONFLICT',
            'SRM_OPERATION_FAILED',
            'CONTRACT_ERROR',
            'NOT_FOUND'
          ].includes(safe.type) ||
          elapsed > 60000
        );

      if (
        shouldFailValidation
      ) await journal.transition(
        op,
        'FAILED',
        {
          error:
            e.code ||
            safe.code ||
            'VALIDATION_FAILED'
        }
      );
    }
  } finally {
    if (locked) await lock.run(
      (s, p) => {
        const R = s.helpers;

        return R.result((parent => {
          let rows = [
            R.context(parent)
          ];

          let groups =
            rows.map(r => [r]);

          return groups.flatMap(g => {
            const r =
              g[0] ||
              R.context(parent);

            return R.expand({
              "pg_advisory_unlock":
                s.unlock(
                  R.fn(
                    "hashtextextended",
                    [p[0], 0]
                  )
                )
            }).map(value => ({
              value,
              r: R.projectContext(
                r,
                value
              ),
              g
            }));
          }).slice(0).map(
            x => x.value
          );
        })(null));
      },
      [
        `srm-worker:${key}`
      ],
      false
    );

    lock.release();
  }
}

async function tick() {
  if (running) return;

  running = true;

  try {
    const selected = [];
    const pairs = new Set();

    for (
      const item of
      await journal.pending()
    ) {
      // VMware SRM allows only a small number of sessions and responds with
      // 429 when two writes open sessions for the same local pair. Queue many
      // objects, but advance only one operation per pair in each worker pass.
      const pair = String(
        item.intent?.pairId ||
        'unknown'
      );

      if (pairs.has(pair)) continue;

      pairs.add(pair);
      selected.push(item);

      if (
        selected.length >=
        concurrency
      ) break;
    }

    await Promise.allSettled(
      selected.map(processItem)
    );
  } finally {
    running = false;
  }
}

function start() {
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