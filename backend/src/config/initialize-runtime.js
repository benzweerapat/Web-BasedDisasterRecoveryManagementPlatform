'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateRuntimeSecrets } = require('./runtime-security');

function initializeRuntime(env = process.env) {
  env.PORT ||= '3002';
  env.HOST ||= '127.0.0.1';
  env.NODE_ENV ||= 'production';
  const dir = path.resolve(env.SRM_DATA_DIR || path.join(__dirname, '../../../data'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  env.SRM_STATE_FILE ||= path.join(dir, 'application.json');
  const filename = path.join(dir, 'runtime-secrets.json');
  if (!env.SESSION_SECRET || !env.VMWARE_CREDENTIAL_KEY) {
    if (env.SRM_OS_VAULT === 'true') throw Error('The operating system vault could not supply runtime keys');
    if (!fs.existsSync(filename)) {
      // Never silently replace the key for a pre-existing encrypted store.
      if (fs.existsSync(env.SRM_STATE_FILE)) throw Error('Existing state requires its original encryption key; restore its matching runtime secrets');
      const secret = crypto.randomBytes(48).toString('hex');
      const key = crypto.randomBytes(32).toString('base64');
      fs.writeFileSync(filename, JSON.stringify({ sessionSecret: secret, encryptionKey: key }), { mode: 0o600, flag: 'wx' });
    }
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    env.SESSION_SECRET ||= saved.sessionSecret;
    env.VMWARE_CREDENTIAL_KEY ||= saved.encryptionKey;
  }
  validateRuntimeSecrets(env);
  const ca = path.join(path.dirname(env.SRM_STATE_FILE), 'vmware-ca.pem');
  if (fs.existsSync(ca)) env.VMWARE_CA_CERT_PATH = ca;
  return { dataDir: path.dirname(env.SRM_STATE_FILE) };
}
module.exports = { initializeRuntime };
