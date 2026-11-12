const express = require('express');
const router = express.Router();
const vrController = require('../controllers/vr.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { csrfProtection } = require('../middleware/csrf.middleware');

router.use(requireAuth);

const management = require('../controllers/vr-management.controller');
router.get('/management/pairings', requireRole('ADMIN','OPERATOR','VIEWER'), management.pairs);
router.get('/management/pairings/:pairId/vms', requireRole('ADMIN','OPERATOR','VIEWER'), management.vms);
router.get('/management/pairings/:pairId/configuration', requireRole('ADMIN','OPERATOR','VIEWER'), management.configuration);
router.get('/management/pairings/:pairId/current-configuration', requireRole('ADMIN','OPERATOR','VIEWER'), management.currentConfiguration);
router.get('/management/pairings/:pairId/replications', requireRole('ADMIN','OPERATOR','VIEWER'), management.replications);
router.get('/management/operations/:operationId', requireRole('ADMIN','OPERATOR','VIEWER'), management.operation);
router.post('/replications', requireRole('ADMIN','OPERATOR'), csrfProtection, management.submit('configure'));
for (const operation of ['reconfigure','pause','resume','sync','unconfigure']) {
  router.post(`/management/actions/${operation}`, requireRole(...(operation==='unconfigure'?['ADMIN']:['ADMIN','OPERATOR'])),
    csrfProtection, management.submit(operation));
}

router.get('/overview', requireRole('ADMIN', 'OPERATOR', 'VIEWER'), vrController.getOverview);
router.get('/pairings', requireRole('ADMIN', 'OPERATOR', 'VIEWER'), vrController.getPairings);
router.get('/pairings/:id', requireRole('ADMIN', 'OPERATOR', 'VIEWER'), vrController.getPairingById);
router.get('/replications', requireRole('ADMIN', 'OPERATOR', 'VIEWER'), vrController.getReplications);
router.get('/replications/:id', requireRole('ADMIN', 'OPERATOR', 'VIEWER'), vrController.getReplicationById);

router.post(
  '/connections/:id/sync',
  requireRole('ADMIN', 'OPERATOR'),
  csrfProtection,
  vrController.syncConnection
);


// Phase E3A.2 Visibility Routes
router.get('/issues', requireRole('VIEWER', 'OPERATOR', 'ADMIN'), vrController.getIssues);
router.get('/servers', requireRole('VIEWER', 'OPERATOR', 'ADMIN'), vrController.getServers);

module.exports = router;