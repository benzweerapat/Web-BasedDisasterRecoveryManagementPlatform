const test = require('node:test');
const assert = require('node:assert/strict');
const { FileStore } = require('./file-store');

// In-memory store only: no filename, so nothing is persisted.
const vcenter = name => ({ name, system_type: 'VCENTER', base_url: `https://${name}.example.invalid`, is_active: true });
const names = rows => rows.map(r => r.name).sort();

async function setup() {
  const store = new FileStore(null);
  await store.run(s => s.insert('connections', [vcenter('dc')]), [], true);
  return store;
}

test('view rows are reused until the next write', async () => {
  const store = await setup();
  const first = store.read('current_connections');
  assert.equal(store.read('current_connections'), first);
  await store.run(s => s.insert('connections', [vcenter('dr')]), [], true);
  assert.deepEqual(names(store.read('current_connections')), ['dc', 'dr']);
});

test('a write callback reads its own changes', async () => {
  const store = await setup();
  store.read('current_connections');
  const seen = await store.run(s => {
    s.update('connections', r => r.name === 'dc', () => ({ is_active: false }));
    return names(s.read('current_connections'));
  }, [], true);
  assert.deepEqual(seen, []);
  assert.deepEqual(names(store.read('current_connections')), []);
});

test('a failed write leaves the cached view on the restored data', async () => {
  const store = await setup();
  store.read('current_connections');
  await assert.rejects(store.run(s => {
    s.insert('connections', [vcenter('dr')]);
    throw Error('abort');
  }, [], true), /abort/);
  assert.deepEqual(names(store.read('current_connections')), ['dc']);
});

test('an open session neither fills nor reads the shared cache', async () => {
  const store = await setup();
  store.read('current_connections');
  const session = await store.connect();
  await session.begin();
  session.insert('connections', [vcenter('dr')]);
  assert.deepEqual(names(session.read('current_connections')), ['dc', 'dr']);
  assert.deepEqual(names(store.read('current_connections')), ['dc']);
  await session.commit();
  assert.deepEqual(names(store.read('current_connections')), ['dc', 'dr']);
  session.release();
});

test('a rolled back session keeps the committed view', async () => {
  const store = await setup();
  const session = await store.connect();
  await session.begin();
  session.insert('connections', [vcenter('dr')]);
  await session.rollback();
  assert.deepEqual(names(store.read('current_connections')), ['dc']);
  session.release();
});
