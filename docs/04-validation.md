# ผลตรวจ SRM Monitoring 2.0

วันที่ 28 ตุลาคม 2026 ตรวจด้วยข้อมูลจำลอง ไม่ใช้บัญชี VMware หรือ AI key ของบริษัท

| รายการ | ผลและขอบเขต |
|---|---|
| Automated tests | 82 ผ่าน, 0 ไม่ผ่าน; รวม auth, role boundaries, encryption, CRUD, key masking/removal และ restart persistence |
| First-run/restart | เริ่มโดยไม่มีไฟล์ตั้งค่า สร้างบัญชีผ่าน HTTP API ปิด/เปิด backend ใหม่แล้วบัญชี/server/AI key/session ยังอยู่ โดยไม่หมุน master key ทับข้อมูลเดิม |
| Browser UI | Login, เปิดฟอร์ม Edit server โดย password ว่าง, บันทึกชื่อใหม่ และตรวจ Settings ว่า key แสดงเพียง saved status ไม่แสดงค่าลับ |
| CA settings | อัปโหลด public test certificate และลบผ่าน authenticated API สำเร็จ ไม่อัปโหลด private key |
| Production frontend | Build ผ่าน; ยังมี bundle-size warning |
| Lint | exit 0, มี 67 warnings เดิม เช่น unused variables |
| Dependency audit | npm audit root/backend/frontend รายงาน 0 vulnerabilities ณ เวลาตรวจ |
| Publish guard | ผ่าน; ปรับ context matching ให้ไม่เข้าใจ autocomplete labels เป็น hardcoded password |
| Windows build | สร้าง NSIS `.exe`; ตรวจ packaged launcher เป็น PE32+ x86-64 |
| Mac build | สร้าง arm64 และ Intel x64 app/PKG; ตรวจ Mach-O architecture ให้ตรงชื่อไฟล์และตรวจ ad-hoc signature ของ app |
| Package payload | ตรวจ backend/frontend/desktop entry และ 1,894 runtime/dependency files ต่อแพ็กเกจว่าตรงกับ source ที่ตรวจ; ไม่มี .env หรือข้อมูล QA ใน runtime payload |
| Packaged backend | เริ่ม service จาก packaged production resources ได้ และรายงาน first-run setup โดยไม่ใช้ source node_modules ภายนอก |

Mac ใช้ PKG installer เนื่องจาก DiskManagement/DiskImages ไม่พร้อมใช้ใน build session นี้ การสร้างและตรวจ PKG ไม่ต้องติดตั้งโปรแกรมลงเครื่องของผู้ใช้ ตรวจ payload ของ PKG และ code signature ของ app ที่ขยายจาก package แล้ว ตัว installer เองยังไม่มี Developer ID Installer/notarization; Windows ยังไม่มี Authenticode signature

## สิ่งที่ยังไม่ได้ยืนยัน

- ยังไม่ได้ทดสอบติดตั้ง/เปิด Native Desktop UI บนเครื่องปลายทางจริง การเปิดแอป Mac ผ่านเครื่องมือถูกปฏิเสธเพราะไม่มี Computer Use permission; browser UI และ packaged backend ได้ตรวจแยกแล้ว
- ยังไม่ได้รัน Windows installer บน Windows จริง หรือทดสอบ OS vault ในเครื่องปลายทาง
- ยังไม่ได้เชื่อมต่อ VMware/AI provider ของบริษัท ทดสอบ model availability, appliance compatibility หรือ live Recovery
- ยังไม่มี portable encrypted backup/import wizard ข้ามเครื่อง หรือการกู้คืน Admin ที่ลืมรหัสผ่านทั้งหมด
- ตัวตรวจ secrets ไม่ครอบคลุมทุกชนิดหรือ Git history; ไม่มีการรับรองว่า source ปลอดภัยสมบูรณ์
- ไม่สร้าง GitHub remote, commit, push หรือ publish release อัตโนมัติในงานนี้

ก่อนกระจายวงกว้าง ให้ทีมบริษัททดสอบบน OS เป้าหมายและลงนามตัวติดตั้งตามนโยบาย ดู [Security](../SECURITY.md), [คู่มือผู้ใช้](01-user-manual.md) และ [Desktop](05-desktop.md)
