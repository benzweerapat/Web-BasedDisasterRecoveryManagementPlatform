# Project Monitoring SRM with KMITL — 2.0

ระบบติดตามและจัดการ VMware Disaster Recovery ผ่าน vCenter, vSphere Replication (VR) และ Site Recovery Manager (SRM) มีทั้งเว็บและแอป Desktop ใช้หน้าเดียวกัน ตั้งค่า server, username, password, AI API key และบัญชีผู้ใช้บนหน้าจอได้ ไม่ต้องสร้าง `.env` หรือแก้ `connections.json`

## ผู้ใช้งาน: เริ่มจากโปรแกรมติดตั้ง

1. ติดตั้ง SRM Monitoring สำหรับ macOS หรือ Windows แล้วเปิดโปรแกรม
2. ครั้งแรกสร้างบัญชี Administrator และรหัสผ่านอย่างน้อย 12 ตัวอักษร
3. เปิด **VMware connections → Add server** เพิ่ม vCenter ก่อน แล้วเพิ่ม SRM/VR ที่อ้าง vCenter ใน site เดียวกัน
4. กด Test และ Sync เมื่อพร้อมเชื่อมต่อ VMware จริง
5. ตั้งค่า AI, CA certificate, รอบ Sync และเปลี่ยนรหัสผ่านใน **Settings** จัดการบัญชีใน **Users**

แอป Desktop เริ่ม backend บน loopback และสร้าง encryption keys ให้เอง เก็บข้อมูลแยกจากตัวโปรแกรมใน OS user profile ใช้ OS vault ป้องกัน master key บน Mac/Windows ไม่ต้องติดตั้ง Node.js หรือ Docker บนเครื่องผู้ใช้งาน

ตัวติดตั้งที่ build โดยไม่มี certificate ของผู้พัฒนายังไม่ผ่าน Apple notarization หรือ Windows code signing ดู [คู่มือติดตั้ง](docs/05-desktop.md) ก่อนส่งให้บริษัทใช้งานจริง

## ผู้พัฒนา: รันเว็บจาก source

ต้องมี Node.js 24 และ npm รันจาก root โปรเจกต์:

```bash
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm run build
npm start
```

เปิด [http://localhost:3002](http://localhost:3002) สร้างบัญชีบนเว็บ ระบบสร้าง storage/keys ให้อัตโนมัติ ไม่ต้อง copy ไฟล์ตั้งค่าใด ๆ

รันด้วย Docker ได้เช่นกัน:

```bash
docker compose up -d --build
```

Compose ใช้ named volume เก็บข้อมูลและเปิดพอร์ตเฉพาะ `127.0.0.1:3002` ไม่ต้องเตรียม `.env`, connection file หรือ owner ของ bind mount

## ตรวจและ build ตัวติดตั้ง

```bash
npm test
npm run lint
npm run check:publish
npm audit --audit-level=moderate
npm --prefix backend audit --audit-level=moderate
npm --prefix frontend audit --audit-level=moderate
npm run dist:mac
# หรือ build Windows NSIS installer
npm run dist:win
```

ไฟล์ติดตั้งอยู่ใน `installers/` และถูกกันออกจาก Git มี workflow `Desktop installers` สำหรับ build บน Mac และ Windows runners โดยไม่ต้องให้ CI เข้าถึง VMware/AI credentials

## ความปลอดภัย

- Login จริง ใช้ scrypt password hashes, CSRF, session regeneration และตรวจ role/status/version ทุก request ที่ต้องยืนยันตัวตน
- เฉพาะ Admin แก้ server, credentials, CA และ AI settings; การจัดการบัญชีต้องยืนยันรหัสผ่าน Admin ปัจจุบัน
- Password และ AI key เข้ารหัส AES-256-GCM และไม่ถูกส่งกลับใน API สำหรับอ่านข้อมูล เว้นช่อง password/key ว่างเมื่อแก้ไขเพื่อคงค่าเดิม
- AI ปิดโดยค่าเริ่มต้น ต้องเลือกเปิดและยืนยันการส่งข้อมูลไป Gemini อย่างชัดเจนก่อนใช้
- Desktop ใช้ sandbox/context isolation และไม่เปิด Node.js ให้ renderer ไม่อนุญาต external navigation หรือ remote subresources
- เว็บรันโดยตรงสร้าง runtime keys ใน storage ของเครื่องด้วยสิทธิ์จำกัด Desktop ป้องกัน keys ด้วย OS vault ห้ามนำ app data หรือ backups ขึ้น GitHub

ยังเป็นแอปสำหรับ local/trusted operation การมี Login ไม่เท่ากับผ่านการรับรอง public deployment หากเปิดใช้ผ่านเครือข่ายต้องมี HTTPS และทดสอบการควบคุมการเข้าถึงของระบบปลายทาง อ่าน [SECURITY.md](SECURITY.md)

[คู่มือผู้ใช้](docs/01-user-manual.md) · [สถาปัตยกรรม](docs/02-architecture.md) · [GitHub](docs/03-github-release.md) · [ผลตรวจ](docs/04-validation.md) · [Desktop](docs/05-desktop.md)
