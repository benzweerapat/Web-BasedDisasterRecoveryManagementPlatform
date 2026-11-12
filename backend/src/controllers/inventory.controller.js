const inventorySyncService = require('../services/inventory-sync.service');
const { buildSafeError } = require('../utils/api-response.util');

class InventoryController {
  async sync(req, res) {
    try {
      const connectionId = req.params.id;
      const actor = req.authUser || req.session?.user || { username: 'system', role: 'SYSTEM' };

      if (!connectionId || isNaN(connectionId)) {
        return res.status(400).json({ error: 'INVALID_CONNECTION_ID' });
      }

      const result = await inventorySyncService.syncVCenterInventory(connectionId, actor, { ip: req.ip, requestId: req.id });
      res.status(200).json(result);
    } catch (err) {
      console.error('Inventory sync request failed', { requestId: req.id, code: err.code || 'SYNC_FAILED' });
      if (err.code === 'INVENTORY_SYNC_IN_PROGRESS' || err.code === 'SYNC_IN_PROGRESS') {
        return res.status(409).json(buildSafeError(req, {
          type: 'SYNC_IN_PROGRESS', code: 'SYNC_IN_PROGRESS', httpStatus: 409,
          safeMessage: 'Synchronization is already in progress. Please wait for the current operation to finish.'
        }));
      }
      if (err.code === 'INVALID_STATE' || err.code === 'INVENTORY_LIMIT_EXCEEDED' || err.code === 'AUTH_FAILED') {
        return res.status(400).json(buildSafeError(req, { code: err.code, httpStatus: 400, safeMessage: 'vCenter cannot be synchronized in its current state' }));
      }
      return res.status(500).json(buildSafeError(req, { code: err.code || 'SYNC_FAILED', httpStatus: 500, safeMessage: 'Unable to synchronize vCenter data' }));
    }
  }
}

module.exports = new InventoryController();
