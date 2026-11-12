import React from 'react';

function canonicalSiteName(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/^(SRM|VR|VCENTER|VC|SITE)\s+/, '');
  if (normalized === 'DC' || normalized.endsWith(' DC') || normalized === 'PRIMARY') return 'DC';
  if (normalized === 'DR' || normalized.endsWith(' DR') || normalized === 'RECOVERY') return 'DR';
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
  _scopes = {},
  pairView = null,
  replicationsByKey = new Map()
}) {
  const vcenterIp = pairView?.localVcenterHost || vcenter?.host || vcenter?.ip || null;
  const vcenterName = vcenter?.displayName || vcenter?.siteName || `vCenter ${siteKey}`;
  const peerVcenterIp = pairView?.remoteVcenterHost || peerVcenter?.host || peerVcenter?.ip || null;
  
  const vrIp = vrAppliance?.applianceIp || vrAppliance?.applianceHost || vrAppliance?.apiEndpointHost || null;
  const srmIp = srmAppliance?.applianceHost || srmAppliance?.applianceIp || null;

  // Filter counts by this site
  const isSiteMatch = (siteVal, hostVal) => {
    if (hostVal && hostVal === vcenterIp) return true;
    const norm = canonicalSiteName(siteVal);
    return norm === siteKey;
  };

  const belongsToLocalSrm = row => {
    if (srmAppliance?.connectionId != null && row?.connectionId != null) {
      return Number(row.connectionId) === Number(srmAppliance.connectionId);
    }
    if (row?.observationSiteName) {
      return canonicalSiteName(row.observationSiteName) === siteKey;
    }
    return isSiteMatch(row?.protectedSiteName || row?.protectedSite, row?.protectedVcenterHost);
  };

  const siteGroups = protectionGroups.filter(belongsToLocalSrm);
  const sitePlans = recoveryPlans.filter(belongsToLocalSrm);

  const pgCount = siteGroups.length;
  const rpCount = sitePlans.length;

  const outgoingReps = pairView
    ? (pairView.outgoingCanonicalReplicationKeys || []).map(key => replicationsByKey.get(key)).filter(Boolean)
    : replications.filter(row => isSiteMatch(row.logicalSourceSiteName || row.sourceSite, row.logicalSourceVcenterHost));
  const incomingReps = pairView
    ? (pairView.incomingCanonicalReplicationKeys || []).map(key => replicationsByKey.get(key)).filter(Boolean)
    : replications.filter(row => isSiteMatch(row.logicalTargetSiteName || row.targetSite, row.logicalTargetVcenterHost));

  const outgoingCount = outgoingReps.length;
  const incomingCount = incomingReps.length;

  const displayVcenterIp = vcenterIp || 'Not available';
  const displayPeerVcenterIp = peerVcenterIp || 'Not available';

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300 transition-colors space-y-6" data-site-card={siteKey} data-srm-appliance={siteKey}>
      {/* 1. Header (vCenter Title & IP on Left | Route Pill on Right) */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex flex-col gap-1 min-w-0 shrink-0">
          <h3 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">{vcenterName}</h3>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            {displayVcenterIp}
          </p>
        </div>
        
        <div className="flex items-center shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <span>↔ {displayPeerVcenterIp}</span>
          </div>
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
              {(vrAppliance?.displayName || vrAppliance?.applianceName) && <p className="text-[11px] font-medium text-slate-400">{vrAppliance.displayName || vrAppliance.applianceName}</p>}
            </div>
            <span className="text-sm font-semibold text-slate-800">{vrIp || 'Not available'}</span>
          </div>

          {/* Site Recovery Manager Appliance */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50/50 border border-slate-200 px-4 py-3 shadow-2xs">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">Site Recovery Manager</p>
              {srmAppliance?.displayName && <p className="text-[11px] font-medium text-slate-400">{srmAppliance.displayName}</p>}
            </div>
            <span className="text-sm font-semibold text-slate-800">{srmIp || 'Not available'}</span>
          </div>
        </div>
      </section>

      {/* 3. Bottom Row: 2-Column Grid (Left: vSphere Replication, Right: Site Recovery Manager) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        {/* Left Column: vSphere Replication */}
        <section className="space-y-2.5">
          <h4 className="text-xs font-bold text-slate-800 tracking-tight">vSphere Replication</h4>
          <div className="space-y-2.5">
            <div
              className="flex items-center justify-between rounded-xl bg-white border border-[#8AC389] px-4 py-3 shadow-2xs"
              data-srm-direction="OUTGOING"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-700">Outgoing</span>
              </div>
              <span className="text-sm font-bold text-slate-900">{outgoingCount}</span>
            </div>

            <div
              className="flex items-center justify-between rounded-xl bg-white border border-[#8AC389] px-4 py-3 shadow-2xs"
              data-srm-direction="INCOMING"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-700">Incoming</span>
              </div>
              <span className="text-sm font-bold text-slate-900">{incomingCount}</span>
            </div>
          </div>
        </section>

        {/* Right Column: Site Recovery Manager */}
        <section className="space-y-2.5">
          <h4 className="text-xs font-bold text-slate-800 tracking-tight">Site Recovery Manager</h4>
          <div className="space-y-2.5">
            <div
              className="flex items-center justify-between rounded-xl bg-white border border-[#FE5E37] px-4 py-3 shadow-2xs"
              data-srm-site-metric="Groups"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-700">Protection groups</span>
              </div>
              <span className="text-sm font-bold text-slate-900">{pgCount}</span>
            </div>

            <div
              className="flex items-center justify-between rounded-xl bg-white border border-[#FE5E37] px-4 py-3 shadow-2xs"
              data-srm-site-metric="Plans"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-700">Recovery plans</span>
              </div>
              <span className="text-sm font-bold text-slate-900">{rpCount}</span>
            </div>
          </div>
        </section>
      </div>

    </article>
  );
}

export default function DisasterRecoverySrmStatusSection({
  overview,
  metrics: _propsMetrics,
  replicationsSummary,
  protectionGroupsSummary,
  recoveryPlansSummary,
  title = "Site Recovery Manager status"
}) {
  const topology = overview?.topology || {};
  const vcenters = topology.vcenters || [];
  const health = overview?.srmHealth || {};
  const scopes = health.scopes || {};

  const authoritativeAppliances = Array.isArray(health.appliances) ? health.appliances : [];
  const derivedAppliances = Array.isArray(health.vrDerivedEvidence) ? health.vrDerivedEvidence : [];

  // VR health is evidence for VR only; it must never impersonate an SRM appliance.
  const srmAppliances = topology.srm?.length ? topology.srm : authoritativeAppliances;
  const vrAppliances = topology.vr?.length ? topology.vr.map(appliance => {
    const matches = derivedAppliances.filter(evidence => appliance.connectionId != null
      ? String(evidence.connectionId) === String(appliance.connectionId)
      : canonicalSiteName(evidence.siteName) === canonicalSiteName(appliance.siteName));
    return matches.length === 1 ? { ...matches[0], ...appliance } : appliance;
  }) : derivedAppliances;

  const usingVrEvidence = (!authoritativeAppliances.length && derivedAppliances.length > 0) || (health.overallState === 'NOT_AVAILABLE' && health.evidenceSource === 'VR') || Boolean(scopes.usingVrDerivedEvidence);

  const replications = replicationsSummary?.canonicalRows || replicationsSummary?.canonicalReplications || [];
  const replicationsByKey = new Map(replications.map(row => [row.canonicalReplicationKey, row]).filter(([key]) => key));
  const sitePairViews = Array.isArray(replicationsSummary?.sitePairViews) ? replicationsSummary.sitePairViews : [];
  const protectionGroups = Array.isArray(protectionGroupsSummary?.observations) && protectionGroupsSummary.observations.length
    ? protectionGroupsSummary.observations
    : (protectionGroupsSummary?.canonicalGroups || []);
  const recoveryPlans = Array.isArray(recoveryPlansSummary?.observations) && recoveryPlansSummary.observations.length
    ? recoveryPlansSummary.observations
    : (recoveryPlansSummary?.canonicalPlans || []);

  const dcVcenter = vcenters.find(v => canonicalSiteName(v.siteName || v.displayName) === 'DC') || vcenters[0] || null;
  const drVcenter = vcenters.find(v => canonicalSiteName(v.siteName || v.displayName) === 'DR') || vcenters[1] || null;

  const dcVr = vrAppliances.find(v => canonicalSiteName(v.siteName || v.siteRole || v.applianceName) === 'DC') || vrAppliances[0] || null;
  const drVr = vrAppliances.find(v => canonicalSiteName(v.siteName || v.siteRole || v.applianceName) === 'DR') || vrAppliances[1] || null;

  const dcSrm = srmAppliances.find(s => canonicalSiteName(s.siteName || s.siteRole || s.displayName) === 'DC') || srmAppliances[0] || null;
  const drSrm = srmAppliances.find(s => canonicalSiteName(s.siteName || s.siteRole || s.displayName) === 'DR') || srmAppliances[1] || null;

  const pairViewFor = (siteKey, vcenter) => sitePairViews.find(view =>
    (vcenter?.host && view.localVcenterHost === vcenter.host)
    || (vcenter?.stableId && view.localVcenterStableId === vcenter.stableId)
    || canonicalSiteName(view.localSiteName || view.localVcenterName) === siteKey
  ) || null;
  const dcPairView = pairViewFor('DC', dcVcenter);
  const drPairView = pairViewFor('DR', drVcenter);

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="dr-srm-status-heading" data-srm-health-panel>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2.5">
          <div>
            <h2 id="dr-srm-status-heading" className="text-sm font-bold text-slate-900 tracking-tight">{title}</h2>
          </div>
        </div>

      </div>

      {usingVrEvidence && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-700 flex items-center justify-between" data-vr-derived-srm-notice>
          <span><strong>SRM connection is not configured.</strong> Showing site, vCenter, appliance, pairing direction, and replication evidence available from vSphere Replication.</span>
          <span className="font-semibold text-indigo-800">Derived from VR</span>
        </div>
      )}

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
          pairView={dcPairView}
          replicationsByKey={replicationsByKey}
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
          pairView={drPairView}
          replicationsByKey={replicationsByKey}
        />
      </div>
    </section>
  );
}
