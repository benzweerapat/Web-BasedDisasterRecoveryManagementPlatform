const text = value => typeof value === 'string' ? value.trim() : '';
const statusCode = value => text(value).toUpperCase().replace(/[\s-]+/g, '_');

const ACTION_LABELS = {
  create: 'Create', delete: 'Delete', remove: 'Remove', rename: 'Rename',
  pause: 'Pause', resume: 'Resume', reconfigure: 'Reconfigure',
  test: 'Test', 'test recovery': 'Test', cleanup: 'Cleanup', reprotect: 'Reprotect',
  recovery: 'Recovery', 'disaster recovery': 'Recovery',
  migration: 'Migration', 'planned migration': 'Migration',
  synchronize: 'Sync', synchronization: 'Sync', sync: 'Sync',
  'add virtual machine': 'Add VM', 'remove virtual machine': 'Remove VM',
  'add protection group': 'Add group', 'remove protection group': 'Remove group',
};

const TYPE_LABELS = {
  'recovery plan': 'plan', 'protection group': 'group', replication: 'replication',
  'virtual machine': 'VM',
};

function parseLegacyLabel(label) {
  // Match specific types before generic actions so "Rename recovery plan X"
  // does not leave "recovery plan" attached to the actual object name.
  const typed = label.match(/^(Create|Delete|Remove|Rename|Pause|Resume|Reconfigure)\s+(recovery plan|protection group|replication)\s+(.+)$/i);
  if (typed) return { action: typed[1], entityType: typed[2], entityName: typed[3] };
  const actionOnly = label.match(/^(Disaster recovery|Planned migration|Test recovery|Synchronization|Synchronize|Reprotect|Cleanup|Rename|Add virtual machine|Remove virtual machine|Add protection group|Remove protection group)\s+(.+)$/i);
  if (actionOnly) return { action: actionOnly[1], entityName: actionOnly[2] };
  return {};
}

function operationIdentity(item, context) {
  const label = text(item.label);
  const legacy = parseLegacyLabel(label);
  const entityName = text(context.entityName) || text(item.entityName) || text(legacy.entityName);
  const entityType = text(context.entityType) || text(item.entityType) || text(legacy.entityType);
  const action = text(context.action) || text(item.action) || text(legacy.action);
  const actionKey = action.toLowerCase();
  const shortAction = ACTION_LABELS[actionKey] || action;
  const shortType = TYPE_LABELS[entityType.toLowerCase()] || entityType;
  const includeType = ['create', 'delete', 'remove'].includes(actionKey);
  const prefix = shortAction ? `${shortAction}${includeType && shortType ? ` ${shortType}` : ''}` : shortType;
  const title = entityName ? `${prefix ? `${prefix} · ` : ''}${entityName}` : label || prefix || 'Background operation';
  const isReplicationCreate = statusCode(item.provider) === 'VR' && (
    (actionKey === 'create' && entityType.toLowerCase() === 'replication') || /^Create replication(?:\s|$)/i.test(label)
  );
  return { title, isReplicationCreate };
}

function shortStatus(item, isReplicationCreate) {
  const code = statusCode(item.status || item.state);
  const phase = text(item.phase).toLowerCase();

  // Failure/ambiguity must never be hidden by a stale "success" phase.
  if (['FAILED', 'ERROR', 'ROLLBACK_FAILED'].includes(code)) return { statusLabel: 'Failed', tone: 'error' };
  if (code === 'RECONCILIATION_BLOCKED') return { statusLabel: 'Blocked', tone: 'warning' };
  if (['UNKNOWN', 'STATUS_UNAVAILABLE', 'NOT_FOUND'].includes(code)) {
    return { statusLabel: code === 'UNKNOWN' ? 'Unknown' : 'Unavailable', tone: 'warning' };
  }
  if (code === 'ROLLBACK_SUCCESS') return { statusLabel: 'Rolled back', tone: 'warning' };
  if (['CANCELLED', 'CANCELED'].includes(code)) return { statusLabel: 'Cancelled', tone: 'neutral' };
  if (phase === 'failed') return { statusLabel: 'Failed', tone: 'error' };

  const activeLabels = {
    QUEUED: 'Queued', PENDING: 'Pending', VALIDATING: 'Checking', READY_EXECUTE: 'Checking',
    SUBMITTING: 'Starting', RUNNING: 'Running', TASK_RUNNING: 'Running', EXECUTING: 'Running', IN_PROGRESS: 'Running',
    RECONCILIATION_REQUIRED: 'Checking', VERIFIED: 'Refreshing',
    CANCELLING: 'Cancelling', CANCELING: 'Cancelling', CLEANING_UP: 'Cleaning up',
  };
  if (activeLabels[code]) return { statusLabel: activeLabels[code], tone: 'pending' };
  if (code === 'SUCCESS' || (!code && phase === 'success')) {
    return { statusLabel: isReplicationCreate ? 'Configured' : 'Done', tone: 'success' };
  }
  if (!code && phase === 'pending') return { statusLabel: 'Pending', tone: 'pending' };
  return { statusLabel: 'Unknown', tone: code || phase ? 'warning' : 'neutral' };
}

// Presentation only: no timers, mutations, or assumptions about VM readiness.
// Keep the complete object name; the panel handles visual truncation and details.
export function compactBackgroundOperation(item = {}, context = {}) {
  const safeItem = item || {};
  const identity = operationIdentity(safeItem, context || {});
  return { title: identity.title, ...shortStatus(safeItem, identity.isReplicationCreate) };
}
