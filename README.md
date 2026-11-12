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

## พัฒนาต่อ (dev mode)

เปิด 2 terminal เพื่อให้หน้าเว็บ reload อัตโนมัติเมื่อแก้โค้ด frontend:

```bash
# terminal 1 — backend (ยอมรับ origin ของ Vite dev server เมื่อ NODE_ENV ไม่ใช่ production)
PORT=3003 NODE_ENV=development npm start
```

```bash
# terminal 2 — frontend (Vite proxy /api → 127.0.0.1:3003)
npm --prefix frontend run dev
```

เปิด [http://localhost:5175](http://localhost:5175) — แก้โค้ด backend แล้วต้อง restart terminal 1 เอง

| ส่วน | ที่อยู่ | เริ่มอ่านจาก |
|------|--------|-------------|
| Backend API | `backend/src/` | `backend/server.js` → `src/app.js` → `routes/` → `controllers/` → `services/` |
| VMware clients | `backend/src/adapters/vmware/` | `vmware-adapter.factory.js` |
| Storage | `backend/src/storage/` | `file-store.js`, schema ใน `fields.json` |
| Frontend | `frontend/src/` | `main.jsx` → `App.jsx` → `pages/` |
| Tests | `**/*.test.js`, `frontend/tests/` | `npm test` (Node test runner) |

รายละเอียดการทำงานภายในดู [สถาปัตยกรรม](docs/02-architecture.md)

## ตรวจคุณภาพโค้ด

```bash
npm test
npm run lint
npm audit --audit-level=moderate
npm --prefix backend audit --audit-level=moderate
npm --prefix frontend audit --audit-level=moderate
```

## ความปลอดภัย

- Login จริง ใช้ scrypt password hashes, CSRF, session regeneration และตรวจ role/status/version ทุก request ที่ต้องยืนยันตัวตน
- เฉพาะ Admin แก้ server, credentials, CA และ AI settings; การจัดการบัญชีต้องยืนยันรหัสผ่าน Admin ปัจจุบัน
- Password และ AI key เข้ารหัส AES-256-GCM และไม่ถูกส่งกลับใน API สำหรับอ่านข้อมูล เว้นช่อง password/key ว่างเมื่อแก้ไขเพื่อคงค่าเดิม
- AI ปิดโดยค่าเริ่มต้น ต้องเลือกเปิดและยืนยันการส่งข้อมูลไป Gemini อย่างชัดเจนก่อนใช้
- Runtime keys ถูกสร้างใน storage ของเครื่องด้วยสิทธิ์จำกัด ห้ามแชร์โฟลเดอร์ `data/` หรือ backups ให้ผู้อื่น

ยังเป็นแอปสำหรับ local/trusted operation การมี Login ไม่เท่ากับผ่านการรับรอง public deployment หากเปิดใช้ผ่านเครือข่ายต้องมี HTTPS และทดสอบการควบคุมการเข้าถึงของระบบปลายทาง อ่าน [SECURITY.md](SECURITY.md)

[เอกสารทั้งหมด](docs/README.md) · [คู่มือผู้ใช้](docs/01-user-manual.md) · [สถาปัตยกรรม](docs/02-architecture.md) · [ผลตรวจ](docs/03-validation.md)
