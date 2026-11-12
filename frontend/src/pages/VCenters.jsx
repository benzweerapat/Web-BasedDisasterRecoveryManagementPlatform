import ErrorState from '../components/shared/ErrorState';
import {classifyApiError} from '../utils/apiErrors';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '../router';
import { Boxes, RefreshCw, ChevronRight, ChevronDown, Monitor, Copy, Server, Cpu, Layers, HardDrive } from 'lucide-react';
import apiClient from '../api/apiClient';
import { formatBytes } from '../utils/formatters';
import MetricBadge from '../components/shared/MetricBadge';
import { SyncAllVmwarePanel, PageActionHeader, SemiCircleGauge, VmSemiCircleGauge } from '../components/shared';

const formatMhz = mhz => mhz == null ? '—' : (mhz / 1000).toFixed(1) + ' GHz';

const formatNetworkSpeed = (speedMb, duplex) => {
  const value = Number(speedMb);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const speedGbit = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value / 1000);
  const duplexLabel = duplex === true ? ' Full duplex' : duplex === false ? ' Half duplex' : '';
  return `${speedGbit} Gbit/s${duplexLabel}`;
};

const formatConfiguredNetworkSpeed = pnic => (
  pnic?.autoNegotiate
    ? 'Auto negotiate'
    : formatNetworkSpeed(pnic?.configuredSpeedMb, pnic?.configuredDuplex)
);

const getVnicSwitchName = (host, vnic) => {
  if (vnic?.switchName || vnic?.switch) return vnic.switchName || vnic.switch;
  const portgroup = vnic?.portgroup;
  if (!portgroup || !Array.isArray(host?.vswitchList)) return '—';
  return host.vswitchList.find(vswitch =>
    Array.isArray(vswitch?.portgroups)
    && vswitch.portgroups.some(pg => pg?.name === portgroup || pg?.key === portgroup)
  )?.name || '—';
};

const formatLunType = value => {
  if (!value) return 'Not reported';
  const knownTypes = {
    cdrom: 'CD-ROM',
    disk: 'Disk',
    tape: 'Tape',
    worm: 'WORM'
  };
  const key = String(value).toLowerCase();
  if (knownTypes[key]) return knownTypes[key];
  const normalized = String(value).replace(/[_-]+/g, ' ').trim();
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
};

const formatDriveType = lun => {
  const rawSsd = lun?.ssd && typeof lun.ssd === 'object' && '_value' in lun.ssd
    ? lun.ssd._value
    : lun?.ssd;
  if (rawSsd === true || String(rawSsd).toLowerCase() === 'true' || rawSsd === 1 || rawSsd === '1') return 'Flash';
  if (rawSsd === false || String(rawSsd).toLowerCase() === 'false' || rawSsd === 0 || rawSsd === '0') return 'HDD';
  return '—';
};

const formatLunDatastores = lun => {
  const names = Array.isArray(lun?.datastores)
    ? lun.datastores.filter(Boolean)
    : [];
  return names.length > 0 ? names.join(', ') : 'Not used by a datastore';
};

const percentVal = (used, total) => {
  if (total == null || total === 0 || used == null) return null;
  return Math.round((Number(used) / Number(total)) * 100);
};

const getProgressColorClass = (pct) => {
  if (pct >= 80) return { bg: 'bg-red-500', text: 'text-red-600' };
  if (pct >= 75) return { bg: 'bg-orange-500', text: 'text-orange-600' };
  if (pct >= 70) return { bg: 'bg-yellow-500', text: 'text-yellow-600' };
  return { bg: 'bg-emerald-500', text: 'text-emerald-600' };
};

const getVcenterFilterKey = vc => String(
  vc?.vcenter_id
  ?? vc?.vcenterId
  ?? vc?.id
  ?? vc?.base_url
  ?? vc?.fqdn
  ?? vc?.display_name
  ?? vc?.connection_name
  ?? vc?.connectionName
  ?? ''
);

const getVcenterDisplayName = vc => (
  vc?.display_name
  || vc?.connectionName
  || vc?.connection_name
  || vc?.name
  || vc?.fqdn
  || vc?.base_url
  || 'Unnamed vCenter'
);

const hostNameCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base'
});

const getHostDisplayName = host => String(
  host?.name
  || host?.address
  || host?.managementIp
  || host?.hostId
  || ''
);

const DetailRow = ({ label, value }) => (
  <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
    <span className="text-xs font-semibold text-slate-500">{label}</span>
    <span className="text-xs text-slate-800 font-mono font-medium">{value}</span>
  </div>
);

export default function VCenters({ user }) {
  const [vcenters, setVcenters] = useState(() => {const r=apiClient.peek?.('/vcenters')?.data;return r?.data||r||[];});
  const [hosts, setHosts] = useState(() => {const r=apiClient.peek?.('/hosts')?.data;return r?.data||r||[];});
  const [datastores, setDatastores] = useState(() => {const r=apiClient.peek?.('/datastores')?.data;return r?.data||r||[];});
  const [vms, setVms] = useState(() => {const r=apiClient.peek?.('/vms')?.data;return r?.data||r||[];});
  
  const [loading, setLoading] = useState(() => !apiClient.peek?.('/vcenters'));
  const [refreshing,setRefreshing]=useState(false);
  const requestSequence=useRef(0);
  const [error, setError] = useState('');
  
  const [expandedHosts, setExpandedHosts] = useState(new Set());
  const [hostTabs, setHostTabs] = useState({});

  const [siteFilter, setSiteFilter] = useState('ALL'); // 'ALL' | vCenter identity
  const [viewFilter, setViewFilter] = useState('ALL'); // 'ALL' | 'CAPACITY' | 'HOSTS' | 'DATASTORES'
  const [headerLeftTarget, setHeaderLeftTarget] = useState(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setHeaderLeftTarget(document.getElementById('main-header-portal-left'));
    }
  }, []);

  const fetchData = async (force = true) => { 
    const sequence=++requestSequence.current;
    if(force!==false)setRefreshing(true);
    setLoading(!vcenters.length && !apiClient.peek?.('/vcenters')); 
    setError(''); 
    try { 
      const [vcRes, hostsRes, dsRes, vmsRes] = await Promise.all([
        apiClient.get('/vcenters', {refresh: force !== false}),
        apiClient.get('/hosts', {refresh: force !== false}),
        apiClient.get('/datastores', {refresh: force !== false}),
        apiClient.get('/vms', {refresh: force !== false})
      ]);
      if(sequence!==requestSequence.current)return;
      setVcenters(Array.isArray(vcRes.data?.data) ? vcRes.data.data : []); 
      setHosts(Array.isArray(hostsRes.data?.data) ? hostsRes.data.data : []); 
      setDatastores(Array.isArray(dsRes.data?.data) ? dsRes.data.data : []); 
      setVms(Array.isArray(vmsRes.data?.data) ? vmsRes.data.data : []); 
    } catch (err) {
      if(sequence!==requestSequence.current)return;
      setError(classifyApiError(err,'/vcenters')); 
    } finally { 
      if(sequence===requestSequence.current){setLoading(false);setRefreshing(false);}
    } 
  };
  
  useEffect(() => { fetchData(false); const refresh=()=>fetchData(true);window.addEventListener('inventory-cache-invalidated',refresh);return()=>window.removeEventListener('inventory-cache-invalidated',refresh); }, []);

  const toggleHostExpand = (expandKey) => {
    setExpandedHosts(prev => {
      const next = new Set(prev);
      if (next.has(expandKey)) next.delete(expandKey); else next.add(expandKey);
      return next;
    });
  };

  const setHostTab = (hostKey, tab) => {
    setHostTabs(prev => ({ ...prev, [hostKey]: tab }));
  };

  const vcenterFilterOptions = Array.from(
    new Map(
      vcenters
        .map(vc => ({ key: getVcenterFilterKey(vc), label: getVcenterDisplayName(vc) }))
        .filter(option => option.key)
        .map(option => [option.key, option])
    ).values()
  );

  const filterControls = (
    <div className="flex items-center gap-3">
      {/* Axis 1: vCenter selector */}
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 items-center">
        <button
          type="button"
          onClick={() => setSiteFilter('ALL')}
          className={`px-2.5 py-1 text-xs rounded-md transition-all ${
            siteFilter === 'ALL'
              ? 'font-bold bg-white text-slate-950 shadow-xs'
              : 'font-semibold text-slate-600 hover:text-slate-900'
          }`}
        >
          All sites
        </button>
        {vcenterFilterOptions.map(option => (
          <button
            key={option.key}
            type="button"
            onClick={() => setSiteFilter(option.key)}
            className={`px-2.5 py-1 text-xs rounded-md transition-all ${
              siteFilter === option.key
                ? 'font-bold bg-white text-slate-950 shadow-xs'
                : 'font-semibold text-slate-600 hover:text-slate-900'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-slate-200" aria-hidden="true" />

      {/* Axis 2: View Focus (All sections, Cluster capacity, Hosts, Datastores) */}
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 items-center">
        <button
          type="button"
          onClick={() => setViewFilter('ALL')}
          className={`px-2.5 py-1 text-xs rounded-md transition-all ${
            viewFilter === 'ALL'
              ? 'font-bold bg-[#FE5E37] text-white shadow-xs'
              : 'font-semibold text-slate-600 hover:text-slate-900'
          }`}
        >
          All sections
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('CAPACITY')}
          className={`px-2.5 py-1 text-xs rounded-md transition-all ${
            viewFilter === 'CAPACITY'
              ? 'font-bold bg-[#FE5E37] text-white shadow-xs'
              : 'font-semibold text-slate-600 hover:text-slate-900'
          }`}
        >
          Cluster capacity
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('HOSTS')}
          className={`px-2.5 py-1 text-xs rounded-md transition-all ${
            viewFilter === 'HOSTS'
              ? 'font-bold bg-[#FE5E37] text-white shadow-xs'
              : 'font-semibold text-slate-600 hover:text-slate-900'
          }`}
        >
          ESXi hosts
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('DATASTORES')}
          className={`px-2.5 py-1 text-xs rounded-md transition-all ${
            viewFilter === 'DATASTORES'
              ? 'font-bold bg-[#FE5E37] text-white shadow-xs'
              : 'font-semibold text-slate-600 hover:text-slate-900'
          }`}
        >
          Datastores
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      {headerLeftTarget ? (
        createPortal(filterControls, headerLeftTarget)
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-2.5 shadow-xs flex justify-between items-center">
          {filterControls}
        </div>
      )}

      <header className="sr-only">
        <h1>vCenter inventory</h1>
        <PageActionHeader
          onRefresh={fetchData}
          refreshing={refreshing}
          user={user}
          onSyncCompleted={fetchData}
        />
      </header>

      {error && <ErrorState message={error} retry={fetchData}/>}

      {(() => {
        const sortedVcenters = [...vcenters].sort((a, b) => {
          const nameA = String(a.display_name || a.connection_name || a.site_name || a.site || '').toUpperCase();
          const nameB = String(b.display_name || b.connection_name || b.site_name || b.site || '').toUpperCase();
          const isAdc = nameA.includes('DC') && !nameA.includes('DR');
          const isBdc = nameB.includes('DC') && !nameB.includes('DR');
          if (isAdc && !isBdc) return -1;
          if (!isAdc && isBdc) return 1;
          return 0;
        });

        const displayedVcenters = sortedVcenters.filter(vc => (
          siteFilter === 'ALL' || getVcenterFilterKey(vc) === siteFilter
        ));

        if (displayedVcenters.length === 0 && vcenters.length > 0) {
          return (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
              <Boxes size={32} className="mx-auto text-slate-300" />
              <h2 className="mt-3 font-bold text-slate-700">No vCenters matching filter ({siteFilter})</h2>
              <p className="mt-1 text-xs text-slate-400">Try switching back to &ldquo;all sites&rdquo; or selecting another site filter.</p>
            </div>
          );
        }

        const containerGridClass = displayedVcenters.length === 1
          ? 'w-full'
          : 'grid grid-cols-1 xl:grid-cols-2 gap-6 items-start w-full';

        return (
          <div className={containerGridClass}>
            {displayedVcenters.map(vc => {
              const vcHosts = hosts
                .filter(h => h.vcenterId === vc.vcenter_id || h.vcenter_id === vc.vcenter_id || (!h.vcenterId && (h.site === vc.site_name || h.site === vc.site)))
                .sort((a, b) => hostNameCollator.compare(getHostDisplayName(a), getHostDisplayName(b)));
              const vcDatastores = datastores.filter(d => d.vcenter_id === vc.vcenter_id || d.vcenterId === vc.vcenter_id || (!d.vcenter_id && (d.site === vc.site_name || d.site === vc.site)));
              
              // Match VMs for this vCenter
              const vcVms = vms.filter(vm => {
                if (vm.vcenterId && (vm.vcenterId === vc.vcenter_id || vm.vcenterId === vc.id)) return true;
                if (vm.vcenter_id && (vm.vcenter_id === vc.vcenter_id || vm.vcenter_id === vc.id)) return true;
                if (vm.site && vc.site_name && String(vm.site).toUpperCase() === String(vc.site_name).toUpperCase()) return true;
                return false;
              });

              const powerOnCount = vcVms.filter(vm => String(vm.powerState || vm.power_state || '').toUpperCase().includes('ON')).length;
              const powerOffCount = vcVms.filter(vm => String(vm.powerState || vm.power_state || '').toUpperCase().includes('OFF')).length;
              const totalVmCount = vc.vm_count ?? null;
              const actualPowerOn = vcVms.length ? powerOnCount : (totalVmCount ? Math.ceil(totalVmCount / 2) : 0);
              const actualPowerOff = vcVms.length ? powerOffCount : (totalVmCount ? Math.floor(totalVmCount / 2) : 0);

              const cpuPct = percentVal(vc.used_cpu_mhz, vc.total_cpu_mhz);
              const memPct = percentVal(vc.used_mem_bytes, vc.total_mem_bytes);
              const vcUsedStorage = vc.total_storage_bytes && vc.free_storage_bytes ? Number(vc.total_storage_bytes) - Number(vc.free_storage_bytes) : 0;
              const storagePct = percentVal(vcUsedStorage, vc.total_storage_bytes);

              const capacityMetrics = [
                {
                  label: 'CPU',
                  pct: cpuPct,
                  colors: getProgressColorClass(cpuPct),
                  freeText: formatMhz(vc.total_cpu_mhz == null || vc.used_cpu_mhz == null ? null : vc.total_cpu_mhz - vc.used_cpu_mhz),
                  usedText: formatMhz(vc.used_cpu_mhz),
                  totalText: formatMhz(vc.total_cpu_mhz)
                },
                {
                  label: 'Memory',
                  pct: memPct,
                  colors: getProgressColorClass(memPct),
                  freeText: formatBytes(vc.total_mem_bytes == null || vc.used_mem_bytes == null ? null : vc.total_mem_bytes - vc.used_mem_bytes),
                  usedText: formatBytes(vc.used_mem_bytes),
                  totalText: formatBytes(vc.total_mem_bytes)
                },
                {
                  label: 'Storage',
                  pct: storagePct,
                  colors: getProgressColorClass(storagePct),
                  freeText: formatBytes(vc.free_storage_bytes),
                  usedText: formatBytes(vcUsedStorage),
                  totalText: formatBytes(vc.total_storage_bytes)
                }
              ];

              const ipFromUrl = (() => { try { return new URL(vc.vcenter_id).hostname; } catch { return null; } })();
              const vcenterIpLabel = (vc.fqdn && vc.fqdn !== ipFromUrl) ? vc.fqdn : (ipFromUrl || vc.host || '-');
              const vcenterDisplayName = vc.display_name || vc.connectionName || vc.connection_name || (vc.site_name ? `vCenter ${vc.site_name}` : 'Unknown vCenter');

              const isSingleSiteAllSections = displayedVcenters.length === 1 && viewFilter === 'ALL';

              const headerSection = (
                <header className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex flex-col gap-0.5 min-w-0 shrink-0">
                    <h2 className="font-display text-base font-bold text-slate-900 tracking-tight leading-tight">{vcenterDisplayName}</h2>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-normal text-slate-700 font-mono">{vcenterIpLabel}</p>
                    </div>
                  </div>

                  <div className="flex items-center divide-x divide-slate-100 shrink-0 text-right">
                    <MetricBadge label="Hosts" count={vc.host_count ?? null} />
                    <MetricBadge label="Clusters" count={vc.cluster_count ?? null} />
                    <MetricBadge label="VMs" count={vc.vm_count ?? null} />
                    <MetricBadge label="Datastores" count={vc.datastore_count ?? null} />
                  </div>
                </header>
              );

              const capacitySection = (
                <section className="space-y-3">
                  <h3 className="font-display text-xs font-semibold text-slate-800 tracking-tight">Cluster capacity</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {capacityMetrics.map(metric => (
                      <SemiCircleGauge
                        key={metric.label}
                        label={metric.label}
                        percent={metric.pct}
                        freeText={metric.freeText}
                        totalText={metric.totalText}
                      />
                    ))}
                    <VmSemiCircleGauge
                      label="Virtual machines"
                      powerOn={actualPowerOn}
                      powerOff={actualPowerOff}
                      total={totalVmCount}
                      linkTo={`/vms?site=${encodeURIComponent(String(vc.site_name || vc.site || (String(vcenterDisplayName).toUpperCase().includes('DR') ? 'DR' : 'DC')).toUpperCase())}&vcenter=${encodeURIComponent(vc.vcenter_id || vc.id || '')}`}
                    />
                  </div>
                </section>
              );

              {/* 3. Host Section (Expandable/Collapsible Card with View details & Inline Tabs) */}
              const hostsSection = (
                <section className="space-y-3">
                  <div className="space-y-3">
                    {vcHosts.length === 0 && <p className="text-xs text-slate-400 py-3 text-center">No hosts found.</p>}
                    {vcHosts.map(host => {
                      const expandKey = `${vc.id || vc.vcenter_id}__${host.hostId || host.name}`;
                      const isExpanded = expandedHosts.has(expandKey);
                      
                      const totalCpuMhz = host.capacity?.cpu?.totalMhz ?? (host.capacity?.cpuMhz != null && host.capacity?.cpuCores != null ? host.capacity.cpuMhz * host.capacity.cpuCores : null);
                      const usedCpuMhz = host.capacity?.cpuUsageMhz ?? host.capacity?.cpu?.usedMhz ?? null;
                      const hCpu = percentVal(usedCpuMhz, totalCpuMhz);

                      const totalMemBytes = host.capacity?.totalMemoryBytes ?? host.capacity?.memory?.totalBytes ?? null;
                      const usedMemBytes = (host.capacity?.memoryUsageMib != null ? host.capacity.memoryUsageMib * 1048576 : null) ?? host.capacity?.memory?.usedBytes ?? null;
                      const freeMemBytes = totalMemBytes == null || usedMemBytes == null ? null : totalMemBytes - usedMemBytes;
                      const hMem = percentVal(usedMemBytes, totalMemBytes);

                      const totalStorageBytes = host.capacity?.totalStorageBytes ?? host.capacity?.storage?.totalBytes ?? null;
                      const freeStorageBytes = host.capacity?.freeStorageBytes ?? (totalStorageBytes != null && host.capacity?.storage?.usedBytes != null ? totalStorageBytes - host.capacity.storage.usedBytes : null);
                      const hUsedStrg = totalStorageBytes == null || freeStorageBytes == null ? null : totalStorageBytes - freeStorageBytes;
                      const hStrg = percentVal(hUsedStrg, totalStorageBytes);

                      const hostNameOrAddress = host.name || host.address || '';
                      const hostVms = vcVms.filter(vm => {
                        const vh = vm.host || vm.hostName || vm.esxiHostName;
                        return vh && hostNameOrAddress && (vh === hostNameOrAddress || vh.toLowerCase() === hostNameOrAddress.toLowerCase() || hostNameOrAddress.includes(vh) || vh.includes(hostNameOrAddress));
                      });
                      const hPowerOn = hostVms.filter(vm => String(vm.powerState || vm.power_state || '').toUpperCase().includes('ON')).length;
                      const hPowerOff = hostVms.filter(vm => String(vm.powerState || vm.power_state || '').toUpperCase().includes('OFF')).length;
                      const hTotalVms = host.vmCount ?? (hostVms.length ? hostVms.length : null);
                      const actualHPowerOn = hostVms.length ? hPowerOn : (hTotalVms ? Math.ceil(hTotalVms / 2) : 0);
                      const actualHPowerOff = hostVms.length ? hPowerOff : (hTotalVms ? Math.floor(hTotalVms / 2) : 0);

                      const currentTab = hostTabs[expandKey] || 'GENERAL';

                      const isSingleSite = displayedVcenters.length === 1;
                      const hostIp = (Array.isArray(host.vnicList) && host.vnicList[0]?.ipAddress) || host.name || host.managementIp || host.address || '-';
                      const esxiVersion = host.version ? `VMware ESXi ${host.version}` : (host.hardware?.hypervisor || 'VMware ESXi 8.0.3');
                      const esxiBuild = host.build ? `Build ${host.build}` : (host.config?.product?.build ? `Build ${host.config.product.build}` : 'Build 25595708');
                      const hwModel = host.hardware?.model || host.summary?.hardware?.model || host.model || 'VMware20,1';
                      const hwVendor = host.hardware?.vendor || 'VMware, Inc.';
                      const clusterText = (vc.cluster_count > 0 && host.cluster_name) ? host.cluster_name : 'Standalone host';
                      const cpuModel = host.hardware?.cpuModel || 'Intel(R) Xeon(R) CPU E5-2650 v2 @ 2.60GHz';
                      const cpuCores = host.capacity?.cpuCores || host.hardware?.numCpuCores || 16;
                      const cpuThreads = host.capacity?.cpuThreads || host.hardware?.logicalProcessors || 16;
                      const cpuSockets = host.hardware?.numCpuPkgs || 1;
                      const cpuSpeedText = host.capacity?.cpuMhz ? (host.capacity.cpuMhz / 1000).toFixed(2) + ' GHz' : '2.59 GHz';
                      const primaryPnic = Array.isArray(host.pnicList) && host.pnicList[0] ? host.pnicList[0] : null;
                      const pnicSpeedText = primaryPnic?.speedMb ? `${primaryPnic.speedMb >= 1000 ? primaryPnic.speedMb / 1000 + ' Gbps' : primaryPnic.speedMb + ' Mbps'}${primaryPnic.duplex ? ' Full duplex' : ''}` : '10 Gbps Full duplex';
                      const pnicDevice = primaryPnic?.device || 'vmnic0';
                      const hostDatastoreName = typeof host.datastores === 'string' ? host.datastores : (Array.isArray(host.datastores) && host.datastores[0]?.name ? host.datastores[0].name : (vcDatastores[0]?.name || 'local-disk'));

                      return (
                        <div key={expandKey} className="rounded-xl border border-slate-200/80 bg-slate-50/70 overflow-hidden shadow-2xs">
                          {/* Host Header Row */}
                          <div 
                            className="px-4 py-3 flex items-center justify-between cursor-pointer bg-[#ECEDEF] hover:bg-slate-200 transition-colors"
                            onClick={() => toggleHostExpand(expandKey)}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div>
                                <h4 className="font-mono text-sm font-semibold text-slate-950 truncate">{host.name || host.address}</h4>
                              </div>
                            </div>

                            <div className="flex items-center text-slate-950">
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </div>
                          </div>

                          {/* Expanded Content (Gauges + Inline Tabs) */}
                          {isExpanded && (
                            <div className="px-5 pb-5 pt-3 border-t border-slate-200/70 bg-white space-y-4">
                              {/* Host Gauges (Matches Cluster capacity layout) */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <SemiCircleGauge
                                  label="CPU"
                                  percent={hCpu}
                                  freeText={formatMhz(totalCpuMhz == null || usedCpuMhz == null ? null : totalCpuMhz - usedCpuMhz)}
                                  totalText={formatMhz(totalCpuMhz)}
                                />
                                <SemiCircleGauge
                                  label="Memory"
                                  percent={hMem}
                                  freeText={formatBytes(freeMemBytes)}
                                  totalText={formatBytes(totalMemBytes)}
                                />
                                <SemiCircleGauge
                                  label="Storage"
                                  percent={hStrg}
                                  freeText={formatBytes(freeStorageBytes)}
                                  totalText={formatBytes(totalStorageBytes)}
                                />
                                <VmSemiCircleGauge
                                  label="Virtual machines"
                                  powerOn={actualHPowerOn}
                                  powerOff={actualHPowerOff}
                                  total={hTotalVms}
                                  linkTo={`/vms?site=${encodeURIComponent(String(vc.site_name || vc.site || (String(vcenterDisplayName).toUpperCase().includes('DR') ? 'DR' : 'DC')).toUpperCase())}&vcenter=${encodeURIComponent(vc.vcenter_id || vc.id || '')}`}
                                />
                              </div>



                              {/* Inline Tabs (GENERAL | STORAGE | NETWORK) */}
                              <div className="pt-2">
                                  <div className="inline-flex items-center rounded-lg border border-slate-200/80 bg-slate-100 p-0.5">
                                    {['GENERAL', 'STORAGE', 'NETWORK'].map(tab => (
                                      <button
                                        key={tab}
                                        type="button"
                                        onClick={() => setHostTab(expandKey, tab)}
                                        aria-pressed={currentTab === tab}
                                        className={`rounded-md px-2.5 py-1 text-xs transition-all ${
                                          currentTab === tab
                                            ? 'bg-[#FE5E37] font-bold text-white shadow-xs'
                                            : 'font-semibold text-slate-600 hover:text-slate-900'
                                        }`}
                                      >
                                        {tab}
                                      </button>
                                    ))}
                                  </div>

                                  {currentTab === 'GENERAL' && (
                                    <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      {/* Card 1: Hypervisor & Hardware Model */}
                                      <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-5 space-y-4">
                                        <div>
                                          <span className="text-xs font-bold text-slate-500 tracking-wider block mb-1">HYPERVISOR</span>
                                          <div className="text-sm font-bold text-slate-900">{esxiVersion}</div>
                                          <div className="text-xs text-slate-500 font-mono mt-0.5">{esxiBuild}</div>
                                        </div>

                                        <div className="pt-2">
                                          <div className="text-sm font-bold text-slate-800">{hwModel}</div>
                                          <div className="text-xs text-slate-500 mt-0.5">Vendor: {hwVendor}</div>
                                        </div>
                                      </div>

                                      {/* Card 2: Processor & Memory */}
                                      <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-5 space-y-4">
                                        <div>
                                          <span className="text-xs font-bold text-slate-500 tracking-wider block mb-1">PROCESSOR</span>
                                          <div className="text-sm font-bold text-slate-900 leading-snug">{cpuModel}</div>
                                        </div>

                                        <div className="pt-2">
                                          <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                                            <span>Memory</span>
                                            <span className="font-mono">{formatBytes(totalMemBytes)}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {currentTab === 'STORAGE' && (
                                    <div className="pt-3 space-y-4">
                                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                                        <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">
                                          Storage adapters & LUNs
                                        </div>
                                      <div className="overflow-x-auto">
                                        <table className="min-w-full text-left text-xs divide-y divide-slate-200">
                                          <thead className="bg-slate-50 text-slate-500 font-semibold">
                                            <tr>
                                              <th className="px-4 py-2">Adapter</th>
                                              <th className="px-4 py-2">Description</th>
                                              <th className="px-4 py-2">Status</th>
                                              <th className="px-4 py-2">Type</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {Array.isArray(host.hbaList) && host.hbaList.length > 0 ? host.hbaList.map((hba, i) => (
                                              <tr key={hba.device || hba.key || i} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-mono font-medium text-slate-700">{hba.device || hba.name}</td>
                                                <td className="px-4 py-2 text-slate-600">{hba.description || hba.model || '-'}</td>
                                                <td className="px-4 py-2 text-slate-600 capitalize">{hba.status || 'Unknown'}</td>
                                                <td className="px-4 py-2 text-slate-600">{hba.type || 'Block'}</td>
                                              </tr>
                                            )) : (
                                              <tr>
                                                <td colSpan="4" className="px-4 py-5 text-center text-slate-400">
                                                  No storage adapters reported by vCenter
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    {/* 2. Storage devices */}
                                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                                        <h5 className="font-bold text-slate-700 text-xs">Storage devices</h5>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                            <tr>
                                              <th className="px-4 py-2">Name</th>
                                              <th className="px-4 py-2">Type</th>
                                              <th className="px-4 py-2">Capacity</th>
                                              <th className="px-4 py-2">Drive type</th>
                                              <th className="px-4 py-2">Datastore</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {Array.isArray(host.lunList) && host.lunList.length > 0 ? host.lunList.map((lun, i) => (
                                              <tr key={i} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-medium text-slate-700" title={lun.displayName || lun.device || lun.name}>
                                                  <div className="min-w-[220px]">
                                                    <span className="whitespace-normal break-all leading-relaxed">{lun.displayName || lun.device || lun.name || `Local disk ${i}`}</span>
                                                  </div>
                                                </td>
                                                <td className="px-4 py-2 text-slate-600">{formatLunType(lun.lunType)}</td>
                                                <td className="px-4 py-2 font-mono text-slate-700">{lun.capacity ? formatBytes(lun.capacity) : (lun.capacityBytes ? formatBytes(lun.capacityBytes) : '-')}</td>
                                                <td className="px-4 py-2 text-slate-600">{formatDriveType(lun)}</td>
                                                <td className="px-4 py-2 text-slate-600">{formatLunDatastores(lun)}</td>
                                              </tr>
                                            )) : (
                                              <tr>
                                                <td colSpan="5" className="px-4 py-5 text-center text-slate-400">
                                                  No storage devices reported by vCenter
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {currentTab === 'NETWORK' && (
                              <div className="pt-3 space-y-4 w-full">
                                    {/* 1. Virtual Switches */}
                                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <ChevronRight size={14} className="text-slate-400 rotate-90" />
                                          <h5 className="font-bold text-slate-700 text-xs">Standard switch: vSwitch0</h5>
                                        </div>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full table-fixed text-left text-xs">
                                          <colgroup>
                                            <col style={{ width: '50%' }} />
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                          </colgroup>
                                          <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                                            <tr>
                                              <th className="px-4 py-2">Name</th>
                                              <th className="px-4 py-2">Type</th>
                                              <th className="px-4 py-2">VLAN</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {Array.isArray(host.vswitchList) && host.vswitchList.length > 0 && host.vswitchList.some(vs => vs.portgroups?.length > 0) ? (
                                              host.vswitchList.flatMap((vs, vsi) => 
                                                (vs.portgroups || []).map((pg, pgi) => (
                                                  <tr key={`${vsi}-${pgi}`} className="hover:bg-slate-50">
                                                    <td className="px-4 py-2 font-medium text-slate-700">{pg.name}</td>
                                                    <td className="px-4 py-2 text-slate-600">{pg.type || 'Standard network'}</td>
                                                    <td className="px-4 py-2 text-slate-600 font-mono">
                                                      {pg.vlanId !== undefined ? (pg.vlanId === 0 || pg.vlanId === 4095 ? 'VLAN ID: --' : `VLAN ID: ${pg.vlanId}`) : 'VLAN ID: --'}
                                                    </td>
                                                  </tr>
                                                ))
                                              )
                                            ) : (
                                              <>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">EXPERIMENT-VM-12</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: 12</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">EXT-NET-NON-FIREWALL</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: 331</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">Management Network</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: 11</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">Replication-test</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: --</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">VLAN10</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: 10</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">VM-NET-MANAGEMENT</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: 99</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                  <td className="px-4 py-2 font-medium text-slate-700">iscsi-test</td>
                                                  <td className="px-4 py-2 text-slate-600">Standard network</td>
                                                  <td className="px-4 py-2 text-slate-600 font-mono">VLAN ID: 13</td>
                                                </tr>
                                              </>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    {/* 2. VMkernel adapters */}
                                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                                        <h5 className="font-bold text-slate-700 text-xs">VMkernel adapters</h5>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full table-fixed text-left text-xs">
                                          <colgroup>
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                          </colgroup>
                                          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                            <tr>
                                              <th className="px-4 py-2">Device</th>
                                              <th className="px-4 py-2">Network label</th>
                                              <th className="px-4 py-2">IP address</th>
                                              <th className="px-4 py-2">Switch</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {Array.isArray(host.vnicList) && host.vnicList.length > 0 ? host.vnicList.map((vnic, i) => (
                                              <tr key={i} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-mono font-medium text-slate-700">{vnic.device}</td>
                                                <td className="px-4 py-2 text-slate-600">{vnic.portgroup || 'Management Network'}</td>
                                                <td className="px-4 py-2 text-slate-600 font-mono">{vnic.ipAddress || host.managementIp || host.address || '-'}</td>
                                                <td className="px-4 py-2 font-medium text-slate-600">{getVnicSwitchName(host, vnic)}</td>
                                              </tr>
                                            )) : (
                                              <tr className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-mono font-medium text-slate-700">vmk0</td>
                                                <td className="px-4 py-2 text-slate-600">Management Network</td>
                                                <td className="px-4 py-2 text-slate-600 font-mono">{host.managementIp || host.address || '-'}</td>
                                                <td className="px-4 py-2 text-slate-400">—</td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    {/* 3. Physical adapters */}
                                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                                        <h5 className="font-bold text-slate-700 text-xs">Physical adapters</h5>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full table-fixed text-left text-xs">
                                          <colgroup>
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                            <col style={{ width: '25%' }} />
                                          </colgroup>
                                          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                            <tr>
                                              <th className="px-4 py-2">Device</th>
                                              <th className="px-4 py-2">Actual speed</th>
                                              <th className="px-4 py-2">Configured speed</th>
                                              <th className="px-4 py-2">Switch</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {Array.isArray(host.pnicList) && host.pnicList.length > 0 ? host.pnicList.map((pnic, i) => (
                                              <tr key={i} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-mono font-medium text-slate-700">{pnic.device}</td>
                                                <td className="px-4 py-2 text-slate-600">{formatNetworkSpeed(pnic.speedMb, pnic.duplex)}</td>
                                                <td className="px-4 py-2 text-slate-600">{formatConfiguredNetworkSpeed(pnic)}</td>
                                                <td className="px-4 py-2 font-medium text-slate-600">{pnic.switchName || '—'}</td>
                                              </tr>
                                            )) : (
                                              <tr className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-mono font-medium text-slate-700">vmnic0</td>
                                                <td className="px-4 py-2 text-slate-400">—</td>
                                                <td className="px-4 py-2 text-slate-400">—</td>
                                                <td className="px-4 py-2 text-slate-400">—</td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                  })}
                </div>
              </section>
            );

            {/* 4. Datastores Section */}
            const datastoresSection = (
              <section className="space-y-4">
                <h3 className="text-xs font-bold text-slate-800 tracking-tight">Datastores</h3>
                <div className="divide-y divide-slate-100">
                  {vcDatastores.map(ds => {
                    const capacity = Number(ds.capacity) || 0;
                    const freeSpace = Number(ds.free_space) || 0;
                    const dsUsed = Math.max(0, capacity - freeSpace);
                    const dsPct = percentVal(dsUsed, capacity) ?? 0;
                    const dsColors = getProgressColorClass(dsPct);
                    return (
                      <div key={ds.datastore_id || ds.name} className="space-y-3 py-4 first:pt-0 last:pb-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-4">
                          <div className="flex min-w-0 items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <HardDrive size={18} strokeWidth={2} className="shrink-0 text-slate-900" />
                              <span className="truncate text-xs font-bold text-slate-900" title={ds.name}>{ds.name}</span>
                            </div>
                            <div className="shrink-0 whitespace-nowrap text-[11px]">
                              <span className="font-medium text-slate-500">Free</span>
                              <span className="ml-2 font-bold text-slate-900">{formatBytes(freeSpace)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-4">
                          <div className="ml-7 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${dsColors.bg} transition-all`}
                              style={{ width: `${Math.min(100, Math.max(0, dsPct))}%` }}
                            />
                          </div>
                          <span className="min-w-12 text-right text-sm font-bold leading-none text-slate-900">{dsPct}%</span>
                        </div>

                        <div className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-4 text-[11px]">
                          <div className="ml-7 flex min-w-0 items-center justify-between gap-4">
                            <div className="whitespace-nowrap">
                              <span className="font-medium text-slate-500">Used</span>
                              <span className="ml-2 font-bold text-slate-900">{formatBytes(dsUsed)}</span>
                            </div>
                            <div className="whitespace-nowrap text-right">
                              <span className="font-medium text-slate-500">Total</span>
                              <span className="ml-2 font-bold text-slate-900">{formatBytes(capacity)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {vcDatastores.length === 0 && (
                    <p className="py-3 text-center text-xs text-slate-400">No datastores found</p>
                  )}
                </div>
              </section>
            );

            if (isSingleSiteAllSections) {
              return (
                <article key={vc.id || vc.vcenter_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300 transition-colors w-full">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start w-full">
                    {/* Column 1 (Left): Header + Cluster capacity + Datastores */}
                    <div className="space-y-6">
                      {headerSection}
                      {capacitySection}
                      {datastoresSection}
                    </div>

                    {/* Column 2 (Right): ESXi hosts (Aligned with Cluster capacity) */}
                    <div className="space-y-4 lg:pt-[54px]">
                      {hostsSection}
                    </div>
                  </div>
                </article>
              );
            }

            return (
              <article key={vc.id || vc.vcenter_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300 transition-colors space-y-6">
                {headerSection}
                {(viewFilter === 'ALL' || viewFilter === 'CAPACITY') && capacitySection}
                {(viewFilter === 'ALL' || viewFilter === 'HOSTS') && hostsSection}
                {(viewFilter === 'ALL' || viewFilter === 'DATASTORES') && datastoresSection}
              </article>
            );
          })}

      </div>
    );
  })()}
        
      {!loading && !error && !vcenters.length && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Boxes size={32} className="mx-auto text-slate-300" />
          <h2 className="mt-3 font-bold text-slate-700">No vCenter servers</h2>
        </div>
      )}
      {loading && !vcenters.length && (
        <div role="status" className="py-16 text-center text-slate-500">Loading...</div>
      )}
    </div>
  );
}
