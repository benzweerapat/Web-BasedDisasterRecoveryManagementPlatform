/**
 * Utility to redact sensitive information from objects before logging
 */

//รายชื่อคำที่ถือว่าเป็นข้อมูลลับ
const SENSITIVE_KEYS = [
  'password',
  'token',
  'cookie',
  'authorization',
  'secret',
  'credential',
  'privatekey',
  'session',
  'jwt'
];

/**
 * Deep copy an object and redact sensitive keys
 * @param {Object} obj The object to redact
 * @returns {Object} Redacted object
 */

//รับค่า 2 ตั
//obj ข้อมูลที่ต้องการตรวจและซ่อน
//visited  ช้เก็บว่า Object ใดเคยถูกตรวจแล้ว
function redact(obj, visited = new WeakSet()) {

  //กรณีข้อมูลไม่ใช่ Object จะคืนค่าเดิมทันที
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  //ป้องกัน Circular reference คือ Object ที่อ้างกลับมาหาตัวเอง
  if (visited.has(obj)) {
    return '[CIRCULAR]';
  }
  visited.add(obj);

  if (Array.isArray(obj)) {
    return obj.map(item => redact(item, visited));
  }

  const redactedObj = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = SENSITIVE_KEYS.some(sensitiveKey => lowerKey.includes(sensitiveKey));
      
      if (isSensitive) {
        redactedObj[key] = '[REDACTED]';
      } else {
        redactedObj[key] = redact(obj[key], visited);
      }
    }
  }

  return redactedObj;
}

module.exports = {
  redact
};