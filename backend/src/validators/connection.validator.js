//ใช้ตรวจสอบ id ของ Connection ก่อนส่งไปทำงานต่อ

const { z } = require('zod');
const connectionIdSchema = z.object({ id: z.coerce.number().int().positive() });
module.exports = { connectionIdSchema };
