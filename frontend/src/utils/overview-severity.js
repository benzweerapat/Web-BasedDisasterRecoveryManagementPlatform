export function getCapacitySeverity(percent) {
  if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) return 'UNKNOWN';
  const value = Number(percent);
  if (value >= 81) return 'CRITICAL';
  if (value >= 61) return 'WARNING';
  return 'HEALTHY';
}

export function getFreshnessSeverity(freshness) {
  const status = freshness?.freshnessStatus;
  if (status === 'COLLECTION_FAILED') return 'FAILED';
  if (status === 'FRESH') return 'FRESH';
  if (status === 'STALE') return 'STALE';
  if (status === 'PARTIAL' || status === 'AGING') return 'AGING';
  // Explicit backend state wins; only legacy payloads without a state use age.
  if (!status && Number.isFinite(freshness?.collectionAgeSeconds) && freshness.collectionAgeSeconds >= 0) {
    if (freshness.collectionAgeSeconds <= 900) return 'FRESH';
    if (freshness.collectionAgeSeconds <= 3600) return 'AGING';
    return 'STALE';
  }
  return 'UNKNOWN';
}

export function getVmPowerStatePresentation(state) {
  const normalized = String(state || 'UNKNOWN').toUpperCase();
  if (['POWERED_ON', 'RUNNING', 'ON'].includes(normalized)) return { label: 'Powered on', severity: 'HEALTHY', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
  if (['POWERED_OFF', 'STOPPED', 'OFF'].includes(normalized)) return { label: 'Powered off', severity: 'NEUTRAL', className: 'border-slate-200 bg-slate-100 text-slate-700', dot: 'bg-red-500' };
  if (['SUSPENDED', 'PAUSED'].includes(normalized)) return { label: 'Suspended', severity: 'WARNING', className: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
  if (['ERROR', 'FAILED'].includes(normalized)) return { label: 'Error', severity: 'CRITICAL', className: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' };
  return { label: 'Unknown', severity: 'NEUTRAL', className: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400' };
}

export function getDrMetricPresentation({ count, state }) {
  const normalized = String(state || 'UNKNOWN').toUpperCase();
  const availableCount = count !== null && count !== undefined && Number.isFinite(Number(count));
  if (['FAILED', 'ERROR', 'FETCH_FAILED', 'COLLECTION_FAILED'].includes(normalized)) return { countLabel: '—', label: 'Failed', badgeStatus: 'FAILED', muted: false };
  if (['NOT_AVAILABLE', 'NEVER_COLLECTED', 'UNKNOWN'].includes(normalized) || !availableCount) return { countLabel: '—', label: 'Not available', badgeStatus: 'NOT_AVAILABLE', muted: true };
  if (normalized === 'SUCCESS_EMPTY') return { countLabel: String(Number(count)), label: 'None configured', badgeStatus: 'NOT_AVAILABLE', muted: true };
  if (['PARTIAL', 'WARNING', 'STALE', 'STALE_WITH_DATA'].includes(normalized)) return { countLabel: String(Number(count)), label: 'Partial', badgeStatus: 'WARNING', muted: false };
  return { countLabel: String(Number(count)), label: 'Healthy', badgeStatus: 'SUCCESS', muted: false };
}

export function formatHostCount(count) {
  if (count === null || count === undefined || !Number.isFinite(Number(count))) return 'Total hosts: not available';
  return `Total hosts: ${Number(count)}`;
}

export const CAPACITY_SEVERITY_STYLES = Object.freeze({
  HEALTHY: { bar: 'bg-emerald-500', text: 'text-emerald-700', label: 'Healthy' },
  WARNING: { bar: 'bg-amber-500', text: 'text-amber-700', label: 'Warning' },
  CRITICAL: { bar: 'bg-red-500', text: 'text-red-700', label: 'Critical' },
  UNKNOWN: { bar: 'bg-slate-300', text: 'text-slate-500', label: 'Unknown' }
});

export const FRESHNESS_SEVERITY_STYLES = Object.freeze({
  FRESH: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Fresh' },
  AGING: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Aging' },
  STALE: { dot: 'bg-orange-500', text: 'text-orange-700', label: 'Stale' },
  FAILED: { dot: 'bg-red-500', text: 'text-red-700', label: 'Failed' },
  UNKNOWN: { dot: 'bg-slate-400', text: 'text-slate-500', label: 'Unknown' }
});
