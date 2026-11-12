// โหลด Tool ในการจัดการตำแหน่งไฟล์ 
const path = require('node:path');
// โหลดClass FileStore ซึ่งเป็นตัว อ่าน เพิ่ม แก้ไข ลบข้อมูล
const { FileStore } = require('./src/storage/file-store');
// สร้าง pool เพื่อจัดการข้อมูล
// ถ้า SRM_STATE_FILE = /ตำแหน่ง/ไฟล์ที่ต้องการ.json ระบบจะใช้ตำแหน่งนั้น
//ถ้าไม่มี จะใช้ data/application.json
const pool = new FileStore(process.env.SRM_STATE_FILE || path.join(__dirname, '../data/application.json'));

//ส่งออกให้ส่วนอื่นใช้งาน
module.exports = {
  pool,                         // ส่ง FileStore ทั้งตัว
  run: pool.run.bind(pool),     // ส่งคำสั่ง run แบบเรียกตรงได้
  connect: pool.connect.bind(pool), // ส่งคำสั่ง connect แบบเรียกตรงได้
  checkConnection: async () => true // Storage พร้อมใช้งาน
};