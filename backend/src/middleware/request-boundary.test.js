const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestBoundary } = require('./request-boundary');

function request(boundary, headers) {
  let status = 200, continued = false;
  const req = { get: key => headers[key], id: 'test' };
  const res = { status(code) { status = code; return this; }, json() {} };
  boundary.guard(req, res, () => { continued = true; });
  return { status, continued };
}

test('production permits local UI, health checks and exact configured origins', () => {
  const boundary = createRequestBoundary({ NODE_ENV: 'production', PORT: '3002', FRONTEND_ORIGIN: 'https://console.example.invalid' });
  for (const headers of [
    { Host: '127.0.0.1:3002' },
    { Host: 'localhost:3002', Origin: 'http://localhost:3002' },
    { Host: 'console.example.invalid', Origin: 'https://console.example.invalid' }
  ]) assert.deepEqual(request(boundary, headers), { status: 200, continued: true });
});

test('rejects foreign, null, prefix-spoofed and wrong-port origins before routes', () => {
  const boundary = createRequestBoundary({ NODE_ENV: 'production', PORT: '3002', FRONTEND_ORIGIN: 'https://console.example.invalid' });
  for (const origin of ['null', 'https://evil.example.invalid', 'https://console.example.invalid.evil.invalid', 'https://console.example.invalid:444', 'http://localhost:5175']) {
    assert.deepEqual(request(boundary, { Host: 'localhost:3002', Origin: origin }), { status: 403, continued: false });
  }
});

test('rejects DNS-rebinding Host and originless cross-site navigation', () => {
  const boundary = createRequestBoundary({ NODE_ENV: 'production', PORT: '3002' });
  assert.equal(request(boundary, { Host: 'evil.example.invalid:3002' }).status, 403);
  assert.equal(request(boundary, { Host: 'localhost:3002', 'Sec-Fetch-Site': 'cross-site' }).status, 403);
});

test('development permits Vite only in development by default', () => {
  const boundary = createRequestBoundary({ NODE_ENV: 'development' });
  assert.equal(request(boundary, { Host: '127.0.0.1:3003', Origin: 'http://localhost:5175' }).continued, true);
});

test('invalid and wildcard FRONTEND_ORIGIN fail closed at startup', () => {
  for (const origin of ['*', 'null', 'https://user@example.invalid', 'https://example.invalid/path', 'https://example.invalid/?q=1']) {
    assert.throws(() => createRequestBoundary({ FRONTEND_ORIGIN: origin }), /FRONTEND_ORIGIN/);
  }
});
