import SemanticIcon from "./SemanticIcon";
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { STATUS_TEXT } from '../../utils/ui-text';

const STATUS_CONFIG = {
  // Green
  'OK': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Healthy' },
  'HEALTHY': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Healthy' },
  'CONNECTED': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-link', label: STATUS_TEXT.CONNECTED },
  'SYNCED': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-check-double', label: 'Synchronized' },
  'SUCCEEDED': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-check', label: 'Success' },
  'SUCCESS': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: STATUS_TEXT.SUCCESS },
  'SUCCESS_EMPTY': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Success (no data)' },
  'SUCCESS_WITH_UNSUPPORTED_SCOPE': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Success (some scopes unsupported)' },
  'PRESENT': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-check', label: STATUS_TEXT.MAPPING_PRESENT },
  'RESOLVED': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Resolved' },
  'PROTECTED': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-shield-halved', label: 'Protected' },
  'RECOVERED': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Recovered' },
  'RECOVERY_COMPLETE': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Recovery complete' },
  'TEST_COMPLETE': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Test complete' },
  'CLEANUP_COMPLETE': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-circle-check', label: 'Cleanup complete' },
  'READY': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-arrow-right', label: 'Ready' },
  'READY_STATE': { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'fa-arrow-right', label: 'Ready' },
  
  // Blue
  'SYNCING': { color: 'text-blue-700 bg-blue-50 border-blue-200', Icon: RefreshCw, label: 'Syncing' },
  'RUNNING': { color: 'text-blue-700 bg-blue-50 border-blue-200', icon: 'fa-circle-notch fa-spin', label: 'Running' },
  'TEST_IN_PROGRESS': { color: 'text-blue-700 bg-blue-50 border-blue-200', icon: 'fa-circle-notch fa-spin', label: 'Test in progress' },
  'RECOVERY_IN_PROGRESS': { color: 'text-blue-700 bg-blue-50 border-blue-200', icon: 'fa-circle-notch fa-spin', label: 'Recovery in Progress' },
  'CLEANUP_IN_PROGRESS': { color: 'text-blue-700 bg-blue-50 border-blue-200', icon: 'fa-circle-notch fa-spin', label: 'Cleanup in progress' },
  
  // Orange
  'WARNING': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-triangle-exclamation', label: 'Warning' },
  'PARTIAL': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-circle-half-stroke', label: STATUS_TEXT.PARTIAL },
  'STALE': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-clock-rotate-left', label: STATUS_TEXT.STALE },
  'STALE_WITH_DATA': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-clock-rotate-left', label: 'Stale data available' },
  'UNMAPPED_IDENTITY': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-triangle-exclamation', label: 'Cross-site identity unresolved' },
  'UNPROTECTED': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-shield', label: 'Unprotected' },
  'INCOMPLETE_RECOVERY': { color: 'text-orange-700 bg-orange-50 border-orange-200', icon: 'fa-triangle-exclamation', label: 'Incomplete recovery' },
  'NOT_ACTIVE': { color: 'text-amber-700 bg-amber-50 border-amber-200', icon: 'fa-triangle-exclamation', label: 'Not active' },
  'NOT_CONFIGURED': { color: 'text-amber-700 bg-amber-50 border-amber-200', icon: 'fa-triangle-exclamation', label: 'Not configured' },
  
  // Red
  'ERROR': { color: 'text-red-700 bg-red-50 border-red-200', icon: 'fa-circle-xmark', label: 'Error' },
  'FAILED': { color: 'text-red-700 bg-red-50 border-red-200', icon: 'fa-circle-xmark', label: STATUS_TEXT.FAILED },
  'FETCH_FAILED': { color: 'text-red-700 bg-red-50 border-red-200', icon: 'fa-circle-xmark', label: 'Fetch failed' },
  'CRITICAL': { color: 'text-red-700 bg-red-50 border-red-200', icon: 'fa-skull-crossbones', label: 'Critical' },
  
  // Gray
  'UNKNOWN': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-question-circle', label: STATUS_TEXT.UNKNOWN },
  'NOT_PROVIDED_BY_API': { color: 'text-slate-600 bg-slate-50 border-slate-200', icon: 'fa-circle-minus', label: 'Not provided by API' },
  'UNAVAILABLE': { color: 'text-slate-600 bg-slate-50 border-slate-200', icon: 'fa-circle-exclamation', label: 'Unavailable' },
  'UNMAPPED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-link-slash', label: 'Unmapped' },
  'UNMAPPED_VCENTER': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-link-slash', label: 'Unmapped vCenter' },
  'NOT_FOUND': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-magnifying-glass', label: 'Object not found' },
  'DATASTORE_NOT_FOUND': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-magnifying-glass', label: 'Datastore not found' },
  'NOT_COLLECTED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-database', label: 'Not collected' },
  'NOT_AVAILABLE': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-circle-exclamation', label: STATUS_TEXT.NOT_AVAILABLE },
  'SCOPE_FAILED': { color: 'text-red-700 bg-red-50 border-red-200', icon: 'fa-circle-xmark', label: 'Scope failed' },
  'UNSUPPORTED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-ban', label: 'Not supported' },
  'NEVER_SYNCED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-calendar-xmark', label: 'Not synced' },
  'NOT_STARTED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-stopwatch', label: 'Not started' },
  'NOT_APPLICABLE': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-ban', label: 'Not applicable' },
  'DISCONNECTED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-link-slash', label: 'Disconnected' },
  'CANCELLED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-ban', label: 'Cancelled' },
  'PAUSED': { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: 'fa-pause', label: 'Paused' }
};

export default function StatusBadge({ status, textOverride, minimal = false }) {
  const upperStatus = (status || 'UNKNOWN').toUpperCase();
  const config = STATUS_CONFIG[upperStatus] || STATUS_CONFIG['UNKNOWN'];
  const label = textOverride || config.label;
  const Icon = config.Icon;

  return (
    <div
      className={minimal
        ? `inline-flex items-center gap-1.5 text-xs font-semibold ${config.color.split(' ').find(value => value.startsWith('text-'))}`
        : `inline-flex items-center gap-1.5 rounded-full border bg-white px-2 py-0.5 text-xs font-semibold ${config.color.split(' ').filter(value => !value.startsWith('bg-')).join(' ')}`}
      aria-label={`Status: ${label}`}
      role="status"
    >
      {minimal
        ? <span className={`h-2 w-2 rounded-full ${upperStatus === 'FAILED' || upperStatus === 'ERROR' || upperStatus === 'CRITICAL' ? 'bg-red-500' : upperStatus === 'PARTIAL' || upperStatus === 'WARNING' || upperStatus === 'STALE' || upperStatus === 'STALE_WITH_DATA' ? 'bg-amber-500' : upperStatus === 'UNKNOWN' || upperStatus === 'NOT_AVAILABLE' || upperStatus === 'SUCCESS_EMPTY' ? 'bg-slate-400' : 'bg-emerald-500'}`} aria-hidden="true"></span>
        : Icon
          ? <Icon size={13} className="animate-spin" aria-hidden="true" />
          : <SemanticIcon className={`fa-solid ${config.icon}`} aria-hidden="true"></SemanticIcon>}
      <span>{label}</span>
    </div>
  );
}
