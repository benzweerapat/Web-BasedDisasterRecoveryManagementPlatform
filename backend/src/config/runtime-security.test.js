const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { validateRuntimeSecrets } = require('./runtime-security');

test('requires separate valid runtime secrets and rejects placeholders', () => {
  const env = { SESSION_SECRET: randomBytes(48).toString('hex'), VMWARE_CREDENTIAL_KEY: randomBytes(32).toString('base64') };
  assert.doesNotThrow(() => validateRuntimeSecrets(env));
  for (const secret of ['', 'short', 'replace-with-a-random-secret-that-is-long']) {
    assert.throws(() => validateRuntimeSecrets({ ...env, SESSION_SECRET: secret }), /SESSION_SECRET/);
  }
  for (const key of ['', 'not-a-key', env.VMWARE_CREDENTIAL_KEY + '?', randomBytes(31).toString('base64')]) {
    assert.throws(() => validateRuntimeSecrets({ ...env, VMWARE_CREDENTIAL_KEY: key }), /VMWARE_CREDENTIAL_KEY/);
  }
});
