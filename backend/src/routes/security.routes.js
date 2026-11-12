const express = require('express');
const router = express.Router();
const crypto = require("crypto");
const { requireAuth } = require('../middleware/auth.middleware');

router.get('/csrf-token', (req, res, next) => {
  try {
    const existingToken = req.session?.csrfToken;

    if (typeof existingToken === "string" && existingToken.length > 0) {
      return res.status(200).json({
        success: true,
        csrfToken: existingToken,
        requestId: req.id || "unknown"
      });
    }

    req.session.csrfToken = crypto.randomBytes(32).toString("hex");

    req.session.save((saveError) => {
      if (saveError) {
        return next(saveError);
      }

      return res.status(200).json({
        success: true,
        csrfToken: req.session.csrfToken,
        requestId: req.id || "unknown"
      });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;