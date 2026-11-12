const { buildSafeError } = require('../utils/api-response.util');
const { classifyOperationError } = require('../utils/operation-error.util');

/**
 * Global Error Handler Middleware
 * Prevents stack traces from leaking to the client in production
 * and safely logs the error on the server side
 */
const errorMiddleware = (err, req, res, next) => {

  //เรียกใช้ไฟล์ที่อธิบายก่อนหน้านี้ เพื่อเปลี่ยน Error ดิบให้เป็นข้อมูลมาตรฐาน ,เลือก HTTP ืั้ตะตอบ
  const safe = classifyOperationError(err);
  
  // Lบันทืึก log
  const errorLog = {
    requestId: req.id,
    path: req.path,
    method: req.method,
    code: safe.code,
    httpStatus: safe.httpStatus
  };
  
  console.error('[GlobalErrorHandler]', JSON.stringify(errorLog));

  // Sส่งคำตอบที่ปลอดภัยกลับหน้าเว็บ
  res.status(safe.httpStatus).json(buildSafeError(req, safe));
};

module.exports = errorMiddleware;
