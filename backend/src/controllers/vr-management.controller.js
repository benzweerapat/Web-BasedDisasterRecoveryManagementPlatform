const service =
  require(
    '../services/vr-management.service'
  );

const tasks =
  require(
    '../repositories/vr-management.repository'
  );

const {
  buildSafeError
} = require(
  '../utils/api-response.util'
);

const handle = fn =>
  async (req,res) => {
    try {
      const data =
        await fn(req);

      res
        .status(
          req.method === 'POST'
            ? 202
            : 200
        )
        .json({
          success: true,
          data,
          requestId: req.id
        });
    } catch(error) {
      console.error(
        '[VR Management Controller Error]',
        error?.message || error,
        error?.code,
        error?.stack
      );

      const body =
        buildSafeError(
          req,
          {
            type:
              error.type ||
              'BACKEND_ERROR',

            code:
              error.type
                ? error.code
                : 'VR_MANAGEMENT_FAILED',

            httpStatus:
              error.httpStatus ||
              500,

            safeMessage:
              error.safeMessage ||
              'The replication request could not be completed.'
          }
        );

      if (error.operationId) {
        body.operationId =
          error.operationId;
      }

      res
        .status(
          error.httpStatus || 500
        )
        .json(body);
    }
  };

exports.pairs =
  handle(
    () => service.getPairs()
  );

exports.vms =
  handle(
    req =>
      service.getSuitableVms(
        req.params.pairId
      )
  );

exports.configuration =
  handle(
    req =>
      service.getConfiguration(
        req.params.pairId,
        req.query.vmId
      )
  );

exports.currentConfiguration =
  handle(
    req =>
      service.getCurrentConfiguration(
        req.params.pairId,
        req.query.replicationId
      )
  );

exports.replications =
  handle(
    req =>
      service.getManageableReplications(
        req.params.pairId
      )
  );

exports.submit =
  operation =>
    handle(
      req =>
        service.submit(
          req.body.pairId,
          operation,
          req.body,
          req.authUser,
          req.id
        )
    );

exports.operation =
  handle(
    async req => {
      const row =
        await tasks.get(
          req.params.operationId
        );

      if (!row) {
        const e =
          new Error('NOT_FOUND');

        e.httpStatus = 404;

        throw e;
      }

      return tasks.safe(row);
    }
  );