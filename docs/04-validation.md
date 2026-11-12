# ผลตรวจ SRM Monitoring 2.0 (เว็บ)

วันที่ 12 พฤศจิกายน 2026 ตรวจด้วยข้อมูลจำลอง ไม่ใช้บัญชี VMware หรือ AI key จริง

| รายการ | ผลและขอบเขต |
|---|---|
| Automated tests | 87 ผ่าน, 0 ไม่ผ่าน; รวม auth, role boundaries, encryption, CRUD, key masking/removal, sync coordinator และ restart persistence |
| First-run/restart | เริ่มโดยไม่มีไฟล์ตั้งค่า สร้างบัญชีผ่าน HTTP API ปิด/เปิด backend ใหม่แล้วบัญชี/server/AI key/session ยังอยู่ โดยไม่หมุน master key ทับข้อมูลเดิม |
| Browser UI | Login, เปิดฟอร์ม Edit server โดย password ว่าง, บันทึกชื่อใหม่ และตรวจ Settings ว่า key แสดงเพียง saved status ไม่แสดงค่าลับ |
| CA settings | อัปโหลด public test certificate และลบผ่าน authenticated API สำเร็จ ไม่อัปโหลด private key |
| Production frontend | `npm run build` ผ่าน; ยังมี bundle-size warning |
| Lint | exit 0, มี 67 warnings เดิม เช่น unused variables |
| Dependency audit | root และ frontend: 0 vulnerabilities; backend: 2 moderate ใน `nodemon` → `minimatch` (devDependency ใช้ตอนพัฒนาเท่านั้น ไม่อยู่ใน runtime/Docker image) |
| Publish guard | ผ่าน; ปฏิเสธ `.docx`/`.pdf`, private IP, path ส่วนตัว, token และไฟล์ runtime |

## สิ่งที่ยังไม่ได้ยืนยัน

- ยังไม่ได้เชื่อมต่อ VMware/AI provider จริง ทดสอบ model availability, appliance compatibility หรือ live Recovery
- ยังไม่มี portable encrypted backup/import wizard ข้ามเครื่อง หรือการกู้คืน Admin ที่ลืมรหัสผ่านทั้งหมด
- ตัวตรวจ secrets ไม่ครอบคลุมทุกชนิดหรือ Git history; ไม่มีการรับรองว่า source ปลอดภัยสมบูรณ์
- `npm --prefix backend audit` ใน CI จะไม่ผ่านจนกว่าจะอัปเดต `nodemon`

ดู [Security](../SECURITY.md) และ [คู่มือผู้ใช้](01-user-manual.md)
