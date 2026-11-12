const test = require('node:test');
const assert = require('node:assert/strict');
const { SyncCoordinatorService } = require('./sync-coordinator.service');

const busy = { code: 'SYNC_IN_PROGRESS' };

test('different scopes and connections sync in parallel', () => {
  const c = new SyncCoordinatorService();
  c.acquire({ kind: 'VR_SYNC' });
  c.acquire({ kind: 'SRM_SYNC' });
  c.acquire({ kind: 'VCENTER_SYNC', connectionId: 1 });
  c.acquire({ kind: 'VCENTER_SYNC', connectionId: 2 });
  assert.equal(c.getSafeState().runs.length, 4);
});

test('the same connection or an overlapping whole scope is rejected', () => {
  const c = new SyncCoordinatorService();
  c.acquire({ kind: 'VR_SYNC', connectionId: 5 });
  assert.throws(() => c.acquire({ kind: 'VR_SYNC', connectionId: 5 }), busy);
  assert.throws(() => c.acquire({ kind: 'VR_SYNC' }), busy);
  assert.throws(() => c.acquire({ kind: 'SYNC_ALL' }), busy);
  c.acquire({ kind: 'SRM_SYNC', connectionId: 5 });
});

test('sync all blocks every scope until released', () => {
  const c = new SyncCoordinatorService();
  const token = c.acquire({ kind: 'SYNC_ALL' });
  assert.throws(() => c.acquire({ kind: 'SRM_SYNC', connectionId: 3 }), busy);
  assert.equal(c.release(token), true);
  c.acquire({ kind: 'SRM_SYNC', connectionId: 3 });
});

test('configuration change is exclusive and visible to admission', () => {
  const c = new SyncCoordinatorService();
  const sync = c.acquire({ kind: 'VR_SYNC', connectionId: 1 });
  assert.throws(() => c.acquire({ kind: 'CONFIGURATION_CHANGE', connectionId: 9 }), busy);
  c.release(sync);
  c.acquire({ kind: 'CONFIGURATION_CHANGE', connectionId: 9 });
  assert.throws(() => c.acquire({ kind: 'VCENTER_SYNC', connectionId: 2 }), busy);
  assert.equal(c.hasKind('CONFIGURATION_CHANGE'), true);
  assert.equal(c.getSafeState().kind, 'CONFIGURATION_CHANGE');
});

test('release ignores unknown tokens and reports idle', () => {
  const c = new SyncCoordinatorService();
  assert.equal(c.release(Symbol('x')), false);
  assert.deepEqual(c.getSafeState(), { status: 'IDLE', runs: [] });
  assert.equal(c.isRunning(), false);
});
