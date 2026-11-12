# 📚 SRM Monitoring 2.0 — เอกสารประกอบโครงการ

ระบบ **Web-Based Disaster Recovery Management Platform** สำหรับติดตามและจัดการ VMware Disaster Recovery
ผ่าน **vCenter**, **vSphere Replication (VR)** และ **Site Recovery Manager (SRM)** จากหน้าจอเดียว
ใช้งานได้ทั้งแบบ **เว็บ** (Node.js / Docker) และ **แอป Desktop** (macOS / Windows) โดยตั้งค่าทุกอย่างบนหน้าจอ
ไม่ต้องสร้าง `.env` หรือแก้ไฟล์ connection

> ชื่อโปรเจกต์ใน repository คือ **Project Monitoring SRM with KMITL** — เอกสารชุดนี้เรียกรวมว่า "SRM Monitoring"

---

## เอกสารในชุดนี้

| # | ไฟล์ | เนื้อหา | เหมาะกับใคร |
|---|------|---------|-------------|
| 1 | [01-user-manual.md](01-user-manual.md) | **คู่มือผู้ใช้** — ติดตั้ง, สร้างบัญชีแรก, เพิ่ม server, Sync, ใช้งานแต่ละหน้า, Replication / Protection group / Recovery plan, AI, CA, บัญชีผู้ใช้, แก้ปัญหาเบื้องต้น | ผู้ดูแลระบบ / ผู้ใช้งาน |
| 2 | [02-architecture.md](02-architecture.md) | **สถาปัตยกรรม & การทำงานภายใน** — startup, middleware pipeline, authentication, FileStore, VMware adapters, Sync coordinator, write engine, network policy, AI, Desktop isolation, ตัวแปรตั้งค่า | ผู้พัฒนา / ผู้ดูแลเชิงลึก |
| 3 | [03-github-release.md](03-github-release.md) | **ขึ้น GitHub อย่างปลอดภัย** — publish check, pre-commit hook, CI และ installer workflow | ผู้พัฒนา / ผู้ดูแล repo |
| 4 | [04-validation.md](04-validation.md) | **ผลตรวจ** — tests, build, audit และขอบเขตที่ยังไม่ได้ทดสอบกับ VMware จริง | ผู้ตรวจรับ / QA |
| 5 | [05-desktop.md](05-desktop.md) | **แอป Desktop** — ติดตั้ง Mac/Windows, ที่เก็บข้อมูล, build ตัวติดตั้ง, code signing | ผู้ใช้งาน Desktop / ผู้ build |
| — | [../SECURITY.md](../SECURITY.md) | **นโยบายความปลอดภัย** — ขอบเขต, การเก็บ secrets, การส่งข้อมูลออกภายนอก, การรายงานช่องโหว่ | ทุกคน |

---

## สรุประบบ

```
ผู้ใช้ (Browser หรือ Desktop app)
   │  HTTPS/HTTP เฉพาะ loopback (127.0.0.1:3002) — Login + CSRF + Role
   ▼
[ Express API ]  backend/src/app.js
   │  request boundary · helmet/CSP · session · requireAuth · operation guard
   ▼
[ Controllers → Services → Repositories ]
   │
   ├──► [ FileStore JSON ]   application.json  ◄── บัญชี, server (รหัสผ่านเข้ารหัส AES-256-GCM),
   │                                              inventory cache, sessions, journal, settings
   │
   ├──► [ VMware adapters ]  HTTPS + network allowlist + TLS verify
   │        ├─ vCenter  (REST + vSphere SOAP)  → hosts / clusters / datastores / VMs
   │        ├─ vSphere Replication (REST)      → pairings / replications / configure
   │        └─ Site Recovery Manager (REST + SOAP สำหรับ mapping) → protection groups / recovery plans
   │
   ├──► [ Sync coordinator ]  Sync All: vCenter → VR → SRM  (+ รอบอัตโนมัติ 60–86400 วินาที)
   │
   └──► [ AI Assistant ]  Google Gemini — ปิดโดยค่าเริ่มต้น, อ่านอย่างเดียว, ต้องยืนยันก่อนส่งข้อมูล
   ▼
[ หน้าจอ React ]  DR Dashboard · Connections · vCenter · VMs · Replications · Mappings
                   · Protection groups · Recovery plans · Settings · Users
```

**หลักการออกแบบ:**
- **ตั้งค่าบนเว็บทั้งหมด** — server, credentials, CA, AI key และบัญชีผู้ใช้เก็บใน application storage ไม่มีไฟล์ config ให้หลุดขึ้น Git
- **ไม่มีบัญชี default** — ครั้งแรกต้องสร้าง Administrator เอง (รหัสผ่าน 12–128 ตัวอักษร)
- **ความลับไม่ย้อนกลับมาที่ browser** — API อ่านข้อมูลตอบเพียง `hasPassword` / `hasApiKey`
- **สั่งงาน VMware อย่างระมัดระวัง** — ทุก write ผ่าน preflight, idempotency และ journal; HTTP 202 ไม่เท่ากับสำเร็จ

รายละเอียดเต็มอยู่ใน [02-architecture.md](02-architecture.md)

---

## เริ่มใช้แบบเร็วสุด

**ผู้ใช้งาน** — ติดตั้งแอป Desktop จาก Release แล้วเปิดโปรแกรม ดู [05-desktop.md](05-desktop.md)

**ผู้พัฒนา** — ต้องมี Node.js 24

```bash
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm run build
npm start
```

หรือใช้ Docker:

```bash
docker compose up -d --build
```

เปิด:
- **Web UI** → http://localhost:3002

ครั้งแรกระบบจะพาไปหน้า **Create your administrator account** ดูขั้นตอนละเอียดที่ [01-user-manual.md](01-user-manual.md)

> ⚠️ ห้ามนำโฟลเดอร์ `data/`, backups, `runtime-secrets.json`, `vault.bin` หรือไฟล์คู่มือที่มีภาพหน้าจอระบบจริงขึ้น GitHub
> รัน `npm run check:publish` ก่อน push ทุกครั้ง (ดู [03-github-release.md](03-github-release.md))
