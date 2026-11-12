const test = require('node:test');
const assert = require('node:assert/strict');
const { isIpInCidr } = require('./network-policy.util');

test('IPv4 CIDR boundaries match only the configured range', () => {
  assert.equal(isIpInCidr('192.0.2.99', '192.0.2.0/24'), true);
  assert.equal(isIpInCidr('198.51.100.99', '192.0.2.0/24'), false);
  assert.equal(isIpInCidr('192.0.2.99', '192.0.2.99/32'), true);
  assert.equal(isIpInCidr('192.0.2.98', '192.0.2.99/32'), false);
});

test('malformed ranges and unsupported IPv6 cannot silently grant network access', () => {
  for (const cidr of ['192.0.2.0/-1', '192.0.2.0/33', '192.0.2.0/no', 'invalid/24', '192.0.2.0/24/0', '192.0.2.0', '::/0']) {
    assert.equal(isIpInCidr('192.0.2.10', cidr), false, cidr);
  }
  assert.equal(isIpInCidr('invalid', '0.0.0.0/0'), false);
});
