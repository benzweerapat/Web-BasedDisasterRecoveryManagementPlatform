const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('VMware client keeps TLS, DNS pinning and redirect policy for both Node lookup forms', async () => {
  let config;
  const module = { exports: {} };
  const mocks = {
    axios: { create(options) { config = options; return { defaults: { headers: { common: {} } } }; } },
    https: require('node:https'), fs,
    'node:net': require('node:net'),
    '../utils/network-policy.util': { validateTarget: async () => ['2001:db8::10'] },
    '../config/vmware.config': { timeoutMs: 1000, maxResponseBytes: 1024, caCertPath: null }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'vmware-http.service.js'), 'utf8'), {
    module, URL, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }
  });
  await module.exports.createClient('https://vmware.example.invalid');
  assert.equal(config.adapter, 'http');
  assert.equal(config.maxRedirects, 0);
  assert.equal(config.proxy, false);
  assert.equal(config.httpsAgent.options.rejectUnauthorized, true);
  const lookup = config.httpsAgent.options.lookup;
  lookup('vmware.example.invalid', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '2001:db8::10'); assert.equal(family, 6);
  });
  lookup('vmware.example.invalid', { all: true }, (error, addresses) => {
    assert.equal(error, null); assert.equal(addresses[0].address, '2001:db8::10'); assert.equal(addresses[0].family, 6);
  });
});
