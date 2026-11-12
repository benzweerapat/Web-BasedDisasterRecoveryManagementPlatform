'use strict';
// Web-managed configuration is already persisted in FileStore. Never reconcile
// against connections.json on restart: doing so would overwrite UI changes.
async function initialize() {
  const { pool } = require('../../db');
  await pool.run(s => { s.read('connections'); s.read('users'); }, [], false);
}
module.exports = { initialize };
