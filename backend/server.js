'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('./src/config/initialize-runtime').initializeRuntime();
const { pool } = require('./db');
const dir = path.dirname(pool.filename);
const lock = path.join(dir, 'application.pid');
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, 'utf8'));
  let alive = false;
  if (pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch {} }
  if (alive) throw Error('This application data is already open in another process');
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { mode: 0o600, flag: 'wx' });
const clear = () => { try { if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); } catch {} };
process.once('exit', clear);
async function start() {
  await require('./src/storage/bootstrap').initialize();
  const app = require('./src/app');
  await require('./src/services/vr-management-worker.service').start();
  require('./src/services/srm-write-worker').start();
  require('./src/services/sync-schedule.service').start();
  const server = app.listen(Number(process.env.PORT || 3002), process.env.HOST || '127.0.0.1', () => {
    const port = server.address().port;
    process.env.SRM_BOUND_PORT = String(port);
    const ready = { type: 'ready', port };
    if (process.parentPort) process.parentPort.postMessage(ready);
    else if (process.send) process.send(ready);
    console.log('SRM Monitoring ready on loopback port ' + port);
  });
  server.on('error', () => { console.error('Unable to open the application port'); process.exit(1); });
  const stop = () => { server.close(() => { clear(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
  process.parentPort?.on('message', event => { if (event.data?.type === 'shutdown') stop(); });
}
start().catch(() => { console.error('Application startup failed. Check data access and matching encryption keys.'); process.exit(1); });
