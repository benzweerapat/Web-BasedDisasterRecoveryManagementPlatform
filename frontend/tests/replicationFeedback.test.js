import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReplicationFeedback, getReplicationDatastoreReview, replicationVmName,
  REPLICATION_CREATE_COMPLETED_MESSAGE,
} from '../src/utils/replicationFeedback.js';

test('Not active stays a warning, not an assumed initial sync or healthy status', () => {
  const result = getReplicationFeedback({ rawStatus: 'NOT_ACTIVE', normalizedStatus: 'NOT_ACTIVE' });
  assert.equal(result.statusLabel, 'Not active');
  assert.equal(result.severity, 'warning');
  assert.equal(result.isSyncing, false);
  assert.equal(result.progressPercent, null);
  assert.match(result.guidance, /does not confirm that synchronization has started/);
  assert.match(result.guidance, /configuration, not replication readiness/);
});

test('initial full sync is distinct from general syncing and never invents progress', () => {
  const result = getReplicationFeedback({ rawStatus: 'INITIAL_FULL_SYNC', normalizedStatus: 'SYNCING' });
  assert.equal(result.statusLabel, 'Initial full sync');
  assert.equal(result.severity, 'info');
  assert.equal(result.progressPercent, null);
  assert.match(result.guidance, /not ready yet/);
  assert.match(result.guidance, /No progress percentage is available/);
});

test('only a valid reported percentage is used, including zero', () => {
  for (const progress of [0, 42.5, 100, '15']) {
    assert.equal(getReplicationFeedback({ rawStatus: 'INITIAL_FULL_SYNC', syncProgressPercent: progress }).progressPercent, Number(progress));
  }
  for (const progress of [undefined, null, '', '  ', true, false, -1, 101, Infinity, 'bad']) {
    assert.equal(getReplicationFeedback({ rawStatus: 'INITIAL_FULL_SYNC', syncProgressPercent: progress }).progressPercent, null);
  }
});

test('stale progress cannot turn inactive, OK, or ERROR into syncing', () => {
  for (const status of ['NOT_ACTIVE', 'OK', 'ERROR']) {
    const result = getReplicationFeedback({ rawStatus: status, syncProgressPercent: 22 });
    assert.equal(result.isSyncing, false);
    assert.equal(result.progressPercent, null);
  }
});

test('authoritative raw terminal and inactive states override a stale normalized SYNCING phase', () => {
  for (const [rawStatus, severity] of [['OK', 'success'], ['RECOVERED', 'success'], ['PAUSED', 'warning'], ['ERROR', 'error'], ['NOT_ACTIVE', 'warning']]) {
    const result = getReplicationFeedback({ rawStatus, normalizedStatus: 'SYNCING', syncProgressPercent: 28 });
    assert.equal(result.isSyncing, false, rawStatus);
    assert.equal(result.progressPercent, null, rawStatus);
    assert.equal(result.severity, severity, rawStatus);
    assert.doesNotMatch(result.guidance, /synchronization is in progress/i, rawStatus);
  }
});

test('SYNCED, NOT_SYNCED, and NEVER_SYNCED are not active sync even when normalized to SYNCING', () => {
  for (const rawStatus of ['SYNCED', 'NOT_SYNCED', 'NEVER_SYNCED', 'SYNC_COMPLETED', 'SYNC_QUEUED']) {
    const result = getReplicationFeedback({ rawStatus, normalizedStatus: 'SYNCING', syncProgressPercent: 100 });
    assert.equal(result.isSyncing, false, rawStatus);
    assert.equal(result.progressPercent, null, rawStatus);
    assert.equal(result.guidance, '', rawStatus);
    assert.equal(result.severity, 'neutral', rawStatus);
  }
});

test('recognized active phases still work and normalized phase is used only when raw is absent', () => {
  for (const rawStatus of ['SYNC', 'SYNCING', 'INITIAL_FULL_SYNC', 'FULL_SYNC', 'FULL_SYNC_RPO_VIOLATION']) {
    assert.equal(getReplicationFeedback({ rawStatus, normalizedStatus: 'SYNCING' }).isSyncing, true, rawStatus);
  }
  assert.equal(getReplicationFeedback({ normalizedStatus: 'SYNCING' }).isSyncing, true);
  assert.equal(getReplicationFeedback({ status: 'INITIAL_FULL_SYNC' }).isSyncing, true);
});

test('error and violation precedence are retained when raw and normalized status differ', () => {
  const failed = getReplicationFeedback({ rawStatus: 'INITIAL_FULL_SYNC', normalizedStatus: 'ERROR', syncProgressPercent: 20 });
  assert.equal(failed.severity, 'error');
  assert.equal(failed.isSyncing, false);
  assert.equal(failed.progressPercent, null);
  const violated = getReplicationFeedback({ rawStatus: 'FULL_SYNC', normalizedStatus: 'RPO_VIOLATION' });
  assert.equal(violated.severity, 'warning');
  assert.equal(violated.isSyncing, true);
  assert.match(violated.guidance, /RPO violation/);
});

test('real error and RPO violation remain visible with synchronization statuses', () => {
  const failed = getReplicationFeedback({ rawStatus: 'FULL_SYNC_ERROR', configurationErrorMessage: 'Target unavailable' });
  assert.equal(failed.severity, 'error');
  assert.equal(failed.isSyncing, false);
  assert.deepEqual(failed.issues, ['Target unavailable']);
  const violated = getReplicationFeedback({ rawStatus: 'FULL_SYNC_RPO_VIOLATION', normalizedStatus: 'SYNCING' });
  assert.equal(violated.severity, 'warning');
  assert.match(violated.statusLabel, /RPO violation/);
  assert.match(violated.guidance, /does not clear that warning/);
});

test('different inactive spellings and VM detail status field are supported', () => {
  for (const status of ['NOT_ACTIVE', 'Not active', 'NOT_ACTIVE_RPO_VIOLATION']) {
    const result = getReplicationFeedback({ status, vmPowerState: 'POWERED_OFF' });
    assert.equal(result.isInactive, true);
    assert.equal(result.severity, 'warning');
    assert.match(result.sourcePowerNote, /powered off in the latest inventory/);
  }
});

test('collection time, sync time, and distinct issue details are preserved without generated timestamps', () => {
  const result = getReplicationFeedback({ status: 'NOT_ACTIVE', detailWarningMessage: 'Not active',
    replicationIssueDescription: 'Not active', recoveryErrorMessage: 'Recovery error',
    lastCollectedAt: '2026-10-07T08:40:00Z', lastVrSyncAt: '2026-10-07T08:39:00Z' });
  assert.deepEqual(result.issues, ['Not active', 'Recovery error']);
  assert.equal(result.lastCollectedAt, '2026-10-07T08:40:00Z');
  assert.equal(result.lastVrSyncAt, '2026-10-07T08:39:00Z');
  assert.equal(getReplicationFeedback({ status: 'NOT_ACTIVE' }).lastCollectedAt, null);
});

test('unknown status is not healthy and does not assume pending synchronization', () => {
  const result = getReplicationFeedback({});
  assert.equal(result.statusLabel, 'Unknown');
  assert.equal(result.severity, 'neutral');
  assert.equal(result.isSyncing, false);
  assert.equal(result.guidance, '');
});

test('datastore review lists VM home, each disk, policies, and excluded disks', () => {
  const config = {
    disks: [{ device_key: 0, is_vm_home: true }, { device_key: 2000, is_vm_home: false, label: 'Hard disk 1' }],
    datastores: [{ id: 'ds-a', name: 'NFS-DR' }, { id: 'ds-b', name: 'local-disk-DR' }],
    policies: [{ storage_policy_id: 'policy-a', storage_policy_name: 'Test policy' }],
  };
  const form = { disks: [
    { deviceKey: 0, isVmHome: true, enabled: true, datastoreId: 'ds-a' },
    { deviceKey: 2000, isVmHome: false, enabled: true, datastoreId: 'ds-b', storagePolicyId: 'policy-a' },
    { deviceKey: 2001, isVmHome: false, enabled: false, datastoreId: 'ds-a' },
  ] };
  assert.deepEqual(getReplicationDatastoreReview(config, form), [
    { key: 'home-0', label: 'VM configuration files (VM home)', enabled: true, datastore: 'NFS-DR', policy: 'Datastore default' },
    { key: 'disk-2000', label: 'Hard disk 1', enabled: true, datastore: 'local-disk-DR', policy: 'Test policy' },
    { key: 'disk-2001', label: 'Disk 2001', enabled: false, datastore: 'Not replicated', policy: '—' },
  ]);
});

test('missing datastore catalog entry is disclosed rather than shown as an assumed destination', () => {
  assert.equal(getReplicationDatastoreReview({}, { disks: [{ deviceKey: 1, enabled: true, datastoreId: 'missing' }] })[0].datastore, 'Not selected / unavailable');
});

test('operation naming uses vmName from the catalog rather than falling back to generic VM', () => {
  assert.equal(replicationVmName({ vmName: 'win01DC' }), 'win01DC');
  assert.equal(replicationVmName({ name: 'legacy name' }), 'legacy name');
  assert.equal(replicationVmName(undefined, { vmName: 'form name' }), 'form name');
  assert.equal(replicationVmName({ vmName: 'catalog name', name: 'other name' }), 'catalog name');
});

test('completed create messaging distinguishes configuration completion from synchronization', () => {
  assert.match(REPLICATION_CREATE_COMPLETED_MESSAGE, /configuration completed/);
  assert.match(REPLICATION_CREATE_COMPLETED_MESSAGE, /synchronization may still be pending or running/);
  assert.match(REPLICATION_CREATE_COMPLETED_MESSAGE, /check Replications for OK/);
});
