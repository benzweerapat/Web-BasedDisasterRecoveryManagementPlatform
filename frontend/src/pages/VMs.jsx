import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '../router-hooks';
import apiClient from '../api/apiClient';
import { formatOptional } from "../utils/formatters";
import { ErrorState, PageActionHeader, VmDetailModal } from '../components/shared';
import { ChevronRight, Search } from 'lucide-react';
import { getVmPowerStatePresentation } from '../utils/overview-severity';
import { parseReplicationPayload } from '../utils/adapters';

function vmRowKey(vm) {
  return `${vm.vcenterId || 'unknown'}:${vm.vmId || vm.id || vm.name || 'vm'}`;
}

function normalizeEndpointHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
  }
}

function replicationStatusPresentation(replication) {
  if (!replication) {
    return {
      label: 'Not configured',
      className: 'bg-slate-100 text-slate-600',
      dot: 'bg-slate-400'
    };
  }

  const rawStatus = String(replication.rawStatus || replication.normalizedStatus || replication.status || 'UNKNOWN').toUpperCase();
  const labels = {
    OK: 'OK',
    RECOVERED: 'Recovered',
    PAUSED: 'Paused',
    NOT_ACTIVE: 'Not active',
    NOT_ACTIVE_RPO_VIOLATION: 'Not active — RPO violation',
    RPO_VIOLATION: 'RPO violation',
    FULL_SYNC_RPO_VIOLATION: 'Full sync RPO violation'
  };
  const label = labels[rawStatus]
    || rawStatus.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()).replace(/\bRpo\b/g, 'RPO');

  if (rawStatus === 'OK' || rawStatus === 'RECOVERED') {
    return { label, className: 'bg-slate-100 text-slate-900', dot: 'bg-[#8AC389]' };
  }
  if (rawStatus === 'PAUSED' || rawStatus === 'NOT_ACTIVE') {
    return { label, className: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
  }
  if (rawStatus.includes('ERROR') || rawStatus.includes('FAIL') || rawStatus.includes('VIOLATION')) {
    return { label, className: 'bg-red-50 text-red-700', dot: 'bg-red-500' };
  }
  return { label, className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
}

export default function VMs({ user }) {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search || (typeof window !== 'undefined' ? window.location.search : '')), [location.search]);

  const [vms, setVms] = useState(() => {const r=apiClient.peek?.('/vms')?.data;return r?.data||r||[];});
  const [vcenters, setVcenters] = useState(() => {const r=apiClient.peek?.('/vcenters')?.data;return r?.data||r||[];});
  const [hosts, setHosts] = useState(() => {const r=apiClient.peek?.('/hosts')?.data;return r?.data||r||[];});
  const [connections, setConnections] = useState(() => apiClient.peek?.('/connections')?.data || []);
  const [replications, setReplications] = useState(() => {
    const cached = apiClient.peek?.('/vr/replications')?.data;
    return cached ? (parseReplicationPayload(cached).canonicalReplications || []) : [];
  });
  const [loading, setLoading] = useState(() => !apiClient.peek?.('/vms'));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestSequence = useRef(0);
  
  const [vcenterFilter, setVcenterFilter] = useState('ALL');
  const [hostFilter, setHostFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [powerFilter, setPowerFilter] = useState(() => searchParams.get('power')?.toUpperCase() || 'ALL');
  const [resourcePoolFilter, setResourcePoolFilter] = useState('ALL');
  const [protectionFilter, setProtectionFilter] = useState('ALL');

  const [expandedVmKey, setExpandedVmKey] = useState(null);
  const [vmDetailsByKey, setVmDetailsByKey] = useState({});
  const handledDetailsRequest = useRef(null);
  const [headerLeftTarget, setHeaderLeftTarget] = useState(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setHeaderLeftTarget(document.getElementById('main-header-portal-left'));
    }
  }, []);

  const fetchData = async (force = true) => {
    const sequence=++requestSequence.current;
    if(force!==false)setRefreshing(true);
    setLoading(!vms.length && !apiClient.peek?.('/vms'));
    setLoadError('');
    try {
      const [vmsRes, vcRes, hostsRes, replicationsRes, connectionsRes] = await Promise.all([
        apiClient.get('/vms'),
        apiClient.get('/vcenters'),
        apiClient.get('/hosts'),
        apiClient.get('/vr/replications').catch(() => null),
        apiClient.get('/connections').catch(() => null)
      ]);
      if(sequence!==requestSequence.current)return;
      setLoadError('');
      setVms(vmsRes.data?.data || []);
      setVcenters(vcRes.data?.data || []);
      setHosts(hostsRes.data?.data || []);
      if (replicationsRes) {
        setReplications(parseReplicationPayload(replicationsRes.data).canonicalReplications || []);
      }
      setConnections(connectionsRes && Array.isArray(connectionsRes.data) ? connectionsRes.data : []);
    } catch (err) {
      if(sequence!==requestSequence.current)return;
      console.error('Error fetching VMs data:', err);
      setLoadError('Unable to load virtual machines.');
    } finally {
      if(sequence===requestSequence.current){setLoading(false);setRefreshing(false);}
    }
  };

  useEffect(() => { fetchData(false); const refresh=()=>fetchData(true);window.addEventListener('inventory-cache-invalidated',refresh);return()=>window.removeEventListener('inventory-cache-invalidated',refresh); }, []);

  const canCreateReplicationForVm = vm => {
    const sourceVcenterId = String(vm?.vcenterId || '');
    const sourceVcenterHost = normalizeEndpointHost(sourceVcenterId);
    const sourceVcenterConnection = connections.find(connection => (
      String(connection?.systemType || '').toUpperCase() === 'VCENTER'
      && (
        String(connection.id) === sourceVcenterId
        || normalizeEndpointHost(connection.baseUrl) === sourceVcenterHost
      )
    ));

    if (!sourceVcenterConnection) return false;

    return connections.some(connection => (
      String(connection?.systemType || '').toUpperCase() === 'SRM'
      && connection.isActive !== false
      && String(connection.lastConnectionStatus || '').toUpperCase() === 'CONNECTED'
      && String(connection.associatedVcenterConnectionId || '') === String(sourceVcenterConnection.id)
    ));
  };

  const expandVmDetails = async (vm) => {
    const key = vmRowKey(vm);
    setExpandedVmKey(key);
    if (vmDetailsByKey[key]?.data || vmDetailsByKey[key]?.loading) return;

    setVmDetailsByKey(current => ({
      ...current,
      [key]: { loading: true, data: null, error: '' },
    }));
    try {
      const res = await apiClient.get(`/vms/${encodeURIComponent(vm.vmId)}/details`, {
        params: { vcenterId: vm.vcenterId }
      });
      setVmDetailsByKey(current => ({
        ...current,
        [key]: { loading: false, data: res.data?.data || vm, error: '' },
      }));
    } catch (err) {
      console.error('Failed to load details', err);
      setVmDetailsByKey(current => ({
        ...current,
        [key]: { loading: false, data: vm, error: 'Unable to load virtual machine details.' },
      }));
    }
  };

  const toggleVmDetails = (vm) => {
    const key = vmRowKey(vm);
    if (expandedVmKey === key) {
      setExpandedVmKey(null);
      return;
    }
    expandVmDetails(vm);
  };

  useEffect(() => {
    if (loading || searchParams.get('details') !== '1') return;
    const requestedVmId = searchParams.get('vmId');
    const requestedVcenterId = searchParams.get('vcenterId');
    const requestedName = searchParams.get('name');
    const requestKey = `${requestedVcenterId || ''}:${requestedVmId || ''}:${requestedName || ''}`;
    if (handledDetailsRequest.current === requestKey) return;

    const exactMatch = vms.find(vm =>
      requestedVmId && requestedVcenterId
      && String(vm.vmId) === requestedVmId
      && String(vm.vcenterId) === requestedVcenterId
    );
    const scopedNameMatch = vms.find(vm =>
      requestedName && requestedVcenterId
      && String(vm.name || '').toLowerCase() === requestedName.toLowerCase()
      && String(vm.vcenterId) === requestedVcenterId
    );
    const uniqueNameMatches = requestedName
      ? vms.filter(vm => String(vm.name || '').toLowerCase() === requestedName.toLowerCase())
      : [];
    const matchedVm = exactMatch || scopedNameMatch || (uniqueNameMatches.length === 1 ? uniqueNameMatches[0] : null);
    handledDetailsRequest.current = requestKey;
    if (matchedVm) expandVmDetails(matchedVm);
  }, [loading, searchParams, vms]);

  const vcenterOptions = useMemo(() => {
    return [...new Map([
      ...vms.map(vm => [vm.vcenterId, { key: vm.vcenterId, label: vm.vcenterName || 'Unknown vCenter', site: vm.site }]),
      ...vcenters.map(vcenter => [vcenter.vcenter_id || vcenter.vcenterId || vcenter.fqdn, {
        key: vcenter.vcenter_id || vcenter.vcenterId || vcenter.fqdn,
        label: vcenter.connectionName || vcenter.display_name || vcenter.fqdn,
        site: vcenter.site
      }])
    ].filter(([key]) => Boolean(key))).values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [vms, vcenters]);

  const vcenterNameById = useMemo(() => new Map(
    vcenterOptions.map(vcenter => [String(vcenter.key), vcenter.label])
  ), [vcenterOptions]);

  useEffect(() => {
    const siteParam = searchParams.get('site');
    const vcenterParam = searchParams.get('vcenter');
    const powerParam = searchParams.get('power');

    if (powerParam) {
      setPowerFilter(powerParam.toUpperCase());
    }

    if (vcenterOptions.length > 0) {
      if (vcenterParam) {
        const directMatch = vcenterOptions.find(opt => 
          String(opt.key) === vcenterParam || 
          String(opt.label).toLowerCase() === vcenterParam.toLowerCase() ||
          String(opt.key).toLowerCase().includes(vcenterParam.toLowerCase()) || 
          String(opt.label).toLowerCase().includes(vcenterParam.toLowerCase()) ||
          vcenterParam.toLowerCase().includes(String(opt.key).toLowerCase())
        );
        if (directMatch) {
          setVcenterFilter(directMatch.key);
          return;
        }
      }

      if (siteParam && siteParam !== 'ALL') {
        const siteMatch = vcenterOptions.find(opt => 
          String(opt.site || '').toUpperCase() === siteParam.toUpperCase() ||
          String(opt.label || '').toUpperCase().includes(siteParam.toUpperCase()) ||
          String(opt.key || '').toUpperCase().includes(siteParam.toUpperCase())
        );
        if (siteMatch) {
          setVcenterFilter(siteMatch.key);
          return;
        }
      } else if (!vcenterParam) {
        setVcenterFilter('ALL');
      }
    }
  }, [vcenterOptions, searchParams]);

  useEffect(() => {
    setHostFilter('ALL');
    setResourcePoolFilter('ALL');
  }, [vcenterFilter]);

  const selectedVcenter = vcenterOptions.find(vcenter => vcenter.key === vcenterFilter);
  const hostOptions = [...new Set([
    ...hosts.filter(host => vcenterFilter === 'ALL' || String(host.vcenterId) === String(vcenterFilter)).map(host => host.name || host.hostName || host.address),
    ...vms.filter(vm => vcenterFilter === 'ALL' || String(vm.vcenterId) === String(vcenterFilter)).map(vm => vm.host || vm.hostName || vm.esxiHostName)
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));
  
  const resourcePoolOptions = [...new Set(
    vms.filter(vm => vcenterFilter === 'ALL' || String(vm.vcenterId) === String(vcenterFilter))
       .map(vm => vm.resourcePool)
       .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const replicationLookup = useMemo(() => {
    const exact = new Map();
    const byName = new Map();

    replications.forEach(replication => {
      if (replication.vmInventoryVcenterId && replication.vmInventoryVmId) {
        exact.set(`${replication.vmInventoryVcenterId}:${replication.vmInventoryVmId}`, replication);
      }
      const nameKey = String(replication.vmName || '').trim().toLowerCase();
      if (nameKey) {
        const matches = byName.get(nameKey) || [];
        matches.push(replication);
        byName.set(nameKey, matches);
      }
    });

    return { exact, byName };
  }, [replications]);

  const replicationForVm = vm => {
    const exactMatch = replicationLookup.exact.get(`${vm.vcenterId}:${vm.vmId}`);
    if (exactMatch) return exactMatch;

    const nameMatches = replicationLookup.byName.get(String(vm.name || '').trim().toLowerCase()) || [];
    const vmVcenterName = String(vm.vcenterName || '').toLowerCase();
    const vmVcenterId = String(vm.vcenterId || '').toLowerCase();
    const scopedMatch = nameMatches.find(replication => {
      const sourceName = String(replication.logicalSourceVcenterName || '').toLowerCase();
      const sourceHost = String(replication.logicalSourceVcenterHost || '').toLowerCase();
      return (sourceName && sourceName === vmVcenterName)
        || (sourceHost && (vmVcenterId.includes(sourceHost) || vmVcenterName.includes(sourceHost)))
        || String(replication.vmInventoryVcenterId || '') === String(vm.vcenterId || '');
    });
    if (scopedMatch) return scopedMatch;

    const matchWithoutSourceIdentity = nameMatches.find(replication =>
      !replication.logicalSourceVcenterName
      && !replication.logicalSourceVcenterHost
      && !replication.vmInventoryVcenterId
    );
    return nameMatches.length === 1 ? matchWithoutSourceIdentity || null : null;
  };
  
  const filteredVMs = vms.filter(vm => {
    const vmHost = vm.host || vm.hostName || vm.esxiHostName;
    const matchVcenter = vcenterFilter === 'ALL' || 
      String(vm.vcenterId) === String(vcenterFilter) ||
      (selectedVcenter && String(vm.vcenterName || '').toLowerCase() === String(selectedVcenter.label || '').toLowerCase());
    const matchHost = hostFilter === 'ALL' || vmHost === hostFilter;
    const vmName = vm.name || '';
    const vmIp = vm.primaryIp || '';
    const matchSearch = vmName.toLowerCase().includes(searchTerm.toLowerCase()) || vmIp.includes(searchTerm);
    const matchPower = powerFilter === 'ALL' || (powerFilter === 'ON' && (vm.powerState === 'POWERED_ON' || String(vm.powerState || '').toUpperCase().includes('ON'))) || (powerFilter === 'OFF' && (vm.powerState === 'POWERED_OFF' || String(vm.powerState || '').toUpperCase().includes('OFF')));
    const matchResourcePool = resourcePoolFilter === 'ALL' || vm.resourcePool === resourcePoolFilter;
    const isProtected = vm.protectionStatus === 'PROTECTED' || Boolean(vm.isProtected) || Boolean(vm.protectionGroupName);
    const matchProtection = protectionFilter === 'ALL' ||
      (protectionFilter === 'PROTECTED' && isProtected) ||
      (protectionFilter === 'UNPROTECTED' && !isProtected);
    
    return matchVcenter && matchHost && matchSearch && matchPower && matchResourcePool && matchProtection;
  });

  const vcenterFilterBar = (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 items-center" data-vcenter-filter-bar>
      <button
        type="button"
        aria-pressed={vcenterFilter === 'ALL'}
        onClick={() => { setVcenterFilter('ALL'); setHostFilter('ALL'); }}
        className={`px-2.5 py-1 text-xs rounded-md transition-all ${
          vcenterFilter === 'ALL'
            ? 'font-bold bg-white text-slate-950 shadow-xs'
            : 'font-semibold text-slate-600 hover:text-slate-900'
        }`}
        data-vcenter-filter="ALL"
      >
        All
      </button>
      {vcenterOptions.map(vcenter => (
        <button
          type="button"
          aria-pressed={vcenterFilter === vcenter.key}
          key={vcenter.key}
          onClick={() => { setVcenterFilter(vcenter.key); setHostFilter('ALL'); }}
          className={`px-2.5 py-1 text-xs rounded-md transition-all ${
            vcenterFilter === vcenter.key
              ? 'font-bold bg-white text-slate-950 shadow-xs'
              : 'font-semibold text-slate-600 hover:text-slate-900'
          }`}
          data-vcenter-filter={vcenter.key}
        >
          {vcenter.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {headerLeftTarget ? (
        createPortal(vcenterFilterBar, headerLeftTarget)
      ) : (
        <div className="sr-only">
          {vcenterFilterBar}
          <PageActionHeader
            onRefresh={fetchData}
            refreshing={refreshing}
            refreshAriaLabel="Refresh virtual machine inventory"
            user={user}
            onSyncCompleted={fetchData}
          />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Host filters */}
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-6 py-4">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 items-center" data-host-filter-bar>
            <button
              type="button"
              aria-pressed={hostFilter === 'ALL'}
              onClick={() => setHostFilter('ALL')}
              className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                hostFilter === 'ALL'
                  ? 'font-bold bg-white text-slate-950 shadow-xs'
                  : 'font-semibold text-slate-600 hover:text-slate-900'
              }`}
              data-host-filter="ALL"
            >
              All hosts
            </button>
            {hostOptions.map(host => (
              <button
                type="button"
                aria-pressed={hostFilter === host}
                key={host}
                onClick={() => setHostFilter(host)}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                  hostFilter === host
                    ? 'font-bold bg-white text-slate-950 shadow-xs'
                    : 'font-semibold text-slate-600 hover:text-slate-900'
                }`}
                data-host-filter={host}
              >
                {host}
              </button>
            ))}
          </div>
        </div>

        {/* Filter inputs row */}
        <div className="p-4 border-b border-slate-100 bg-white flex flex-wrap gap-3 items-center">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={14} className="text-slate-400" aria-hidden="true" />
            </div>
            <input
              type="text"
              placeholder="Search VM name or IP..."
              className="pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-slate-400 w-56 transition-colors shadow-2xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="border border-slate-200 rounded-lg text-xs text-slate-700 py-1.5 pl-2.5 pr-8 bg-white focus:outline-none focus:border-slate-400 shadow-2xs"
            value={powerFilter}
            onChange={(e) => setPowerFilter(e.target.value)}
          >
            <option value="ALL">Power state: all</option>
            <option value="ON">Powered on</option>
            <option value="OFF">Powered off</option>
          </select>

          <select
            className="border border-slate-200 rounded-lg text-xs text-slate-700 py-1.5 pl-2.5 pr-8 bg-white focus:outline-none focus:border-slate-400 shadow-2xs"
            value={resourcePoolFilter}
            onChange={(e) => setResourcePoolFilter(e.target.value)}
          >
            <option value="ALL">Resource pool: all</option>
            {resourcePoolOptions.map(rp => (
              <option key={rp} value={rp} title={rp}>
                {rp.length > 25 ? rp.substring(0, 25) + '...' : rp}
              </option>
            ))}
          </select>

          <select
            className="border border-slate-200 rounded-lg text-xs text-slate-700 py-1.5 pl-2.5 pr-8 bg-white focus:outline-none focus:border-slate-400 shadow-2xs"
            value={protectionFilter}
            onChange={(e) => setProtectionFilter(e.target.value)}
          >
            <option value="ALL">Protection group: All</option>
            <option value="PROTECTED">Assigned</option>
            <option value="UNPROTECTED">Not assigned</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto" data-vm-list>
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs font-semibold tracking-wider text-slate-700">
              <tr>
                {['VM name','vCenter','Power','Resources','IP address','Replication','Protection group'].map(label => (
                  <th key={label} className="px-5 py-3.5">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && vms.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : loadError && vms.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-8"><ErrorState message={loadError} retry={() => fetchData(true)} /></td>
                </tr>
              ) : filteredVMs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    <Search size={22} className="mx-auto mb-3 text-slate-300" />
                    <p className="font-medium text-slate-600">No virtual machines found</p>
                    <p className="text-xs text-slate-400 mt-1">Try adjusting the search criteria.</p>
                  </td>
                </tr>
              ) : filteredVMs.map(vm => {
                const power = getVmPowerStatePresentation(vm.powerState);
                const resourceParts = [
                  vm.configuredVcpu == null ? null : `${vm.configuredVcpu} vCPU`,
                  vm.configuredMemoryGiB == null ? null : `${Math.round(vm.configuredMemoryGiB)} GB RAM`
                ].filter(Boolean);
                const replication = replicationForVm(vm);
                const replicationStatus = replicationStatusPresentation(replication);
                const protectionGroupName = replication?.protectionGroupName || vm.protectionGroupName || null;
                const rowKey = vmRowKey(vm);
                const expanded = expandedVmKey === rowKey;
                const detailsId = `vm-details-${rowKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`transition-colors ${expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                      data-vm-list-row
                      data-vm-power-state={power.label}
                      data-vm-protection-status={vm.protectionStatus || 'NOT_AVAILABLE'}
                      data-vm-replication-status={replication?.normalizedStatus || replication?.status || 'NOT_CONFIGURED'}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${vm.name || 'VM'}`}
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            onClick={() => toggleVmDetails(vm)}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                          >
                            <ChevronRight size={15} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                          </button>
                          <span className="font-medium text-slate-900 text-xs">{formatOptional(vm.name, 'Name unavailable')}</span>
                        </div>
                      </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {formatOptional(vm.vcenterName || vcenterNameById.get(String(vm.vcenterId)), 'Unknown vCenter')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        <span className={`h-1.5 w-1.5 rounded-full ${power.label === 'Powered on' ? 'bg-[#8AC389]' : power.label === 'Powered off' ? 'bg-red-500' : 'bg-slate-400'}`} />
                        {power.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-700">
                      {resourceParts.length > 0 ? (
                        <div className="flex items-center gap-4 font-medium">
                          {resourceParts.map(part => <span key={part}>{part}</span>)}
                        </div>
                      ) : (
                        <p className="font-medium">Not collected</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700">{formatOptional(vm.primaryIp)}</td>
                    <td className="px-5 py-3.5">
                      {replication ? (
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${replicationStatus.className}`}>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${replicationStatus.dot}`} />
                          {replicationStatus.label}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5">
                      {protectionGroupName ? (
                        <span className="inline-flex max-w-[180px] items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800" title={protectionGroupName}>
                          <span className="truncate">{protectionGroupName}</span>
                        </span>
                      ) : null}
                    </td>
                    </tr>
                    {expanded ? (
                      <tr id={detailsId} className="border-t border-slate-100 bg-slate-50/80">
                        <td colSpan="7" className="p-0">
                          <VmDetailModal
                            inline
                            open
                            vm={vm}
                            details={vmDetailsByKey[rowKey]?.data}
                            loading={vmDetailsByKey[rowKey]?.loading}
                            canCreateReplication={canCreateReplicationForVm(vm)}
                            onClose={() => setExpandedVmKey(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
