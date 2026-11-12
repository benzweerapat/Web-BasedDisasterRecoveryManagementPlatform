import test from 'node:test';
import assert from 'node:assert/strict';
import { compactBackgroundOperation } from '../src/utils/backgroundOperationPresentation.js';

test('shortens legacy typed labels without losing complete timestamped object names', () => {
  const name = 'TEST-RP-win01DC-20261007-1628';
  assert.deepEqual(compactBackgroundOperation({ label: `Create recovery plan ${name}`, status: 'SUCCESS' }), {
    title: `Create plan · ${name}`, statusLabel: 'Done', tone: 'success',
  });
  assert.equal(compactBackgroundOperation({ label: 'Create protection group TEST-PG-123' }).title, 'Create group · TEST-PG-123');
  assert.equal(compactBackgroundOperation({ label: 'Delete recovery plan A plan with spaces' }).title, 'Delete plan · A plan with spaces');
  assert.equal(compactBackgroundOperation({ label: 'Rename recovery plan New plan name' }).title, 'Rename · New plan name');
});

test('explicit metadata and supplied context override inferred names without truncation', () => {
  const name = `A complete plan name ${'x'.repeat(150)}`;
  assert.equal(compactBackgroundOperation({ label: 'Rename recovery plan OLD', entityName: 'stored name', entityType: 'Recovery plan', action: 'rename' }, {
    entityName: name, entityType: 'Recovery plan', action: 'Rename',
  }).title, `Rename · ${name}`);
  assert.equal(compactBackgroundOperation({ label: 'Add protection group technical-id', action: 'add protection group', entityName: 'User plan', entityType: 'Recovery plan' }, {
    action: '', entityType: 'Recovery plan', entityName: 'User plan',
  }).title, 'Add group · User plan');
});

test('shortens common execution actions from legacy labels', () => {
  for (const [label, title] of [
    ['Test recovery My plan', 'Test · My plan'], ['Disaster recovery My plan', 'Recovery · My plan'],
    ['Planned migration My plan', 'Migration · My plan'], ['Cleanup My plan', 'Cleanup · My plan'],
    ['Reprotect My plan', 'Reprotect · My plan'], ['Synchronize win01DC', 'Sync · win01DC'],
    ['Pause replication win01DC', 'Pause · win01DC'], ['Reconfigure replication win01DC', 'Reconfigure · win01DC'],
  ]) assert.equal(compactBackgroundOperation({ label }).title, title);
});

test('unknown and mapping labels remain intact and missing input is safe', () => {
  assert.equal(compactBackgroundOperation({ label: 'Create network mapping' }).title, 'Create network mapping');
  assert.equal(compactBackgroundOperation({ label: 'Some custom operation with a long label' }).title, 'Some custom operation with a long label');
  assert.deepEqual(compactBackgroundOperation(null, null), { title: 'Background operation', statusLabel: 'Unknown', tone: 'neutral' });
});

test('active states have concise accurate labels even if phase is stale success', () => {
  for (const [status, statusLabel] of [
    ['QUEUED', 'Queued'], ['PENDING', 'Pending'], ['VALIDATING', 'Checking'], ['READY_EXECUTE', 'Checking'],
    ['SUBMITTING', 'Starting'], ['TASK_RUNNING', 'Running'], ['RECONCILIATION_REQUIRED', 'Checking'],
    ['VERIFIED', 'Refreshing'], ['CANCELLING', 'Cancelling'], ['CLEANING_UP', 'Cleaning up'],
  ]) {
    const result = compactBackgroundOperation({ status, phase: 'success' });
    assert.equal(result.statusLabel, statusLabel, status);
    assert.equal(result.tone, 'pending', status);
  }
});

test('failure, blocked, unknown and unavailable must never appear Done', () => {
  for (const [status, statusLabel, tone] of [
    ['FAILED', 'Failed', 'error'], ['ERROR', 'Failed', 'error'], ['ROLLBACK_FAILED', 'Failed', 'error'],
    ['UNKNOWN', 'Unknown', 'warning'], ['STATUS_UNAVAILABLE', 'Unavailable', 'warning'],
    ['NOT_FOUND', 'Unavailable', 'warning'], ['RECONCILIATION_BLOCKED', 'Blocked', 'warning'],
    ['ROLLBACK_SUCCESS', 'Rolled back', 'warning'], ['NEW_UNRECOGNIZED_STATE', 'Unknown', 'warning'],
  ]) {
    const result = compactBackgroundOperation({ status, phase: 'success' });
    assert.equal(result.statusLabel, statusLabel, status);
    assert.equal(result.tone, tone, status);
  }
});

test('explicit failed phase is not erased by successful status and cancellation is distinct', () => {
  assert.equal(compactBackgroundOperation({ status: 'SUCCESS', phase: 'failed' }).tone, 'error');
  assert.equal(compactBackgroundOperation({ phase: 'failed' }).statusLabel, 'Failed');
  assert.equal(compactBackgroundOperation({ status: 'CANCELLED' }).statusLabel, 'Cancelled');
});

test('VR create success means Configured, never synchronized or ready', () => {
  assert.deepEqual(compactBackgroundOperation({ label: 'Create replication win01DC', provider: 'VR', status: 'SUCCESS' }), {
    title: 'Create replication · win01DC', statusLabel: 'Configured', tone: 'success',
  });
  assert.equal(compactBackgroundOperation({ provider: 'VR', phase: 'success', entityType: 'Replication', entityName: 'win02DC', action: 'create' }).statusLabel, 'Configured');
  assert.equal(compactBackgroundOperation({ provider: 'VR', label: 'Synchronize win01DC', status: 'SUCCESS' }).statusLabel, 'Done');
  assert.equal(compactBackgroundOperation({ provider: 'VR', label: 'Create replication win01DC', status: 'UNKNOWN', phase: 'success' }).statusLabel, 'Unknown');
});

test('legacy phase-only records and normalized status spellings are supported', () => {
  assert.equal(compactBackgroundOperation({ phase: 'success', label: 'Create recovery plan plan' }).statusLabel, 'Done');
  assert.equal(compactBackgroundOperation({ phase: 'pending' }).statusLabel, 'Pending');
  assert.equal(compactBackgroundOperation({ status: 'task running' }).statusLabel, 'Running');
  assert.equal(compactBackgroundOperation({ state: 'VALIDATING' }).statusLabel, 'Checking');
});

test('helper is pure and does not modify metadata, messages, or operation state', () => {
  const item = Object.freeze({ label: 'Rename recovery plan old', status: 'SUCCESS', message: 'Full details retained.' });
  const context = Object.freeze({ action: 'Rename', entityName: 'new', entityType: 'Recovery plan' });
  assert.equal(compactBackgroundOperation(item, context).title, 'Rename · new');
  assert.equal(item.message, 'Full details retained.');
  assert.equal(item.label, 'Rename recovery plan old');
});
