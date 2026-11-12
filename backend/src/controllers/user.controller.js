const {
  pool
} = require('../../db');
const {
  sendReadResponse
} = require('../utils/api-response.util');
const getUsers = async (req, res, next) => {
  try {
    const {
      rows
    } = await pool.run((s, p) => {
      const R = s.helpers;
      const views = {};
      return R.result((parent => {
        let rows = [R.context(parent)];
        rows = R.join(rows, "users", r => views["users"] || s.read("users"), r => true, "INNER JOIN");
        let groups = rows.map(r => [r]);
        let result = groups.flatMap(g => {
          const r = g[0] || R.context(parent);
          return R.expand({
            "id": R.ref(r, "id", null),
            "username": R.ref(r, "username", null),
            "role": R.ref(r, "role", null),
            "status": R.ref(r, "status", null),
            "last_login": R.ref(r, "last_login", null),
            "created_at": R.ref(r, "created_at", null)
          }).map(value => ({
            value,
            r: R.projectContext(r, value),
            g
          }));
        });
        result.sort((a, b) => R.order([[R.ref(a.r, "id", null), R.ref(b.r, "id", null), "ASC", null]]));
        return result.slice(0).map(x => x.value);
      })(null));
    }, [], false);
    const formattedUsers = rows.map(user => ({
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.status === 'Active',
      lastLoginAt: user.last_login,
      createdAt: user.created_at
    }));
    sendReadResponse(res, formattedUsers, {
      dataState: formattedUsers.length ? 'SUCCESS' : 'SUCCESS_EMPTY'
    });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  getUsers
};