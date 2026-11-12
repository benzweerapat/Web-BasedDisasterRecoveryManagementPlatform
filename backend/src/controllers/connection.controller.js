const connectionRepository = require('../repositories/connection.repository');
const connectionTestService = require('../services/connection-test.service');

//แสดงรายการ Connections
async function getConnections(req, res, next) {
  try {
    const connections = await connectionRepository.findAllConnections();
    
    // ซ่อน username สำหรับ VIEWER
    const role = req.session.user?.role;
    if (role === 'VIEWER') {
      connections.forEach(conn => {
        if (conn.username) {
          const atIndex = conn.username.indexOf('@');
          if (atIndex > 1) {
            conn.username = conn.username[0] + '***' + conn.username.substring(atIndex);
          } else {
            conn.username = '***';
          }
        }
      });
    }

    res.json(connections);
  } catch (error) {
    next(error);
  }
}

//อ่าน connection ID

//ทดสอบ Connection
// ส่งผลทดสอบกลับ
async function testConnection(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await connectionTestService.testConnection(id, req.session.user, req.ip, req.id);
    return res.status(result.status).json(result.data);
  } catch (error) {
    next(error);
  }
}

module.exports = { getConnections, testConnection };

