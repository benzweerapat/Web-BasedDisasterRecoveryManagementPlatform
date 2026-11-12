//อ่านการตั้งค่าจาก environment เช่น .env แล้วจัดเป็นค่ากลางให้ส่วนเชื่อมต่อ VMware ใช้

//ใช้แปลง env ให้เป็น array
//เช่น VMWARE_ALLOWED_HOSTS=vcenter.local, srm.local, vr.local
// เป็น [
//   "vcenter.local",
//   "srm.local",
//   "vr.local"
// ]
const parseList = (envValue) => {
  if (!envValue) return [];
  return envValue.split(',').map(s => s.trim()).filter(s => s.length > 0);
};

//วลาสูงสุดที่รอการเชื่อมต่อ ค่าเริ่มต้น 10 วินาที และถูกจำกัดให้อยู่ระหว่าง 1–30 วินาที
const getTimeout = (envValue, defaultMs = 10000, minMs = 1000, maxMs = 30000) => {
  if (!envValue) return defaultMs;
  const val = parseInt(envValue, 10);
  if (isNaN(val)) return defaultMs;
  return Math.min(Math.max(val, minMs), maxMs);
};

//ขนาดคำตอบสูงสุดที่รับได้ ค่าเริ่มต้น 1 MB
const getResponseLimit = (envValue, defaultBytes = 1048576) => {
  if (!envValue) return defaultBytes;
  const val = parseInt(envValue, 10);
  if (isNaN(val) || val <= 0) return defaultBytes;
  return val;
};

// สร้าง Configuration Object
const vmwareConfig = {
  timeoutMs: getTimeout(process.env.VMWARE_CONNECT_TIMEOUT_MS),
  maxResponseBytes: getResponseLimit(process.env.VMWARE_MAX_RESPONSE_BYTES),
  allowedHosts: parseList(process.env.VMWARE_ALLOWED_HOSTS),
  allowedCidrs: parseList(process.env.VMWARE_ALLOWED_CIDRS),
  caCertPath: process.env.VMWARE_CA_CERT_PATH ? process.env.VMWARE_CA_CERT_PATH.trim() : null,
};

module.exports = vmwareConfig;
