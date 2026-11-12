const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const errors = require('../utils/operation-error.util');

// Load only this controller into a stubbed module scope. No database, gateway,
// live VMware client, server or credentials are loaded by these regressions.
for (const code of ['SRM_SESSION_BUSY', 'SRM_SESSION_LOGIN_UNCERTAIN']) {
  test(`available-actions does not multiply the adapter admission wait for ${code}`, async () => {
    let calls = 0;
    const gateway = {
      context: async () => ({ identity: 'mock-scope' }),
      withGateway: async () => { calls++; throw Object.assign(new Error(code), { code }); }
    };
    const exports = {};
    const mocks = {
      '../services/srm-write-gateway': gateway,
      '../repositories/srm-write.repository': {},
      '../services/recovery-execution': {},
      '../utils/operation-error.util': errors,
      '../utils/api-response.util': { buildSafeError: (_req, error) => ({ error }) }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'recovery-execution.controller.js'), 'utf8'), {
      exports,
      require: name => { assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`); return mocks[name]; },
      setTimeout: () => { throw Error('Controller must not retry adapter admission'); }
    });
    const response = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
    await exports.options({ params: { id: 'mock-plan' }, query: { pairId: '1' }, session: { user: { role: 'ADMIN' } } }, response);
    assert.equal(calls, 1);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error.code, code);
  });
}
