# Security — SRM Monitoring 2.0

รุ่นนี้มี first-run Admin setup และ Login จริง ไม่มี default/local ADMIN bypass Password เป็น scrypt hashes; login จำกัด attempts; CSRF/session regeneration และ active user/version checks ปกป้อง settings API เฉพาะ Admin จัดการ server/AI/CA/users

## การเก็บข้อมูลลับ

VMware passwords และ AI key เข้ารหัส AES-256-GCM ไม่คืน plaintext/ciphertext/key ผ่าน GET API ช่องแก้ไขที่ว่างคงค่าเดิม การลบ AI key ต้องเลือก clear อย่างชัดเจน ไม่ใส่ key ใน frontend bundle, URL หรือ source

Desktop ใช้ Electron safeStorage async API กับ OS key store ป้องกัน master key หาก vault unavailable จะไม่ fallback เป็น plaintext เว็บ Node โดยตรงสร้าง matching keys ใน local data directory ด้วยสิทธิ์ไฟล์จำกัด; บน Windows ยังขึ้นกับ ACL ของ OS profile การเข้าถึง OS user account, vault และ backups เป็นส่วนหนึ่งของ trust boundary แอปไม่ป้องกันเครื่องที่ถูกยึดสิทธิ์โดยผู้โจมตีแล้ว

ห้าม commit runtime data, sessions, keys, vault, credentials, backups, logs หรือ installer artifacts ตัวตรวจ publish เป็น pattern check บางชนิด ไม่ครอบคลุม secret ทุกประเภทและไม่ตรวจ history เปิด GitHub secret scanning/push protection ตามที่ repository รองรับ หากเคยรั่วให้ revoke/rotate กับ provider การลบไฟล์ไม่เพิกถอน key และไม่ลบ Git history

## Desktop / network

Renderer ไม่มี Node integration, ใช้ sandbox/context isolation, ไม่เปิด privileged IPC, ไม่อนุญาต navigation/popup/subresource ออกนอก local origin Backend อยู่ loopback random port และต้องมี per-launch capability header จาก Electron main

Standalone web defaults เป็น loopback ไม่ใช้ password/session ผ่าน public HTTP แม้มี Login ก็ยังต้องมี HTTPS, deployment access policy, monitoring และ integration tests ก่อนเปิดหลายผู้ใช้ผ่านเครือข่าย Cookie secure=false สำหรับ local HTTP ห้ามถือว่า CORS เป็น authentication และใช้ backend process เดียวต่อ state

VMware client ใช้ configured endpoints เป็น allowlist, HTTPS, pinned DNS, no proxy/redirect และ TLS verification เป็น default ของ SRM/VR อย่าปิด verifyTls ในระบบจริง ให้อัปโหลด public CA certificate ผ่าน Settings แทน ไม่รับ private keys

## AI

AI ปิดจน Admin เปิด กำหนด model/key และยืนยัน external sharing เมื่อส่งคำถามจะมี selected cached inventory/history ไป Google Gemini ซึ่งยังอาจมีชื่อ VM, IP และ endpoint ภายใน ไม่ใช่ข้อมูล anonymous AI ไม่มีเครื่องมือส่ง VMware commands การ Save settings ไม่ตรวจ key/model กับ provider โดยอัตโนมัติ

## Distribution และ reporting

Build ที่ไม่มี certificate ยังเป็น unsigned/unnotarized: Apple Gatekeeper หรือ Windows SmartScreen อาจเตือน ไม่ปิด OS security protections ให้ใช้บริษัทลงนาม/รับรองตามนโยบายก่อนกระจายวงกว้าง macOS safeStorage อาจถามสิทธิ์ Keychain ซ้ำเมื่อ unsigned app เปลี่ยน build/signature ไม่มี key/signing certificate ของบริษัทในชุดนี้

รายงานช่องโหว่ผ่านช่องทางส่วนตัวของผู้ดูแลหรือ GitHub Private vulnerability reporting หากเปิดไว้ ห้ามใส่ credentials/inventory จริงใน public issue

[Electron security](https://www.electronjs.org/docs/latest/tutorial/security) · [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) · [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
