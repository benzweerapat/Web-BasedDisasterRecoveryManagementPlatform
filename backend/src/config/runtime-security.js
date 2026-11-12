'use strict';

function validateRuntimeSecrets(env = process.env) {
  const secret = String(env.SESSION_SECRET || '');
  if (secret.length < 32 || /replace-with|change.?me|example|placeholder/i.test(secret)) {
    throw Error('SESSION_SECRET must be a new random value of at least 32 characters');
  }
  const key = String(env.VMWARE_CREDENTIAL_KEY || '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32 ||
      Buffer.from(key, 'base64').toString('base64') !== key) {
    throw Error('VMWARE_CREDENTIAL_KEY must be canonical Base64 of 32 random bytes');
  }
}

module.exports = { validateRuntimeSecrets };
