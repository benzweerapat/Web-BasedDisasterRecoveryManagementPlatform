# เตรียม source ขึ้น GitHub

Source ต้องไม่มี runtime data, credentials, OS vault, backups, installer binaries หรือ node_modules มี `.gitignore`, publish guard, pre-commit hook, CI และ Dependabot สำหรับ root/backend/frontend/Actions

## เอกสารและภาพหน้าจอ

ไฟล์ `.docx` / `.pdf` (รวมถึง `docs/user-manual/`) ถูกกันออกจาก Git และ publish guard ปฏิเสธแม้ force-add เพราะภาพหน้าจอที่ฝังอยู่มักติด **IP ภายใน, ชื่อ host/VM/datastore และ metadata ผู้เขียน** ซึ่ง pattern check อ่านไม่ได้ เผยแพร่คู่มือเป็น Markdown ใน `docs/` แทน หากจำเป็นต้องแนบไฟล์ ให้ถ่ายภาพหน้าจอใหม่จาก lab ที่ใช้ชื่อ/IP ตัวอย่าง (เช่น `192.0.2.0/24`, `*.example.invalid`) หรือเบลอข้อมูลก่อน แล้วแนบเป็น GitHub Release asset หลังตรวจด้วยตา

ตัวอย่างในเอกสารและ tests ใช้เฉพาะ documentation addresses (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`) และโดเมน `example.invalid`

```bash
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
npm --prefix backend audit --audit-level=moderate
npm --prefix frontend audit --audit-level=moderate
```

เมื่อเริ่ม repository ใหม่:

```bash
git init -b main
git config core.hooksPath .githooks
git add .
npm run check:publish -- --staged
git diff --cached --stat
git diff --cached
```

Publish guard อ่าน contents จาก Git index จึงยังพบ key ที่ stage ไว้แม้ worktree จะแก้แล้ว ไม่แสดงค่าลับใน log และปฏิเสธ private/generated files แม้ force-add มา เครื่องมือไม่สแกน Git history และไม่รู้จัก secret ทุกชนิด ตรวจ diff/history และเปิด GitHub secret scanning/push protection เพิ่ม

คง repository เป็น private จนบริษัทตรวจสิทธิ์ในโค้ดและเอกสาร โครงการยังไม่มี LICENSE ระดับ repo; ISC ใน backend metadata ไม่ได้ตัดสินสิทธิ์ของทั้งชุด ให้เจ้าของงานกำหนดสิทธิ์ก่อนเปิด public

เมื่อผ่าน review จึง commit และเชื่อม URL ของ repository ที่เลือก ห้ามฝัง token/password ใน URL:

```bash
git commit -m "Prepare web-managed SRM Monitoring and desktop installers"
git remote add origin REPOSITORY_URL
git push -u origin main
```

CI ตรวจ publish set, tests, lint, build และ audit ทั้งสาม packages ใช้ read-only token และ Actions ที่ pin ด้วย SHA ไม่มี VMware/AI secrets ส่วน **Desktop installers** build unsigned artifacts บน Mac/Windows เมื่อ dispatch หรือ push tag `v*` ยังไม่ publish release

ตั้ง branch rules ให้ job `verify` ผ่านก่อน merge ทบทวน Dependabot และเปิด private vulnerability reporting หากรองรับ การ clone ใหม่ต้องตั้ง core.hooksPath อีกครั้ง

[Security](../SECURITY.md) · [Desktop build](05-desktop.md) · [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
