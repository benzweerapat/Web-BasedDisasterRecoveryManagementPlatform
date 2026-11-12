import api, { invalidateReadCache } from './apiClient';
import { REPLICATION_CREATE_COMPLETED_MESSAGE } from '../utils/replicationFeedback';

const STORAGE_KEY = 'srm.background-operations.v1';
const SRM_TERMINAL = new Set(['SUCCESS', 'FAILED', 'RECONCILIATION_BLOCKED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED']);
const VR_TERMINAL = new Set(['SUCCESS', 'FAILED', 'UNKNOWN']);
const listeners = new Set();
let polling = false;
let timer = null;

function restore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item?.id && item?.provider).slice(0, 50) : [];
  } catch {
    return [];
  }
}

let operations = typeof window === 'undefined' ? [] : restore();

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(operations.slice(0, 50))); } catch {}
}

function emit() {
  persist();
  listeners.forEach(listener => listener());
  schedule(operations.some(item => item.phase === 'pending') ? 800 : null);
}

function schedule(delay = 2000) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (delay === null || typeof window === 'undefined') return;
  timer = setTimeout(poll, delay);
}

function errorMessage(error, fallback) {
  return error?.response?.data?.error?.safeMessage
    || error?.response?.data?.safeMessage
    || error?.message
    || fallback;
}

const STATUS_MESSAGES = {
  QUEUED: 'Waiting to start.',
  VALIDATING: 'Checking the current configuration and readiness.',
  READY_EXECUTE: 'Checks passed. Preparing to start in Site Recovery Manager.',
  SUBMITTING: 'Sending the request to Site Recovery Manager.',
  TASK_RUNNING: 'Site Recovery Manager is running this operation.',
  RECONCILIATION_REQUIRED: 'Confirming the operation result with Site Recovery Manager.',
  VERIFIED: 'The operation completed. Refreshing inventory data.',
  STATUS_UNAVAILABLE: 'The latest status is temporarily unavailable. Automatic checking will continue.'
};

const ACTION_LABELS = {
  recovery: 'Disaster recovery',
  migration: 'Planned migration',
  reprotect: 'Reprotect',
  cleanup: 'Cleanup',
  test: 'Test recovery',
  rename: 'Rename',
  'add virtual machine': 'Add virtual machine',
  'remove virtual machine': 'Remove virtual machine',
  synchronize: 'Synchronization'
};

const OPERATION_ERROR_MESSAGES = {
  SRM_HTTP_400: 'SRM rejected the recovery plan configuration. Refresh the plan and verify that the Protection Group is ready and belongs to the selected protected site.'
};

function operationContext(item, data = {}) {
  const raw = String(item?.label || 'Background operation');
  const explicitAction = data.operation || item.action;
  const action = ACTION_LABELS[String(explicitAction || '').toLowerCase()] || '';
  if (item.entityType && item.entityName) return {action,entityType:item.entityType,entityName:item.entityName};

  const recoveryAction = Object.values(ACTION_LABELS).find(value => raw.toLowerCase().startsWith(`${value.toLowerCase()} `));
  if (recoveryAction) {
    const entityName = raw.slice(recoveryAction.length + 1);
    return {
      action:recoveryAction,
      entityType:recoveryAction === 'Synchronization' ? 'Virtual machine' : 'Recovery plan',
      entityName
    };
  }

  if (/^Synchronize\s+/i.test(raw)) {
    return {action:'Synchronization',entityType:'Virtual machine',entityName:raw.replace(/^Synchronize\s+/i, '')};
  }

  return {action,entityType:'',entityName:''};
}

export function backgroundOperationDetails(item) {
  return operationContext(item);
}

export function backgroundOperationLabel(item) {
  const context = operationContext(item);
  return context.entityName ? `${context.entityType}: ${context.entityName}` : String(item?.label || 'Background operation');
}

export function backgroundOperationMessage(item, data = {}, phase = item.phase) {
  const status = data.state || data.status || item.status || 'QUEUED';
  const supplied = data.safeMessage || data.finalOutcome || data.message || item.message;
  const {action} = operationContext(item,data);

  if (phase === 'success') {
    if (item.provider === 'VR' && /^Create replication\b/i.test(item.label || '')) return REPLICATION_CREATE_COMPLETED_MESSAGE;
    return action ? `${action} completed successfully.` : 'The operation completed successfully.';
  }

  if (phase === 'failed') {
    if (OPERATION_ERROR_MESSAGES[supplied]) return OPERATION_ERROR_MESSAGES[supplied];
    if (supplied && !/requires attention/i.test(supplied)) return supplied;
    if (/^Synchronize\b/i.test(item.label)) {
      return 'Synchronization failed. Open Replications, review this VM\'s status, then try again.';
    }
    return 'The operation failed. Review the current VMware status before trying again.';
  }

  if (status === 'TASK_RUNNING' && action) return `${action} is running in Site Recovery Manager.`;
  return STATUS_MESSAGES[status] || `${action || 'The operation'} is still running. Status will update automatically.`;
}

async function readStatus(item) {
  const url = item.provider === 'VR'
    ? `/vr/management/operations/${encodeURIComponent(item.id)}`
    : `/srm/operations/${encodeURIComponent(item.id)}`;

  const response = await api.get(url);
  const data = response.data?.data || {};
  const status = item.provider === 'VR' ? data.status : data.state;
  const terminal = item.provider === 'VR' ? VR_TERMINAL.has(status) : SRM_TERMINAL.has(status);
  const success = status === 'SUCCESS';

  return {
    status: status || item.status || 'PENDING',
    phase: terminal ? (success ? 'success' : 'failed') : 'pending',
    message: backgroundOperationMessage(
      item,
      {...data,message:data.safeMessage || data.finalOutcome || data.error},
      terminal ? (success ? 'success' : 'failed') : 'pending'
    )
  };
}

async function poll() {
  if (polling) return;
  const active = operations.filter(item => item.phase === 'pending').slice(0, 4);
  if (!active.length) return;

  polling = true;
  let completed = false;

  try {
    const results = await Promise.allSettled(active.map(readStatus));

    operations = operations.map(item => {
      const index = active.findIndex(activeItem => activeItem.id === item.id && activeItem.provider === item.provider);
      if (index < 0) return item;

      const result = results[index];

      if (result.status === 'rejected') {
        if (result.reason?.response?.status === 404) {
          return { ...item, phase: 'failed', status: 'NOT_FOUND', message: 'This operation is no longer available on the server. Dismiss it and retry if needed.', updatedAt: Date.now() };
        }

        return { ...item, status: 'STATUS_UNAVAILABLE', message: errorMessage(result.reason, 'Status is temporarily unavailable.'), updatedAt: Date.now() };
      }

      if (result.value.phase !== 'pending') completed = true;
      return { ...item, ...result.value, updatedAt: Date.now() };
    });

    if (completed) invalidateReadCache();
    emit();
    } finally {
    polling = false;
    if (operations.some(item => item.phase === 'pending')) schedule(document.hidden ? 5000 : 2000);
  }
}


export function trackBackgroundOperation({ id, provider = 'SRM', label = 'Background operation', resourceKey = '', entityType = '', entityName = '', action = '' }) {
  if (!id) return null;

  const key = `${provider}:${id}`;
  const existing = operations.find(item => `${item.provider}:${item.id}` === key);

  const next = {
    id: String(id), provider, label, resourceKey,
    entityType:entityType || existing?.entityType || '',
    entityName:entityName || existing?.entityName || '',
    action:action || existing?.action || '',
    status: existing?.status || 'QUEUED',
    phase: existing?.phase || 'pending', message: existing?.message || null,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now()
  };

  operations = [next, ...operations.filter(item => `${item.provider}:${item.id}` !== key)].slice(0, 50);
  emit();

  return next;
}

export function dismissBackgroundOperation(provider, id) {
  operations = operations.filter(item => !(item.provider === provider && item.id === String(id)));
  emit();
}

export function clearCompletedOperations() {
  operations = operations.filter(item => item.phase === 'pending');
  emit();
}

export function isResourcePending(resourceKey) {
  return Boolean(resourceKey && operations.some(item => item.resourceKey === resourceKey && item.phase === 'pending'));
}

export function subscribeBackgroundOperations(listener) {
  listeners.add(listener);
  if (operations.some(item => item.phase === 'pending')) schedule(0);
  return () => listeners.delete(listener);
}

export function getBackgroundOperationsSnapshot() { return operations; }

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && operations.some(item => item.phase === 'pending')) schedule(0);
  });
  if (operations.some(item => item.phase === 'pending')) schedule(0);
}
