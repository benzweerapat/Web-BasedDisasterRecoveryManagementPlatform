import SyncScheduleControl from './SyncScheduleControl';
import {runSync,getSyncState,subscribeSync} from '../../api/sync-schedule';
import Button from './Button';
import SemanticIcon from "./SemanticIcon";
import React from 'react';
import { RefreshCw } from 'lucide-react';
import apiClient from '../../api/apiClient';
import { SYNC_ALL_ENDPOINT, canSyncAll, overallResultCopy } from '../../utils/sync-all';
import { streamSyncAll } from '../../utils/sync-stream';

const SCOPE_CONFIG = [
  { key: 'vcenter', label: 'vCenter' },
  { key: 'vr', label: 'vSphere Replication' },
  { key: 'srm', label: 'Site Recovery Manager' }
];

const STATUS_COPY = {
  SUCCESS: { label: 'Success', icon: 'fa-circle-check', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  PARTIAL: { label: 'Partial', icon: 'fa-triangle-exclamation', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  FAILED: { label: 'Failed', icon: 'fa-circle-xmark', color: 'text-red-700 bg-red-50 border-red-200' },
  NOT_CONFIGURED: { label: 'Not configured', icon: 'fa-circle-minus', color: 'text-slate-600 bg-slate-50 border-slate-200' },
  SKIPPED_DEPENDENCY: { label: 'Skipped: dependency', icon: 'fa-forward', color: 'text-slate-600 bg-slate-50 border-slate-200' },
  RUNNING: { label: 'Running', icon: 'fa-circle-notch fa-spin', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  PENDING: { label: 'Pending', icon: 'fa-clock', color: 'text-slate-600 bg-slate-50 border-slate-200' }
};

function StatusPill({ status }) {
  const config = STATUS_COPY[status] || STATUS_COPY.FAILED;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${config.color}`}>
      <SemanticIcon className={`fa-solid ${config.icon}`} aria-hidden="true"></SemanticIcon>
      {config.label}
    </span>
  );
}

function InlineScopeStatus({ label, status }) {
  const config = STATUS_COPY[status] || STATUS_COPY.FAILED;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] shadow-sm" data-sync-inline-scope={label} data-sync-inline-status={status}>
    <span className="font-medium text-slate-500">{label}</span>
    <span className={`font-medium ${config.color.split(' ')[0]}`}>{String(status || 'FAILED').replaceAll('_', ' ')}</span>
  </span>;
}

export default function SyncAllVmwarePanel({ user, onCompleted, requestSync, compact = false, hideSchedule = false }) {
  const globalSync = React.useSyncExternalStore(subscribeSync,getSyncState);
  const [localSyncing, setLocalSyncing] = React.useState(false);
  const syncing = localSyncing || globalSync.running || globalSync.manualRunning;
  const [result, setResult] = React.useState(null);
  const [safeError, setSafeError] = React.useState(null);
  const [liveProgress, setLiveProgress] = React.useState({});
  const inFlightRef = React.useRef(false);

  if (!canSyncAll(user)) return null;

  const handleSync = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setResult(null);
    setSafeError(null);
    setLiveProgress({});
    try {
      setLocalSyncing(true);
      const handleProgress = (event) => {
        setLiveProgress(prev => {
          const next = { ...prev };
          const scope = event.scope;
          if (!scope) return prev;
          next[scope] = next[scope] || { status: 'RUNNING', connections: {} };
          if (event.type === 'SCOPE_STARTED') {
            next[scope].status = 'RUNNING';
          } else if (event.type === 'CONNECTION_STARTED') {
            next[scope].connections = {
              ...next[scope].connections,
              [event.connectionId]: {
                connectionId: event.connectionId,
                connectionName: event.connectionName,
                site: event.site,
                status: 'RUNNING'
              }
            };
          } else if (event.type === 'CONNECTION_COMPLETED') {
            next[scope].connections = {
              ...next[scope].connections,
              [event.connectionId]: {
                connectionId: event.connectionId,
                connectionName: event.connectionName,
                site: event.site,
                status: event.status || 'SUCCESS',
                durationMs: event.durationMs,
                rowsCollected: event.rowsCollected,
                liveUpstreamRequest: true
              }
            };
          } else if (event.type === 'CONNECTION_FAILED') {
            next[scope].connections = {
              ...next[scope].connections,
              [event.connectionId]: {
                connectionId: event.connectionId,
                connectionName: event.connectionName,
                site: event.site,
                status: 'FAILED',
                error: event.error
              }
            };
          } else if (event.type === 'SCOPE_COMPLETED') {
            next[scope].status = event.status;
          }
          return next;
        });
      };

      const defaultStreamRequest = () => streamSyncAll({ onProgress: handleProgress });
      const fallbackRequest = () => apiClient.post(SYNC_ALL_ENDPOINT, {});
      const request = requestSync || (typeof window !== 'undefined' && window.fetch ? defaultStreamRequest : fallbackRequest);
      const response = await runSync(request);
      const finalResult = response?.data?.data || response?.data || null;
      setResult(finalResult);
      if (onCompleted) await onCompleted(finalResult);
    } catch (error) {
      const apiError = error?.response?.data?.error;
      setSafeError({
        code: apiError?.code || 'SYNC_ALL_FAILED',
        safeMessage: apiError?.safeMessage || error?.message || 'Unable to synchronize data'
      });
    } finally {
      inFlightRef.current = false;
      setLocalSyncing(false);
    }
  };

  const modalOpen = localSyncing || result || safeError;
  const syncButton = <Button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        title="Collect the latest VMware data through vCenter, vSphere Replication, and Site Recovery Manager."
        aria-label={compact ? (syncing ? 'Loading...' : 'Sync all') : undefined}
        className={`operations-pill-button inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold border border-transparent bg-indigo-600 text-white shadow-2xs hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {!syncing && <RefreshCw size={14} className="shrink-0" aria-hidden="true" />}
        <span>{syncing ? 'Loading...' : 'Sync all'}</span>
      </Button>;

  if (compact) {
    const systems = result?.systems || result?.scopes || {};
    const visibleScopes = syncing
      ? [{ key: 'vcenter', label: 'vCenter', status: 'RUNNING' }]
      : SCOPE_CONFIG
        .map(scope => ({ ...scope, status: systems?.[scope.key]?.status }))
        .filter(scope => scope.status && (scope.key === 'vcenter' || !['NOT_CONFIGURED', 'SKIPPED_DEPENDENCY'].includes(scope.status)));
    return <div className="flex flex-col items-end gap-1.5" data-sync-all-compact>
      {syncButton}
      {!hideSchedule && <SyncScheduleControl />}
      {modalOpen && <div className="flex max-w-[420px] flex-wrap justify-end gap-1.5" aria-live="polite" data-sync-all-inline-result>
        {syncing ? <span role="status">Loading...</span> : safeError
          ? <InlineScopeStatus label="Sync" status={safeError.code === 'SYNC_IN_PROGRESS' ? 'RUNNING' : 'FAILED'} />
          : visibleScopes.map(scope => <InlineScopeStatus key={scope.key} label={scope.label} status={scope.status} />)}
      </div>}
    </div>;
  }

  return (
    <>
      {syncButton}
      {!hideSchedule && <SyncScheduleControl />}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sync-all-title">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-slate-50">
              <h2 id="sync-all-title" className="font-display text-base font-semibold text-slate-800">
                {syncing ? 'Loading...' : (safeError ? (safeError.code === 'SYNC_IN_PROGRESS' ? 'Synchronization in progress' : 'Unable to synchronize data') : overallResultCopy(result?.overallStatus))}
              </h2>
            </div>

            <div className="p-5 space-y-3" aria-live="polite">
              {syncing ? (
                <p role="status" className="text-sm text-slate-600">Loading...</p>
              ) : safeError ? (
                <div className={`${safeError.code === 'SYNC_IN_PROGRESS' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-red-50 border-red-200 text-red-800'} border rounded-lg p-3`}>
                  <p className="font-medium">{safeError.safeMessage}</p>
                  <details className="text-xs mt-1"><summary>Technical details</summary><code>Status: {safeError.code}</code></details>
                </div>
              ) : SCOPE_CONFIG.map((scope, index) => {
                const scopeResult = (result?.systems || result?.scopes)?.[scope.key];
                const liveScope = liveProgress[scope.key];
                const status = syncing
                  ? (liveScope?.status || (index === 0 ? 'RUNNING' : 'PENDING'))
                  : (scopeResult?.status || 'FAILED');
                const finalConnections = scopeResult?.connections || scopeResult?.connectionResults || [];
                const liveConnections = liveScope?.connections ? Object.values(liveScope.connections) : [];
                const connections = syncing ? (liveConnections.length > 0 ? liveConnections : finalConnections) : finalConnections;
                return (
                  <div key={scope.key} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                      <p className="font-medium text-slate-800">{scope.label}</p>
                      {!syncing && scopeResult && (
                        <>
                          <p className="text-xs text-slate-500 mt-1">{scopeResult.connectionsProcessed ?? 0} Connections</p>
                          {scopeResult.failedScopes?.length > 0 && (
                            <p className="text-xs text-amber-700 mt-1">Failed scopes: {scopeResult.failedScopes.join(', ')}</p>
                          )}
                          {scopeResult.error?.safeMessage && (
                            <p className="text-xs text-red-700 mt-1">{scopeResult.error.safeMessage}</p>
                          )}
                        </>
                      )}
                      </div>
                      <StatusPill status={status} />
                    </div>
                    {connections.length > 0 && (
                      <div className="border-t border-slate-100 pt-2 space-y-1.5">
                        {connections.map(connection => {
                          const isConnRunning = connection.status === 'RUNNING';
                          const success = connection.status === 'SUCCESS';
                          const partial = connection.status === 'PARTIAL';
                          return (
                            <div key={`${scope.key}-${connection.connectionId}`} className="flex items-start justify-between gap-3 text-xs">
                              <div className="flex items-start gap-2 min-w-0">
                                {!isConnRunning && (
                                  <SemanticIcon
                                    className={`fa-solid mt-0.5 ${success ? 'fa-circle-check text-emerald-600' : (partial ? 'fa-triangle-exclamation text-amber-600' : 'fa-circle-xmark text-red-600')}`}
                                    aria-hidden="true"
                                  ></SemanticIcon>
                                )}
                                <div>
                                  <p className="font-semibold text-slate-700">{connection.site || connection.connectionName || `Connection ${connection.connectionId}`}</p>
                                  {isConnRunning && <p className="text-indigo-600">Loading...</p>}
                                  {!isConnRunning && connection.liveUpstreamRequest && (
                                    <p className="text-emerald-700">Live VMware collection {connection.durationMs != null ? `(${(connection.durationMs / 1000).toFixed(1)}s)` : ''}</p>
                                  )}
                                  {connection.error?.safeMessage && <p className="text-red-700">{connection.error.safeMessage}</p>}
                                </div>
                              </div>
                              <span className="font-mono text-slate-500">{connection.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {result?.syncRunId && (
                <p className="text-xs text-slate-500 font-mono break-all">Sync run: {result.syncRunId}</p>
              )}

              {result?.durationMs != null && (
                <p className="text-sm text-slate-600 text-right">Duration: {(result.durationMs / 1000).toFixed(1)} seconds</p>
              )}
            </div>

            {!syncing && (
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
                <Button type="button" onClick={() => { setResult(null); setSafeError(null); }} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700">Close</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
