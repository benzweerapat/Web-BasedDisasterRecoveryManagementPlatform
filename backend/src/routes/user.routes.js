const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

router.get('/', requireAuth, requireRole('ADMIN'), userController.getUsers);

const { csrfProtection } = require('../middleware/csrf.middleware');
const save = async (req,res,next) => {
  try {
    const id = req.params.id ? Number(req.params.id) : null;
    if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return res.status(400).json({message:'Invalid user ID'});
    const user = await require('../services/accounts.service').saveUser(req.session.user,id,req.body);
    res.json({data:user});
  } catch(e) {
    if (e.name==='ZodError') return res.status(400).json({message:'Check username, role and password (12–128 characters)'});
    if (e.code==='ACCOUNT_ERROR') return res.status(e.status).json({message:e.message});
    next(e);
  }
};
router.post('/',requireAuth,requireRole('ADMIN'),csrfProtection,save);
router.put('/:id',requireAuth,requireRole('ADMIN'),csrfProtection,save);
module.exports = router;