const express = require('express');
const syncController = require('../controllers/sync.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { csrfProtection } = require('../middleware/csrf.middleware');

const router = express.Router();

router.get('/operations', requireAuth, async (req,res,next)=>{try{const {pool}=require('../../db');const result=await pool.run(s=>({rows:s.read('tasks').filter(r=>r.operation_provider==='SRM').map(r=>{const success=['SUCCESS','ROLLBACK_SUCCESS'].includes(r.status);return {id:'operation:'+r.task_id,sourceSystem:'APP',title:r.operation_context?.action||'Operation',entityName:r.saga_data?.planName||r.operation_context?.confirmName||r.operation_context?.changes?.name||'Application operation',normalizedStatus:r.status,startedAt:r.start_time,completedAt:r.end_time,lastCollectedAt:r.saga_data?.lastUpdated||r.start_time,error:success?null:(r.saga_data?.error||null)};})}),[],false);res.json({data:result.rows});}catch(e){next(e);}});
router.get('/schedule', requireAuth, (req,res)=>res.json({data:require('../services/sync-schedule.service').snapshot()}));
router.put('/schedule', requireAuth, requireRole('ADMIN'), csrfProtection, (req,res,next)=>{try{res.json({data:require('../services/sync-schedule.service').configure(req.body.seconds)});}catch(e){next(e);}});
router.post('/all', requireAuth, requireRole('OPERATOR', 'ADMIN'), csrfProtection, syncController.syncAll);
router.post('/vr', requireAuth, requireRole('OPERATOR', 'ADMIN'), csrfProtection, syncController.syncVr);
router.post('/srm', requireAuth, requireRole('OPERATOR', 'ADMIN'), csrfProtection, syncController.syncSrm);

module.exports = router;
