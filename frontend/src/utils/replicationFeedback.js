const normalizedCode = value => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

const STATUS_LABELS = {
  OK: 'OK', RECOVERED: 'Recovered', PAUSED: 'Paused', NOT_ACTIVE: 'Not active',
  NOT_ACTIVE_RPO_VIOLATION: 'Not active — RPO violation', RPO_VIOLATION: 'RPO violation',
  INITIAL_FULL_SYNC: 'Initial full sync', FULL_SYNC: 'Full sync', SYNCING: 'Syncing',
  FULL_SYNC_RPO_VIOLATION: 'Full sync — RPO violation',
};

const ACTIVE_SYNC_CODES = new Set([
  'SYNC', 'SYNCING', 'INITIAL_FULL_SYNC', 'FULL_SYNC',
  'SYNC_RPO_VIOLATION', 'INITIAL_FULL_SYNC_RPO_VIOLATION', 'FULL_SYNC_RPO_VIOLATION',
]);

// Status remains the status VMware reported. In particular, NOT_ACTIVE is not
// evidence of initial synchronization and a completed create task is not health.
export function getReplicationFeedback(rep = {}) {
  const rawStatus = String(rep.rawStatus || rep.raw_status || rep.normalizedStatus || rep.status || '').trim();
  const code = normalizedCode(rawStatus);
  const normalized = normalizedCode(rep.normalizedStatus || rep.status || code);
  const codes = [code, normalized];
  const isError = codes.some(value => /ERROR|FAIL/.test(value));
  const isInactive = codes.some(value => value.startsWith('NOT_ACTIVE'));
  const hasViolation = codes.some(value => value.includes('VIOLATION')) || Number(rep.rpoViolation) > 0;
  // The raw status, when present, is authoritative for the current phase.
  // A cached normalized SYNCING value must not override OK/PAUSED/etc., and
  // substring matching would incorrectly treat SYNCED/NOT_SYNCED as active.
  const isSyncing = !isError && !isInactive && ACTIVE_SYNC_CODES.has(code);
  const initialSync = isSyncing && code.includes('INITIAL');
  const reportedProgress = rep.syncProgressPercent;
  const progress = typeof reportedProgress === 'number' || (typeof reportedProgress === 'string' && reportedProgress.trim())
    ? Number(reportedProgress) : NaN;
  const progressPercent = isSyncing && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : null;
  const severity = isError ? 'error' : (isInactive || hasViolation || code === 'PAUSED' || code === 'WARNING') ? 'warning'
    : isSyncing ? 'info' : ['OK', 'RECOVERED'].includes(code) ? 'success' : 'neutral';
  const statusLabel = STATUS_LABELS[code] || (rawStatus
    ? rawStatus.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()).replace(/\bRpo\b/g, 'RPO')
    : 'Unknown');
  let guidance = '';
  if (isInactive && !isError) {
    guidance = 'VMware reports that replication is not active. After creation this can precede initial synchronization, but this status alone does not confirm that synchronization has started. A completed create task confirms configuration, not replication readiness. Check the reported issues and wait for a refreshed status before continuing recovery operations.';
  } else if (isSyncing) {
    guidance = initialSync
      ? 'The initial full synchronization is in progress. Replication is not ready yet; wait for VMware to report OK before continuing recovery operations.'
      : 'Synchronization is in progress. Wait for the updated VMware status before continuing recovery operations.';
    if (progressPercent == null) guidance += ' No progress percentage is available in the latest collected data.';
    if (hasViolation) guidance += ' An RPO violation is also reported; synchronization does not clear that warning yet.';
  }
  const issues = [...new Set([
    rep.detailWarningMessage, rep.configurationErrorMessage, rep.lastGroupErrorMessage,
    rep.recoveryErrorMessage, rep.replicationIssueDescription,
    rep.diskCollectionStatus === 'FAILED' ? `Disk details could not be collected (${rep.diskCollectionErrorCode || 'VR_REPLICATION_DISKS_FETCH_FAILED'}).` : '',
  ].filter(value => typeof value === 'string' && value.trim()))];
  const sourcePowerNote = isInactive && normalizedCode(rep.vmPowerState) === 'POWERED_OFF'
    ? 'The VM is powered off in the latest inventory.' : '';
  return {
    rawStatus, statusLabel, severity, isInactive, isSyncing, progressPercent,
    guidance, issues, sourcePowerNote,
    hasDetails: Boolean(guidance || issues.length || sourcePowerNote),
    lastCollectedAt: rep.lastCollectedAt || null,
    lastVrSyncAt: rep.lastVrSyncAt || null,
  };
}

export function getReplicationDatastoreReview(config = {}, form = {}) {
  return (form.disks || []).map(disk => {
    const source = (config.disks || []).find(item => String(item.device_key) === String(disk.deviceKey) && Boolean(item.is_vm_home) === Boolean(disk.isVmHome));
    const datastore = (config.datastores || []).find(item => String(item.id) === String(disk.datastoreId));
    const policy = (config.policies || []).find(item => String(item.storage_policy_id) === String(disk.storagePolicyId));
    return {
      key: `${disk.isVmHome ? 'home' : 'disk'}-${disk.deviceKey}`,
      label: disk.isVmHome ? 'VM configuration files (VM home)' : source?.label || `Disk ${disk.deviceKey}`,
      enabled: Boolean(disk.enabled),
      datastore: !disk.enabled ? 'Not replicated' : datastore?.name || 'Not selected / unavailable',
      policy: !disk.enabled ? '—' : !disk.storagePolicyId ? 'Datastore default' : policy?.storage_policy_name || 'Selected policy unavailable',
    };
  });
}

export function replicationVmName(vm, form = {}) {
  return vm?.vmName || vm?.name || form.vmName || '';
}

export const REPLICATION_CREATE_COMPLETED_MESSAGE = 'Replication configuration completed. Initial synchronization may still be pending or running; check Replications for OK before continuing recovery operations.';
