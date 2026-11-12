import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from './check-publish.mjs';

test('publish guard catches private files even when force-added', () => {
  for (const path of ['.env', 'backend/.env.local', 'connections.json', 'data/application.json', 'backup.key', 'output/report.pdf', 'docs/manual.docx', 'docs/manual.pdf', 'node_modules/pkg/index.js']) {
    assert.ok(inspect(path, Buffer.from('')).length, path);
  }
  assert.ok(inspect('linked-file', Buffer.from(''), true).length);
});

test('publish guard reports secret type without exposing the matched value', () => {
  const value = 'AI' + 'za' + 'a'.repeat(35);
  const result = inspect('config.js', Buffer.from(value));
  assert.ok(result.includes('possible provider token or private key'));
  assert.equal(result.join('').includes(value), false);
});

test('example values are blank and documentation networks remain allowed', () => {
  assert.deepEqual(inspect('.env.example', Buffer.from('SESSION_SECRET=\nVMWARE_ALLOWED_HOSTS=\n')), []);
  assert.ok(inspect('.env.example', Buffer.from('SESSION_SECRET=not-empty')).length);
  assert.deepEqual(inspect('test.js', Buffer.from('192.0.2.10')), []);
  const internal = ['192', '168', '50', '10'].join('.');
  assert.ok(inspect('test.js', Buffer.from(internal)).length);
});
