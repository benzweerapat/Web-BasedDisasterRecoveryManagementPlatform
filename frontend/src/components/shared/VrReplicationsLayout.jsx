import { displayName, displayVmName } from '../../utils/displayNames';
import Button from './Button';
import ReplicationDatastores from './ReplicationDatastores';
import VmDetailModal from './VmDetailModal';
import apiClient from '../../api/apiClient';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Pause, Play, RefreshCw, Sliders, Trash2, ChevronRight, Eye } from 'lucide-react';
import { getVmPowerStatePresentation } from '../../utils/overview-severity';
import { getReplicationFeedback } from '../../utils/replicationFeedback';
import ReplicationStatusNotice from './ReplicationStatusNotice';

function VmPowerBadge({ powerState }) {
  const p = getVmPowerStatePresentation(powerState);
  const textStyle = p.severity === 'HEALTHY' ? { color: '#0f172a' } : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${p.className}`}
      style={textStyle}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  );
}

function ExpandedDetails({ rep }) {
  if (!getReplicationFeedback(rep).hasDetails) return null;

  return (
    <div className="min-w-0 bg-white px-6 py-3 text-sm" data-vr-replication-details>
      <ReplicationStatusNotice rep={rep} />
    </div>
  );
}

function ReplicationRow({ rep, direction, isExpanded, toggleExpand, onAction, onViewVm, isAdmin, pairContext }) {
  const statusStr = (rep.normalizedStatus ?? rep.status ?? '').toUpperCase();
  const isPaused = statusStr === 'PAUSED';
  const feedback = getReplicationFeedback(rep);
  const { statusLabel, severity, hasDetails } = feedback;
  const statusColors = {
    success: 'border-emerald-200/80 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200/80 bg-amber-50 text-amber-700',
    error: 'border-rose-200/80 bg-rose-50 text-rose-700',
    info: 'border-blue-200/80 bg-blue-50 text-blue-700',
    neutral: 'border-slate-200 bg-slate-100 text-slate-600',
  };
  const dotColors = { success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500', info: 'bg-blue-500', neutral: 'bg-slate-400' };
  const isOutgoing = String(direction || rep.direction || '').toUpperCase() === 'OUTGOING';

  return (
    <>
      <tr className={`border-b border-slate-200/80 transition-colors ${isExpanded && hasDetails ? 'bg-slate-50/90' : 'hover:bg-slate-50/60'}`}>
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            {hasDetails ? (
              <button
                type="button"
                onClick={toggleExpand}
                aria-label={`${isExpanded ? 'Hide' : 'Show'} replication status details for ${displayVmName(rep.vmName)}`}
                aria-expanded={isExpanded}
                className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100/60 rounded transition-transform cursor-pointer shrink-0"
                title={isExpanded ? 'Hide status details' : 'Show status details'}
              >
                <ChevronRight
                  size={16}
                  className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                />
              </button>
            ) : (
              <span className="w-6 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 text-sm tracking-tight truncate">
                  {displayVmName(rep.vmName)}
                </div>
                <div className="mt-0.5">
                  <VmPowerBadge powerState={rep.vmPowerState} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => onViewVm?.(rep)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-2xs transition-colors hover:border-[#8AC389] hover:bg-[#8AC389]/10 hover:text-[#6EAC6C] cursor-pointer"
                title="View VM details"
                aria-label={`View VM details for ${displayVmName(rep.vmName)}`}
              >
                <Eye size={14} />
              </button>
            </div>
          </div>
        </td>
        <td className="px-4 py-3.5 whitespace-nowrap">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColors[severity]}`} title={feedback.guidance || feedback.rawStatus}>
            <span className={`h-1.5 w-1.5 rounded-full ${dotColors[severity]}`} />
            {statusLabel}{feedback.progressPercent != null ? ` · ${feedback.progressPercent}%` : ''}
          </span>
          {(feedback.isInactive || feedback.isSyncing) && (
            <p className="mt-1 max-w-[210px] whitespace-normal text-[11px] leading-4 text-slate-500">
              {feedback.isInactive ? 'Not ready. Open status details.' : feedback.progressPercent == null ? 'Progress percentage unavailable.' : 'Waiting for synchronization to finish.'}
            </p>
          )}
        </td>
        <td className="px-4 py-3.5 whitespace-nowrap">
          {rep.rpo == null ? (
            <span className="text-xs text-slate-400">Unavailable</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700">
              {rep.rpo} min
            </span>
          )}
        </td>
        <td className="px-4 py-3.5">
          <ReplicationDatastores rep={rep} />
        </td>
        <td className="px-4 py-3.5">
          {rep.protectionGroupName ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 truncate max-w-[170px]" title={rep.protectionGroupName}>
              <span className="truncate">{displayName(rep.protectionGroupName, 'Not protected')}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">Not protected</span>
          )}
        </td>
        <td className="px-4 py-3.5">
          {rep.recoveryPlanName ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 truncate max-w-[170px]" title={rep.recoveryPlanName}>
              <span className="truncate">{displayName(rep.recoveryPlanName, 'Unavailable')}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">Unavailable</span>
          )}
        </td>
        <td className="px-4 py-3.5 whitespace-nowrap text-right">
          {isOutgoing ? (
            <div className="inline-flex items-center justify-end">
              <div className="inline-flex items-center gap-1">
                {isPaused ? (
                  <button
                    type="button"
                    onClick={() => onAction?.('resume', rep, pairContext || rep.pairingId)}
                    className="flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-white text-emerald-600 shadow-2xs transition-all hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer"
                    title="Resume"
                    aria-label="Resume replication"
                  >
                    <Play size={15} />
                  </button>
                ) : rep.actions?.includes('pause') ? (
                  <button
                    type="button"
                    onClick={() => onAction?.('pause', rep, pairContext || rep.pairingId)}
                    className="flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-white text-slate-600 shadow-2xs transition-all hover:bg-amber-50 hover:text-amber-700 cursor-pointer"
                    title="Pause"
                    aria-label="Pause replication"
                  >
                    <Pause size={15} />
                  </button>
                ) : null}

                {rep.actions?.includes('sync') ? (
                  <button
                    type="button"
                    onClick={() => onAction?.('sync', rep, pairContext || rep.pairingId)}
                    className="flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-white text-slate-600 shadow-2xs transition-all hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer"
                    title="Sync now"
                    aria-label="Sync now"
                  >
                    <RefreshCw size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-slate-300 opacity-60 cursor-not-allowed"
                    title={statusStr === 'NOT_ACTIVE' ? 'Sync not allowed when replication is NOT_ACTIVE' : 'Sync not allowed in current state'}
                    aria-label="Sync now unavailable"
                  >
                    <RefreshCw size={15} />
                  </button>
                )}

                {rep.actions?.includes('reconfigure') && (
                  <button
                    type="button"
                    onClick={() => onAction?.('reconfigure', rep, rep.pairingId)}
                    className="flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-white text-slate-600 shadow-2xs transition-all hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                    title="Reconfigure"
                    aria-label="Reconfigure replication"
                  >
                    <Sliders size={15} />
                  </button>
                )}

                {isAdmin && rep.actions?.includes('unconfigure') && (
                  <button
                    type="button"
                    onClick={() => onAction?.('unconfigure', rep, rep.pairingId)}
                    className="flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-white text-slate-500 shadow-2xs transition-all hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                    title="Remove"
                    aria-label="Remove replication"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">Managed at Source</span>
          )}
        </td>
      </tr>
      {isExpanded && hasDetails && (
        <tr>
          <td colSpan="7" className="p-0 border-b border-slate-200 bg-slate-50/40">
            <ExpandedDetails rep={rep} />
          </td>
        </tr>
      )}
    </>
  );
}



function ReplicationBlock({ title, direction, subtitle, list, pairContext, canWrite, isAdmin, onCreateReplication, onAction, onViewVm, loading = false, emptyMessage }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="mb-8 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-vr-direction={direction.toUpperCase()} data-vr-route={subtitle}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
        <div>
          <h3 className="mb-1 flex items-center gap-2 font-display text-sm font-semibold text-slate-800">
            {title}
          </h3>
          <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
            {subtitle}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {canWrite && (
            <Button
              variant="vr-green"
              type="button"
              onClick={() => onCreateReplication?.(pairContext)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-sm transition-colors"
              title={`Create new replication for route: ${subtitle}`}
            >
              <Plus size={14} />
              New replication
            </Button>
          )}
          <span className="text-sm font-medium text-slate-800">{direction}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
          <div className="overflow-x-auto">
            <table className="replications-table w-full min-w-[1100px] table-fixed text-left text-sm">
              <colgroup>
                <col style={{ width: '250px' }} />
                <col style={{ width: '190px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '210px' }} />
              </colgroup>
              <thead className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold tracking-wider text-slate-500">
                <tr>
                  <th className="whitespace-nowrap">Virtual machine</th>
                  <th className="whitespace-nowrap">Status</th>
                  <th className="whitespace-nowrap">RPO</th>
                  <th className="whitespace-nowrap">Target datastore</th>
                  <th className="whitespace-nowrap">Protection group</th>
                  <th className="whitespace-nowrap">Recovery plan</th>
                  <th className="whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td colSpan="7" className="py-12 text-center text-slate-500">
                      {loading ? (
                        'Loading...'
                      ) : (
                        emptyMessage || `No ${direction.toLowerCase()} replications`
                      )}
                    </td>
                  </tr>
                )}
                {list.map((rep, idx) => {
                  const rowId = rep.canonicalReplicationKey || rep.replicationId || rep.id || rep.vmName || idx;
                  return (
                    <ReplicationRow
                      key={rowId}
                      rep={rep}
                      direction={direction}
                      isExpanded={expandedId === rowId}
                      toggleExpand={() => setExpandedId(expandedId === rowId ? null : rowId)}
                      onAction={onAction}
                      onViewVm={onViewVm}
                      isAdmin={isAdmin}
                      pairContext={pairContext}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
      </div>
    </div>
  );
}

function compactSiteLabel(value) {
  const label = String(value || '').trim().replace(/^(site|vcenter|vr)\s+/i, '');
  return label || 'Unknown';
}

function endpointLabel(view, side) {
  const prefix = side === 'local' ? 'local' : 'remote';
  return view?.[`${prefix}VcenterHost`]
    || view?.[`${prefix}VcenterName`]
    || view?.[`${prefix}SiteName`]
    || 'Not available';
}

export default function VrReplicationsLayout({
  replicationsSummary,
  loading = false,
  canWrite = false,
  isAdmin = false,
  onCreateReplication,
  onAction
}) {
  const allReps = useMemo(
    () => replicationsSummary?.canonicalReplications || replicationsSummary?.canonicalRows || [],
    [replicationsSummary?.canonicalReplications, replicationsSummary?.canonicalRows]
  );
  const sitePairViews = useMemo(
    () => Array.isArray(replicationsSummary?.sitePairViews) ? replicationsSummary.sitePairViews : [],
    [replicationsSummary?.sitePairViews]
  );
  const replicationsByKey = useMemo(
    () => new Map(allReps.map(rep => [rep.canonicalReplicationKey, rep]).filter(([key]) => key)),
    [allReps]
  );
  const [activeTab, setActiveTab] = useState(null);
  const [selectedVm, setSelectedVm] = useState(null);
  const [vmDetails, setVmDetails] = useState(null);
  const [vmDetailsLoading, setVmDetailsLoading] = useState(false);

  const openVmDetails = async rep => {
    const vm = {
      name: rep.vmName,
      powerState: rep.vmPowerState,
      vmId: rep.vmInventoryVmId,
      vcenterId: rep.vmInventoryVcenterId,
      protectionGroupName: rep.protectionGroupName,
      protectionStatus: rep.protectionStatus,
      isProtected: rep.protectionStatus === 'PROTECTED' || Boolean(rep.protectionGroupName),
      replications: [rep]
    };
    setSelectedVm(vm);
    setVmDetails(null);

    if (!vm.vmId || !vm.vcenterId) return;
    setVmDetailsLoading(true);
    try {
      const response = await apiClient.get(`/vms/${encodeURIComponent(vm.vmId)}/details`, {
        params: { vcenterId: vm.vcenterId }
      });
      setVmDetails(response.data?.data || null);
    } catch (error) {
      console.error('Failed to load VM details from replication row', error);
    } finally {
      setVmDetailsLoading(false);
    }
  };

  const closeVmDetails = () => {
    setSelectedVm(null);
    setVmDetails(null);
    setVmDetailsLoading(false);
  };

  useEffect(() => {
    if (!sitePairViews.length) {
      setActiveTab(null);
      return;
    }
    if (!sitePairViews.some(view => view.viewKey === activeTab)) {
      setActiveTab(sitePairViews[0].viewKey);
    }
  }, [activeTab, sitePairViews]);

  const activeView = sitePairViews.find(view => view.viewKey === activeTab) || sitePairViews[0] || null;
  const replicationForView = (key, direction) => {
    const canonical = replicationsByKey.get(key);
    if (!canonical) return null;
    const localSite = compactSiteLabel(activeView?.localSiteName || activeView?.localVcenterName).toUpperCase();
    const observation = (canonical.observations || []).find(row =>
      String(row.direction || '').toUpperCase() === direction
      && compactSiteLabel(row.observationSiteName || row.localSiteName).toUpperCase() === localSite
    );
    return observation ? { ...canonical, ...observation, observations: canonical.observations } : canonical;
  };
  const incomingList = (activeView?.incomingCanonicalReplicationKeys || [])
    .map(key => replicationForView(key, 'INCOMING'))
    .filter(Boolean);
  const outgoingList = (activeView?.outgoingCanonicalReplicationKeys || [])
    .map(key => replicationForView(key, 'OUTGOING'))
    .filter(Boolean);

  const localSite = compactSiteLabel(activeView?.localSiteName || activeView?.localVcenterName);
  const remoteSite = compactSiteLabel(activeView?.remoteSiteName || activeView?.remoteVcenterName);
  const localEndpoint = endpointLabel(activeView, 'local');
  const remoteEndpoint = endpointLabel(activeView, 'remote');
  const [directionFilter, setDirectionFilter] = useState('ALL');

  const displayedDirections = useMemo(() => {
    if (directionFilter === 'OUTGOING') return ['OUTGOING'];
    if (directionFilter === 'INCOMING') return ['INCOMING'];
    return ['OUTGOING', 'INCOMING'];
  }, [directionFilter]);

  const pairControls = sitePairViews.length > 0 ? (
    <div className="flex min-w-0 items-center shrink-0">
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 items-center shrink-0" data-vr-site-pairs-bar="true">
        {sitePairViews.map(view => {
          const isActive = activeTab === view.viewKey;
          return (
            <button
              key={view.viewKey}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveTab(view.viewKey)}
              data-vr-site-pair={view.viewKey}
              className={`px-3 py-1 rounded-md text-xs transition-all flex items-center gap-1.5 ${
                isActive
                  ? 'font-bold bg-[#8AC389] text-[#0A0A0A] shadow-xs'
                  : 'font-semibold text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{endpointLabel(view, 'local')}</span>
              <ArrowLeftRight size={13} className={isActive ? 'text-[#0A0A0A]' : 'text-slate-500'} aria-hidden="true" />
              <span>{endpointLabel(view, 'remote')}</span>
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className="w-full mt-2 pb-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50 p-3 px-4" data-vr-direction-toolbar="true">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold tracking-wider text-slate-700">Direction:</span>
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs" data-vr-direction-filter-bar="true">
              <button
                type="button"
                aria-pressed={directionFilter === 'ALL'}
                onClick={() => setDirectionFilter('ALL')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-all ${
                  directionFilter === 'ALL'
                    ? 'font-bold bg-[#8AC389] text-[#0A0A0A] shadow-xs'
                    : 'font-semibold text-slate-600 hover:text-slate-900'
                }`}
                data-vr-direction-filter="ALL"
              >
                <span>All</span>
              </button>
              <button
                type="button"
                aria-pressed={directionFilter === 'OUTGOING'}
                onClick={() => setDirectionFilter('OUTGOING')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-all ${
                  directionFilter === 'OUTGOING'
                    ? 'font-bold bg-[#8AC389] text-[#0A0A0A] shadow-xs'
                    : 'font-semibold text-slate-600 hover:text-slate-900'
                }`}
                data-vr-direction-filter="OUTGOING"
              >
                <span>Outgoing</span>
              </button>
              <button
                type="button"
                aria-pressed={directionFilter === 'INCOMING'}
                onClick={() => setDirectionFilter('INCOMING')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-all ${
                  directionFilter === 'INCOMING'
                    ? 'font-bold bg-[#8AC389] text-[#0A0A0A] shadow-xs'
                    : 'font-semibold text-slate-600 hover:text-slate-900'
                }`}
                data-vr-direction-filter="INCOMING"
              >
                <span>Incoming</span>
              </button>
            </div>
          </div>
          {pairControls}
        </div>

      {displayedDirections.map(direction => {
        const isIncoming = direction === 'INCOMING';
        const arrow = isIncoming ? '←' : '→';
        const pairContext = !activeView ? undefined : isIncoming
          ? {
              sourceVcenterId: activeView.remoteVcenterStableId,
              targetVcenterId: activeView.localVcenterStableId,
              sourceHost: activeView.remoteVcenterHost,
              targetHost: activeView.localVcenterHost,
              sourceName: activeView.remoteSiteName || activeView.remoteVcenterName,
              targetName: activeView.localSiteName || activeView.localVcenterName
            }
          : {
              sourceVcenterId: activeView.localVcenterStableId,
              targetVcenterId: activeView.remoteVcenterStableId,
              sourceHost: activeView.localVcenterHost,
              targetHost: activeView.remoteVcenterHost,
              sourceName: activeView.localSiteName || activeView.localVcenterName,
              targetName: activeView.remoteSiteName || activeView.remoteVcenterName
            };

        return (
          <ReplicationBlock
            key={direction}
            title={activeView ? `Site ${localSite} ${arrow} ${remoteSite}` : isIncoming ? 'Incoming' : 'Outgoing'}
            subtitle={activeView ? `${localEndpoint} ${arrow} ${remoteEndpoint}` : ''}
            direction={isIncoming ? 'Incoming' : 'Outgoing'}
            list={activeView ? (isIncoming ? incomingList : outgoingList) : []}
            loading={loading}
            emptyMessage={activeView ? undefined : 'No replications configured'}
            pairContext={pairContext}
            canWrite={canWrite}
            isAdmin={isAdmin}
            onCreateReplication={onCreateReplication}
            onAction={onAction}
            onViewVm={openVmDetails}
          />
        );
      })}
      <VmDetailModal
        open={Boolean(selectedVm)}
        vm={selectedVm}
        details={vmDetails}
        loading={vmDetailsLoading}
        onClose={closeVmDetails}
      />
    </div>
  );
}
