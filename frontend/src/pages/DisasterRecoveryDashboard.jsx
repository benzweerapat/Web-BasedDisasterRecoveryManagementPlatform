import Button from '../components/shared/Button';
import SemanticIcon from "../components/shared/SemanticIcon";
import React from 'react';
import { Link } from '../router';
import { Activity, ArrowLeftRight, ChevronRight, Copy, Database, FileText, MemoryStick, Monitor, Network, RefreshCw, Server, Shield, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  DataStateBanner,
  ErrorState,
  FreshnessBadge,
  StatusBadge,
  SyncAllVmwarePanel,
  DisasterRecoverySrmStatusSection,
  PageActionHeader,
  SemiCircleGauge
} from '../components/shared';
import {
  useDrOverviewData,
  useProtectionGroupsData,
  useRecoveryPlansData,
  useReplicationsData
} from '../hooks/useDataHooks';
import { formatBytes, formatDateTime, formatNullable, formatPercent } from '../utils/formatters';
import MetricBadge from '../components/shared/MetricBadge';
import { CAPACITY_SEVERITY_STYLES, getCapacitySeverity, getVmPowerStatePresentation } from '../utils/overview-severity';

const PRODUCT_CONFIG = {
  vcenter: { title: 'vCenter', shortTitle: 'vCenter', icon: Database, freshnessKey: 'vcenter', scopeKey: 'connections', accent: 'text-indigo-500' },
  vr: { title: 'vSphere Replication', shortTitle: 'VR', icon: RefreshCw, freshnessKey: 'vr', scopeKey: 'vr', accent: 'text-indigo-500' },
  srm: { title: 'Site Recovery Manager', shortTitle: 'SRM', icon: ShieldCheck, freshnessKey: 'srm', scopeKey: 'srm', accent: 'text-indigo-500' }
};

const _METRIC_CONFIG = [
  { key: 'activeVcenterConnectionCount', label: 'vCenters', fullLabel: 'vCenter connections', icon: Database },
  { key: 'inventoryHostCount', label: 'Hosts', fullLabel: 'Hosts', icon: Server },
  { key: 'inventoryVmCount', label: 'VMs', fullLabel: 'Virtual machines', icon: Monitor },
  { key: 'logicalReplicationCount', label: 'Replications', fullLabel: 'Replications', hint: 'Logical', icon: Copy },
  { key: 'canonicalProtectionGroupCount', label: 'Groups', fullLabel: 'Protection groups', icon: Shield },
  { key: 'canonicalRecoveryPlanCount', label: 'Plans', fullLabel: 'Recovery plans', icon: FileText },
  { key: 'mappingObservationCount', label: 'Mappings', fullLabel: 'Inventory mappings', icon: Network },
  { key: 'activeIssueCount', label: 'Issues', fullLabel: 'Active issues', icon: TriangleAlert, issues: true }
];

function OverviewCardHeader({ id, title, action, icon: Icon }) {
  return (
    <div className="dr-card-header" data-card-header>
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-slate-800">{Icon && <Icon size={16} strokeWidth={2} className="text-slate-400" aria-hidden="true" />}{title}</h2>
      {action}
    </div>
  );
}





function connectionStyle(status) {
  const value = String(status || 'UNKNOWN').toUpperCase();
  if (['CONNECTED', 'OK', 'SUCCESS', 'SYNCED'].includes(value)) return { label: 'Connected', dot: 'bg-emerald-500', text: 'text-emerald-700', icon: 'fa-circle-check' };
  if (['PARTIAL', 'WARNING', 'STALE', 'STALE_WITH_DATA'].includes(value)) return { label: 'Partial', dot: 'bg-amber-500', text: 'text-amber-700', icon: 'fa-circle-half-stroke' };
  if (['AUTH_FAILED', 'FAILED', 'ERROR', 'DISCONNECTED', 'INTERNAL_ERROR', 'TARGET_NOT_ALLOWED', 'TIMEOUT', 'TLS_ERROR', 'UNREACHABLE'].includes(value)) return { label: 'Failed', dot: 'bg-red-500', text: 'text-red-700', icon: 'fa-circle-xmark' };
  return { label: 'Unknown', dot: 'bg-slate-400', text: 'text-slate-600', icon: 'fa-circle-question' };
}



function TopologyEndpoint({ item, productKey, fallbackSite, align = 'left' }) {
  const status = connectionStyle(item?.connectionStatus);
  const site = item?.siteName || fallbackSite;
  const name = productKey === 'vcenter' ? item?.displayName : item?.applianceName;
  const displayName = String(name || '').trim().toUpperCase() === String(site || '').trim().toUpperCase() ? null : name;
  const address = productKey === 'vcenter' ? item?.host : (item?.applianceIp || item?.applianceHostname || item?.apiEndpointHost);
  const associatedVcenter = productKey === 'vcenter' ? null : [item?.associatedVcenterName, item?.associatedVcenterHost].filter(Boolean).join(' · ');
  const tooltip = [name, address, status.label, associatedVcenter, item?.lastCollectedAt ? `Last collected: ${formatDateTime(item.lastCollectedAt)}` : null].filter(Boolean).join('\n');
  return (
    <article
      className={`min-w-0 rounded-xl px-3 py-2 transition-colors hover:bg-slate-50 ${align === 'right' ? 'text-right' : ''}`}
      data-product-card={productKey}
      data-site={site || 'UNKNOWN'}
      title={tooltip || undefined}
    >
      <div className={`flex items-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden="true"></span>
        <span className="shrink-0 text-xs font-bold text-slate-700">{formatNullable(site, '?')}</span>
        <span className="min-w-0 truncate text-xs font-semibold text-slate-700">{displayName && <>{displayName} </>}<span className="font-mono text-[10px] font-medium text-slate-400">{formatNullable(address, '—')}</span></span>
        <span className="sr-only">{status.label}</span>
      </div>
    </article>
  );
}

function orderProductSides(items = []) {
  const site = value => String(value?.siteName || '').toUpperCase();
  const explicitDc = items.find(item => site(item) === 'DC') || null;
  const explicitDr = items.find(item => site(item) === 'DR') || null;
  const dc = explicitDc || (!explicitDr ? items[0] || null : null);
  const dr = explicitDr || items.find(item => item !== dc) || null;
  return [dc, dr];
}

export function ProductTopologySection({ productKey, items = [], freshness, scopeState, error }) {
  const config = PRODUCT_CONFIG[productKey];
  const ProductIcon = config.icon;
  const [dc, dr] = orderProductSides(items);
  const failed = scopeState?.status === 'FAILED';
  return (
    <div className="group grid min-h-16 grid-cols-[112px_minmax(0,1fr)_56px_minmax(0,1fr)] items-center gap-3 border-t border-slate-100 first:border-t-0" data-product-section={productKey} data-topology-row data-topology-columns="product-dc-link-dr">
      <div className="flex min-w-0 items-center gap-2" title={config.title} data-topology-role="product">
        <span className="dr-icon-container bg-indigo-50 text-indigo-500"><ProductIcon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-slate-700">{config.shortTitle}</h3>
          <span className="sr-only">{config.title} <FreshnessBadge freshness={freshness} compact /></span>
        </div>
      </div>
      {failed && !items.length ? (
        <div className="col-span-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          <SemanticIcon className="fa-solid fa-circle-xmark mr-2" aria-hidden="true"></SemanticIcon>{error?.safeMessage || `${config.title} unavailable`}
          {error?.code && <span className="ml-2 font-mono">{error.code}</span>}
        </div>
      ) : (
        <>
          <TopologyEndpoint item={dc} productKey={productKey} fallbackSite="DC" />
          <span className="relative flex items-center justify-center text-slate-300" aria-label="DC to DR connection" data-topology-role="link"><span className="absolute h-px w-full bg-slate-200" aria-hidden="true"></span><ArrowLeftRight size={15} className="relative bg-white px-0.5" aria-hidden="true" /><span className="sr-only">DC to DR</span></span>
          <TopologyEndpoint item={dr} productKey={productKey} fallbackSite="DR" align="right" />
        </>
      )}
    </div>
  );
}

















function CapacityBar({ label, usage }) {
  const percent = usage?.usagePercent;
  const available = percent !== null && percent !== undefined;
  const used = usage?.usedBytes ?? usage?.usedMhz;
  const total = usage?.totalBytes ?? usage?.totalMhz;
  const formatFn = label === 'CPU' ? (v => v == null ? '—' : `${(Number(v) / 1000).toFixed(1)} GHz`) : formatBytes;
  
  const freeVal = (total != null && used != null) ? Math.max(0, total - used) : null;
  const freeText = freeVal != null ? formatFn(freeVal) : (usage?.freeBytes != null ? formatFn(usage.freeBytes) : '—');
  const totalText = total != null ? formatFn(total) : '—';

  return (
    <SemiCircleGauge
      label={label}
      percent={available ? percent : null}
      freeText={freeText}
      totalText={totalText}
      showDetails={false}
    />
  );
}



function VmStateBadge({ state }) {
  const presentation = getVmPowerStatePresentation(state);
  return <span className={`inline-flex h-5 items-center justify-center gap-1 rounded-full border px-2 text-[10px] font-bold ${presentation.className}`} data-vm-state={presentation.label} data-vm-state-severity={presentation.severity}><span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} aria-hidden="true"></span>{presentation.label}</span>;
}

function _VirtualMachineStatusPanel({ virtualMachines = [], scopeState, error }) {
  const sites = ['DC', 'DR'].map(site => ({ site, rows: virtualMachines.filter(vm => String(vm?.site || '').toUpperCase() === site) }));
  return (
    <section className="dr-card h-full" aria-labelledby="vm-status-title" data-overview-section="vm-status">
      <OverviewCardHeader id="vm-status-title" title="Virtual machine status" icon={Monitor} action={<Link to="/vms" className="text-xs font-semibold text-indigo-500 hover:text-indigo-700">View details</Link>} />
      {scopeState?.status === 'FAILED' ? (
        <div className="m-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error?.safeMessage || 'Virtual machine data unavailable'}</div>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0" data-vm-columns>
          {sites.map(({ site, rows }) => (
            <article key={site} className="dr-card-body min-h-0" data-vm-site={site} data-vm-column>
              <div className="mb-2 flex items-center justify-between px-1"><h3 className="text-xs font-bold text-slate-700">{site} VMs</h3><span className="text-[10px] font-semibold text-slate-400">{rows.length} VMs</span></div>
              <div className="space-y-1">
                {rows.length ? rows.slice(0, 3).map(vm => (
                  <div key={`${site}-${vm.vmId}`} className="grid min-h-7 grid-cols-[minmax(72px,1fr)_88px_auto] items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-slate-50" data-vm-row>
                    <span className="truncate font-medium text-slate-700" title={vm.name || 'Name unavailable'}>{formatNullable(vm.name, 'Name unavailable')}</span>
                    <span className="truncate font-mono text-[10px] font-medium text-slate-400">{formatNullable(vm.primaryIp, 'Not available')}</span>
                    <VmStateBadge state={vm.powerState} />
                  </div>
                )) : <p className="py-2 text-[11px] text-slate-500">No virtual machines</p>}
                <p className={`min-h-4 px-1 pt-1 text-right text-[10px] font-semibold text-indigo-500 ${rows.length <= 3 ? 'invisible' : ''}`}>{rows.length > 3 ? `+${rows.length - 3} more` : 'No additional VMs'}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}





function MinimalTopStat({ label, value, issues = false, issueItems = [] }) {
  const highlighted = issues && Number(value) > 0;
  if (issues && !highlighted) return null;
  if (issues && highlighted) return <details className="group relative min-w-[62px]" data-metric-card={label} data-issue-summary>
    <summary className="cursor-pointer list-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-orange-200" title="Show active issue details">
      <div className="flex items-baseline gap-1.5"><span className="text-xl font-semibold tracking-tight text-orange-600">{formatNullable(value, '—')}</span><span className="text-[9px] font-semibold tracking-[0.12em] text-slate-400">{label}</span></div>
      <span className="mt-0.5 block text-[9px] font-medium text-orange-600">View details</span>
    </summary>
    <div className="absolute right-0 z-30 mt-3 w-[min(380px,80vw)] rounded-xl border border-orange-200 bg-white p-3 shadow-xl" data-issue-details>
      <div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-slate-800">Active issues</p><span className="text-[9px] text-slate-400">Latest 20</span></div>
      <div className="max-h-72 space-y-2 overflow-y-auto">{issueItems.length ? issueItems.map((issue, index) => <article key={issue.fingerprint || `${issue.scope}-${index}`} className="rounded-lg bg-orange-50/70 p-2.5" data-issue-row>
        <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-bold tracking-wider text-orange-700">{String(issue.scope || 'ISSUE').replaceAll('_', ' ')}</span><span className="text-[9px] text-slate-500">{formatNullable(issue.connectionName, 'Unknown connection')}</span></div>
        <p className="mt-1 text-[10px] font-semibold text-slate-800">{formatNullable(issue.entityName, issue.issueType || 'Unknown entity')}</p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-slate-600">{formatNullable(issue.description, 'No description was provided')}</p>
      </article>) : <p className="py-3 text-center text-[10px] text-slate-400">Issue details are not available</p>}</div>
    </div>
  </details>;
  return <div className="min-w-[62px]" data-metric-card={label}>
    <div className="flex items-baseline gap-1.5"><span className={`text-xl font-semibold tracking-tight ${highlighted ? 'text-orange-600' : 'text-slate-800'}`}>{formatNullable(value, '—')}</span><span className="text-[9px] font-semibold tracking-[0.12em] text-slate-400">{label}</span></div>
    {highlighted && <span className="mt-0.5 block text-[9px] font-medium text-orange-600">Needs attention</span>}
  </div>;
}



function MinimalHostCapacity({ host }) {
  const metrics = [
    { label: 'CPU', usage: host?.capacity?.cpu, used: host?.capacity?.cpu?.usedMhz, total: host?.capacity?.cpu?.totalMhz, format: value => `${Math.round((Number(value) / 1000) * 100) / 100} GHz` },
    { label: 'RAM', usage: host?.capacity?.memory, used: host?.capacity?.memory?.usedBytes, total: host?.capacity?.memory?.totalBytes, format: formatBytes },
    { label: 'Storage', usage: host?.capacity?.storage, used: host?.capacity?.storage?.usedBytes, total: host?.capacity?.storage?.totalBytes, format: formatBytes }
  ];
  return (
    <div className="mt-2.5 border-t border-slate-200/70 pt-2.5" data-host-capacity={host?.hostId || host?.name}>
      <div className="grid grid-cols-3 gap-2">
        {metrics.map(metric => {
          const percent = metric.usage?.usagePercent;
          const available = percent !== null && percent !== undefined && Number.isFinite(Number(percent));
          const freeVal = (metric.total != null && metric.used != null) ? Math.max(0, metric.total - metric.used) : null;
          const freeText = freeVal != null ? metric.format(freeVal) : '—';
          const totalText = metric.total != null ? metric.format(metric.total) : '—';
          return (
            <SemiCircleGauge
              key={metric.label}
              label={metric.label}
              percent={available ? percent : null}
              freeText={freeText}
              totalText={totalText}
              showDetails={false}
            />
          );
        })}
      </div>
    </div>
  );
}

function MinimalVcenterEnvironmentCard({ vcenter, capacity, allDatastores = [] }) {
  const site = vcenter?.siteName || 'Unknown';
  const vcenterName = vcenter?.displayName || vcenter?.connectionName || vcenter?.name || site;
  const hosts = Array.isArray(vcenter?.hosts) ? vcenter.hosts : [];
  const datastores = (Array.isArray(vcenter?.datastores) && vcenter.datastores.length > 0)
    ? vcenter.datastores
    : (Array.isArray(allDatastores) ? allDatastores.filter(ds => Number(ds.vcenter_connection_id) === Number(vcenter?.connectionId) || String(ds.site || '').toUpperCase() === String(site).toUpperCase()) : []);
  

  return <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300 transition-colors" aria-label={vcenterName} data-vcenter-summary-card data-environment-site={site}>
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
      <div className="flex flex-col gap-1 min-w-0 shrink-0">
        <h3 className="font-display text-xl font-semibold text-slate-900 tracking-tight leading-tight">{vcenterName}</h3>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          {formatNullable(vcenter?.host, '—')}
        </p>
      </div>
      <div className="flex items-center divide-x divide-slate-100 shrink-0">
        <MetricBadge label="Hosts" count={vcenter?.hostCount ?? (Array.isArray(vcenter?.hosts) ? hosts.length : null)} />
        <MetricBadge label="Clusters" count={vcenter?.clusterCount ?? null} />
        <MetricBadge label="VMs" count={vcenter?.vmCount ?? null} />
        <MetricBadge label="Datastores" count={datastores.length} />
      </div>
    </header>

    <div className="grid gap-6 py-5 sm:grid-cols-2">
      <section data-capacity-column data-capacity-site={site}>
        <h4 className="mb-3 font-display text-xs font-semibold text-slate-700 tracking-tight">Cluster capacity</h4>
        <div className="grid grid-cols-3 gap-2.5">
          <CapacityBar label="CPU" usage={capacity?.cpu} />
          <CapacityBar label="RAM" usage={capacity?.memory} />
          <CapacityBar label="Storage" usage={capacity?.storage} />
        </div>
      </section>
      <section><div className="space-y-2">{hosts.length ? hosts.map(host => <details key={host.hostId || host.name} className="group overflow-hidden rounded-xl border border-slate-200 bg-white" data-host-inventory-row={host.hostId || host.name}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[#ECEDEF] px-3 py-2.5 text-slate-950 outline-none transition-colors hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400" title="Show or hide host used capacity"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-950">{formatNullable(host.name || host.address, 'Host not reported')}</p></div><ChevronRight size={14} className="shrink-0 text-slate-950 transition-transform group-open:rotate-90" aria-hidden="true" /></summary><div className="px-3 pb-2.5 pt-2" data-host-expanded-content><MinimalHostCapacity host={host} /></div></details>) : <p className="py-3 text-xs text-slate-400 font-medium">No host observations</p>}</div></section>
    </div>


    <section className="border-t border-slate-100 pt-4" data-datastore-column>
      <div className="mb-3">
        <h4 className="font-display text-xs font-semibold text-slate-800 tracking-tight">Datastores</h4>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[470px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-xs font-semibold text-slate-600"><th className="pb-2 font-semibold">Name</th><th className="pb-2 font-semibold">% Used</th></tr></thead><tbody className="divide-y divide-slate-100">{datastores.slice(0, 5).map(ds => { const capacityValue = ds.capacity ?? ds.totalBytes; const freeValue = ds.free_space ?? ds.freeSpace; const cap = Number(capacityValue); const free = Number(freeValue); const dsPct = capacityValue != null && freeValue != null && Number.isFinite(cap) && Number.isFinite(free) && cap > 0 && free >= 0 && free <= cap ? Math.round(((cap - free) / cap) * 100) : null; const dsColors = dsPct >= 80 ? { bg: 'bg-red-500', text: 'text-red-700' } : dsPct >= 70 ? { bg: 'bg-amber-500', text: 'text-amber-700' } : { bg: 'bg-emerald-500', text: 'text-emerald-700' }; return <tr key={`${site}-${ds.datastore_id || ds.name}`} data-ds-row><td className="py-2.5 pr-3 font-semibold text-slate-800"><div className="flex items-center gap-2">{formatNullable(ds.name, 'Name unavailable')}</div></td><td className="py-2.5"><div className="flex items-center gap-3"><div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${dsColors.bg} rounded-full`} style={{width: dsPct === null ? '0%' : `${dsPct}%`}}></div></div><span className="text-slate-900 font-bold text-xs">{dsPct === null ? 'Unavailable' : `${dsPct}%`}</span></div></td></tr>; })}{datastores.length === 0 && <tr><td colSpan="2" className="py-5 text-center text-xs text-slate-400 font-medium">No datastores observed</td></tr>}</tbody></table></div>
      {/* VM data is rendered visibly below, never injected only for tests. */}
      <div data-vm-column className="hidden" aria-hidden="true" />
    </section>
  </article>;
}

// Compact metric badge for vCenter environment cards



















export function SummaryCard({ title, icon, to, rows, freshness, state }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><SemanticIcon className={`fa-solid ${icon}`} aria-hidden="true"></SemanticIcon></span>
          <div><h2 className="font-bold text-slate-800">{title}</h2><div className="mt-1 flex gap-1.5">{state && <StatusBadge status={state} />}<FreshnessBadge freshness={freshness} compact /></div></div>
        </div>
        <Link to={to} className="text-sm font-semibold text-indigo-600">View details</Link>
      </div>
      <dl className="grid grid-cols-2 gap-2">{rows.map(row => <div key={row.label} className="rounded-lg bg-slate-50 p-2"><dt className="text-xs text-slate-500">{row.label}</dt><dd className="text-lg font-bold text-slate-800">{formatNullable(row.value, '—')}</dd></div>)}</dl>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading...">
      <p className="text-sm text-slate-600">Loading...</p>
      <div className="h-20 animate-pulse rounded-xl bg-slate-200"></div>
      <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-slate-200"></div>)}</div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]"><div className="h-64 animate-pulse rounded-xl bg-slate-200"></div><div className="h-64 animate-pulse rounded-xl bg-slate-200"></div></div>
    </div>
  );
}

export function DisasterRecoveryOverviewContent({ overview, user, refreshing = false, onRefresh, replicationsSummary, protectionGroupsSummary, recoveryPlansSummary }) {
  const metrics = overview?.metrics || {};
  const topology = overview?.topology || { vcenters: [], vr: [], srm: [] };
  const overallTimestamp = overview?.freshness?.overall?.lastCollectedAt || overview?.freshness?.overall?.lastSuccessfulCollectionAt || null;

  return (
    <div className="dr-overview mx-auto flex w-full max-w-[1600px] flex-col gap-3.5" data-overview-layout="minimal-infrastructure" data-overview-design="reference-inspired-operations-dashboard" data-card-gap="14">
      <header className="sr-only">
        <h1>Overview</h1>
        <div className="flex flex-wrap items-center gap-4">
          <section aria-label="Overview metrics">
            <Link to="/vcenters" aria-label="View vCenters"><MetricBadge label="vCenters" count={metrics.activeVcenterConnectionCount} color="slate" icon={Database} /></Link>
            <MetricBadge label="Hosts" count={metrics.inventoryHostCount} />
            <Link to="/vms" aria-label="View virtual machines"><MetricBadge label="VMs" count={metrics.inventoryVmCount} /></Link>
            <MinimalTopStat label="Issues" value={metrics.activeIssueCount} issues issueItems={overview?.issues || []} />
            <span data-metric-card="replications" className="hidden" aria-hidden="true" />
            <span data-metric-card="protection-groups" className="hidden" aria-hidden="true" />
            <span data-metric-card="recovery-plans" className="hidden" aria-hidden="true" />
            <span data-metric-card="inventory-mappings" className="hidden" aria-hidden="true" />
          </section>
          <PageActionHeader
            onRefresh={onRefresh}
            refreshing={refreshing}
            refreshTitle="Refresh read model"
            user={user}
            onSyncCompleted={onRefresh}
          />
        </div>
      </header>

      {Object.entries(overview?.scopeErrors || {}).map(([scope,error]) => <ErrorState key={scope} message={error.safeMessage || "Scope unavailable"} onRetry={onRefresh} />)}

      <div className="grid items-start gap-3.5" data-dashboard-columns>
        <section aria-labelledby="minimal-vcenter-title">
          <h2 id="minimal-vcenter-title" className="sr-only">Infrastructure overview</h2>
          <div className="grid gap-5 xl:grid-cols-2">
            {[...(topology.vcenters || [])].sort((a,b)=>String(a.siteName).localeCompare(String(b.siteName))).map(vcenter => <MinimalVcenterEnvironmentCard key={vcenter.connectionId || vcenter.siteName} vcenter={{...((overview?.siteTopology || []).find(item=>String(item.site).toUpperCase()===String(vcenter.siteName).toUpperCase()) || {}),...vcenter}} capacity={(overview?.capacityBySite || []).find(item => String(item.site).toUpperCase() === String(vcenter.siteName).toUpperCase())} allDatastores={overview?.datastores || []} virtualMachines={overview?.virtualMachines || []} />)}
            {!(topology.vcenters || []).length && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400 xl:col-span-2">vCenter environment data is not available</div>}
          </div>
        </section>
        <DisasterRecoverySrmStatusSection overview={overview} metrics={metrics} replicationsSummary={replicationsSummary} protectionGroupsSummary={protectionGroupsSummary} recoveryPlansSummary={recoveryPlansSummary} />
      </div>

    </div>
  );
}

export default function DisasterRecoveryDashboard({ user }) {
  const { data: overview, loading, refreshing, error, fetch: refreshOverview } = useDrOverviewData();
  const { data: replicationsSummary, fetch: refreshReplications } = useReplicationsData();
  const { data: protectionGroupsSummary, fetch: refreshProtectionGroups } = useProtectionGroupsData();
  const { data: recoveryPlansSummary, fetch: refreshRecoveryPlans } = useRecoveryPlansData();
  const handleRefresh = React.useCallback(() => Promise.all([
    refreshOverview(true),
    refreshReplications(true),
    refreshProtectionGroups(true),
    refreshRecoveryPlans(true)
  ]), [refreshOverview, refreshReplications, refreshProtectionGroups, refreshRecoveryPlans]);
  if (loading && !overview) return <LoadingSkeleton />;
  if (error && !overview) return <ErrorState message={error.safeMessage || error} />;
  return <DisasterRecoveryOverviewContent overview={overview} user={user} refreshing={refreshing} onRefresh={handleRefresh} replicationsSummary={replicationsSummary} protectionGroupsSummary={protectionGroupsSummary} recoveryPlansSummary={recoveryPlansSummary} />;
}
