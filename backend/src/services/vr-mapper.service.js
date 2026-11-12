/**
 * VR Mapper Service
 *
 * Maps raw observation rows from the database into the Replication View Model.
 *
 * Key design principle:
 * - canonical_identity_status is set authoritatively by the sync service at ingest time.
 * - Do NOT re-run canonicalization here. Trust the DB value.
 * - resolved_source_site / resolved_target_site are derived from runtime vCenter identities.
 */
const { partitionCanonicalAndUnmapped } = require('./entity-partition.service');
const { parseDiscoveryMetadata, parseUrlHost } = require('./appliance-discovery.service');

const resolveDetailWarning = obs => {
  const status=String(obs.normalized_status || obs.raw_status || '').toUpperCase();
  const issue=String(obs.replication_issue_description || '');
  // Some VR releases keep the previous PAUSED issue for one collection after
  // the live status is already OK. Do not display a contradictory stale issue.
  if (issue && !(status!=='PAUSED' && /\bpaused\b/i.test(issue))) return issue;
  if (obs.configuration_error_message) return obs.configuration_error_message;
  if (obs.last_group_error_message) return obs.last_group_error_message;
  if (obs.recovery_error_message) return obs.recovery_error_message;
  if (obs.protection_resolution_status === 'NOT_FOUND_IN_VC') {
    return 'The source virtual machine is not present in the latest vCenter inventory.';
  }
  if (String(obs.raw_status || '').toUpperCase() === 'NOT_ACTIVE') {
    return 'This replication is not active.';
  }
  return null;
};

const resolveReplicationServerName = obs => {
  const targetServerUuid = String(obs.target_replication_server_uuid || '');

  // VMware represents the built-in enhanced replication endpoint with an
  // HBRB identity. It is not a vr_replication_servers UUID and therefore must
  // not be treated as an unresolved external server.
  if (targetServerUuid.toUpperCase().startsWith('HBRB:')) {
    return 'Enhanced Replication Service';
  }
  if (obs.replication_server_internally_managed) {
    return 'Embedded Replication Service';
  }
  return obs.replication_server_name
    || (obs.enhanced_replication ? 'Enhanced Replication Service' : null);
};

const resolveAvailableActions = (direction, rawStatus) => {
  if (String(direction || '').toUpperCase() !== 'OUTGOING') return [];
  const status = String(rawStatus || '').toUpperCase();
  if (['FAILED', 'UNKNOWN'].includes(status)) return [];
  const actions = [];
  if (status === 'PAUSED') actions.push('resume');
  else actions.push('pause');
  if (status !== 'PAUSED') actions.push('sync');
  actions.push('reconfigure');
  actions.push('unconfigure');
  return actions;
};
const mapObservation = (obs, vcUuidMap) => {
  // Use site labels resolved by the repository from runtime vCenter identities.
  const localSite = obs.local_site || null;
  const sourceSite = obs.resolved_source_site || obs.source_site_name || null;
  const targetSite = obs.resolved_target_site || obs.target_site_name || null;

  const isOutgoing = obs.direction === 'OUTGOING';
  const logicalSourceSiteName = sourceSite;
  const logicalTargetSiteName = targetSite;

  let lastVrSyncAvailability = 'NOT_PROVIDED_BY_API';
  let lastVrSyncAt = null;

  if (obs.last_sync_at) {
    lastVrSyncAt = obs.last_sync_at;
    lastVrSyncAvailability = 'AVAILABLE';
  } else if (obs.status === 'NEVER_SYNCED' || !obs.last_seen_at) {
    lastVrSyncAvailability = 'NEVER_SYNCED';
  } else if (obs.fetch_status === 'FAILED') {
    lastVrSyncAvailability = 'SCOPE_FAILED';
  } else {
    lastVrSyncAvailability = 'NOT_PROVIDED_BY_API';
  }

  // Protection status: use value from the repository JOIN.
  // Allowlist: PROTECTED, NOT_PROTECTED, NOT_AVAILABLE. All others → UNMAPPED.
  let protectionStatus = obs.protection_status || 'UNMAPPED';
  if (!['PROTECTED', 'NOT_PROTECTED', 'NOT_AVAILABLE'].includes(protectionStatus)) {
    protectionStatus = 'UNMAPPED';
  }

  return {
    rowKey: `obs-${obs.id}`,
    canonicalReplicationKey: obs.canonical_replication_key,
    canonicalIdentityStatus: obs.canonical_identity_status,
    canonicalIdentityEvidence: obs.canonical_identity_evidence || obs.canonical_identity_status,

    observationId: obs.id,
    replicationId: obs.replication_id,
    replicationName: obs.name || null,
    replicationNameAvailability: obs.name ? 'AVAILABLE' : 'NOT_PROVIDED_BY_API',
    pairingId: obs.pairing_id || null,
    connectionId: obs.connection_id || null,
    direction: obs.direction || null,
    actions: resolveAvailableActions(obs.direction, obs.normalized_status || obs.raw_status),

    vmMoid: obs.vm_id,
    vmName: obs.vm_name,
    vmPowerState: obs.vm_power_state || null,
    vmPrimaryIp: obs.vm_primary_ip || null,
    vmInventoryRole: obs.vm_inventory_role || 'NOT_AVAILABLE',
    vmInventoryVcenterId: obs.vm_inventory_vcenter_id || null,
    vmInventoryVmId: obs.vm_inventory_vm_id || null,

    observationSiteName: localSite,
    observationDirection: obs.direction,
    localSiteName: localSite,
    remoteSiteName: isOutgoing ? targetSite : sourceSite,

    logicalSourceSiteName,
    sourceVrName: obs.source_site_name || null,
    logicalSourceVcenterName: obs.resolved_source_vcenter_name || obs.source_site_name || null,
    logicalSourceVcenterStableId: obs.source_vc_id || null,
    logicalSourceVcenterHost: parseUrlHost(obs.resolved_source_vcenter_base_url).host
      || obs.resolved_source_vcenter_host
      || null,

    logicalTargetSiteName,
    targetVrName: obs.target_site_name || null,
    logicalTargetVcenterName: obs.resolved_target_vcenter_name || obs.target_site_name || null,
    logicalTargetVcenterStableId: obs.target_vc_id || null,
    logicalTargetVcenterHost: parseUrlHost(obs.resolved_target_vcenter_base_url).host
      || obs.resolved_target_vcenter_host
      || null,
          normalizedStatus: obs.normalized_status || obs.raw_status || null,
    rawStatus: obs.raw_status || null,
    replicationType: obs.raw_type || null,
    configurationState: obs.configuration_state || null,
    recoveryState: obs.recovery_state || null,
    recoverySolution: obs.recovery_solution || null,
    configurationErrorMessage: obs.configuration_error_message || null,
    configurationErrorDetails: obs.configuration_error_details || null,
    lastGroupErrorMessage: obs.last_group_error_message || null,
    lastGroupErrorDetails: obs.last_group_error_details || null,
    recoveryErrorMessage: obs.recovery_error_message || null,
    targetReplicationServerUuid: obs.target_replication_server_uuid || null,
    lastSyncDurationSeconds: obs.last_sync_duration_seconds ?? null,
    lastSyncSizeBytes: obs.last_sync_size_bytes ?? null,
    quiescingEnabled: obs.quiescing_enabled ?? null,
    networkCompressionEnabled: obs.network_compression_enabled ?? null,
    encryptionEnabled: obs.encryption_enabled ?? null,
    autoReplicateNewDisksEnabled: obs.auto_replicate_new_disks_enabled ?? null,
    mpitEnabled: obs.mpit_enabled ?? null,
    mpitInstances: obs.mpit_instances ?? null,
    mpitDays: obs.mpit_days ?? null,
    vmDataSetsReplicationEnabled: obs.vm_data_sets_replication_enabled ?? null,
    enhancedReplication: obs.enhanced_replication ?? null,
    diskCollectionStatus: obs.disk_collection_status || null,
    diskCollectionErrorCode: obs.disk_collection_error_code || null,
    replicatedDiskSummary: obs.replicated_disk_summary || null,
    replicationIssueDescription: (String(obs.normalized_status || obs.raw_status || '').toUpperCase()!=='PAUSED' && /\bpaused\b/i.test(String(obs.replication_issue_description || ''))) ? null : (obs.replication_issue_description || null),
    replicationIssueSeverity: obs.replication_issue_severity || null,
    replicationIssueType: obs.replication_issue_type || null,
    replicationIssueOccurredAt: obs.replication_issue_occurred_at || null,
    detailWarningMessage: resolveDetailWarning(obs),
    syncProgressPercent: obs.sync_progress_percent ?? null,
    detailStatus: obs.detail_status || null,
    detailErrorCode: obs.detail_error_code || null,
    rpoMinutes: obs.rpo_minutes,
    rpoViolation: obs.current_rpo_violation ?? null,

    protectionStatus,
    protectionGroupId: obs.protection_group_id || null,
    protectionGroupName: obs.protection_group_name || null,
    recoveryPlanId: obs.recovery_plan_id || null,
    recoveryPlanName: obs.recovery_plan_name || null,
    protectionResolutionStatus: obs.protection_resolution_status || null,

    replicationServerId: obs.replication_server_id || null,
    replicationServerName: resolveReplicationServerName(obs),
    replicationServerNameAvailability: resolveReplicationServerName(obs) ? 'AVAILABLE' : 'NOT_PROVIDED_BY_API',
    apiReportedServerAddress: obs.api_reported_server_address || null,
    apiReportedServerAddressType: parseUrlHost(
      obs.api_reported_server_address ? `https://${obs.api_reported_server_address}` : null
    ).hostType,
    vrApplianceHost: parseDiscoveryMetadata(obs.vr_management_safe_url).applianceIp
      || parseDiscoveryMetadata(obs.vr_management_safe_url).apiEndpointHost
      || parseUrlHost(obs.vr_management_safe_url).host,
    serverResolutionStatus: resolveReplicationServerName(obs) ? 'PRESENT' : 'UNMAPPED_IDENTITY',

    lastVrSyncAt,
    lastVrSyncAvailability,
    lastVrSyncSource: 'VR_API',

    lastCollectedAt: obs.last_seen_at,
    lastObservationAt: obs.last_seen_at,
    collectionRunId: obs.sync_run_id || null,
    lastCollectionRunId: obs.sync_run_id || null
  };
};
const mapCanonical = (rawRows) => {
  // Prefer OUTGOING observation as primary (source-side view is most authoritative for RPO etc.)
  const primaryObs = rawRows.find(r => r.direction === 'OUTGOING') || rawRows[0];
  const mappedPrimary = mapObservation(primaryObs, new Map());

  return {
    rowKey: `canonical-${mappedPrimary.canonicalReplicationKey}`,
    canonicalReplicationKey: mappedPrimary.canonicalReplicationKey,
    canonicalIdentityStatus: mappedPrimary.canonicalIdentityStatus,
    observationCount: rawRows.length,

    replicationId: mappedPrimary.replicationId,
    replicationName: mappedPrimary.replicationName,
    replicationNameAvailability: mappedPrimary.replicationNameAvailability,
    pairingId: mappedPrimary.pairingId || null,
    connectionId: mappedPrimary.connectionId || null,
    direction: mappedPrimary.direction || null,
    actions: mappedPrimary.actions || [],

    vmMoid: mappedPrimary.vmMoid,
    vmName: mappedPrimary.vmName,
    vmPowerState: mappedPrimary.vmPowerState,
    vmPrimaryIp: mappedPrimary.vmPrimaryIp,
    vmInventoryRole: mappedPrimary.vmInventoryRole,
    vmInventoryVcenterId: mappedPrimary.vmInventoryVcenterId,
    vmInventoryVmId: mappedPrimary.vmInventoryVmId,

    logicalSourceSiteName: mappedPrimary.logicalSourceSiteName,
    sourceVrName: mappedPrimary.sourceVrName,
    logicalSourceVcenterName: mappedPrimary.logicalSourceVcenterName,
    logicalSourceVcenterStableId: mappedPrimary.logicalSourceVcenterStableId,
    logicalSourceVcenterHost: mappedPrimary.logicalSourceVcenterHost,

    logicalTargetSiteName: mappedPrimary.logicalTargetSiteName,
    targetVrName: mappedPrimary.targetVrName,
    logicalTargetVcenterName: mappedPrimary.logicalTargetVcenterName,
    logicalTargetVcenterStableId: mappedPrimary.logicalTargetVcenterStableId,
    logicalTargetVcenterHost: mappedPrimary.logicalTargetVcenterHost,

    normalizedStatus: mappedPrimary.normalizedStatus,
    rawStatus: mappedPrimary.rawStatus,
    replicationType: mappedPrimary.replicationType,
    configurationState: mappedPrimary.configurationState,
    recoveryState: mappedPrimary.recoveryState,
    recoverySolution: mappedPrimary.recoverySolution,
    configurationErrorMessage: mappedPrimary.configurationErrorMessage,
    configurationErrorDetails: mappedPrimary.configurationErrorDetails,
    lastGroupErrorMessage: mappedPrimary.lastGroupErrorMessage,
    lastGroupErrorDetails: mappedPrimary.lastGroupErrorDetails,
    recoveryErrorMessage: mappedPrimary.recoveryErrorMessage,
    targetReplicationServerUuid: mappedPrimary.targetReplicationServerUuid,
    lastSyncDurationSeconds: mappedPrimary.lastSyncDurationSeconds,
    lastSyncSizeBytes: mappedPrimary.lastSyncSizeBytes,
    quiescingEnabled: mappedPrimary.quiescingEnabled,
    networkCompressionEnabled: mappedPrimary.networkCompressionEnabled,
    encryptionEnabled: mappedPrimary.encryptionEnabled,
    autoReplicateNewDisksEnabled: mappedPrimary.autoReplicateNewDisksEnabled,
    mpitEnabled: mappedPrimary.mpitEnabled,
    mpitInstances: mappedPrimary.mpitInstances,
    mpitDays: mappedPrimary.mpitDays,
    vmDataSetsReplicationEnabled: mappedPrimary.vmDataSetsReplicationEnabled,
    enhancedReplication: mappedPrimary.enhancedReplication,
    diskCollectionStatus: mappedPrimary.diskCollectionStatus,
    diskCollectionErrorCode: mappedPrimary.diskCollectionErrorCode,
    replicatedDiskSummary: mappedPrimary.replicatedDiskSummary,
    replicationIssueDescription: mappedPrimary.replicationIssueDescription,
    replicationIssueSeverity: mappedPrimary.replicationIssueSeverity,
    replicationIssueType: mappedPrimary.replicationIssueType,
    replicationIssueOccurredAt: mappedPrimary.replicationIssueOccurredAt,
    detailWarningMessage: mappedPrimary.detailWarningMessage,
    syncProgressPercent: mappedPrimary.syncProgressPercent,
    detailStatus: mappedPrimary.detailStatus,
    detailErrorCode: mappedPrimary.detailErrorCode,
    rpoMinutes: mappedPrimary.rpoMinutes,
    rpoViolation: mappedPrimary.rpoViolation,

    protectionStatus: mappedPrimary.protectionStatus,
    protectionGroupId: mappedPrimary.protectionGroupId,
    protectionGroupName: mappedPrimary.protectionGroupName,
    recoveryPlanId: mappedPrimary.recoveryPlanId,
    recoveryPlanName: mappedPrimary.recoveryPlanName,
    protectionResolutionStatus: mappedPrimary.protectionResolutionStatus,

    replicationServerId: mappedPrimary.replicationServerId,
    replicationServerName: mappedPrimary.replicationServerName,
    replicationServerNameAvailability: mappedPrimary.replicationServerNameAvailability,
    apiReportedServerAddress: mappedPrimary.apiReportedServerAddress,
    apiReportedServerAddressType: mappedPrimary.apiReportedServerAddressType,
    vrApplianceHost: mappedPrimary.vrApplianceHost,
    serverResolutionStatus: mappedPrimary.serverResolutionStatus,

    lastVrSyncAt: mappedPrimary.lastVrSyncAt,
    lastVrSyncAvailability: mappedPrimary.lastVrSyncAvailability,
    lastVrSyncSource: mappedPrimary.lastVrSyncSource,
    lastCollectedAt: mappedPrimary.lastCollectedAt,
    lastObservationAt: mappedPrimary.lastObservationAt,
    collectionRunId: mappedPrimary.collectionRunId,
    lastCollectionRunId: mappedPrimary.lastCollectionRunId,

    observations: rawRows.map(r => mapObservation(r, new Map()))
  };
};
const endpointValue = (row, side, field) => row?.[`logical${side}Vcenter${field}`] || null;

const buildEndpoint = (row, side) => ({
  siteName: row?.[`logical${side}SiteName`] || null,
  vcenterName: endpointValue(row, side, 'Name'),
  vcenterStableId: endpointValue(row, side, 'StableId'),
  vcenterHost: endpointValue(row, side, 'Host')
});

const endpointIdentity = endpoint => [
  endpoint.vcenterStableId,
  endpoint.vcenterHost,
  endpoint.vcenterName,
  endpoint.siteName
].find(value => typeof value === 'string' && value.trim())?.trim().toLowerCase() || null;

/**
 * Build the authoritative per-VR-connection direction contract used by every
 * VR tab. Membership comes only from observations actually collected by that
 * local VR appliance. Never mirror a canonical replication into the peer view:
 * the peer collection may legitimately report a different set of rows.
 */
const buildSitePairViews = (observationRows, pairings = []) => {
  const views = new Map();

  const append = (local, remote, direction, canonicalReplicationKey) => {
    const localIdentity = endpointIdentity(local);
    const remoteIdentity = endpointIdentity(remote);
    if (!localIdentity || !remoteIdentity) return;

    const viewKey = `${localIdentity}::${remoteIdentity}`;

    if (!views.has(viewKey)) {
      views.set(viewKey, {
        viewKey,
        localSiteName: local.siteName,
        localVcenterName: local.vcenterName,
        localVcenterStableId: local.vcenterStableId,
        localVcenterHost: local.vcenterHost,
        remoteSiteName: remote.siteName,
        remoteVcenterName: remote.vcenterName,
        remoteVcenterStableId: remote.vcenterStableId,
        remoteVcenterHost: remote.vcenterHost,
        preferredDirection: direction || 'OUTGOING',
        incomingCanonicalReplicationKeys: new Set(),
        outgoingCanonicalReplicationKeys: new Set()
      });
    }

    if (canonicalReplicationKey) {
      const view = views.get(viewKey);

      const target = direction === 'OUTGOING'
        ? view.outgoingCanonicalReplicationKeys
        : view.incomingCanonicalReplicationKeys;

      target.add(canonicalReplicationKey);
    }
  };
    // Seed site pair views from active configured pairings so views exist even with 0 replications
  for (const pair of pairings || []) {
    if (pair.is_self_pairing || pair.pairing_type === 'SELF') continue;
    const sourceVcenterId = pair.sourceVcenterId || pair.local_vcenter_external_id;
    const targetVcenterId = pair.targetVcenterId || pair.remote_vcenter_external_id;
    if (sourceVcenterId && targetVcenterId && sourceVcenterId === targetVcenterId) continue;

    const source = {
      siteName: pair.sourceName || pair.local_site || 'Local',
      vcenterName: pair.sourceName || pair.local_site_name,
      vcenterStableId: sourceVcenterId,
      vcenterHost: pair.sourceHost || pair.local_site_name
    };
    const target = {
      siteName: pair.targetName || pair.remote_site || 'Remote',
      vcenterName: pair.targetName || pair.remote_site_name,
      vcenterStableId: targetVcenterId,
      vcenterHost: pair.targetHost || pair.remote_site_name
    };
    append(source, target, 'OUTGOING', null);
  }

  for (const row of observationRows || []) {
    const direction = String(row?.observationDirection || '').toUpperCase();
    if (!['OUTGOING', 'INCOMING'].includes(direction)) continue;

    const source = buildEndpoint(row, 'Source');
    const target = buildEndpoint(row, 'Target');
    const local = direction === 'OUTGOING' ? source : target;
    const remote = direction === 'OUTGOING' ? target : source;
    append(local, remote, direction, row.canonicalReplicationKey);
  }

  return [...views.values()]
    .map(view => ({
      ...view,
      incomingCanonicalReplicationKeys: [...view.incomingCanonicalReplicationKeys],
      outgoingCanonicalReplicationKeys: [...view.outgoingCanonicalReplicationKeys]
    }))
    .sort((a, b) => String(a.localVcenterHost || a.localVcenterName || a.localSiteName || '')
      .localeCompare(String(b.localVcenterHost || b.localVcenterName || b.localSiteName || '')));
};
exports.buildReplicationsViewModel = (rawObservations, vcUuidMap, pairings = []) => {
  // Trust canonical_identity_status from DB (set by sync service during data ingestion).
  // Do NOT re-run canonicalization here — the DB already has the authoritative value.
  // partitionCanonicalAndUnmapped checks obs.canonical_identity_status === 'COMPLETE'
  // and groups by obs.canonical_replication_key.

  const { canonicalRows, mappedObservations, unmappedObservations } = partitionCanonicalAndUnmapped(
    rawObservations,
    'canonical_replication_key',
    mapCanonical,
    (obs) => mapObservation(obs, vcUuidMap)
  );

  let logicalReplicationCount = canonicalRows.length;
  let identityState = 'SUCCESS_CANONICAL';
  if (rawObservations.length > 0 && canonicalRows.length === 0) {
    logicalReplicationCount = null;
    identityState = 'CANONICAL_EMPTY_WITH_OBSERVATIONS';
  } else if (rawObservations.length === 0) {
    identityState = 'SUCCESS_EMPTY';
  }

  const observations = rawObservations.map(obs => mapObservation(obs, vcUuidMap));
  const mappedObservationIds = mappedObservations.map(obs => obs.observationId);
  const protectedCount = canonicalRows.filter(row => row.protectionStatus === 'PROTECTED').length;
  const unprotectedCount = canonicalRows.filter(row => row.protectionStatus === 'NOT_PROTECTED').length;
  const protectionUnmappedCount = canonicalRows.filter(row => !['PROTECTED', 'NOT_PROTECTED'].includes(row.protectionStatus)).length;

  return {
    metrics: {
      logicalReplicationCount,
      observationCount: rawObservations.length,
      mappedObservationCount: mappedObservations.length,
      unmappedObservationCount: unmappedObservations.length,
      protectedCount,
      unprotectedCount,
      protectionUnmappedCount,
      outgoingObservationCount: rawObservations.filter(row => row.direction === 'OUTGOING').length,
      incomingObservationCount: rawObservations.filter(row => row.direction === 'INCOMING').length
    },
    state: identityState,
    canonicalRows,
    canonicalReplications: canonicalRows,
    sitePairViews: buildSitePairViews(mappedObservations, pairings),
    mappedObservationIds,
    mappedObservations,
    unmappedObservations,
    observations,
    collectionRunIds: [...new Set(rawObservations.map(row => row.sync_run_id).filter(Boolean))]
  };
};

exports.buildSitePairViews = buildSitePairViews;
const net = require('net');
const dns = require('dns').promises;

exports.buildServersViewModel = async (rawServers) => {
  const { managementServers = [], replicationServers = [] } = rawServers;

  const mapServer = async (srv, type) => {
    let apiReportedServerAddress = null;
    let replicationApplianceHost = null;
    let serverType = type;

    // Attempt to extract hostname from URL or hostname field
    let rawHost = srv.hostname || null;
    let applianceIp = null;
    let apiEndpointHost = null;
    let apiEndpointHostType = null;

    if (!rawHost && srv.safe_url) {
      try {
        if (srv.safe_url.startsWith('{')) {
          const parsed = JSON.parse(srv.safe_url);
          rawHost = parsed.original ? new URL(parsed.original).hostname : null;
          applianceIp = parsed.applianceIp || null;
          apiEndpointHost = parsed.apiEndpointHost || null;
          apiEndpointHostType = parsed.apiEndpointHostType || null;
        } else {
          const urlObj = new URL(srv.safe_url);
          rawHost = urlObj.hostname;
        }
      } catch (e) {}
    }
    if (!rawHost && srv.safe_configuration_url) {
      try {
        const urlObj = new URL(srv.safe_configuration_url);
        rawHost = urlObj.hostname;
      } catch (e) {}
    }

    if (rawHost || apiEndpointHost) {
      apiReportedServerAddress = rawHost;
      if (net.isIP(rawHost)) {
        replicationApplianceHost = rawHost;
      } else if (rawHost !== '127.0.0.1' && rawHost !== 'localhost') {
        try {
          const addrs = await dns.resolve(rawHost);
          if (addrs && addrs.length > 0) {
            replicationApplianceHost = addrs[0];
          }
        } catch (e) {
          // ignore dns error
        }
      }
    }

    // Check if Embedded
    if (apiReportedServerAddress === '127.0.0.1' || apiReportedServerAddress === 'localhost' || srv.internally_managed === true) {
      serverType = 'EMBEDDED';
    }

    const finalApplianceIp = applianceIp || replicationApplianceHost;

    return {
      replicationServerId: srv.server_id || srv.vrms_id,
      replicationServerUuid: srv.server_uuid || null,
      replicationServerName: (serverType === 'EMBEDDED' && !srv.name) ? 'Embedded Replication Service' : (srv.name || null),
      apiReportedServerAddress: apiEndpointHost || apiReportedServerAddress,
      apiReportedServerAddressType: apiEndpointHostType || (net.isIP(apiReportedServerAddress) ? 'IP' : (apiReportedServerAddress ? 'FQDN' : 'UNKNOWN')),
      applianceIp: finalApplianceIp,
      applianceSource: finalApplianceIp ? 'API_OR_ENDPOINT' : 'NOT_PROVIDED_BY_API',
      applianceAvailability: finalApplianceIp ? 'AVAILABLE' : 'NOT_PROVIDED_BY_API',
      replicationApplianceHost: finalApplianceIp,
      replicationApplianceHostType: finalApplianceIp ? 'IP' : 'UNKNOWN',
      replicationServerResolutionStatus: 'PRESENT',
      serverType,
      internallyManaged: srv.internally_managed,
      connected: srv.connected,
      replicationCount: srv.replication_count
    };
  };

  const mgt = await Promise.all(managementServers.map(s => mapServer(s, 'MANAGEMENT')));
  const rep = await Promise.all(replicationServers.map(s => mapServer(s, 'REPLICATION')));

  return {
    managementServers: mgt,
    replicationServers: rep
  };
};