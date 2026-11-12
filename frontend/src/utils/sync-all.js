export const SYNC_ALL_ENDPOINT = '/sync/all';

export function canSyncAll(user) {
  return ['ADMIN', 'OPERATOR'].includes(String(user?.role || '').toUpperCase());
}

export function overallResultCopy(status) {
  if (status === 'SUCCESS') return 'VMware synchronization succeeded';
  if (status === 'PARTIAL') return 'VMware synchronization partially succeeded';
  if (status === 'NOT_CONFIGURED') return 'VMware connections are not configured';
  return 'Unable to synchronize data';
}