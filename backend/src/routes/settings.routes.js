'use strict';
const router = require('express').Router();
const { requireRole } = require('../middleware/auth.middleware');
const { csrfProtection } = require('../middleware/csrf.middleware');
const settings = require('../services/web-settings.service');
router.use(requireRole('ADMIN'));
const wrap = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) {
  if (e.name==='ZodError') return res.status(400).json({message:'Invalid settings'});
  if (e.status===400) return res.status(400).json({message:e.message});
  next(e);
} };
router.get('/ai',wrap(async (_req,res)=>res.json({data:await settings.publicAi()})));
router.put('/ai',csrfProtection,wrap(async (req,res)=>res.json({data:await settings.saveAi(req.body)})));
router.get('/tls',(_req,res)=>res.json({data:{configured:Boolean(require('../config/vmware.config').caCertPath)}}));
router.put('/tls',csrfProtection,wrap(async (req,res)=>res.json({data:await settings.saveCa(req.body)})));
module.exports=router;
