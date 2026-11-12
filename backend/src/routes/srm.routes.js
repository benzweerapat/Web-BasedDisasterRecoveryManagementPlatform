const express = require('express');
const router = express.Router();
const srmController = require('../controllers/srm.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { csrfProtection } = require('../middleware/csrf.middleware');
const write=require('../controllers/srm-write.controller');
const execution=require('../controllers/recovery-execution.controller');

router.get('/recovery-plans/:id/available-actions',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),execution.options);
router.get('/recovery-plans/:id/active-operation',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),execution.progress);
router.post('/recovery-plans/:id/operations/:operationId/cancel',requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,execution.cancel);
router.post('/recovery-plans/:id/execute/:action',requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,execution.submit);

router.get('/operations/:operationId',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),write.operation);

for(const [path,kind] of [['protection-groups','pg'],['recovery-plans','rp']]) {
  router.post(`/${path}`,requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,write.submit(kind,'create'));
  router.post(`/${path}/:id/reconfigure`,requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,write.submit(kind,'edit'));
  router.delete(`/${path}/:id`,requireAuth,requireRole('ADMIN'),csrfProtection,write.submit(kind,'delete'));
  router.post(`/${path}/:id/${kind==='pg'?'members':'protection-groups'}`,requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,write.submit(kind,'members'));
}

router.post('/inventory-mappings/:mappingType',requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,write.submit('mapping','create'));
router.delete('/inventory-mappings/:mappingType/:mappingId',requireAuth,requireRole('ADMIN'),csrfProtection,write.submit('mapping','delete'));
router.post('/inventory-mappings/:mappingType/:mappingId/replace',requireAuth,requireRole('ADMIN'),csrfProtection,write.submit('mapping','replace'));
router.get('/pairings/:id/replicated-vms',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),write.replicatedVms);
router.get('/pairings/:id/options',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),write.options);
router.get('/pairings/:id/inventory/:mappingType',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),write.inventory);
router.post('/placeholder-datastores',requireAuth,requireRole('OPERATOR','ADMIN'),csrfProtection,write.createPlaceholderDatastore);
router.delete('/placeholder-datastores/:id',requireAuth,requireRole('ADMIN'),csrfProtection,write.deletePlaceholderDatastore);
router.get('/placeholder-datastores/tasks/:taskId',requireAuth,requireRole('VIEWER','OPERATOR','ADMIN'),write.placeholderDatastoreTask);

router.get('/site-pairs', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getSitePairs);
router.get('/srm-servers', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getSrmServers);
router.get('/protection-groups', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getProtectionGroups);
router.get('/recovery-plans', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getRecoveryPlans);
router.get('/inventory-mappings', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getMappings);
router.get('/placeholder-datastores', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getPlaceholderDatastores);
router.get('/issues', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getIssues);
router.get('/sync-state', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getSyncState);
router.get('/site-pairs/:id', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getSitePairById);
router.get('/protection-groups/:id', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getProtectionGroupById);
router.get('/protection-groups/:id/vms', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getProtectionGroupVms);
router.get('/protected-vms', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getProtectedVms);
router.get('/recovery-plans/:id', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getRecoveryPlanById);
router.get('/recovery-plans/:id/vms', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getRecoveryPlanVms);
router.get('/recovery-plans/:id/protection-groups', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getRecoveryPlanGroups);
router.get('/recovery-plans/:id/history', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getRecoveryPlanHistory);
router.get('/recovery-plans/:id/steps', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getRecoveryPlanSteps);
router.get('/mappings', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), srmController.getMappings);

router.post('/connections/:id/sync', requireAuth, requireRole('OPERATOR', 'ADMIN'), csrfProtection, srmController.syncSrm);
router.post('/protection-groups/:id/protect-vm', requireAuth, requireRole('OPERATOR', 'ADMIN'), csrfProtection, write.protectVm);
router.post('/protection-groups/:id/configure-all-vms', requireAuth, requireRole('OPERATOR', 'ADMIN'), csrfProtection, write.configureAllVms);

module.exports = router;
