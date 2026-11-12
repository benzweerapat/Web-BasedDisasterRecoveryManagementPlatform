# Project Monitoring SRM with KMITL — 2.0

ระบบเว็บสำหรับติดตามและจัดการ VMware Disaster Recovery ผ่าน vCenter, vSphere Replication (VR) และ Site Recovery Manager (SRM) ตั้งค่า server, username, password, AI API key และบัญชีผู้ใช้บนหน้าเว็บได้ทั้งหมด ไม่ต้องสร้าง `.env` หรือแก้ `connections.json`

## เริ่มใช้งาน

ต้องมี Node.js 24 และ npm รันจาก root โปรเจกต์:

```bash
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm run build
npm start
```

เปิด [http://localhost:3002](http://localhost:3002) แล้ว:

1. ครั้งแรกสร้างบัญชี Administrator และรหัสผ่านอย่างน้อย 12 ตัวอักษร
2. เปิด **VMware connections → Add server** เพิ่ม vCenter ก่อน แล้วเพิ่ม SRM/VR ที่อ้าง vCenter ใน site เดียวกัน
3. กด Test และ Sync เมื่อพร้อมเชื่อมต่อ VMware จริง
4. ตั้งค่า AI, CA certificate, รอบ Sync และเปลี่ยนรหัสผ่านใน **Settings** จัดการบัญชีใน **Users**

ระบบสร้าง storage และ encryption keys ใน `data/` ให้อัตโนมัติ ไม่ต้อง copy ไฟล์ตั้งค่าใด ๆ

### Docker

```bash
docker compose up -d --build
```

Compose ใช้ named volume เก็บข้อมูลและเปิดพอร์ตเฉพาะ `127.0.0.1:3002` ไม่ต้องเตรียม `.env`, connection file หรือ owner ของ bind mount

## ตรวจก่อน push

```bash
npm test
npm run lint
npm run check:publish
npm audit --audit-level=moderate
npm --prefix backend audit --audit-level=moderate
npm --prefix frontend audit --audit-level=moderate
```

## ความปลอดภัย

- Login จริง ใช้ scrypt password hashes, CSRF, session regeneration และตรวจ role/status/version ทุก request ที่ต้องยืนยันตัวตน
- เฉพาะ Admin แก้ server, credentials, CA และ AI settings; การจัดการบัญชีต้องยืนยันรหัสผ่าน Admin ปัจจุบัน
- Password และ AI key เข้ารหัส AES-256-GCM และไม่ถูกส่งกลับใน API สำหรับอ่านข้อมูล เว้นช่อง password/key ว่างเมื่อแก้ไขเพื่อคงค่าเดิม
- AI ปิดโดยค่าเริ่มต้น ต้องเลือกเปิดและยืนยันการส่งข้อมูลไป Gemini อย่างชัดเจนก่อนใช้
- Runtime keys ถูกสร้างใน storage ของเครื่องด้วยสิทธิ์จำกัด ห้ามนำ `data/` หรือ backups ขึ้น GitHub

ยังเป็นแอปสำหรับ local/trusted operation การมี Login ไม่เท่ากับผ่านการรับรอง public deployment หากเปิดใช้ผ่านเครือข่ายต้องมี HTTPS และทดสอบการควบคุมการเข้าถึงของระบบปลายทาง อ่าน [SECURITY.md](SECURITY.md)

[เอกสารทั้งหมด](docs/README.md) · [คู่มือผู้ใช้](docs/01-user-manual.md) · [สถาปัตยกรรม](docs/02-architecture.md) · [GitHub](docs/03-github-release.md) · [ผลตรวจ](docs/04-validation.md)
