# 🏗️ สถาปัตยกรรมและการทำงานภายใน — SRM Monitoring 2.0

เอกสารนี้อธิบาย **ระบบทำงานยังไงตั้งแต่ผู้ใช้กดปุ่มบนหน้าจอจนคำสั่งไปถึง VMware และข้อมูลกลับมาแสดงผล**
ในระดับลึก อ้างอิงไฟล์และฟังก์ชันในโค้ดจริง

> ต้องการแค่ "วิธีใช้งาน" ดูที่ [01-user-manual.md](01-user-manual.md)

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรม](#1-ภาพรวมสถาปัตยกรรม)
2. [โครงสร้างโปรเจกต์และ Components](#2-โครงสร้างโปรเจกต์และ-components)
3. [ลำดับการเริ่มระบบ (Startup)](#3-ลำดับการเริ่มระบบ-startup)
4. [Request Pipeline (Middleware)](#4-request-pipeline-middleware)
5. [Authentication และ Authorization](#5-authentication-และ-authorization)
6. [REST API](#6-rest-api)
7. [ชั้นเก็บข้อมูล: FileStore](#7-ชั้นเก็บข้อมูล-filestore)
8. [VMware Adapters](#8-vmware-adapters)
9. [Sync และความสดของข้อมูล](#9-sync-และความสดของข้อมูล)
10. [Write Engine และ Recovery Execution](#10-write-engine-และ-recovery-execution)
11. [Network Policy และ TLS](#11-network-policy-และ-tls)
12. [Web-managed Configuration และการเข้ารหัส](#12-web-managed-configuration-และการเข้ารหัส)
13. [AI Assistant](#13-ai-assistant)
14. [Frontend (React)](#14-frontend-react)
15. [สรุปตัวแปรตั้งค่า (Environment)](#15-สรุปตัวแปรตั้งค่า-environment)
16. [ขอบเขตและข้อจำกัด](#16-ขอบเขตและข้อจำกัด)

---

## 1. ภาพรวมสถาปัตยกรรม

ระบบเป็น **single-process Node.js application** ที่เสิร์ฟทั้ง API และหน้าเว็บ React ที่ build แล้ว
เก็บข้อมูลทั้งหมดในไฟล์ JSON ไฟล์เดียว และคุยกับ VMware ผ่าน HTTPS โดยตรง
แนวคิดหลัก: **configure (บนเว็บ) → collect (Sync) → present (Dashboard) → act (VR/SRM write)**

```
┌──────────────────────────── ผู้ใช้ ─────────────────────────────┐
│                   Browser (localhost:3002)                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │ cookie session + X-CSRF-Token
                                ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                EXPRESS APP  (backend/src/app.js)              │
  │  request-id → request boundary (Host/Origin)                  │
  │  → helmet/CSP → CORS → JSON 100kb → session → CSRF token      │
  │  → /api/auth, /api/security (public)                          │
  │  → requireAuth → /api/settings, /api/users                    │
  │  → operationGuard → /api/connections|vr|srm|dr|sync|ai, /api  │
  └───────┬───────────────────────┬───────────────────────┬──────┘
          │                       │                       │
          ▼                       ▼                       ▼
  ┌───────────────┐      ┌─────────────────┐     ┌────────────────┐
  │ Controllers   │      │ Sync coordinator│     │ Workers        │
  │ → Services    │      │ + schedule      │     │ srm-write      │
  │ → Repositories│      │ vCenter→VR→SRM  │     │ vr-management  │
  └───────┬───────┘      └────────┬────────┘     └───────┬────────┘
          │                       │                      │
          ▼                       ▼                      ▼
  ╔══════════════════════╗   ┌───────────────────────────────────┐
  ║ FileStore            ║   │ VMware adapters (axios, Node HTTP)│
  ║ application.json     ║   │ network-policy: allowlist + DNS   │
  ║ (atomic tmp+rename)  ║   │ pin + no redirect/proxy + TLS     │
  ║ ~50 collections      ║   └──────┬──────────┬──────────┬──────┘
  ╚══════════════════════╝          ▼          ▼          ▼
                               vCenter     vSphere      Site Recovery
                               REST+SOAP   Replication  Manager REST+SOAP
                                           REST
          ┌────────────────────────────┐
          │ AI chat (opt-in) ──────────┼──► Google Gemini API
          └────────────────────────────┘
```

---

## 2. โครงสร้างโปรเจกต์และ Components

| Path | หน้าที่ |
|------|---------|
| `backend/server.js` | entry point: initialize runtime → PID lock → bootstrap storage → start workers → listen |
| `backend/db.js` | สร้าง `pool` (FileStore instance) ที่ทุก repository ใช้ร่วมกัน |
| `backend/src/app.js` | ประกอบ middleware และ routes ของ Express |
| `backend/src/config/` | runtime keys, session, VMware config, freshness thresholds |
| `backend/src/middleware/` | auth, CSRF, request boundary, request-id, validation, error handler |
| `backend/src/routes/` | นิยาม endpoint ต่อกลุ่ม (`auth`, `connections`, `vr`, `srm`, `dr`, `sync`, `ai`, ...) |
| `backend/src/controllers/` | แปลง HTTP ↔ service, ตรวจ input และ role |
| `backend/src/services/` | business logic: sync, normalizer/mapper, write engine, recovery, AI, settings |
| `backend/src/repositories/` | อ่าน/เขียน collection ใน FileStore |
| `backend/src/adapters/vmware/` | client สำหรับ vCenter / VR / SRM (REST + SOAP) |
| `backend/src/storage/` | FileStore, schema (`fields.json`), computed views, session store, bootstrap |
| `backend/src/utils/` | encryption, network policy, redaction, XML parser, error helpers |
| `frontend/src/` | React 19 + Vite + Tailwind/MUI: pages, shared components, hooks, API client |
| `scripts/` | test runner, publish check |

Dependencies หลักของ backend: `express` 5, `express-session`, `helmet`, `cors`, `axios`, `xml2js`, `zod`
— **ไม่มีฐานข้อมูลภายนอก** (ชื่อ `pool` เป็นแค่ชื่อเดิม ไม่ใช่ PostgreSQL และไม่รับ SQL string)

---

## 3. ลำดับการเริ่มระบบ (Startup)

```
backend/server.js
  │
  ├─ 1. initializeRuntime()            config/initialize-runtime.js
  │     ├ ค่า default: PORT=3002, HOST=127.0.0.1, NODE_ENV=production
  │     ├ SRM_DATA_DIR (default <root>/data) → mkdir 0700
  │     ├ ไม่มี SESSION_SECRET / VMWARE_CREDENTIAL_KEY ใน env?
  │     │   ├ ไม่มี runtime-secrets.json แต่มี application.json → throw
  │     │   │   (ไม่สร้าง key ใหม่ทับข้อมูลที่เข้ารหัสด้วย key เดิม)
  │     │   └ ไม่มีทั้งคู่ → สร้าง random 48-byte secret + 32-byte key, เขียน 0600 (flag wx)
  │     ├ validateRuntimeSecrets()  ตรวจรูปแบบ key
  │     └ ถ้ามี vmware-ca.pem → ตั้ง VMWARE_CA_CERT_PATH
  │
  ├─ 2. PID lock: application.pid (ถ้าโปรเซสเดิมยังอยู่ → ปฏิเสธการเปิดซ้ำ)
  ├─ 3. storage/bootstrap.initialize()   โหลด state (ไม่ reconcile จาก connections.json)
  ├─ 4. vr-management-worker.start()     worker งาน VR write
  ├─ 5. srm-write-worker.start()         worker งาน SRM write (concurrency 1–6, default 4)
  ├─ 6. sync-schedule.start()            ตั้งเวลา Sync อัตโนมัติ
  └─ 7. app.listen(PORT, HOST)
        └ ตั้ง SRM_BOUND_PORT แล้วส่ง {type:'ready', port} ให้ parent process (ถ้ารันผ่าน fork)
```

Shutdown: `SIGINT` / `SIGTERM` → ปิด server → ลบ PID lock (timeout 3 วินาที)

---

## 4. Request Pipeline (Middleware)

ลำดับใน `backend/src/app.js`:

| # | Middleware | หน้าที่ |
|---|-----------|---------|
| 1 | `request-id.middleware` | แนบ `X-Request-ID` สำหรับตามรอย error |
| 2 | `request-boundary` | ตรวจ `Host` / `Origin` แบบ exact (localhost, 127.0.0.1, [::1] + bound port) |
| 3 | `helmet` | CSP (`default-src 'self'`, ไม่มี inline script, `frame-src 'none'`), `X-Frame-Options: DENY` |
| 4 | `cors` | อนุญาตเฉพาะ origin ที่ boundary ยอมรับ, `credentials: true` |
| 5 | `express.json` | จำกัด body 100 KB |
| 6 | `express-session` | cookie session เก็บใน `JsonSessionStore`, `rolling: false` |
| 7 | CSRF token | สร้าง token ต่อ session ส่งกลับทาง header `X-CSRF-Token` |
| 8 | `/api/health`, `/api/auth`, `/api/security` | public routes |
| 9 | `requireAuth` | ทุก `/api/*` หลังจุดนี้ต้อง login |
| 10 | `operationGuard` | ตอบ 409 ถ้ากำลังเปลี่ยน server configuration อยู่ |
| 11 | routes → 404 JSON → `error.middleware` | error ถูกแปลงเป็น safe message (ไม่ส่ง stack / secret) |

ถ้ามี `frontend/dist` backend จะเสิร์ฟ static files และ fallback ไปที่ `index.html` สำหรับ client-side routing

---

## 5. Authentication และ Authorization

- **Setup ครั้งแรก** — `POST /api/auth/setup` ใช้ได้เฉพาะตอนยังไม่มีบัญชี สร้าง ADMIN คนแรก
- **Password hash** — Node `crypto.scrypt` + random salt รูปแบบ `scrypt$<salt>$<hash>`
  (`services/accounts.service.js`) และเทียบกับ dummy hash เมื่อไม่พบ user เพื่อลด timing leak
- **Login** — CSRF + rate limit → `req.session.regenerate()` (กัน session fixation) → ออก CSRF ใหม่
- **requireAuth** — โหลด user จาก state ทุก request ตรวจ `status=Active` และ `auth_version` ตรงกับ session
  → เปลี่ยน role / password / status แล้ว session เก่าใช้ไม่ได้ทันที
- **requireRole** — ตรวจ role ปัจจุบันจาก state (`VIEWER` / `OPERATOR` / `ADMIN`)
- **Account management** — ต้อง reauthenticate ด้วยรหัส ADMIN ปัจจุบัน และห้ามปิด/ลดสิทธิ์ ADMIN คนสุดท้าย
- **Session** — `HttpOnly`, `SameSite=Lax`, อายุคงที่ 30 นาที; `secure=false` เพราะออกแบบให้ใช้บน loopback HTTP
  (ห้ามเปิดผ่าน public HTTP)
- **JsonSessionStore** — เก็บใน collection `sessions`, prune session หมดอายุตอน set, ไม่เขียน touch ตอนอ่าน

---

## 6. REST API

| กลุ่ม | Endpoint หลัก | สิทธิ์ |
|-------|---------------|-------|
| Health | `GET /api/health` | public |
| Auth | `GET /api/auth/status`, `POST /setup`, `POST /login`, `GET /me`, `POST /logout`, `POST /password` | public / login |
| Security | `GET /api/security/csrf-token` | public |
| Settings | `GET/PUT /api/settings/ai`, `GET/PUT /api/settings/tls` | ADMIN (GET ไม่คืน key) |
| Users | `GET/POST /api/users`, `PUT /api/users/:id` | ADMIN + reauth |
| Connections | `GET/POST /api/connections`, `PUT/DELETE /:id`, `POST /:id/test`, `POST /:id/sync` | แก้ไข = ADMIN |
| Inventory | `GET /api/dashboard`, `/vcenters`, `/hosts`, `/clusters`, `/datastores`, `/networks`, `/resource-pools`, `/vms`, `/vms/:id/details` | VIEWER+ |
| DR | `GET /api/dr/overview`, `/vms`, `/vms/:id` | VIEWER+ |
| VR | `GET /api/vr/overview`, `/pairings`, `/replications`, `/issues`, `/servers`, `/management/...`; `POST /api/vr/replications` | อ่าน VIEWER+, เขียน OPERATOR+ |
| SRM | `GET /api/srm/site-pairs`, `/protection-groups`, `/recovery-plans/:id/{vms,steps,history,available-actions}`, `/inventory-mappings`, `/placeholder-datastores` | VIEWER+ |
| SRM write | `POST /api/srm/recovery-plans/:id/execute/:action`, `.../operations/:operationId/cancel`, `POST/DELETE /inventory-mappings/...`, `POST /placeholder-datastores`, `POST /protection-groups/:id/protect-vm` | OPERATOR+ |
| Sync | `GET /api/sync/operations`, `GET/PUT /schedule`, `POST /all`, `POST /vr`, `POST /srm` | OPERATOR+ |
| AI | `GET /api/ai/status`, `POST /api/ai/chat` | VIEWER+ (rate limited) |

ทุก request ที่เปลี่ยนข้อมูลต้องแนบ `X-CSRF-Token` และ error ตอบในรูป `{ type, code, safeMessage, requestId }`

---

## 7. ชั้นเก็บข้อมูล: FileStore

`backend/src/storage/file-store.js` — in-process document store บนไฟล์ `application.json`

| ไฟล์ | หน้าที่ |
|------|---------|
| `fields.json` | schema metadata ต่อ collection (ชนิดและค่า default ของ field) |
| `records.js` | helper สำหรับ filter / sort / ref ของ record |
| `views.js` | computed views เช่น `current_hosts`, `current_srm_recovery_plan_groups` |
| `file-store.js` | write queue, transactions, persistence |
| `session-store.js` | adapter สำหรับ `express-session` |
| `connection-reconciliation.js` | transaction ภายในสำหรับ apply การเปลี่ยน connection จาก Admin API |

**การเขียน:** ทุก write ผ่าน queue เดียว → transaction อ่านสำเนาของตัวเอง → commit
→ เขียน `application.json.tmp` (mode 0600) → `fsync` → `rename` ทับไฟล์จริง (atomic)
→ ล้าง view cache

**กลุ่ม collection (ประมาณ 50 รายการ):**

| กลุ่ม | Collections |
|-------|-------------|
| บัญชีและ session | `users`, `sessions`, `activity_logs`, `system_events` |
| Configuration | `connections` (รหัสผ่าน + IV + auth tag), `app_settings` |
| vCenter inventory | `vcenters`, `datacenters`, `clusters`, `hosts`, `datastores`, `networks`, `resource_pools`, `virtual_machines` + mapping tables |
| vSphere Replication | `vr_pairings`, `vr_replications`, `vr_management_servers`, `vr_replication_servers`, `vr_*_issues`, `vr_tasks`, `vr_sync_state` |
| Site Recovery Manager | `srm_site_pairs`, `srm_servers`, `srm_protection_groups`, `srm_protected_vms`, `srm_recovery_plans`, `srm_recovery_plan_*`, `srm_inventory_mappings`, `srm_placeholder_datastores`, `srm_recovery_history`, `srm_tasks`, `srm_issues`, `srm_sync_state` |

> ⚠️ FileStore ต้องมี **backend process เดียวต่อชุดข้อมูล** (บังคับด้วย PID lock)
> ไม่รองรับหลาย replica หรือ distributed coordination

---

## 8. VMware Adapters

`backend/src/adapters/vmware/` สร้างผ่าน `vmware-adapter.factory.js` ตาม `system_type` ของ connection

| Adapter | API | ใช้ทำอะไร |
|---------|-----|-----------|
| `vcenter.adapter.js` | `/api/session`, `/api/vcenter/*`, `/api/appliance/*` + vSphere SOAP | datacenter, cluster, host (NIC/HBA/LUN), datastore, network, VM, appliance health |
| `vr.adapter.js` | `/api/rest/vr/v1` | อ่าน pairings, replications, servers, issues (มี guard pagination / ขนาด response) |
| `vr-management.adapter.js` | `/api/rest/vr/v1` | configure / reconfigure / pause / resume / sync / unconfigure replication |
| `srm.adapter.js` | `/api/rest/srm/v1` | site pairs, protection groups, recovery plans, inventory mappings, placeholder datastore |
| `srm-plan-read.adapter.js` | `/api/rest/srm/v1` | อ่าน steps / history ของ recovery plan |
| `srm-mapping-soap.adapter.js` | `/drserver/vcdr/extapi/sdk` (SOAP) | inventory mapping ที่ REST ไม่รองรับ |
| `srm-session-admission.js` | — | จำกัด SRM session: ≤ 2 ต่อ origin, คิว FIFO ≤ 32, รอ ≤ 10 วินาที, cooldown เมื่อ login ไม่แน่นอน |

ทุก adapter ใช้ `base-vmware.adapter.js` + `services/vmware-http.service.js` ซึ่งบังคับ network policy (§11),
timeout (`VMWARE_CONNECT_TIMEOUT_MS`, 1–30 วินาที) และขนาด response สูงสุด (`VMWARE_MAX_RESPONSE_BYTES`, default 1 MB)

ข้อมูลดิบจาก VMware ผ่าน **normalizer → mapper** (`*-normalizer.service.js`, `*-mapper.service.js`)
ก่อนบันทึก เพื่อให้หน้าจอใช้รูปแบบเดียวกันไม่ว่า API version ไหน

---

## 9. Sync และความสดของข้อมูล

### Sync coordinator (`services/sync-coordinator.service.js`)
- ถือ **claims** ต่อประเภทงาน + connection เพื่อกันงานชนกัน (เช่น Sync ซ้อน, แก้ server ระหว่าง Sync)
- `CONFIGURATION_CHANGE` ทำให้ `operationGuard` ตอบ 409 กับ request อื่นจนกว่าจะเสร็จ

### Sync All (`services/sync-all.service.js`)
```
POST /api/sync/all
  ├─ 1. vCenter  (inventory-sync.service)   ← ต้องมาก่อน เพราะ VR/SRM อ้าง VM/host/datastore
  ├─ 2. VR       (vr-sync.service)
  └─ 3. SRM      (srm-sync.service)
  → ผลลัพธ์ต่อ connection: SUCCESS / PARTIAL / FAILED / SKIPPED
  → stream ความคืบหน้าให้หน้าจอ (frontend/src/utils/sync-stream.js)
```

### Sync schedule (`services/sync-schedule.service.js`)
- `0` = ปิด หรือ `60–86400` วินาที เก็บเป็นไฟล์ในโฟลเดอร์ข้อมูล (mode 0600)
- นับรอบถัดไปหลังรอบก่อนจบ และ **defer** เมื่อมี VR/SRM operation ที่ยังไม่ทราบผล

### Freshness (`services/data-freshness.service.js`)
- แยกจาก collection status: ข้อมูลอาจ Sync สำเร็จแต่เก่า หรือใหม่แต่ Partial
- Warning > `DATA_FRESHNESS_WARNING_SECONDS` (default 3600), Critical > `DATA_FRESHNESS_CRITICAL_SECONDS` (default 86400)

---

## 10. Write Engine และ Recovery Execution

```
UI กดสั่งงาน
  → controller (srm-write / recovery-execution / vr-management)
  → REQUESTED → VALIDATING: โหลด live capability + ตรวจ scope / idempotency key
  → READY_EXECUTE → SUBMITTING: worker (srm-write-worker / vr-management-worker) ส่งคำสั่งไป VMware
  → TASK_RUNNING: ได้ task id → poll task จนจบ (srm-task-result.js)
  → VERIFYING: ตรวจ object สุดท้ายแบบ live → VERIFIED / FAILED / CANCELLED
```

| สถานะพิเศษ | ความหมาย | สิ่งที่ระบบทำ |
|-----------|---------|---------------|
| `SUBMISSION_UNKNOWN` | ส่งแล้วแต่ไม่รู้ว่า VMware รับหรือไม่ | ห้ามส่งซ้ำอัตโนมัติ ต้อง reconcile |
| `RECONCILIATION_REQUIRED` / `RECONCILIATION_BLOCKED` | ตรวจผลกับ VMware ไม่ได้ | ค้างไว้ให้ผู้ดูแลตรวจ |
| `ROLLBACK_FAILED` | ย้อนการเปลี่ยนแปลงไม่สำเร็จ | แจ้งเตือน ต้องแก้ใน VMware |

**Recovery actions** (`controllers/recovery-execution.controller.js`):
- `test`, `cleanup` — ทดสอบ / ล้างผลทดสอบ
- `migration`, `recovery`, `reprotect` — ต้องผ่าน preflight จาก `available-actions` แบบ live ทุกครั้ง

> ℹ️ HTTP 202 = รับงานแล้ว ไม่ใช่สำเร็จ · Local backup ไม่ย้อน state ของ VMware

---

## 11. Network Policy และ TLS

`utils/network-policy.util.js` + `services/vmware-http.service.js`

1. **Allowlist** — สร้างจาก endpoint ของ active connections ที่ ADMIN บันทึก
   (+ `VMWARE_ALLOWED_HOSTS` / `VMWARE_ALLOWED_CIDRS` ถ้าตั้งไว้)
2. **DNS check** — resolve ทุก address ตรวจกับ hostname / IPv4 CIDR แล้ว **pin IP** ที่ผ่าน (กัน DNS rebinding)
3. **Axios** — ใช้ Node HTTP adapter, ปิด redirect และ proxy
4. **TLS** — verify ตาม flag `verify_tls` ของ connection; CA ที่อัปโหลดถูกใช้ผ่าน `VMWARE_CA_CERT_PATH`
5. **Response limit** — ตัดเมื่อเกิน `VMWARE_MAX_RESPONSE_BYTES`

---

## 12. Web-managed Configuration และการเข้ารหัส

- Connection mutation **serialize กับ Sync coordinator** และตรวจงานค้าง / in-flight writes ก่อน apply
- ลบ connection → ล้าง cached scope ที่เกี่ยวข้อง; ห้ามลบ vCenter ที่ยังมี VR/SRM อ้างถึง
- เปลี่ยน site ของ vCenter → อัปเดต site ของ VR/SRM ที่ผูกอยู่
- **รหัสผ่าน VMware และ AI key** เข้ารหัส **AES-256-GCM** (`utils/encryption.util.js`) ด้วย `VMWARE_CREDENTIAL_KEY`
  เก็บ ciphertext + IV + auth tag แยก field
- GET API ตอบเพียง `hasPassword` / `hasApiKey` — ไม่มี ciphertext / IV / tag ใน response
- `aiRuntime()` ถอดรหัส key เฉพาะฝั่ง backend ตอนเรียก provider
- CA upload ตรวจด้วย `X509Certificate`, ปฏิเสธ private key, เขียนเป็น `vmware-ca.pem` และมีผลทันที
- `utils/redact.util.js` ลบค่าที่อ่อนไหวออกจาก log และ error

---

## 13. AI Assistant

`services/ai-chat.service.js` + `routes/ai.routes.js`

```
POST /api/ai/chat  (login + CSRF + rate limit, คำถาม ≤ 2000 ตัวอักษร)
  → ตรวจว่า ADMIN เปิด AI และยืนยัน consent แล้ว
  → เลือก inventory ที่ cache ไว้ (hosts, VMs, datastores, replications, ...) แบบจำกัดจำนวนแถว/field
  → system prompt: อ่านอย่างเดียว ห้ามอ้างว่าสั่งงานใด ๆ
  → generativelanguage.googleapis.com  (model หลัก → fallback เมื่อ 503)
  → ตอบกลับ + ชื่อ model ที่ใช้
```

- ไม่มี tool / function calling ไปยัง VMware — AI สั่งงานใด ๆ ไม่ได้
- timeout 5000–60000 ms (default 30000)
- `services/ai-privacy.test.js` ตรวจว่า AI ต้องมีทั้ง opt-in และ key — key ที่ติดมากับ env อย่างเดียวไม่เปิด AI และไม่อ่าน inventory

---

## 14. Frontend (React)

| Path | หน้าที่ |
|------|---------|
| `src/App.jsx`, `src/router.jsx` | client-side router (ไม่ใช้ react-router) + auth gate |
| `src/api/apiClient.js` | axios instance: แนบ CSRF, จัดการ 401/403, `read-cache.js` สำหรับ cache การอ่าน |
| `src/api/backgroundOperations.js` | ติดตามงาน VR/SRM ที่ใช้เวลานาน |
| `src/pages/` | หน้าหลักตามตาราง Routes ใน [คู่มือผู้ใช้ §4](01-user-manual.md#4-หน้าจอที่เข้าถึงได้-routes) |
| `src/components/shared/` | ตาราง, modal, wizard, gauge, badge, AI chat, sync panel |
| `src/hooks/` | data hooks, dialog focus trap, VMware sync |
| `src/utils/` | formatter, ข้อความ error ที่ปลอดภัย, สถานะ recovery, ทิศทาง site pair |

Build ด้วย Vite (`npm run build`) → `frontend/dist` ซึ่ง backend เสิร์ฟเป็น static

---

## 15. สรุปตัวแปรตั้งค่า (Environment)

> ผู้ใช้ทั่วไป **ไม่ต้องตั้งตัวแปรใด ๆ** — ทุกค่ามี default และ keys ถูกสร้างอัตโนมัติ
> ตารางนี้สำหรับผู้พัฒนา / deployment พิเศษเท่านั้น

### Runtime
| ตัวแปร | Default | ความหมาย |
|--------|---------|---------|
| `PORT` | `3002` | พอร์ต HTTP (`0` = สุ่ม) |
| `HOST` | `127.0.0.1` | address ที่ bind (Docker ตั้ง `0.0.0.0` ภายใน container) |
| `NODE_ENV` | `production` | |
| `SRM_DATA_DIR` | `<root>/data` | โฟลเดอร์ข้อมูล |
| `SRM_STATE_FILE` | `<data>/application.json` | ไฟล์ state |
| `APP_BUILD_ID` | — | ส่งกลับใน header `X-App-Build` |

### Secrets (สร้างอัตโนมัติ — อย่าใส่ใน Git)
| ตัวแปร | ความหมาย |
|--------|---------|
| `SESSION_SECRET` | ลงนาม session cookie |
| `VMWARE_CREDENTIAL_KEY` | AES-256-GCM key สำหรับรหัสผ่าน VMware และ AI key |

### VMware
| ตัวแปร | Default | ความหมาย |
|--------|---------|---------|
| `VMWARE_CONNECT_TIMEOUT_MS` | `10000` (1000–30000) | timeout ต่อ request |
| `VMWARE_MAX_RESPONSE_BYTES` | `1048576` | ขนาด response สูงสุด |
| `VMWARE_ALLOWED_HOSTS` | ว่าง | allowlist เพิ่มเติม (comma-separated) |
| `VMWARE_ALLOWED_CIDRS` | ว่าง | allowlist IPv4 CIDR เพิ่มเติม |
| `VMWARE_CA_CERT_PATH` | ตั้งอัตโนมัติเมื่ออัปโหลด CA | path ของ CA bundle |
| `SRM_WRITE_CONCURRENCY` | `4` (1–6) | จำนวน SRM write ที่ทำพร้อมกัน |

### Freshness
| ตัวแปร | Default |
|--------|---------|
| `DATA_FRESHNESS_WARNING_SECONDS` | `3600` |
| `DATA_FRESHNESS_CRITICAL_SECONDS` | `86400` |

---

## 16. ขอบเขตและข้อจำกัด

- ไม่ใช่ public hosting profile — ออกแบบสำหรับ loopback / trusted network
- ไม่รับประกัน compatibility กับ VMware ทุกเวอร์ชัน (adapter มี fallback vSphere API `8.0.3.0`)
- ยังไม่มี portable backup export / restore ข้ามเครื่อง
- Unit tests ใช้ test double — ไม่แทนการทดสอบ live recovery กับ VMware จริง

ดู [04-validation.md](04-validation.md) และ [SECURITY.md](../SECURITY.md)
