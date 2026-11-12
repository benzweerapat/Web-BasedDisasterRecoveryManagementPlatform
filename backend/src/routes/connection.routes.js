const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connection.controller');
const inventoryController = require('../controllers/inventory.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { csrfProtection } = require('../middleware/csrf.middleware');
const { connectionIdSchema } = require('../validators/connection.validator');

// Validation middleware generator for Zod
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[property]);
      req[property] = parsed;
      next();
    } catch (err) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid input data",
        details: err.errors,
        requestId: req.id || "unknown"
      });
    }
  };
};

//อ่านรายการ Connection
router.get('/',
  requireAuth,
  requireRole("VIEWER", "OPERATOR", "ADMIN"),
  connectionController.getConnections
);


const save = remove => async (req,res,next) => {
  try {
    const id = req.params.id ? Number(req.params.id) : null;
    if (req.params.id && (!Number.isSafeInteger(id) || id < 1)) return res.status(400).json({message:'Invalid server ID'});
    const result = await require('../services/web-connections.service').mutate(id, req.body, remove);
    res.json(result);
  } catch(error) {
    if (error.name === 'ZodError') return res.status(400).json({message:'Check server name, type, address, username and password fields'});
    if (error.code === 'CONFIGURATION_ERROR') return res.status(error.status).json({message:error.message});
    next(error);
  }
};
router.post('/', requireRole('ADMIN'), csrfProtection, save(false));
router.put('/:id', requireRole('ADMIN'), csrfProtection, save(false));
router.delete('/:id', requireRole('ADMIN'), csrfProtection, save(true));

//ทดสอบ Connection ตาม ID
router.post('/:id/test',
  requireAuth,
  requireRole("OPERATOR", "ADMIN"),
  csrfProtection,
  validate(connectionIdSchema, 'params'),
  connectionController.testConnection
);

//ซิงก์ Inventory จาก Connection
router.post('/:id/sync',
  requireAuth,
  requireRole("OPERATOR", "ADMIN"),
  csrfProtection,
  validate(connectionIdSchema, 'params'),
  inventoryController.sync
);

module.exports = router;
