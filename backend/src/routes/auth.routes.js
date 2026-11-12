'use strict';
const router = require('express').Router();
const crypto = require('node:crypto');
const accounts = require('../services/accounts.service');
const { csrfProtection } = require('../middleware/csrf.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const attempts = new Map();
function limit(req, res, next) {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
  const key = req.ip;
  const item = attempts.get(key) || { count: 0, until: now + 60000 };
  if (item.count >= 10 || attempts.size >= 1000) return res.status(429).json({ message: 'Too many attempts. Wait one minute.' });
  item.count++; attempts.set(key, item); next();
}
const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) {
  if (error.name === 'ZodError') return res.status(400).json({ message: 'Use a valid username and a password of 12–128 characters.' });
  if (error.code === 'ACCOUNT_ERROR') return res.status(error.status).json({ message: error.message });
  next(error);
} };
async function signIn(req, res, user) {
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.user = user;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  res.setHeader('X-CSRF-Token', req.session.csrfToken);
  res.json({ user, csrfToken: req.session.csrfToken });
}
router.get('/status', wrap(async (_req, res) => res.json({ needsSetup: await accounts.needsSetup() })));
router.post('/setup', limit, csrfProtection, wrap(async (req, res) => signIn(req, res, await accounts.setup(req.body))));
router.post('/login', limit, csrfProtection, wrap(async (req, res) => signIn(req, res, await accounts.login(req.body))));
router.get('/me', requireAuth, (req, res) => res.json({ user: req.session.user }));
router.post('/logout', requireAuth, csrfProtection, (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('srm.nosql.sid', { path: '/' }); res.json({ success: true }); }));
router.post('/password', requireAuth, csrfProtection, wrap(async (req, res) => {
  const user = await accounts.changePassword(req.session.user, req.body);
  await signIn(req, res, user);
}));
module.exports = router;
