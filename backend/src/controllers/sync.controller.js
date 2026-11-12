const syncAllService = require('../services/sync-all.service');
const { buildSafeError } = require('../utils/api-response.util');

exports.syncAll = async (req, res, next) => {
  const isStream = req.query.stream === 'true' || req.headers.accept?.includes('text/event-stream');
  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await syncAllService.syncAllVmwareData({
        requestedBy: req.authUser,
        requestId: req.id,
        ip: req.ip,
        onProgress: (progress) => {
          sendEvent('progress', progress);
        }
      });
      require('../services/sync-schedule.service').record(result);
      sendEvent('complete', { success: true, data: result, requestId: req.id });
      res.end();
    } catch (error) {
      if (error.code === 'SYNC_IN_PROGRESS') {
        sendEvent('error', {
          type: 'SYNC_IN_PROGRESS',
          code: 'SYNC_IN_PROGRESS',
          httpStatus: 409,
          safeMessage: 'Synchronization is already in progress. Please wait for the current operation to finish.'
        });
      } else {
        sendEvent('error', {
          type: error.type || 'BACKEND_ERROR',
          code: error.code || 'SYNC_ALL_FAILED',
          httpStatus: error.statusCode || error.status || 500,
          safeMessage: error.safeMessage || error.message || 'Unable to synchronize data'
        });
      }
      res.end();
    }
    return;
  }
    try {
    const result = await syncAllService.syncAllVmwareData({
      requestedBy: req.authUser,
      requestId: req.id,
      ip: req.ip
    });
    require('../services/sync-schedule.service').record(result);
    return res.status(200).json({ success: true, data: result, requestId: req.id });
  } catch (error) {
    if (error.code === 'SYNC_IN_PROGRESS') {
      return res.status(409).json(buildSafeError(req, {
        type: 'SYNC_IN_PROGRESS',
        code: 'SYNC_IN_PROGRESS',
        httpStatus: 409,
        safeMessage: 'Synchronization is already in progress. Please wait for the current operation to finish.'
      }));
    }
    return next(error);
  }
};

async function syncDedicated(req, res, next, runner) {
  try {
    const result = await runner({
      requestedBy: req.authUser,
      requestId: req.id,
      ip: req.ip
    });
    require('../services/sync-schedule.service').record(result);
    return res.status(200).json({ success: true, data: result, requestId: req.id });
  } catch (error) {
    if (error.code === 'SYNC_IN_PROGRESS') {
      return res.status(409).json(buildSafeError(req, {
        type: 'SYNC_IN_PROGRESS',
        code: 'SYNC_IN_PROGRESS',
        httpStatus: 409,
        safeMessage: 'Synchronization is already in progress. Please wait for the current operation to finish.'
      }));
    }
    return next(error);
  }
}

exports.syncVr = (req, res, next) => syncDedicated(
  req,
  res,
  next,
  context => syncAllService.syncVrVmwareData(context)
);

exports.syncSrm = (req, res, next) => syncDedicated(
  req,
  res,
  next,
  context => syncAllService.syncSrmVmwareData(context)
);
