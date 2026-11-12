import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryActionAvailability } from './recoveryActionAvailability.js';

const ready = { actions: ['test', 'migration', 'recovery'], preflight: { ready: true } };
const view = (overrides = {}) => recoveryActionAvailability({ info: ready, phase: 'ready', role: 'ADMIN', ...overrides });

test('initial capability load retains disabled Test and Run controls', () => {
  const result = view({ info: null, phase: 'loading' });
  assert.equal(result.showTest, true);
  assert.equal(result.showRun, true);
  assert.deepEqual(result.available, []);
  assert.match(result.message, /Checking/);
});

test('refresh and errors never authorize commands from previous capabilities', () => {
  for (const phase of ['loading', 'error']) {
    const result = view({ phase, previousActions: ['cleanup'] });
    assert.deepEqual(result.available, []);
    assert.equal(result.showCleanup, true);
    assert.equal(result.showTest, true);
    assert.equal(result.showRun, true);
    assert.ok(result.message);
  }
});

test('only a current authoritative response enables the listed actions', () => {
  assert.deepEqual(view().available, ['test', 'migration', 'recovery']);
  assert.deepEqual(view({ info: { status: 'READY_STATE' } }).available, []);
  assert.deepEqual(view({ info: { actions: [] }, previousActions: ready.actions }).available, []);
});

test('busy, running or external edit locks disable every recovery action', () => {
  for (const flag of ['busy', 'locked', 'disabled']) assert.deepEqual(view({ [flag]: true }).available, []);
});

test('preflight blockers cannot enable Test/Run but may permit authoritative Cleanup', () => {
  const result = view({ info: { actions: [...ready.actions, 'cleanup'], preflight: { ready: false } } });
  assert.deepEqual(result.available, ['cleanup']);
  assert.match(result.message, /not ready/);
});

test('role controls do not leak privileged actions', () => {
  const operator = view({ role: 'OPERATOR' });
  assert.deepEqual(operator.available, ['test']);
  assert.equal(operator.showRun, false);
  const viewer = view({ role: 'VIEWER' });
  assert.deepEqual(viewer.available, []);
  assert.equal(viewer.showTest, false);
  assert.equal(viewer.showRun, false);
});

test('conflicting operation is explained instead of hiding controls', () => {
  const result = view({ info: { actions: [], actionAvailability: { reasons: { test: 'WRITE_CONFLICT' } } } });
  assert.equal(result.conflict, true);
  assert.equal(result.showTest, true);
  assert.equal(result.showRun, true);
  assert.deepEqual(result.available, []);
  assert.match(result.message, /operation is in progress/);
});

test('completed Test exposes Cleanup and no stale Run permissions', () => {
  const result = view({ info: { actions: ['cleanup'] }, previousActions: ready.actions });
  assert.deepEqual(result.available, ['cleanup']);
  assert.equal(result.showCleanup, true);
});

test('authoritative Reprotect is preserved after recovery completion', () => {
  const result = view({ info: { actions: ['reprotect'], preflight: { ready: true } } });
  assert.deepEqual(result.available, ['reprotect']);
  assert.equal(result.showRun, true);
});

test('inconsistent running or conflict responses fail closed', () => {
  assert.deepEqual(view({ info: { ...ready, isRunning: true } }).available, []);
  assert.deepEqual(view({ info: { ...ready, actionAvailability: { reasons: { test: 'WRITE_CONFLICT' } } } }).available, []);
});

test('unavailable readiness is distinguished from an unhealthy plan and allows a read retry', () => {
  const result = view({ info: { actions: [], preflight: { ready: false, blockers: [{ code: 'RECOVERY_PREFLIGHT_UNAVAILABLE' }] } } });
  assert.equal(result.preflightUnavailable, true);
  assert.match(result.message, /readiness is unavailable/);
  assert.doesNotMatch(result.message, /plan is not ready/);
  assert.deepEqual(result.available, []);
  assert.equal(result.showTest, true);
  assert.equal(result.showRun, true);
});
