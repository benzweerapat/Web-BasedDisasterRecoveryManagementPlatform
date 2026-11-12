const session = require('express-session');
const {
  pool
} = require('../../db');

//นำข้อกำหนดเหล่านั้นมาทำงานกับฐานข้อมูล JSON
class JsonSessionStore extends session.Store {

  //อ่าน Session
  get(sid, callback) {
    pool.run(s => {
      const r = s.read('sessions').find(x => x.sid === sid);
      return r && Date.parse(r.expires) > Date.now() ? r.session : null;
    }).then(r => callback(null, r), callback);
  }

  //สร้างหรืออัปเดต Session
  set(sid, data, callback = () => {}) {
    pool.run(s => {
      s.remove('sessions', row => Date.parse(row.expires) <= Date.now());
      return s.insert('sessions', [{ sid, session: data, expires: data.cookie.expires || new Date(Date.now() + 1800000).toISOString() }], {
        key: row => row.sid, change: (_, row) => row
      });
    }, [], true).then(() => callback(), callback);
  }

  //ลบ Session
  destroy(sid, callback = () => {}) {
    pool.run(s => s.remove('sessions', r => r.sid === sid), [], true).then(() => callback(), callback);
  }

  //ต่ออายุ Session
  touch(sid, data, callback = () => {}) {
    // Sessions in this local application use a fixed expiry. Avoid rewriting
    // the entire shared JSON state for read-only requests, especially while an
    // inventory sync owns the write lock.
    callback();
  }
}
module.exports = JsonSessionStore;
