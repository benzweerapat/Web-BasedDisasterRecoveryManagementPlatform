import Button from './Button';
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { canRunVmwareSync, useVmwareSync } from '../../hooks/useVmwareSync';
import SyncScheduleControl from './SyncScheduleControl';

const COPY = Object.freeze({
  VR: {
    label: 'Sync VR',
    progress: 'Loading...',
    success: 'vSphere Replication synchronization succeeded',
    partial: 'vSphere Replication synchronization partially succeeded',
    failed: 'Unable to synchronize vSphere Replication'
  },
  SRM: {
    label: 'Sync SRM',
    progress: 'Loading...',
    success: 'Site Recovery Manager synchronization succeeded',
    partial: 'Site Recovery Manager synchronization partially succeeded',
    failed: 'Unable to synchronize Site Recovery Manager'
  }
});

const scopeLabels = Object.freeze({
  protectionGroups: 'Protection groups',
  recoveryPlans: 'Recovery plans',
  inventoryMappings: 'Inventory mappings',
  placeholderDatastores: 'Placeholder datastores'
});

function statusText(status) {
  if (status === 'SUCCESS') return 'Success';
  if (status === 'PARTIAL') return 'Partial';
  if (status === 'NOT_CONFIGURED') return 'Not configured';
  return 'Failed';
}

function StatusPill({ status }) {
  const success = status === 'SUCCESS';
  const partial = status === 'PARTIAL';
  const classes = success
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : partial
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-red-200 bg-red-50 text-red-700';
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${classes}`}>{statusText(status)}</span>;
}

function ResultHeading({ copy, syncing, result, error }) {
  if (syncing) return copy.progress;
  if (error || result?.status === 'FAILED') return copy.failed;
  if (result?.status === 'PARTIAL') return copy.partial;
  return copy.success;
}

function InlineSyncStatus({ type, syncing, result, error }) {
  if (!syncing && !result && !error) return null;

  const status = syncing ? 'RUNNING' : error ? 'FAILED' : (result?.status || 'FAILED');
  const tone = status === 'SUCCESS'
    ? 'text-emerald-700'
    : status === 'PARTIAL'
      ? 'text-amber-700'
      : status === 'RUNNING'
        ? 'text-indigo-700'
        : 'text-red-700';
  const label = type === 'VR' ? 'vSphere Replication' : 'Site Recovery Manager';

  return (
    <div className={`max-w-64 text-right text-xs font-semibold ${tone}`} role="status" data-vmware-sync-inline-status={type}>
      <span className="inline-flex items-center justify-end gap-1.5">
        {!syncing && <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />}
        {syncing ? 'Loading...' : `${label} ${status}`}
      </span>
      {error?.safeMessage && <p className="mt-1 font-normal text-red-600">{error.safeMessage}</p>}
      {!syncing && type === 'VR' && result?.result && (
        <p className="mt-1 font-normal text-slate-500">
          Logical {result.result.logicalReplicationCount ?? '—'} · Observations {result.result.observationCount ?? 0}
        </p>
      )}
    </div>
  );
}

export default function VmwareSyncButton({ type, user, onCompleted, requestSync, display = 'dialog', hideSchedule = false }) {
  const normalizedType = String(type || '').toUpperCase();
  const copy = COPY[normalizedType];
  const { syncing, result, error, sync, reset } = useVmwareSync(normalizedType, { onCompleted, requestSync });
  if (!copy || !canRunVmwareSync(user)) return null;

  const open = display !== 'inline' && (syncing || result || error);
  return (
    <div className={display === 'inline' ? 'flex flex-col items-end gap-1.5' : 'flex items-center gap-2'}>
      <Button
        type="button"
        onClick={sync}
        disabled={syncing}
        className="operations-pill-button inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 active:bg-slate-100 transition-all disabled:opacity-50"
      >
        {!syncing && <RefreshCw size={14} className="shrink-0" aria-hidden="true" />}
        <span>{syncing ? copy.progress : copy.label}</span>
      </Button>

      {!hideSchedule && <SyncScheduleControl />}

      {display === 'inline' && (
        <InlineSyncStatus type={normalizedType} syncing={syncing} result={result} error={error} />
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="font-display text-lg font-semibold text-slate-800"><ResultHeading copy={copy} syncing={syncing} result={result} error={error} /></h2>
            </div>

            <div className="space-y-4 px-6 py-5">
              {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.safeMessage}</div>}
              {result?.connections?.map(connection => (
                <div key={connection.connectionId} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <div>
                    <p className="font-semibold text-slate-800">{connection.site || connection.connectionName || `Connection ${connection.connectionId}`}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {connection.liveUpstreamRequest ? 'Live VMware collection' : connection.error?.safeMessage || 'No upstream evidence available'}
                    </p>
                    {normalizedType === 'VR' && connection.liveUpstreamRequest && (
                      <p className="mt-1 text-xs text-slate-500">Outgoing {connection.outgoingCollected ?? 0} · Incoming {connection.incomingCollected ?? 0} · Observations {connection.totalObservations ?? 0}</p>
                    )}
                  </div>
                  <StatusPill status={connection.status} />
                </div>
              ))}

              {normalizedType === 'VR' && result?.result && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Logical replications</p><p className="mt-1 font-mono text-2xl font-semibold text-slate-800">{result.result.logicalReplicationCount ?? '—'}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Observations</p><p className="mt-1 font-mono text-2xl font-semibold text-slate-800">{result.result.observationCount ?? 0}</p></div>
                </div>
              )}

              {normalizedType === 'SRM' && result?.result && Object.entries(scopeLabels).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <div><p className="font-medium text-slate-800">{label}</p><p className="text-xs text-slate-500">{result.result[key]?.rowsCollected ?? 0} rows</p></div>
                  <StatusPill status={result.result[key]?.status || 'FAILED'} />
                </div>
              ))}

              {result?.syncRunId && <p className="break-all text-xs text-slate-400">Sync run: {result.syncRunId}</p>}
            </div>

            <div className="flex justify-end border-t border-slate-200 px-6 py-4">
              <Button type="button" onClick={reset} disabled={syncing} className="rounded-lg bg-slate-800 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
