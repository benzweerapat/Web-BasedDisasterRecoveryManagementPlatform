import React from 'react';
import { Link } from '../../router';
import { ShieldCheck, Shield, FileText, Copy } from 'lucide-react';


function VcenterNodeIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="6.5" width="11" height="11" rx="2" stroke="#8AC389" strokeWidth="2.2" fill="none" />
      <rect x="8.5" y="2.5" width="11" height="11" rx="2" stroke="#8AC389" strokeWidth="2.2" fill="none" strokeDasharray="2.5 1.5" />
    </svg>
  );
}

function canonicalSiteName(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/^(SRM|VR|VCENTER|VC)\s+/, '');
  if (normalized === 'DC' || normalized.endsWith(' DC')) return 'DC';
  if (normalized === 'DR' || normalized.endsWith(' DR')) return 'DR';
  return normalized || null;
}

function DrSiteStatusCard({
  siteKey,
  vcenter,
  peerVcenter,
  vrAppliance,
  srmAppliance,
  replications = [],
  protectionGroups = [],
  recoveryPlans = [],
  scopes = {}
}) {
  const vcenterIp = vcenter?.host || null;
  const vcenterName = vcenter?.displayName || vcenter?.siteName || `vCenter ${siteKey}`;
  const peerVcenterIp = peerVcenter?.host || null;
  
  const vrIp = vrAppliance?.applianceIp || vrAppliance?.apiEndpointHost || null;
  const srmIp = srmAppliance?.applianceHost || srmAppliance?.applianceIp || null;

  // Filter counts by this site
  const isSiteMatch = (siteVal, hostVal) => {
    if (hostVal && hostVal === vcenterIp) return true;
    const norm = canonicalSiteName(siteVal);
    return norm === siteKey;
  };

  const siteGroups = protectionGroups.filter(row => isSiteMatch(row.protectedSiteName || row.protectedSite, row.protectedVcenterHost));
  const sitePlans = recoveryPlans.filter(row => isSiteMatch(row.protectedSiteName || row.protectedSite, row.protectedVcenterHost));

  const pgCount = siteGroups.length > 0 ? siteGroups.length : (Number(scopes.protectionGroups?.count) > 0 ? 1 : 0);
  const rpCount = sitePlans.length > 0 ? sitePlans.length : (Number(scopes.recoveryPlans?.count) > 0 ? 1 : 0);

  const outgoingReps = replications.filter(row => isSiteMatch(row.logicalSourceSiteName || row.sourceSite, row.logicalSourceVcenterHost));
  const incomingReps = replications.filter(row => isSiteMatch(row.logicalTargetSiteName || row.targetSite, row.logicalTargetVcenterHost));

  const outgoingCount = outgoingReps.length;
  const incomingCount = incomingReps.length;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300 transition-colors space-y-6" data-site-card={siteKey}>
      {/* 1. Header (vCenter Title & IP on Left | Route Pill & Connected on Right) */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex flex-col gap-1 min-w-0 shrink-0">
          <h3 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">{vcenterName}</h3>
          <p className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800">
            <VcenterNodeIcon className="w-3.5 h-3.5 shrink-0" />
            {vcenterIp || 'Not available'}
          </p>
        </div>
        
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <span>{vcenterIp || 'Not available'}</span>
            <span className="text-slate-400 font-normal">↔</span>
            <span>{peerVcenterIp || 'Not available'}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Connected
          </span>
        </div>
      </header>

      {/* 2. Top Row: Appliance servers (Full Width with 2-Column Subgrid) */}
      <section className="space-y-2.5">
        <h4 className="text-xs font-bold text-slate-800 tracking-tight">Appliance servers</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* vSphere Replication Appliance */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50/50 border border-slate-200 px-4 py-3 shadow-2xs">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">vSphere Replication</p>
              <p className="text-[11px] font-medium text-slate-400">Appliance server</p>
            </div>
            <span className="font-mono text-sm font-bold text-slate-900">{vrIp || 'Not available'}</span>
          </div>

          {/* Site Recovery Manager Appliance */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50/50 border border-slate-200 px-4 py-3 shadow-2xs">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">Site Recovery Manager</p>
              <p className="text-[11px] font-medium text-slate-400">Appliance server</p>
            </div>
            <span className="font-mono text-sm font-bold text-slate-900">{srmIp || 'Not available'}</span>
          </div>
        </div>
      </section>

      {/* 3. Bottom Row: 2-Column Grid (Left: vSphere Replication, Right: Site Recovery Manager) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        {/* Left Column: vSphere Replication */}
        <section className="space-y-2.5">
          <h4 className="text-xs font-bold text-slate-800 tracking-tight">vSphere Replication</h4>
          <div className="space-y-2.5">
            <Link 
              to="/replications"
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-2xs hover:border-sky-300 hover:shadow-xs transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 group-hover:scale-105 transition-transform shrink-0">
                  <Copy size={15} />
                </div>
                <span className="text-xs font-semibold text-slate-700">Outgoing</span>
              </div>
              <span className="text-sm font-bold text-slate-900 font-mono">{outgoingCount}</span>
            </Link>

            <Link 
              to="/replications"
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-2xs hover:border-purple-300 hover:shadow-xs transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 group-hover:scale-105 transition-transform shrink-0">
                  <Copy size={15} />
                </div>
                <span className="text-xs font-semibold text-slate-700">Incoming</span>
              </div>
              <span className="text-sm font-bold text-slate-900 font-mono">{incomingCount}</span>
            </Link>
          </div>
        </section>

        {/* Right Column: Site Recovery Manager */}
        <section className="space-y-2.5">
          <h4 className="text-xs font-bold text-slate-800 tracking-tight">Site Recovery Manager</h4>
          <div className="space-y-2.5">
            <Link 
              to="/protection-groups"
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-2xs hover:border-indigo-300 hover:shadow-xs transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:scale-105 transition-transform shrink-0">
                  <Shield size={15} />
                </div>
                <span className="text-xs font-semibold text-slate-700">Protection groups</span>
              </div>
              <span className="text-sm font-bold text-slate-900 font-mono">{pgCount}</span>
            </Link>

            <Link 
              to="/recovery-plans"
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-2xs hover:border-emerald-300 hover:shadow-xs transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:scale-105 transition-transform shrink-0">
                  <FileText size={15} />
                </div>
                <span className="text-xs font-semibold text-slate-700">Recovery plans</span>
              </div>
              <span className="text-sm font-bold text-slate-900 font-mono">{rpCount}</span>
            </Link>
          </div>
        </section>
      </div>
    </article>
  );
}

export default function SrmHealthStatusSection({
  overview,
  metrics: _propsMetrics,
  replicationsSummary,
  protectionGroupsSummary,
  recoveryPlansSummary,
  title = "Site Recovery Manager status"
}) {
  const topology = overview?.topology || {};
  const vcenters = topology.vcenters || [];
  const vrAppliances = topology.vr || [];
  const srmAppliances = topology.srm || [];

  const health = overview?.srmHealth || {};
  const scopes = health.scopes || {};

  const replications = replicationsSummary?.canonicalRows || replicationsSummary?.canonicalReplications || [];
  const protectionGroups = protectionGroupsSummary?.canonicalGroups || [];
  const recoveryPlans = recoveryPlansSummary?.canonicalPlans || [];

  const dcVcenter = vcenters.find(v => canonicalSiteName(v.siteName || v.displayName) === 'DC') || vcenters[0] || null;
  const drVcenter = vcenters.find(v => canonicalSiteName(v.siteName || v.displayName) === 'DR') || vcenters[1] || null;

  const dcVr = vrAppliances.find(v => canonicalSiteName(v.siteName || v.siteRole) === 'DC') || vrAppliances[0] || null;
  const drVr = vrAppliances.find(v => canonicalSiteName(v.siteName || v.siteRole) === 'DR') || vrAppliances[1] || null;

  const dcSrm = srmAppliances.find(s => canonicalSiteName(s.siteName || s.siteRole) === 'DC') || srmAppliances[0] || null;
  const drSrm = srmAppliances.find(s => canonicalSiteName(s.siteName || s.siteRole) === 'DR') || srmAppliances[1] || null;

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="dr-srm-status-heading" data-srm-health-panel>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <ShieldCheck size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 id="dr-srm-status-heading" className="text-sm font-bold text-slate-900 tracking-tight">{title}</h2>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" data-srm-site-columns>
        {/* Left Site: DC */}
        <DrSiteStatusCard 
          siteKey="DC"
          vcenter={dcVcenter}
          peerVcenter={drVcenter}
          vrAppliance={dcVr}
          srmAppliance={dcSrm}
          replications={replications}
          protectionGroups={protectionGroups}
          recoveryPlans={recoveryPlans}
          scopes={scopes}
        />

        {/* Right Site: DR */}
        <DrSiteStatusCard 
          siteKey="DR"
          vcenter={drVcenter}
          peerVcenter={dcVcenter}
          vrAppliance={drVr}
          srmAppliance={drSrm}
          replications={replications}
          protectionGroups={protectionGroups}
          recoveryPlans={recoveryPlans}
          scopes={scopes}
        />
      </div>
    </section>
  );
}
