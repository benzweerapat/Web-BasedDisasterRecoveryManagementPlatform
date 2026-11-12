//รับ Schema หนึ่งตัว


const validateBody = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error.name === 'ZodError') {
        const issues = error.errors || error.issues || [];
        const errors = issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "The submitted data is invalid",
          errors,
          requestId: req.id || "unknown"
        });
      }
      next(error);
    }
  };
};

module.exports = {
  validateBody
};
