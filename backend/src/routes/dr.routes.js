const express = require('express');
const router = express.Router();
const drController = require('../controllers/dr.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

router.get('/overview', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), drController.getOverview);
router.get('/vms', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), drController.getUnifiedVms);
router.get('/vms/:id', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), drController.getVmById);

module.exports = router;
