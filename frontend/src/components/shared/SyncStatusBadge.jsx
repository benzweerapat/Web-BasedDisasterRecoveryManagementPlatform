import React from 'react';
import { formatSyncTimestamp } from '../../utils/formatters';

const STATUS_MAP = {
  SUCCESS: {
    label: 'Success',
    dotClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
  },
  PARTIAL: {
    label: 'Partial',
    dotClass: 'bg-amber-500',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200/60'
  },
  FAILED: {
    label: 'Failed',
    dotClass: 'bg-red-500',
    badgeClass: 'bg-red-50 text-red-700 border-red-200/60'
  },
  RUNNING: {
    label: 'Syncing',
    dotClass: 'bg-indigo-500',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200/60'
  },
  UNKNOWN: {
    label: 'No data',
    dotClass: 'bg-slate-400',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200/60'
  }
};

export default function SyncStatusBadge({
  status,
  lastAt,
  running = false,
  error,
  className = ''
}) {
  const isRunning = Boolean(running || status === 'RUNNING');
  const normalizedStatus = isRunning
    ? 'RUNNING'
    : (status && STATUS_MAP[String(status).toUpperCase()])
      ? String(status).toUpperCase()
      : (status ? 'FAILED' : 'UNKNOWN');

  const config = STATUS_MAP[normalizedStatus] || STATUS_MAP.UNKNOWN;
  const { short: shortTime, full: fullTime } = formatSyncTimestamp(lastAt);

  const titleText = isRunning
    ? 'Loading...'
    : (lastAt
      ? `Last sync: ${fullTime} (${config.label})`
      : 'Last sync: no data');

  return (
    <div
      role="status"
      title={titleText}
      data-sync-status={normalizedStatus}
      data-testid="sync-status-badge"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-xs shadow-2xs select-none ${className}`}
    >
      {isRunning ? (
        <>
          <span className="font-medium text-indigo-700">Loading...</span>
        </>
      ) : (
        <>
          <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass} shrink-0`} aria-hidden="true" />
          {lastAt && <span className="text-slate-700 font-medium">{shortTime}</span>}
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.badgeClass}`}>
            {config.label}
          </span>
        </>
      )}
      {error && <span role="alert" className="sr-only">{error}</span>}
    </div>
  );
}
