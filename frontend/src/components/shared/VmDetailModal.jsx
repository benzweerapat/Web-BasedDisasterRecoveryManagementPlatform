import React, { useState, useEffect } from 'react';
import { 
  Copy, 
  Check, 
  ExternalLink,
  HardDrive,
  ArrowRight,
  Plus,
  X, 
} from 'lucide-react';
import { Link } from '../../router';
import { formatBytes, formatOptional } from '../../utils/formatters';
import { getVmPowerStatePresentation } from '../../utils/overview-severity';
import { StatusPill } from './Pills';
import ReplicationStatusNotice from './ReplicationStatusNotice';
import { getReplicationFeedback } from '../../utils/replicationFeedback';

function numericOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function formatCpuUsage(mhz) {
  if (mhz === null) return 'Not reported';
  if (mhz < 1000) return `${mhz.toLocaleString()} MHz`;
  return `${(mhz / 1000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} GHz`;
}

export default function VmDetailModal({ 
  open, 
  vm, 
  details, 
  loading, 
  onClose,
  inline = false,
  canCreateReplication = false,
}) {
  const [copiedIp, setCopiedIp] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !vm) return null;

  const data = details || vm;
  const power = getVmPowerStatePresentation(data.powerState);
  const powerBadgeClass = power.severity === 'HEALTHY'
    ? 'border-slate-200 bg-slate-100 text-slate-950'
    : power.className;
  
  // CPU metrics
  const cpuUsageMhz = numericOrNull(data.cpuUsageMhz);

  // Memory metrics
  const memoryUsageMib = numericOrNull(data.memoryUsageMib);
  const memUsedBytes = memoryUsageMib === null ? null : memoryUsageMib * 1048576;

  // Storage metrics
  const storageCommitted = numericOrNull(data.storageCommittedBytes);

  // Protection / DR info
  const isProtected = Boolean(data.isProtected) || data.protectionStatus === 'PROTECTED' || Boolean(data.protectionGroupName);
  const protectionGroupName = data.protectionGroupName || data.protection_group_name || null;
  const replications = Array.isArray(data.replications) ? data.replications : [];
  const primaryRep = replications[0] || null;
  const replicationFeedback = primaryRep ? getReplicationFeedback(primaryRep) : null;
  const targetDatastore = primaryRep?.targetDatastores?.[0] || null;
  const targetDatastoreName = targetDatastore?.name
    || primaryRep?.replicatedDiskSummary?.destinationDatastores?.[0]
    || null;
  const targetCapacityBytes = numericOrNull(targetDatastore?.capacityBytes);
  const targetFreeSpaceBytes = numericOrNull(targetDatastore?.freeSpaceBytes);
  const targetUsedBytes = targetCapacityBytes !== null && targetFreeSpaceBytes !== null
    ? Math.max(0, targetCapacityBytes - targetFreeSpaceBytes)
    : null;
  const targetUsedPercent = targetCapacityBytes > 0 && targetUsedBytes !== null
    ? Math.min(100, Math.max(0, (targetUsedBytes / targetCapacityBytes) * 100))
    : 0;
  const formatSrmSite = (site) => {
    const value = String(site || '').trim();
    if (!value) return '';
    if (/^srm(?:\s|-)/i.test(value)) return value.replace(/^srm\s+/i, 'srm-');
    return `srm-${value}`;
  };
  const sourceSrmSite = formatSrmSite(primaryRep?.sourceSiteName);
  const targetSrmSite = formatSrmSite(primaryRep?.targetSiteName);

  // Networks & IPs
  const primaryIp = data.primaryIp || null;
  const allIps = Array.isArray(data.ipAddresses) && data.ipAddresses.length > 0 
    ? [...new Set(data.ipAddresses.filter(Boolean))] 
    : (primaryIp ? [primaryIp] : []);
  const otherIps = allIps.filter(ip => ip !== primaryIp);

  // Datastores & Portgroups
  const datastores = Array.isArray(data.datastores) ? data.datastores : [];
  const networks = Array.isArray(data.networks) ? data.networks : [];
  const sourceVcenterHost = String(data.vcenterId || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  const createReplicationParams = new URLSearchParams({
    create: '1',
    vmId: String(data.vmId || data.id || ''),
    vmName: String(data.name || ''),
    vcenterId: String(data.vcenterId || ''),
    vcenterHost: sourceVcenterHost,
    step: 'target',
  });

  const handleCopy = (text) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedIp(text);
    setTimeout(() => setCopiedIp(null), 2500);
  };

  return (
    <div 
      className={inline
        ? 'w-full animate-in fade-in duration-150'
        : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150'}
      onClick={(e) => {
        if (!inline && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div 
        role={inline ? 'region' : 'dialog'}
        aria-modal={inline ? undefined : 'true'}
        aria-labelledby="vm-details-dialog-title"
        className={inline
          ? 'w-full bg-white overflow-hidden flex flex-col'
          : 'w-full max-w-4xl max-h-[92vh] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150'}
      >
        {/* The modal keeps its title bar; inline rows already show the VM name and state. */}
        {!inline && <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <h2 id="vm-details-dialog-title" className="text-base sm:text-lg font-bold text-slate-900 truncate">
                {formatOptional(data.name, 'Virtual machine')}
              </h2>
              
              {/* Power State */}
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium text-xs ${powerBadgeClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${power.dot}`} />
                {power.label}
              </span>

            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer shrink-0 ml-2"
          >
            <X size={20} />
          </button>
        </div>}

        {/* Scrollable Content */}
        <div className={inline ? 'px-6 sm:px-12 lg:px-24 py-3 space-y-3' : 'p-6 overflow-y-auto space-y-6'}>
          {loading && !details ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400 space-y-3">
              <p className="text-xs font-semibold text-slate-600">Loading...</p>
            </div>
          ) : (
            <>
              {/* Telemetry Rack (3 Gauges) */}
              <div className={`grid grid-cols-1 md:grid-cols-3 ${inline ? 'gap-3' : 'gap-4'}`}>
                {/* CPU Gauge */}
                <div className={`rounded-xl border border-[#8AC389] bg-white shadow-2xs ${inline ? 'p-3' : 'p-5'}`}>
                  <div className="flex min-w-0 items-baseline justify-between gap-4">
                    <span className="text-sm font-bold text-slate-900">CPU</span>
                    <div className="flex min-w-0 items-baseline gap-3 text-right">
                      <span className={`${inline ? 'text-lg' : 'text-xl'} truncate font-bold tracking-tight text-slate-900`}>
                        {formatCpuUsage(cpuUsageMhz)}
                      </span>
                      {cpuUsageMhz !== null && <span className="shrink-0 text-xs font-medium text-slate-500">used</span>}
                    </div>
                  </div>
                </div>

                {/* Memory Gauge */}
                <div className={`rounded-xl border border-[#8AC389] bg-white shadow-2xs ${inline ? 'p-3' : 'p-5'}`}>
                  <div className="flex min-w-0 items-baseline justify-between gap-4">
                    <span className="text-sm font-bold text-slate-900">Memory</span>
                    <div className="flex min-w-0 items-baseline gap-3 text-right">
                      <span className={`${inline ? 'text-lg' : 'text-xl'} truncate font-bold tracking-tight text-slate-900`}>
                        {memUsedBytes !== null ? formatBytes(memUsedBytes) : 'Not reported'}
                      </span>
                      {memUsedBytes !== null && <span className="shrink-0 text-xs font-medium text-slate-500">used</span>}
                    </div>
                  </div>
                </div>

                {/* Storage Gauge */}
                <div className={`rounded-xl border border-[#8AC389] bg-white shadow-2xs ${inline ? 'p-3' : 'p-5'}`}>
                  <div className="flex min-w-0 items-baseline justify-between gap-4">
                    <span className="text-sm font-bold text-slate-900">Storage</span>
                    <div className="flex min-w-0 items-baseline gap-3 text-right">
                      <span className={`${inline ? 'text-lg' : 'text-xl'} truncate font-bold tracking-tight text-slate-900`}>
                        {storageCommitted !== null ? formatBytes(storageCommitted) : 'Not reported'}
                      </span>
                      {storageCommitted !== null && <span className="shrink-0 text-xs font-medium text-slate-500">used</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2-Column Structured Data Grid */}
              <div className={`grid grid-cols-1 lg:grid-cols-2 ${inline ? 'gap-3' : 'gap-5'}`}>
                {/* Left Panel: Infrastructure */}
                <div className={`rounded-xl border border-black bg-white shadow-2xs ${inline ? 'p-3 space-y-2' : 'p-5 space-y-4'}`}>
                  <div className={`flex items-center justify-between border-b border-slate-100 ${inline ? 'pb-2' : 'pb-3'}`}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">Infrastructure</h3>
                    </div>
                  </div>

                  <div className={`${inline ? 'space-y-1' : 'space-y-3'} text-xs`}>
                    <div className="flex items-center justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        vCenter server
                      </span>
                      <span className="font-semibold text-slate-800 text-right truncate max-w-[220px]" title={data.vcenterName || data.vcenterId}>
                        {formatOptional(data.vcenterName || data.vcenterId, 'Not reported')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        Cluster
                      </span>
                      <span className="font-semibold text-slate-800 text-right truncate max-w-[220px]" title={data.cluster}>
                        {formatOptional(data.cluster, '-')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        ESXi host
                      </span>
                      <span className="font-mono font-semibold text-slate-800 text-right truncate max-w-[220px]" title={data.host}>
                        {formatOptional(data.host, 'Not reported')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        Resource pool
                      </span>
                      <span className="font-medium text-slate-700 text-right truncate max-w-[220px]" title={data.resourcePool}>
                        {formatOptional(data.resourcePool, 'Root')}
                      </span>
                    </div>

                    <div className="flex items-start justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-500 shrink-0">Guest OS</span>
                      <span className="font-medium text-slate-800 text-right max-w-[240px]">
                        {formatOptional(data.guestOs, 'Unknown guest OS')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <span className="text-slate-500">DNS name</span>
                      <span className="font-mono font-medium text-slate-700 text-right truncate max-w-[240px]" title={data.dnsName}>
                        {formatOptional(data.dnsName, 'Not configured')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Panel: Storage & Networking */}
                <div className={`rounded-xl border border-black bg-white shadow-2xs ${inline ? 'p-3 space-y-2' : 'p-5 space-y-4'}`}>
                  <div className={`flex items-center justify-between border-b border-slate-100 ${inline ? 'pb-2' : 'pb-3'}`}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">Storage & networking</h3>
                    </div>
                  </div>

                  <div className={`${inline ? 'space-y-1' : 'space-y-3'} text-xs`}>
                    <div className="flex items-center justify-between gap-4 py-1 border-b border-slate-50">
                      <span className="shrink-0 text-slate-500">IP address</span>
                      <span className="truncate text-right font-mono font-semibold text-slate-800" title={primaryIp || undefined}>
                        {formatOptional(primaryIp, 'No IP assigned')}
                      </span>
                    </div>

                    {otherIps.length > 0 && (
                      <div className="flex items-start justify-between gap-4 py-1 border-b border-slate-50">
                        <span className="shrink-0 text-slate-500">Additional addresses</span>
                        <div className="flex min-w-0 flex-col items-end gap-1">
                          {otherIps.map(ip => (
                            <button
                              key={ip}
                              type="button"
                              onClick={() => handleCopy(ip)}
                              className="flex max-w-[260px] cursor-pointer items-center gap-1.5 font-mono text-[11px] font-medium text-slate-700 transition-colors hover:text-[#FE5E37]"
                              title="Click to copy"
                            >
                              <span className="truncate">{ip}</span>
                              {copiedIp === ip ? <Check size={11} className="shrink-0 text-emerald-600" /> : <Copy size={11} className="shrink-0 opacity-50" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-4 py-1 border-b border-slate-50">
                      <span className="shrink-0 text-slate-500">Portgroups</span>
                      <span className="max-w-[260px] text-right font-medium text-slate-800" title={networks.join(', ')}>
                        {networks.length > 0 ? networks.join(', ') : 'No mappings collected'}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-4 py-1">
                      <span className="shrink-0 text-slate-500">Datastores</span>
                      <span className="max-w-[260px] text-right font-medium text-slate-800" title={datastores.join(', ')}>
                        {datastores.length > 0 ? datastores.join(', ') : 'No mappings collected'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {replications.length === 0 && canCreateReplication && (
                <div className="flex justify-end">
                  <Link
                    to={`/replications?${createReplicationParams.toString()}`}
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
                  >
                    <Plus size={14} />
                    Create replication
                  </Link>
                </div>
              )}

              {/* Disaster Recovery & Protection Status Strip */}
              {(isProtected || replications.length > 0 || protectionGroupName) && (
                <div className={`vm-detail-site-recovery rounded-xl border border-[#FE5E37] bg-white shadow-2xs ${inline ? 'p-3 space-y-3' : 'p-5 space-y-4'}`}>
                  <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 ${inline ? 'pb-2' : 'pb-3'}`}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">Site Recovery</h3>
                    </div>
                    <Link
                      to="/replications"
                      onClick={onClose}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#FE5E37] bg-white px-3 py-1.5 text-xs font-semibold text-[#FE5E37] transition-colors hover:bg-orange-50"
                    >
                      Open vSphere Replication
                      <ExternalLink size={13} />
                    </Link>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] table-fixed text-left text-xs">
                      <thead className="bg-slate-100 text-slate-800">
                        <tr>
                          <th className="w-[12%] px-4 py-3 font-bold">Status</th>
                          <th className="w-[9%] px-4 py-3 font-bold">RPO</th>
                          <th className="w-[15%] px-4 py-3 font-bold">Target datastore</th>
                          <th className="w-[19%] px-4 py-3 font-bold">Protection group</th>
                          <th className="w-[10%] px-4 py-3 font-bold">Status</th>
                          <th className="w-[24%] px-4 py-3 font-bold">Recovery plan</th>
                          <th className="w-[11%] px-4 py-3 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-100 text-slate-900">
                          <td className="px-4 py-4">
                            {primaryRep ? <StatusPill
                              status={replicationFeedback.severity === 'error' ? 'ERROR'
                                : replicationFeedback.severity === 'warning' ? 'WARNING'
                                  : replicationFeedback.isSyncing ? 'SYNCING'
                                    : primaryRep.rawStatus || primaryRep.status || 'UNKNOWN'}
                              label={replicationFeedback.statusLabel}
                            /> : null}
                          </td>
                          <td className="px-4 py-4 font-semibold tabular-nums">
                            {primaryRep?.rpoMinutes ? `${primaryRep.rpoMinutes} min` : ''}
                          </td>
                          <td className="px-4 py-4">
                            {targetDatastoreName ? (
                              <span className="inline-flex max-w-full rounded-md bg-slate-100 px-3 py-2 font-semibold text-slate-800">
                                <span className="truncate" title={targetDatastoreName}>{targetDatastoreName}</span>
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-4 font-semibold">
                            <span className="block truncate" title={protectionGroupName || undefined}>{protectionGroupName || ''}</span>
                          </td>
                          <td className="px-4 py-4">
                            {protectionGroupName ? <StatusPill status="OK" /> : null}
                          </td>
                          <td className="px-4 py-4 font-semibold">
                            <span className="block truncate" title={primaryRep?.recoveryPlanName || undefined}>
                              {primaryRep?.recoveryPlanName || ''}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            {primaryRep?.recoveryPlanName ? <StatusPill status="READY" /> : null}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <ReplicationStatusNotice rep={primaryRep} />

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)] text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                      <div className="mb-2 text-[11px] font-medium text-slate-500">Target datastore</div>
                      <div className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-4">
                        <div className="flex min-w-0 items-center justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <HardDrive size={16} strokeWidth={2} className="shrink-0 text-slate-900" />
                            <span className="truncate text-xs font-bold text-slate-900" title={targetDatastoreName || undefined}>
                              {targetDatastoreName || ''}
                            </span>
                          </div>
                          {targetFreeSpaceBytes !== null ? (
                            <div className="shrink-0 whitespace-nowrap text-[11px]">
                              <span className="font-medium text-slate-500">Free</span>
                              <span className="ml-2 font-bold text-slate-900">{formatBytes(targetFreeSpaceBytes)}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {targetCapacityBytes !== null && targetUsedPercent !== null ? (
                        <>
                          <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-4">
                            <div
                              className="ml-6.5 h-2 overflow-hidden rounded-full bg-slate-200"
                              role="progressbar"
                              aria-label="Target datastore used capacity"
                              aria-valuemin="0"
                              aria-valuemax="100"
                              aria-valuenow={Math.round(targetUsedPercent)}
                            >
                              <div
                                className="h-full rounded-full bg-[#FE5E37] transition-[width] duration-300"
                                style={{ width: `${targetUsedPercent}%` }}
                              />
                            </div>
                            <span className="min-w-12 text-right text-sm font-bold leading-none text-slate-900">
                              {Math.round(targetUsedPercent)}%
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-4 text-[11px]">
                            <div className="ml-6.5 flex min-w-0 items-center justify-between gap-4">
                              <div className="whitespace-nowrap">
                                <span className="font-medium text-slate-500">Used</span>
                                <span className="ml-2 font-bold text-slate-900">{formatBytes(targetUsedBytes)}</span>
                              </div>
                              <div className="whitespace-nowrap text-right">
                                <span className="font-medium text-slate-500">Total</span>
                                <span className="ml-2 font-bold text-slate-900">{formatBytes(targetCapacityBytes)}</span>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <div className="bg-slate-100 px-4 py-3 text-xs font-bold text-slate-900">Direction</div>
                      <div className="flex min-h-20 items-center gap-2 px-4 py-4 text-sm font-semibold text-slate-900">
                        {sourceSrmSite && targetSrmSite ? (
                          <>
                            <span className="truncate" title={sourceSrmSite}>{sourceSrmSite}</span>
                            <ArrowRight size={16} className="shrink-0 text-slate-600" aria-hidden="true" />
                            <span className="truncate" title={targetSrmSite}>{targetSrmSite}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
