//โหลดเครื่องมือ dns ที่มีมาให้ใน Node.js แล้วเก็บไว้ในตัวแปรชื่อ dns เพื่อเรียกใช้ในไฟล์นี้
const dns = require('dns');
const { isIP } = require('node:net');
const vmwareConfig = require('../config/vmware.config');

//การค้นหา IP ล้มเหลว ไม่มี IP กลับมา และปลายทางไม่อยู่ในรายการอนุญาต ใช้ข้อความและรหัสเดียวกัน
class NetworkPolicyError extends Error {
  constructor(message, code = 'VMWARE_TARGET_NOT_ALLOWED') {
    super(message);
    this.name = 'NetworkPolicyError';
    this.code = code;
  }
}

//แปลง IPv4 เป็นตัวเลข
function ip4ToInt(ip) {
  return ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;
}

//ตรวจว่า IPv4 อยู่ใน CIDR หรือไม่
//แต่ในนี้ไม่ได้เรียก เพราะไม่ได้กำหนด VMWARE_ALLOWED_CIDRS
function isIpInCidr(ip, cidr) {
  if (isIP(ip) !== 4 || typeof cidr !== 'string') return false;
  const parts = cidr.split('/');
  if (parts.length !== 2 || isIP(parts[0]) !== 4 || !/^\d{1,2}$/.test(parts[1])) return false;
  const bits = Number(parts[1]);
  if (bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip4ToInt(ip) & mask) === (ip4ToInt(parts[0]) & mask);
}

// เริ่มฟังก์ชันหลัก
async function validateTarget(hostname) {
  // allowedHosts คือรายการชื่อหรือ IP ที่อนุญาต
  const configured = await require('../../db').pool.run(s => s.read('connections').filter(c=>c.is_active).map(c=>{try{return new URL(c.base_url).hostname;}catch{return '';}}),[],false);
  const allowedHosts = [...new Set([...vmwareConfig.allowedHosts,...configured])];
  //allowedCidrs เป็น [] เพราะไม่ได้กำหนดไว้
  const allowedCidrs = vmwareConfig.allowedCidrs;

  //รับ IP ปลายทาง
  //ถ้าปลายทางเป็น IPv4 จะได้ปโดยไม่สอบถาม DNS server

  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new NetworkPolicyError('The VMware endpoint is not permitted by network policy');
  }

  //ตรวจว่ามีผลลัพธ์หรือไม่
  if (!addresses || addresses.length === 0) {
    throw new NetworkPolicyError('The VMware endpoint is not permitted by network policy');
  }

  //เตรียมรายการที่ผ่านการตรวจ
  const validIps = [];

  //ตรวจ IP ทีละตัว
  for (const record of addresses) {
    const ip = record.address;
    let allowed = false;

    // ตรวจชื่อหรือ IP แบบตรงตัวก่อน
    if (allowedHosts.includes(hostname)) {
      allowed = true;
    }

    // ถ้ายังไม่ผ่าน จึงตรวจ CIDR
    //ถ้าไม่มี CIDR จะข้ามส่วนนี้ทั้งหมด
    if (!allowed && allowedCidrs.length > 0) {
      for (const cidr of allowedCidrs) {
        if (isIpInCidr(ip, cidr)) {
          allowed = true;
          break;
        }
      }
    }

    //ปฏิเสธทันทีถ้า IP ตัวนั้นไม่ผ่าน
    if (!allowed) {
      throw new NetworkPolicyError('The VMware endpoint is not permitted by network policy');
    }

    validIps.push(ip);
  }

  //เก็บ IP ที่ผ่าน
  return validIps;
}

module.exports = {
  NetworkPolicyError,
  validateTarget,
  isIpInCidr
};