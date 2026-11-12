import Button from './Button';
import SemanticIcon from "./SemanticIcon";
import React, { useState, useMemo } from 'react';
import { Eye } from 'lucide-react';
import { formatNullable, formatDateTime } from '../../utils/formatters';
import DetailDrawer from './DetailDrawer';
import { getReplicationFeedback } from '../../utils/replicationFeedback';
import ReplicationStatusNotice from './ReplicationStatusNotice';

// ─── helpers ────────────────────────────────────────────────────────────────

function getStatusPresentation(rep) {
  const feedback = getReplicationFeedback(rep);
  const presentations = {
    success: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: 'fa-check-circle' },
    error: { cls: 'bg-rose-50 text-rose-700 border-rose-100', icon: 'fa-times-circle' },
    warning: { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-triangle-exclamation' },
    info: { cls: 'bg-blue-50 text-blue-700 border-blue-100', icon: 'fa-bolt' },
    neutral: { cls: 'bg-slate-100 text-slate-700 border-slate-200', icon: 'fa-info-circle' },
  };
  return { ...presentations[feedback.severity], label: `${feedback.statusLabel}${feedback.progressPercent != null ? ` ${feedback.progressPercent}%` : ''}` };
}

function StatusBadge({ rep }) {
  const { label, cls, icon } = getStatusPresentation(rep);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border whitespace-nowrap ${cls}`}>
      <SemanticIcon className={`fa-solid ${icon} text-[10px]`} />
      {label}
    </span>
  );
}

function RpoBar({ rep }) {
  const targetMin = rep.rpo ?? null;
  const isSyncing = rep.syncProgressPercent != null;
  const isViolated = rep.rpoViolation != null && rep.rpoViolation > 0;

  if (targetMin == null) return <span className="text-xs text-slate-400">N/A</span>;

  const targetLabel = targetMin >= 60
    ? `${targetMin / 60} Hr${targetMin >= 120 ? 's' : ''}`
    : `${targetMin} min`;

  let barColor = 'bg-emerald-500';
  let barWidth = '40%';
  let actualLabel = 'OK';

  if (isSyncing) {
    barColor = 'bg-blue-500';
    barWidth = `${rep.syncProgressPercent}%`;
    actualLabel = 'Syncing';
  } else if (isViolated) {
    const v = rep.rpoViolation;
    const h = Math.floor(v / 60), m = v % 60;
    actualLabel = `${h > 0 ? h + 'h ' : ''}${m}m violated`;
    barColor = 'bg-rose-500';
    barWidth = '100%';
  }

  return (
    <div className="min-w-[150px] max-w-[220px]">
      <div className="flex justify-between text-[11px] font-medium mb-1.5">
        <span className="text-slate-400">Target: {targetLabel}</span>
        <span className={isViolated ? 'text-rose-600 font-bold' : 'text-slate-700'}>{actualLabel}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full`} style={{ width: barWidth }} />
      </div>
    </div>
  );
}

// ─── CANONICAL VIEW ──────────────────────────────────────────────────────────

function CanonicalRow({ rep, onSelect }) {
  return (
    <tr
      data-logical-replication-card
      className="hover:bg-slate-50/50 transition-colors"
    >
      {/* VM */}
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <SemanticIcon className="fa-regular fa-hard-drive text-slate-400 text-base" />
          <div>
            <p className="font-semibold text-slate-800">{formatNullable(rep.vmName)}</p>
            <div className="text-[11px] text-slate-500 mt-0.5">
              <span>Replication name: </span>
              {rep.replicationNameAvailability === 'NOT_PROVIDED_BY_API' ? (
                <span className="italic text-slate-400">Not provided by API</span>
              ) : (
                <span>{rep.replicationName || formatNullable(rep.vmName)}</span>
              )}
            </div>
            {rep.replicationId && (
              <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                <span>Replication ID: </span>
                <span>{rep.replicationId}</span>
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="px-5 py-4"><StatusBadge rep={rep} /></td>

      {/* RPO */}
      <td className="px-5 py-4">
        {rep.rpo != null && (
          <p className="text-xs font-semibold text-slate-600 mb-1">
            RPO {rep.rpo >= 60
              ? `${rep.rpo / 60} Hr${rep.rpo >= 120 ? 's' : ''}`
              : `${rep.rpo} min`}
          </p>
        )}
        <RpoBar rep={rep} />
      </td>

      {/* Journey */}
      <td className="px-5 py-4" data-replication-journey>
        <div className="flex items-center gap-2 text-xs">
          <div className="text-left">
            <p className="font-bold text-slate-800 text-[12px]">
              Source · {formatNullable(rep.logicalSourceSiteName || rep.logicalSourceVcenterName, 'DC')}
            </p>
            {rep.logicalSourceVcenterHost && <p className="font-mono text-[10px] text-slate-400">{rep.logicalSourceVcenterHost}</p>}
          </div>
          <SemanticIcon className="fa-solid fa-arrow-right text-slate-300 mx-1" />
          <div className="text-left">
            <p className="font-bold text-slate-800 text-[12px]">
              Target · {formatNullable(rep.logicalTargetSiteName || rep.logicalTargetVcenterName, 'DR')}
            </p>
            {rep.logicalTargetVcenterHost && <p className="font-mono text-[10px] text-slate-400">{rep.logicalTargetVcenterHost}</p>}
          </div>
        </div>
      </td>

      {/* Protection group */}
      <td className="px-5 py-4">
        {rep.protectionGroupName
          ? <span className="text-xs font-semibold text-indigo-600">{rep.protectionGroupName}</span>
          : <span className="text-xs text-slate-400">—</span>}
      </td>

      {/* Observations */}
      <td className="px-5 py-4 text-xs text-slate-500">{rep.observationCount ?? '—'}</td>

      {/* Details */}
      <td className="px-5 py-4 text-right">
        <Button
          onClick={() => onSelect(rep)}
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          aria-label={`Details for ${rep.vmName}`}
          title="View details"
        >
          <Eye size={17} aria-hidden="true" />
        </Button>
      </td>
    </tr>
  );
}

function CanonicalTable({ replications, onSelect }) {
  if (!replications.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-slate-500">No replications found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1100px]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] font-bold tracking-wider">
            <tr>
              <th className="px-5 py-4">Virtual machine</th>
              <th className="px-5 py-4">Health status</th>
              <th className="px-5 py-4">RPO</th>
              <th className="px-5 py-4">Replication journey</th>
              <th className="px-5 py-4">Protection group</th>
              <th className="px-5 py-4">Observations</th>
              <th className="px-5 py-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {replications.map((rep, i) => (
              <CanonicalRow key={rep.rowKey ?? i} rep={rep} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── OBSERVATION VIEW ─────────────────────────────────────────────────────────
// Mimics the VMware vSphere per-vCenter Outgoing/Incoming view

function ObservationView({ observations, replicationsSummary: _replicationsSummary }) {
  // Group observations by their local site (= observationSiteName or localSiteName)
  const sites = useMemo(() => {
    const map = {};
    observations.forEach(obs => {
      const site = obs.observationSiteName ?? obs.localSiteName ?? 'Unknown';
      if (!map[site]) {
        // The "local" host for this observation site depends on direction:
        //   OUTGOING → this site is the source → logicalSourceVcenterHost
        //   INCOMING → this site is the target → logicalTargetVcenterHost
        const dir = (obs.direction ?? '').toUpperCase();
        const localHost = dir === 'OUTGOING'
          ? (obs.logicalSourceVcenterHost ?? obs.localSiteName)
          : (obs.logicalTargetVcenterHost ?? obs.localSiteName);
        const remoteHost = dir === 'OUTGOING'
          ? (obs.logicalTargetVcenterHost ?? obs.remoteSiteName)
          : (obs.logicalSourceVcenterHost ?? obs.remoteSiteName);
        map[site] = { name: site, host: localHost, remoteHost, observations: [] };
      }
      map[site].observations.push(obs);
    });
    return Object.values(map);
  }, [observations]);

  const [activeSite, setActiveSite] = useState(() => sites[0]?.name ?? null);
  const [directionFilter, setDirectionFilter] = useState('OUTGOING');

  const currentSite = useMemo(() => sites.find(s => s.name === activeSite), [sites, activeSite]);
  const filtered = useMemo(
    () => (currentSite?.observations ?? []).filter(o => (o.direction ?? '').toUpperCase() === directionFilter),
    [currentSite, directionFilter]
  );

  // local/remote hosts for the data-observation-route attribute
  const localHost = currentSite?.host ?? currentSite?.name ?? 'Local';
  const remoteHostLabel = currentSite?.remoteHost ?? currentSite?.observations?.[0]?.remoteSiteName ?? 'Remote';

  if (!observations.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-slate-500">No observation data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Site selector */}
      {sites.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {sites.map(s => (
            <Button
              key={s.name}
              onClick={() => { setActiveSite(s.name); setDirectionFilter('OUTGOING'); }}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                activeSite === s.name
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {s.name} ({s.host ?? s.name})
            </Button>
          ))}
        </div>
      )}

      {/* Outgoing / Incoming toggle */}
      <div className="flex gap-2">
        {['OUTGOING', 'INCOMING'].map(dir => (
          <Button
            key={dir}
            onClick={() => setDirectionFilter(dir)}
            className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              directionFilter === dir
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
            }`}
          >
            {dir === 'OUTGOING' ? 'Outgoing' : 'Incoming'}
          </Button>
        ))}
      </div>

      {/* Route card */}
      <div
        data-observation-route={`${localHost}-${directionFilter}-${remoteHostLabel}`}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-500 tracking-wider">
          <span>{localHost}</span>
          <SemanticIcon className={`fa-solid ${directionFilter === 'OUTGOING' ? 'fa-arrow-right' : 'fa-arrow-left'} text-slate-400`} />
          <span>{remoteHostLabel}</span>
          <span className="ml-auto font-normal text-slate-400 normal-case tracking-normal">
            {filtered.length} {filtered.length === 1 ? 'observation' : 'observations'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            0 observations for {directionFilter.toLowerCase()} direction
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[900px]">
              <thead className="text-slate-500 text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3">Virtual machine</th>
                  <th className="px-5 py-3">Observation site</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">RPO</th>
                  <th className="px-5 py-3">Local site</th>
                  <th className="px-5 py-3">Remote site</th>
                  <th className="px-5 py-3">Last collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((obs, i) => (
                  <tr key={obs.rowKey ?? obs.id ?? i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-800">{formatNullable(obs.vmName)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatNullable(obs.observationSiteName)}</td>
                    <td className="px-5 py-3"><StatusBadge rep={obs} /></td>
                    <td className="px-5 py-3"><RpoBar rep={obs} /></td>
                    <td className="px-5 py-3 text-slate-600">{formatNullable(obs.localSiteName)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatNullable(obs.remoteSiteName)}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{formatDateTime(obs.lastCollectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DETAIL DRAWER CONTENT ───────────────────────────────────────────────────

function ReplicationDetail({ rep }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <h4 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Identity</h4>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500 text-xs">VM name</dt><dd className="font-medium text-slate-700">{formatNullable(rep.vmName)}</dd></div>
          <div><dt className="text-slate-500 text-xs">Replication name:</dt><dd className="font-medium text-slate-700">{rep.replicationNameAvailability === 'NOT_PROVIDED_BY_API' ? <em className="text-slate-400">Not provided by API</em> : formatNullable(rep.replicationName)}</dd></div>
          <div className="col-span-2"><dt className="text-slate-500 text-xs">Replication ID:</dt><dd className="font-mono text-xs text-slate-600 break-all">{formatNullable(rep.replicationId)}</dd></div>
        </dl>
      </div>

      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <h4 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Replication journey</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[10px] font-bold text-slate-400 tracking-wider mb-1">Source vCenter</p>
            <p className="font-semibold text-slate-800">{formatNullable(rep.logicalSourceVcenterName || rep.logicalSourceSiteName)}</p>
            <p className="font-mono text-xs text-slate-500">{formatNullable(rep.logicalSourceVcenterHost)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 tracking-wider mb-1">Target vCenter</p>
            <p className="font-semibold text-slate-800">{formatNullable(rep.logicalTargetVcenterName || rep.logicalTargetSiteName)}</p>
            <p className="font-mono text-xs text-slate-500">{formatNullable(rep.logicalTargetVcenterHost)}</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <h4 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Status &amp; Protection</h4>
        <ReplicationStatusNotice rep={rep} />
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500 text-xs">Normalized status</dt><dd className="font-medium">{formatNullable(rep.normalizedStatus)}</dd></div>
          <div><dt className="text-slate-500 text-xs">RPO (minutes)</dt><dd className="font-medium">{rep.rpo != null ? `${rep.rpo} min` : '—'}</dd></div>
          <div><dt className="text-slate-500 text-xs">Protection status</dt><dd className="font-medium">{rep.protectionStatus || 'Not protected'}</dd></div>
          <div><dt className="text-slate-500 text-xs">Protection group</dt><dd className="font-medium text-indigo-600">{rep.protectionGroupName || 'Not protected'}</dd></div>
          <div><dt className="text-slate-500 text-xs">Recovery plan</dt><dd className="font-medium text-indigo-600">{rep.recoveryPlanName || 'No recovery plan'}</dd></div>
          <div><dt className="text-slate-500 text-xs">Observation count</dt><dd className="font-medium">{rep.observationCount ?? '—'}</dd></div>
        </dl>
      </div>

      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <h4 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Replication server</h4>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500 text-xs">Server name</dt><dd className="font-medium">{formatNullable(rep.replicationServerName)}</dd></div>
          <div><dt className="text-slate-500 text-xs">API address</dt><dd className="font-mono text-xs">{formatNullable(rep.apiReportedServerAddress)}</dd></div>
          <div><dt className="text-slate-500 text-xs">VR appliance host</dt><dd className="font-mono text-xs">{formatNullable(rep.vrApplianceHost)}</dd></div>
          <div><dt className="text-slate-500 text-xs">Server resolution</dt><dd className="font-medium">{formatNullable(rep.serverResolutionStatus)}</dd></div>
        </dl>
      </div>

      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <h4 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Collection</h4>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500 text-xs">Last VR sync</dt><dd className="font-medium">{formatDateTime(rep.lastVrSyncAt)}</dd></div>
          <div><dt className="text-slate-500 text-xs">Last collected</dt><dd className="font-medium">{formatDateTime(rep.lastCollectedAt)}</dd></div>
          <div className="col-span-2"><dt className="text-slate-500 text-xs">VM MOID</dt><dd className="font-mono text-xs">{formatNullable(rep.vmMoid)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export default function ReplicationsTable({
  replications = [],
  observations = [],
  replicationsSummary,
  state: _state,
  viewMode = 'canonical',
}) {
  const [selected, setSelected] = useState(null);

  const isObservationMode = viewMode === 'observation';

  return (
    <>
      {isObservationMode ? (
        <ObservationView observations={observations} replicationsSummary={replicationsSummary} />
      ) : (
        <CanonicalTable replications={replications} onSelect={setSelected} />
      )}

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={`Replication: ${selected?.vmName ?? ''}`}
      >
        {selected && <ReplicationDetail rep={selected} />}
      </DetailDrawer>
    </>
  );
}
