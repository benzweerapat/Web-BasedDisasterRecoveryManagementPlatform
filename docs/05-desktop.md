# โปรแกรมติดตั้ง macOS และ Windows

## ติดตั้งและเริ่มใช้

| เครื่อง | ไฟล์ |
|---|---|
| Mac Apple Silicon | `SRM-Monitoring-2.0.0-mac-arm64.pkg` |
| Mac Intel | `SRM-Monitoring-2.0.0-mac-x64.pkg` |
| Windows x64 | `SRM-Monitoring-2.0.0-win-x64.exe` |

Mac เปิด PKG แล้วทำตาม Installer เพื่อติดตั้ง SRM Monitoring ลง Applications Windows เปิด NSIS installer เลือกโฟลเดอร์ติดตั้งได้ เป็นการติดตั้งต่อ OS user ไม่ต้องติดตั้ง Node.js, Docker หรือแก้ไฟล์ตั้งค่า

ครั้งแรกเปิดโปรแกรม สร้าง Admin แล้วเพิ่ม server/AI/CA ผ่านหน้าเว็บในโปรแกรมตาม [คู่มือ](01-user-manual.md) แอปเริ่ม backend และจัดการ port/key ให้เอง ไม่ต้องเปิด terminal การปิดหน้าต่างจะปิด service ของแอปด้วย

ตัวติดตั้งในชุดพัฒนาไม่ได้ใช้ Apple Developer / Windows signing certificate จึงยังไม่ใช่ notarized/trusted distribution อาจถูก OS เตือนหรือบล็อก ให้ผู้ดูแลบริษัทตรวจ SHA-256 และลงนาม/รับรองก่อนส่งต่อ ไม่แนะนำให้ปิด Gatekeeper/SmartScreen หรือ certificate checks

## ข้อมูลและการอัปเดต

ข้อมูลอยู่ใน userData ของ Electron ใต้ชื่อแอป (เช่น Application Support บน macOS และ AppData/Roaming บน Windows) มี `data/application.json`, sync schedule, CA ที่อัปโหลด และ `vault.bin` ที่ป้องกัน keys ผ่าน OS vault ไม่อยู่ใน app bundle หรือ installation directory

ไม่รวมข้อมูล/บัญชี/credentials จากเครื่องต้นฉบับใน installer การอัปเดตโปรแกรมไม่ควรลบ userData ตัวถอนติดตั้ง Windows ตั้งให้เก็บ app data ไว้ แต่ต้องสำรองก่อนอัปเดตเสมอ

Vault ผูกกับ OS account/key store Copy เฉพาะ application.json หรือ vault.bin ไปเครื่องอื่นไม่ใช่ portable migration รุ่นนี้ยังไม่มี export/import wizard ที่ปลอดภัยข้าม OS user หรือเครื่อง อย่าลบ vault เพื่อแก้ปัญหาเปิดแอป เพราะทำให้ข้อมูลที่เข้ารหัสเดิมถอดรหัสไม่ได้

## Build จาก source

```bash
npm ci --ignore-scripts
npm --prefix backend ci --omit=dev --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm run dist:mac
npm run dist:win
```

Electron-builder ดาวน์โหลด runtime/toolchain จากแหล่งทางการ ใช้เวลาตามความเร็วเครือข่าย Mac builds ต้องทำบน macOS; Windows installer อาจ cross-build ได้ตามเครื่องมือที่มี ใช้ workflow **Desktop installers** บน macOS/Windows runners เพื่อ build บน OS เป้าหมายได้

Mac ใช้ ad-hoc signature สำหรับชุดพัฒนาและ entitlements ที่ Electron ต้องใช้ (JIT/library loading) แต่ไม่มี Developer ID หรือ notarization; Windows ยัง unsigned

Workflow สร้าง artifacts เมื่อ dispatch หรือ push tag `v*` ไม่มีขั้นตอน publish release หรือใช้ production credentials โดยอัตโนมัติ การทำ code signing/notarization ต้องให้ผู้ดูแลเพิ่ม certificate/secrets ขององค์กรและขั้นตอน signing ของตนเองก่อนเปิด auto-publish
