# 📘 คู่มือผู้ใช้ (User Manual) — SRM Monitoring 2.0

คู่มือนี้ครอบคลุมการ **ติดตั้ง → สร้างบัญชีแรก → เพิ่ม server → Sync → ใช้งานแต่ละหน้า → ดูแล/แก้ปัญหา**
สำหรับผู้ดูแลระบบและผู้ใช้งานทั่วไป

> ต้องการรู้ "ระบบทำงานภายในยังไง" ดูที่ [02-architecture.md](02-architecture.md)

---

## สารบัญ

1. [ความต้องการของระบบ](#1-ความต้องการของระบบ)
2. [ติดตั้งและเริ่มระบบ](#2-ติดตั้งและเริ่มระบบ)
3. [สร้างบัญชีแรกและ Login](#3-สร้างบัญชีแรกและ-login)
4. [หน้าจอที่เข้าถึงได้ (Routes)](#4-หน้าจอที่เข้าถึงได้-routes)
5. [เพิ่มและจัดการ VMware server](#5-เพิ่มและจัดการ-vmware-server)
6. [Test, Sync และความสดของข้อมูล](#6-test-sync-และความสดของข้อมูล)
7. [Dashboard และ Inventory](#7-dashboard-และ-inventory)
8. [vSphere Replication](#8-vsphere-replication)
9. [Inventory mappings และ Protection groups](#9-inventory-mappings-และ-protection-groups)
10. [Recovery plans และการสั่ง Recovery](#10-recovery-plans-และการสั่ง-recovery)
11. [AI Assistant](#11-ai-assistant)
12. [CA certificate](#12-ca-certificate)
13. [บัญชีผู้ใช้และสิทธิ์ (Roles)](#13-บัญชีผู้ใช้และสิทธิ์-roles)
14. [ที่เก็บข้อมูลและการสำรอง](#14-ที่เก็บข้อมูลและการสำรอง)
15. [ชุดทดสอบและคำสั่งตรวจ](#15-ชุดทดสอบและคำสั่งตรวจ)
16. [แก้ปัญหาเบื้องต้น](#16-แก้ปัญหาเบื้องต้น)

---

## 1. ความต้องการของระบบ

| รายการ | รันจาก source | Docker |
|--------|---------------|--------|
| OS | macOS / Linux / Windows | Linux / macOS ที่มี Docker |
| Runtime | Node.js 24 + npm | Docker + Docker Compose v2 |
| พอร์ต | `127.0.0.1:3002` | `127.0.0.1:3002` |
| Browser | Chrome / Edge / Firefox / Safari รุ่นปัจจุบัน | เหมือนกัน |
| การเข้าถึงเครือข่าย | HTTPS ไปยัง vCenter / VR / SRM ที่ตั้งค่าไว้ | เหมือนกัน |
| AI (ไม่บังคับ) | Internet ไปยัง Google Gemini API | เหมือนกัน |

ฝั่ง VMware ต้องมี:
- **vCenter Server** อย่างน้อยหนึ่งตัวต่อ site
- **vSphere Replication** และ/หรือ **Site Recovery Manager** ที่จับคู่ site แล้ว (ถ้าต้องการใช้หน้า Replication / Recovery)
- บัญชี VMware ที่มีสิทธิ์ตามงาน — อ่านอย่างเดียวพอสำหรับ monitoring, ต้องมีสิทธิ์จัดการสำหรับ configure replication หรือสั่ง recovery

> ⚠️ **ขอบเขตการใช้งาน:** ระบบออกแบบสำหรับ local / trusted network การมี Login ไม่เท่ากับพร้อม
> public deployment หากเปิดให้เครื่องอื่นเข้าถึงต้องมี HTTPS reverse proxy และทดสอบการควบคุมสิทธิ์เพิ่ม
> (ดู [SECURITY.md](../SECURITY.md))

---

## 2. ติดตั้งและเริ่มระบบ

### 2.1 รันจาก source

```bash
# 1) ติดตั้ง dependencies ทั้ง 3 ชุด (root, backend, frontend)
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts

# 2) build หน้าเว็บ (frontend/dist)
npm run build

# 3) เริ่ม backend + เสิร์ฟหน้าเว็บ
npm start
```

เปิด **http://localhost:3002** — ระบบสร้างโฟลเดอร์ `data/` พร้อม `runtime-secrets.json` (สิทธิ์ 0600) ให้อัตโนมัติ

**หยุดระบบ:** กด `Ctrl+C` ใน terminal (backend ปิด HTTP server และลบ `application.pid` ให้เอง)

### 2.2 Docker Compose

```bash
docker compose up -d --build     # build + เริ่ม
docker compose ps                # ดูสถานะ (มี healthcheck /api/health)
docker compose logs -f app       # ดู log
```

Compose ใช้ named volume `srm-data` เก็บข้อมูล, container เป็น read-only, ตัด Linux capabilities ทั้งหมด
และเปิดพอร์ตเฉพาะ `127.0.0.1:3002`

```bash
docker compose down              # หยุด แต่เก็บข้อมูลไว้ใน volume
docker compose down -v           # หยุด + ลบ volume (บัญชี, server, keys, inventory หายหมด)
```

> ⚠️ `down -v` ลบ encryption keys ไปพร้อมข้อมูล — ใช้เฉพาะตอนต้องการเริ่มใหม่สะอาดจริง ๆ

---

## 3. สร้างบัญชีแรกและ Login

การเปิดครั้งแรกจะแสดงหน้า **Create your administrator account**

| ช่อง | เงื่อนไข |
|------|---------|
| Username | 3–64 ตัวอักษร ใช้ `A–Z a–z 0–9 _ . @ -` ระบบเทียบแบบตัวพิมพ์เล็ก |
| Password | 12–128 ตัวอักษร |
| Confirm password | ต้องตรงกับ Password |

- **ไม่มีบัญชีหรือรหัสผ่าน default** — เมื่อสร้างบัญชีแรกแล้วหน้า setup จะถูกปิดถาวร
- ครั้งต่อไปเข้าที่หน้า **Sign in** ด้วยบัญชีที่สร้างไว้
- Session มีอายุคงที่ **30 นาที** (ไม่ต่ออายุอัตโนมัติ) กด **Sign out account** เมื่อเลิกใช้งาน
- การเปลี่ยน role / password / status ของบัญชีจะยกเลิก session เดิมของบัญชีนั้นทันที

---

## 4. หน้าจอที่เข้าถึงได้ (Routes)

| หน้า | Route | ใช้ทำอะไร |
|------|-------|-----------|
| **Disaster recovery dashboard** | `/dr-unified` | ภาพรวมทุก site: CPU/RAM/Storage, datastores, สถานะ VR/SRM, จำนวน protection group / recovery plan |
| **VMware connections** | `/connections` | เพิ่ม / แก้ / ลบ / Test / Sync server |
| **vCenter inventory** | `/vcenters` | hosts, clusters, datastores, networks ของแต่ละ vCenter |
| **Virtual machines** | `/vms` | รายการ VM, สถานะ protection, รายละเอียด VM |
| **Replications** | `/replications` | site pairings, replication ของ vSphere Replication, สร้าง/ปรับ replication |
| **Inventory mappings** | `/inventory-mappings` | network / folder / resource pool mappings และ placeholder datastore ของ SRM |
| **Protection groups** | `/protection-groups` | สร้างและดู protection group, protect VM |
| **Recovery plans** | `/recovery-plans` | ดู plan, steps, history และสั่ง Test / Cleanup / Recovery / Reprotect |
| **Settings** | `/settings` | AI assistant, CA certificate, รอบ Sync อัตโนมัติ, เปลี่ยนรหัสผ่านตัวเอง |
| **Users** | `/users` | (ADMIN) เพิ่ม / แก้บัญชีผู้ใช้ |

ปุ่มที่มีทุกหน้า: **Sync** (มุมขวาบน) และ **AI chat** (มุมขวาล่าง เมื่อเปิดใช้)

---

## 5. เพิ่มและจัดการ VMware server

เปิด **VMware connections → Add server**

| ช่อง | วิธีตั้ง |
|------|---------|
| Server name | ชื่อที่แสดงในแอป เช่น `vcenter dc`, `vr dr` |
| Type | `VCENTER`, `VR` หรือ `SRM` — เปลี่ยนชนิดของรายการเดิมไม่ได้ ให้สร้างรายการใหม่ |
| Site | ชื่อ site เช่น `DC` หรือ `DR` |
| Server address (HTTPS) | HTTPS origin เช่น `https://vcenter.example.invalid` ใส่ port ได้ แต่ห้ามมี path, query หรือ credentials |
| VMware username / password | บัญชี VMware ที่มีสิทธิ์ตามงาน |
| Associated vCenter | (VR / SRM) ต้องเลือก vCenter ที่มีอยู่แล้วใน site เดียวกัน |
| Verify TLS certificate | เปิดไว้ตามปกติ — ถ้าใช้ CA ภายในให้อัปโหลด CA ใน Settings ([§12](#12-ca-certificate)) |

**ลำดับที่แนะนำ:** เพิ่ม vCenter ของทุก site ก่อน → เพิ่ม VR → เพิ่ม SRM

- **Save server** — ค่าใช้ได้ทันทีและคงอยู่หลัง restart ไม่ต้องตั้ง host allowlist แยก
  (backend อนุญาตเฉพาะ endpoint ของ server ที่บันทึกไว้)
- **Edit** — แก้ name / address / username / password / TLS / association ได้
  ช่อง password ว่าง = คงรหัสเดิม ระบบไม่แสดงรหัสเดิมบนฟอร์ม
  การเปลี่ยน site ของ vCenter จะเปลี่ยน site ของ VR/SRM ที่อ้างถึงด้วย
- **Remove** — ลบ configuration และ cached inventory ที่เกี่ยวข้อง (ไม่ได้ลบ VM หรือ appliance จริง)
  ต้องลบ VR/SRM ที่อ้าง vCenter ก่อนจึงลบ vCenter ได้

> ⚠️ ปิด **Verify TLS certificate** เฉพาะสภาพแวดล้อมทดสอบที่แยกขาดเท่านั้น — credentials อาจถูกดักโดย endpoint ปลอม
>
> ℹ️ ระหว่าง Sync หรือมีงาน write ค้าง ระบบอาจตอบ **409** เมื่อแก้ server ให้รอจนงานจบก่อน

---

## 6. Test, Sync และความสดของข้อมูล

| ปุ่ม | ทำอะไร | ติดต่อ VMware? |
|------|--------|:--------------:|
| **Test** | ตรวจ endpoint และบัญชีจริง | ✅ (เบา) |
| **Sync** (ราย server) | เก็บ inventory ใหม่ของ server นั้น | ✅ |
| **Sync All** | เก็บทั้งหมดตามลำดับ dependency **vCenter → VR → SRM** | ✅ |
| **Reload** | อ่านจาก cache ใน storage | ❌ |

**Sync อัตโนมัติ:** **Settings → Automatic inventory synchronization**
- `0` = ปิด, หรือ `60–86400` วินาที
- รอบถัดไปนับหลังรอบก่อนจบ และจะเลื่อนออกไปถ้ามีงาน VR/SRM ค้างอยู่

**ความสดของข้อมูล (Freshness):** ทุกตารางแสดง **Last collected** และ badge

| สถานะ | ค่าเริ่มต้น |
|-------|------------|
| Fresh | อายุข้อมูล ≤ 1 ชั่วโมง |
| Warning | > 1 ชั่วโมง |
| Critical | > 24 ชั่วโมง |

> ℹ️ รายการว่างไม่ได้ยืนยันว่า "ไม่มี VM" หรือ "ไม่มี protection" — ตรวจ scope และสถานะ
> Partial / Failed / Skipped ของการ Sync ครั้งล่าสุดก่อนสรุปเสมอ

---

## 7. Dashboard และ Inventory

### Disaster recovery dashboard (`/dr-unified`)
แสดงการ์ดต่อ vCenter (เช่น DC / DR):
- จำนวน Hosts / Clusters / VMs / Datastores
- **Cluster capacity** — gauge CPU / RAM / Storage
- **Datastores** — % used (แถบแดงเมื่อใกล้เต็ม)
- **Site Recovery Manager status** — appliance (VR / SRM), replication ขาออก/ขาเข้า, จำนวน protection group และ recovery plan

### vCenter inventory (`/vcenters`) และ Virtual machines (`/vms`)
- ตารางค้นหา / กรองได้ คลิกแถวเพื่อเปิด **Detail drawer**
- รายละเอียด host: NIC (vmk/vmnic), vSwitch, HBA, LUN
- รายละเอียด VM: power state, datastore, network, สถานะ replication / protection

---

## 8. vSphere Replication

หน้า **Replications** (`/replications`) มี 2 ส่วน: **Replications** และ **Site pairings**

| งาน | ผลลัพธ์ |
|-----|---------|
| Configure replication | เลือก VM → target site / datastore / RPO แล้วส่งคำสั่งไป VR |
| Reconfigure | ปรับ RPO / datastore / ตั้งค่าเดิม |
| Pause / Resume | หยุดหรือเริ่ม replication ชั่วคราว |
| Sync now | สั่ง sync ทันที |
| Unconfigure | ยกเลิก replication |

> ⚠️ ทุกคำสั่งส่งไป VMware **จริง** — HTTP 202 แปลว่า "รับงานแล้ว" ไม่ใช่ "สำเร็จแล้ว"
> ติดตามผลได้ที่ **Background operations** panel
>
> ℹ️ Create replication สำเร็จ = ตั้ง configuration แล้วเท่านั้น สถานะ *Not active* ไม่ได้ยืนยันว่า initial sync เริ่มแล้ว

---

## 9. Inventory mappings และ Protection groups

### Inventory mappings (`/inventory-mappings`)
- จัดการ **network / folder / resource pool mappings** และ **placeholder datastore** ของ SRM pair
- ทิศทางของ mapping อ้างอิง vCenter / host identity ของแต่ละ site ไม่ใช้ชื่อ datastore หรือลำดับแถว
- เลือกทิศทางด้วย **Direction toggle** (DC → DR หรือ DR → DC)

### Protection groups (`/protection-groups`)
- **Protection group wizard** — สร้าง group จาก VM ที่ replicate ด้วย VR แล้ว
- **Protect VM / Configure all VMs** — ตั้ง protection ให้ VM ใน group
- ตารางแสดงสถานะ protection ของ VM แต่ละตัวและปัญหาที่ SRM รายงาน

---

## 10. Recovery plans และการสั่ง Recovery

หน้า **Recovery plans** (`/recovery-plans`) แสดง plan, protection groups, VMs, steps และ history

| Action | ความหมาย |
|--------|---------|
| **Test** | ทดสอบ recovery ใน bubble network โดยไม่กระทบ production |
| **Cleanup** | ล้างผลของการ Test |
| **Migration** (Planned migration) | ย้าย workload ไป site ปลายทางแบบวางแผน (ทั้งสอง site ยังทำงาน) |
| **Recovery** (Disaster recovery) | กู้ workload ที่ site ปลายทางเมื่อ site ต้นทางเสีย |
| **Reprotect** | กลับทิศทาง protection หลัง recovery |
| **Cancel** | ขอยกเลิกงานที่กำลังทำ |

ขั้นตอนที่ปลอดภัย:
1. เปิด plan → ระบบโหลด **available actions / preflight** จาก SRM แบบ live ก่อนเปิดปุ่ม
2. ตรวจ source / target site, ชื่อ plan, protection groups และ VMs ให้ถูกต้อง
3. กดสั่งงาน → ติดตามผลใน **Recovery execution** และ history
4. ตรวจผล live หลังงานจบทุกครั้ง

> ⚠️ ปุ่มจะถูกปิดระหว่าง refresh / error / conflict ระบบไม่ใช้สิทธิ์เก่าในการส่งคำสั่ง
>
> ⚠️ ถ้าสถานะเป็น `SUBMISSION_UNKNOWN`, `RECONCILIATION_BLOCKED` หรือ `ROLLBACK_FAILED`
> **ห้ามกดซ้ำ** ให้ตรวจใน VMware และ journal ก่อน — **Cancel ไม่รับประกันว่าจะย้อนสิ่งที่ทำไปแล้ว**

---

## 11. AI Assistant

AI **ปิดโดยค่าเริ่มต้น** เปิดได้ที่ **Settings → AI assistant** (ADMIN เท่านั้น)

1. ใส่ **API key** ของบัญชี Google Gemini ที่องค์กรอนุญาต
2. ใส่ **model ID** (ชื่อสั้น ไม่ใส่ `models/` prefix) และ fallback model ถ้าต้องการ
3. ตั้ง timeout `5000–60000` ms
4. ติ๊ก **Enable AI Chat** และยืนยันว่ามีสิทธิ์ส่งข้อมูลภายในไปยัง Google Gemini
5. กด **Save AI settings** (ไม่ต้อง restart)

- หลังบันทึก ช่อง key จะว่างและแสดงเพียงสถานะว่ามี key อยู่ — เว้นว่าง = คงค่าเดิม
- **Remove saved API key** = ลบ key (ต้องปิด Enable ก่อน)
- ปุ่ม Save ไม่ได้ทดสอบ key กับ provider

> ⚠️ AI ส่ง **คำถาม + ประวัติสนทนา + inventory ที่ cache ไว้** ไปยังบริการภายนอก ซึ่งอาจมีชื่อ VM, IP,
> endpoint และปัญหาของระบบ — ไม่ใช่ข้อมูลนิรนาม
>
> ℹ️ AI **อ่านอย่างเดียว** ไม่มีเครื่องมือสั่ง VMware คำถามจำกัด 2000 ตัวอักษรและมี rate limit

---

## 12. CA certificate

**Settings → VMware trusted CA certificate**
- อัปโหลดหรือวาง **PEM CA certificate** (รองรับ chain) ขนาดไม่เกิน 64 KB แล้วกด Save
- ใช้งานได้ทันทีและคงอยู่หลัง restart
- ไม่รับ private key
- **Remove CA certificate** = กลับไปใช้ system trust store

---

## 13. บัญชีผู้ใช้และสิทธิ์ (Roles)

| Role | สิทธิ์หลัก |
|------|-----------|
| **VIEWER** | อ่าน inventory / dashboard และใช้ AI (ถ้าเปิดไว้) |
| **OPERATOR** | VIEWER + Sync และ VMware operations ที่ controller อนุญาต |
| **ADMIN** | OPERATOR + จัดการ server, credentials, AI, CA และบัญชีผู้ใช้ |

**จัดการบัญชี (ADMIN):** **Users → Add user / Edit account**
- ตั้ง role, active status และรหัสผ่านใหม่ (เว้นว่าง = คงเดิม)
- **ทุกการบันทึกต้องยืนยันรหัสผ่าน ADMIN ปัจจุบัน**
- ไม่สามารถลดสิทธิ์หรือปิด ADMIN ที่ active คนสุดท้ายได้
- ใช้การ **ปิดบัญชี** แทนการลบ เพื่อคงตัวตนในประวัติการใช้งาน

**เปลี่ยนรหัสผ่านตัวเอง:** **Settings → Change your application password** (ต้องใส่รหัสปัจจุบัน)
session อื่นของบัญชีจะถูกยกเลิก

> ⚠️ ไม่มี password-recovery bypass — ถ้าลืมรหัส ให้ ADMIN อีกคน reset ผ่านหน้า Users
> จึงควรมีบัญชี ADMIN สำรองอย่างน้อย 1 บัญชี

---

## 14. ที่เก็บข้อมูลและการสำรอง

| รูปแบบติดตั้ง | ที่เก็บข้อมูล | ที่เก็บ keys |
|---------------|--------------|-------------|
| Source | `data/` ที่ root โปรเจกต์ | `data/runtime-secrets.json` (0600) |
| Docker | named volume `srm-data` (`/app/data`) | `runtime-secrets.json` ใน volume |

ไฟล์ในโฟลเดอร์ข้อมูล:
- `application.json` — บัญชี (password hash), server (รหัสผ่านเข้ารหัส), inventory, sessions, journal, settings
- `vmware-ca.pem` — CA ที่อัปโหลด (ถ้ามี)
- `application.pid` — lock กันเปิดข้อมูลชุดเดียวกันซ้ำสองโปรเซส

**การสำรอง:**
1. หยุด backend ก่อน (`Ctrl+C` หรือ `docker compose stop`)
2. สำรอง **ข้อมูล + key ที่คู่กัน** เสมอ (ข้อมูลโดยไม่มี key = ถอดรหัสไม่ได้)
3. เก็บ backup ในที่ปลอดภัยตามนโยบายองค์กร

> ⚠️ **ห้ามแชร์ `data/`, backup หรือ `runtime-secrets.json` ให้ผู้อื่น** เพราะมี keys และรหัสผ่านที่เข้ารหัสไว้
>
> ℹ️ รุ่นนี้ยังไม่มี portable backup / import wizard บนเว็บ

---

## 15. ชุดทดสอบและคำสั่งตรวจ

| คำสั่ง | ทำอะไร |
|--------|--------|
| `npm test` | รัน unit tests ทั้งหมด (`*.test.js` / `*.test.mjs` ใน backend, frontend, scripts) ด้วย `node --test` |
| `npm run lint` | ตรวจโค้ด frontend ด้วย oxlint |
| `npm run build` | build หน้าเว็บไปที่ `frontend/dist` |
| `npm audit --audit-level=moderate` | ตรวจช่องโหว่ dependencies (ทำซ้ำใน `backend/` และ `frontend/`) |

```bash
# ตรวจครบทุกอย่าง
npm test
npm run lint
npm audit --audit-level=moderate
npm --prefix backend audit --audit-level=moderate
npm --prefix frontend audit --audit-level=moderate
```

> ℹ️ tests ใช้ข้อมูลจำลอง ไม่แตะ VMware หรือ AI จริง — ผลและข้อจำกัดอยู่ใน [03-validation.md](03-validation.md)

---

## 16. แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุที่พบบ่อย | วิธีแก้ |
|-------|----------------|---------|
| Login ไม่ได้ | รหัสผิด / บัญชีถูกปิด / ติด rate limit | ตรวจบัญชีกับ ADMIN, รอ 1 นาทีแล้วลองใหม่ |
| `403 REQUEST_ORIGIN_DENIED` | เปิดผ่าน host / port ที่ไม่ตรงกับที่ backend bind | เปิดด้วย `http://localhost:3002` หรือพอร์ตที่ใช้จริง ห้ามแก้ origin เป็น wildcard |
| `409` ตอนแก้ server | มี Sync หรือ VMware operation ค้าง | รอให้งานจบ / ตรวจงานที่ผลไม่แน่นอนก่อน |
| TLS error ตอน Test | ชื่อใน certificate ไม่ตรง / ไม่มี CA | อัปโหลด CA ที่ถูกต้องใน Settings แทนการปิด verification |
| `Application startup failed` | ข้อมูลมีอยู่แต่ key หาย / ไม่ตรง | กู้ `runtime-secrets.json` ชุดเดิม — ระบบจะไม่สร้าง key ใหม่ทับข้อมูลเดิม |
| `already open in another process` | รัน backend ซ้อน / โปรเซสเก่าค้าง | ปิดโปรเซสเดิมก่อน |
| AI ตอบ `AI_RATE_LIMITED` | ถามถี่เกิน | รอสักครู่แล้วถามใหม่ |

### คำสั่งดูแลระบบที่ใช้บ่อย

```bash
# สถานะ backend
curl -s http://localhost:3002/api/health

# Docker: สถานะ + log
docker compose ps
docker compose logs -f app

# rebuild หลังแก้โค้ด (up เฉย ๆ ไม่ rebuild image)
docker compose up -d --build

# รันเฉพาะ test ไฟล์เดียว
node --test backend/src/services/vmware-http.test.js
```

---

[หน้ารวมเอกสาร](README.md) · [สถาปัตยกรรม](02-architecture.md) · [Security](../SECURITY.md)
