# Security — SRM Monitoring 2.0

รุ่นนี้มี first-run Admin setup และ Login จริง ไม่มี default/local ADMIN bypass Password เป็น scrypt hashes; login จำกัด attempts; CSRF/session regeneration และ active user/version checks ปกป้อง settings API เฉพาะ Admin จัดการ server/AI/CA/users

## การเก็บข้อมูลลับ

VMware passwords และ AI key เข้ารหัส AES-256-GCM ไม่คืน plaintext/ciphertext/key ผ่าน GET API ช่องแก้ไขที่ว่างคงค่าเดิม การลบ AI key ต้องเลือก clear อย่างชัดเจน ไม่ใส่ key ใน frontend bundle, URL หรือ source

Backend สร้าง matching keys ใน local data directory (`runtime-secrets.json`) ด้วยสิทธิ์ไฟล์จำกัด; บน Windows ยังขึ้นกับ ACL ของ OS profile การเข้าถึง OS user account, data directory และ backups เป็นส่วนหนึ่งของ trust boundary แอปไม่ป้องกันเครื่องที่ถูกยึดสิทธิ์โดยผู้โจมตีแล้ว

ห้ามแชร์ runtime data, sessions, keys, credentials, backups หรือ logs ให้ผู้อื่น หาก credentials หรือ API key เคยรั่วให้ revoke/rotate กับ provider ทันที การลบไฟล์ไม่ได้เพิกถอน key

## Network

เว็บ defaults เป็น loopback ไม่ใช้ password/session ผ่าน public HTTP แม้มี Login ก็ยังต้องมี HTTPS, deployment access policy, monitoring และ integration tests ก่อนเปิดหลายผู้ใช้ผ่านเครือข่าย Cookie secure=false สำหรับ local HTTP ห้ามถือว่า CORS เป็น authentication และใช้ backend process เดียวต่อ state

VMware client ใช้ configured endpoints เป็น allowlist, HTTPS, pinned DNS, no proxy/redirect และ TLS verification เป็น default ของ SRM/VR อย่าปิด verifyTls ในระบบจริง ให้อัปโหลด public CA certificate ผ่าน Settings แทน ไม่รับ private keys

## AI

AI ปิดจน Admin เปิด กำหนด model/key และยืนยัน external sharing เมื่อส่งคำถามจะมี selected cached inventory/history ไป Google Gemini ซึ่งยังอาจมีชื่อ VM, IP และ endpoint ภายใน ไม่ใช่ข้อมูล anonymous AI ไม่มีเครื่องมือส่ง VMware commands การ Save settings ไม่ตรวจ key/model กับ provider โดยอัตโนมัติ

## Reporting

รายงานช่องโหว่ผ่านช่องทางส่วนตัวของผู้ดูแลระบบ ห้ามแนบ credentials หรือ inventory จริงในรายงานที่เปิดเผยต่อสาธารณะ
