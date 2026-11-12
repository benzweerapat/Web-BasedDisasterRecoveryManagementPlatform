export function mapDrOverviewResponse(response) {
  if (!response) return { _error: true, message: 'Not available' };
  
  // Safe mapping helper for counts (allows 0, but nullish becomes null)
  const getCount = (field) => {
    if (field === null || field === undefined) return null; // Missing API value
    return field;
  };

  const { metrics = {}, siteTopology = [], dataFreshness = {} } = response;
  const primarySite = siteTopology[0] || {};
  const peerSite = siteTopology[1] || {};
  const fallbackVcenters = siteTopology.map(site => ({
    connectionId: site.vcenterConnectionId,
    displayName: site.vcenterName || site.displayName,
    siteName: site.site,
    siteRole: site.vcenterSiteRole,
    host: site.vcenterHost,
    connectionStatus: site.vcenterStatus,
    clusterCount: site.clusterCount,
    hostCount: site.hostCount,
    hosts: Array.isArray(site.hosts) ? site.hosts : [],
    datastoreCount: site.datastoreCount,
    datastores: Array.isArray(site.datastores) ? site.datastores : [],
    vmCount: site.vmCount,
    lastCollectedAt: site.lastInventorySyncAt
  }));
  const topology = {
    vcenters: Array.isArray(response.topology?.vcenters) ? response.topology.vcenters : fallbackVcenters,
    vr: Array.isArray(response.topology?.vr) ? response.topology.vr : (response.vrAppliances || []),
    srm: Array.isArray(response.topology?.srm) ? response.topology.srm : (response.srmAppliances || [])
  };

  return {
    // Health
    dcVcenter: primarySite.vcenterStatus ?? null,
    drVcenter: peerSite.vcenterStatus ?? null,
    dcVr: primarySite.vrConnectionStatus ?? null,
    drVr: peerSite.vrConnectionStatus ?? null,
    dcSrm: primarySite.srmConnectionStatus ?? null,
    drSrm: peerSite.srmConnectionStatus ?? null,
    
    // Summary
    sitePairs: getCount(metrics.sitePairCount ?? response.canonicalSitePairs),
    activeVcenterConnections: getCount(metrics.activeVcenterConnectionCount),
    inventoryHosts: getCount(metrics.inventoryHostCount),
    inventoryVms: getCount(metrics.inventoryVmCount ?? response.vmCount),
    uniqueReplicatedVms: getCount(metrics.logicalReplicationCount),
    protectionGroups: getCount(metrics.canonicalProtectionGroupCount),
    recoveryPlans: getCount(metrics.canonicalRecoveryPlanCount),
    activeIssues: getCount(metrics.activeIssueCount),
    recentTasks: getCount(metrics.recentTaskCount),
    
    // Detailed Counts
    metrics,
    siteTopology,
    topology,
    capacityBySite: Array.isArray(response.capacityBySite) ? response.capacityBySite : [],
    virtualMachines: Array.isArray(response.virtualMachines) ? response.virtualMachines : [],
    datastores: Array.isArray(response.datastores) ? response.datastores : [],
    issues: Array.isArray(response.issues) ? response.issues : [],
    
    // Freshness
    lastVcenterSync: dataFreshness.lastVcenterSync ?? null,
    lastVrSync: dataFreshness.lastVrCoreSyncAt ?? null,
    lastSrmSync: dataFreshness.lastSrmCoreSyncAt ?? null,
    
    srmAppliances: response.srmAppliances || [],
    vrAppliances: response.vrAppliances || [],
    sitePairComparisons: response.sitePairComparisons || [],
    replicatedFromSiteCounts: response.replicatedFromSiteCounts || [],
    health: response.health || {},
    mappingHealth: response.mappingHealth || {},
    srmScopeSummary: response.srmScopeSummary || {},
    srmHealth: response.srmHealth || null,

    _raw: response
  };
}

export function parseDrOverviewPayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'drOverview');
  if (unwrapped.contractError || !unwrapped.data.metrics || !Array.isArray(unwrapped.data.siteTopology)) {
    return { contractError: true, state: 'CONTRACT_ERROR', error: unwrapped.errorReason || 'Invalid DR overview contract' };
  }
  return {
    ...mapDrOverviewResponse(unwrapped.data),
    contractError: false,
    state: unwrapped.data.dataState || unwrapped.state || 'SUCCESS',
    dataState: unwrapped.data.dataState || unwrapped.state || 'SUCCESS',
    freshness: unwrapped.data.freshness || unwrapped.freshness,
    scopeStates: unwrapped.data.scopeStates || {},
    scopeErrors: unwrapped.data.scopeErrors || {}
  };
}

export function parseVrPairingsPayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'vrPairings');
  if (unwrapped.contractError || !Array.isArray(unwrapped.data)) {
    return { rows: [], state: 'CONTRACT_ERROR', contractError: true };
  }
  return { rows: unwrapped.data, state: unwrapped.data.length ? 'SUCCESS' : 'SUCCESS_EMPTY', contractError: false };
}
export function mapReplicationToViewModel(rep) {
  if (!rep) return null;
  
  // API now returns camelCase fields from the mapper service.
  // Support both camelCase (new) and snake_case (legacy) field names.
  return {
    id: rep.observationId ?? rep.id ?? null,
    rowKey: rep.rowKey ?? null,
    canonicalReplicationKey: rep.canonicalReplicationKey ?? null,
    canonicalIdentityStatus: rep.canonicalIdentityStatus ?? null,
    observationCount: rep.observationCount ?? null,
    
    vmName: rep.vmName ?? rep.vm_name ?? rep.name ?? null,
    vmMoid: rep.vmMoid ?? rep.vm_moid ?? rep.vm_id ?? null,
    vmPowerState: rep.vmPowerState ?? rep.vm_power_state ?? null,
    vmPrimaryIp: rep.vmPrimaryIp ?? rep.vm_primary_ip ?? null,
    vmInventoryRole: rep.vmInventoryRole ?? rep.vm_inventory_role ?? 'NOT_AVAILABLE',
    vmInventoryVcenterId: rep.vmInventoryVcenterId ?? rep.vm_inventory_vcenter_id ?? null,
    vmInventoryVmId: rep.vmInventoryVmId ?? rep.vm_inventory_vm_id ?? null,
    
    direction: rep.observationDirection ?? rep.direction ?? null,
    observationSiteName: rep.observationSiteName ?? null,
    localSiteName: rep.localSiteName ?? null,
    remoteSiteName: rep.remoteSiteName ?? null,
    
    sourceSite: rep.logicalSourceSiteName ?? rep.source_site_name ?? rep.source_site ?? null,
    targetSite: rep.logicalTargetSiteName ?? rep.target_site_name ?? rep.target_site ?? null,
    sourceVrName: rep.sourceVrName ?? rep.source_vr_name ?? rep.source_site_name ?? null,
    targetVrName: rep.targetVrName ?? rep.target_vr_name ?? rep.target_site_name ?? null,
    logicalSourceSiteName: rep.logicalSourceSiteName ?? null,
    logicalTargetSiteName: rep.logicalTargetSiteName ?? null,
    logicalSourceVcenterName: rep.logicalSourceVcenterName ?? null,
    logicalSourceVcenterStableId: rep.logicalSourceVcenterStableId ?? null,
    logicalSourceVcenterHost: rep.logicalSourceVcenterHost ?? null,
    logicalTargetVcenterName: rep.logicalTargetVcenterName ?? null,
    logicalTargetVcenterStableId: rep.logicalTargetVcenterStableId ?? null,
    logicalTargetVcenterHost: rep.logicalTargetVcenterHost ?? null,
    
    replicationId: rep.replicationId ?? rep.replication_id ?? null,
    replicationName: rep.replicationName ?? rep.name ?? null,
    replicationNameAvailability: rep.replicationNameAvailability ?? 'NOT_PROVIDED_BY_API',
    
    lastVrSyncAt: rep.lastVrSyncAt ?? rep.last_vr_sync_at ?? rep.last_sync_time ?? null,
    lastVrSyncAvailability: rep.lastVrSyncAvailability ?? rep.last_vr_sync_availability ?? 'NOT_PROVIDED_BY_API',
    lastObservationAt: rep.lastObservationAt ?? rep.last_seen_at ?? null,
    lastCollectedAt: rep.lastCollectedAt ?? rep.lastObservationAt ?? rep.last_seen_at ?? null,
    collectionRunId: rep.collectionRunId ?? rep.lastCollectionRunId ?? rep.sync_run_id ?? null,
    lastCollectionRunId: rep.lastCollectionRunId ?? rep.collectionRunId ?? rep.sync_run_id ?? null,
    
    status: rep.normalizedStatus ?? rep.normalized_status ?? rep.raw_status ?? rep.status ?? null,
    normalizedStatus: rep.normalizedStatus ?? rep.normalized_status ?? rep.raw_status ?? rep.status ?? null,
    rawStatus: rep.rawStatus ?? rep.raw_status ?? null,
    replicationType: rep.replicationType ?? rep.raw_type ?? null,
    configurationState: rep.configurationState ?? rep.configuration_state ?? null,
    recoveryState: rep.recoveryState ?? rep.recovery_state ?? null,
    recoverySolution: rep.recoverySolution ?? rep.recovery_solution ?? null,
    configurationErrorMessage: rep.configurationErrorMessage ?? rep.configuration_error_message ?? null,
    configurationErrorDetails: rep.configurationErrorDetails ?? rep.configuration_error_details ?? null,
    lastGroupErrorMessage: rep.lastGroupErrorMessage ?? rep.last_group_error_message ?? null,
    lastGroupErrorDetails: rep.lastGroupErrorDetails ?? rep.last_group_error_details ?? null,
    recoveryErrorMessage: rep.recoveryErrorMessage ?? rep.recovery_error_message ?? null,
    targetReplicationServerUuid: rep.targetReplicationServerUuid ?? rep.target_replication_server_uuid ?? null,
    lastSyncDurationSeconds: rep.lastSyncDurationSeconds ?? rep.last_sync_duration_seconds ?? null,
    lastSyncSizeBytes: rep.lastSyncSizeBytes ?? rep.last_sync_size_bytes ?? null,
    quiescingEnabled: rep.quiescingEnabled ?? rep.quiescing_enabled ?? null,
    networkCompressionEnabled: rep.networkCompressionEnabled ?? rep.network_compression_enabled ?? null,
    encryptionEnabled: rep.encryptionEnabled ?? rep.encryption_enabled ?? null,
    autoReplicateNewDisksEnabled: rep.autoReplicateNewDisksEnabled ?? rep.auto_replicate_new_disks_enabled ?? null,
    mpitEnabled: rep.mpitEnabled ?? rep.mpit_enabled ?? null,
    mpitInstances: rep.mpitInstances ?? rep.mpit_instances ?? null,
    mpitDays: rep.mpitDays ?? rep.mpit_days ?? null,
    vmDataSetsReplicationEnabled: rep.vmDataSetsReplicationEnabled ?? rep.vm_data_sets_replication_enabled ?? null,
    enhancedReplication: rep.enhancedReplication ?? rep.enhanced_replication ?? null,
    diskCollectionStatus: rep.diskCollectionStatus ?? rep.disk_collection_status ?? null,
    diskCollectionErrorCode: rep.diskCollectionErrorCode ?? rep.disk_collection_error_code ?? null,
    replicatedDiskSummary: rep.replicatedDiskSummary ?? rep.replicated_disk_summary ?? null,
    replicationIssueDescription: rep.replicationIssueDescription ?? rep.replication_issue_description ?? null,
    replicationIssueSeverity: rep.replicationIssueSeverity ?? rep.replication_issue_severity ?? null,
    replicationIssueType: rep.replicationIssueType ?? rep.replication_issue_type ?? null,
    replicationIssueOccurredAt: rep.replicationIssueOccurredAt ?? rep.replication_issue_occurred_at ?? null,
    detailWarningMessage: rep.detailWarningMessage ?? null,
    syncProgressPercent: rep.syncProgressPercent ?? rep.sync_progress_percent ?? null,
    detailStatus: rep.detailStatus ?? rep.detail_status ?? null,
    detailErrorCode: rep.detailErrorCode ?? rep.detail_error_code ?? null,
    rpo: rep.rpoMinutes ?? rep.rpo_minutes ?? rep.rpo ?? null,
    rpoViolation: rep.rpoViolation ?? rep.current_rpo_violation ?? rep.rpo_violation ?? null,
    
    // Join with SRM
    protectionStatus: rep.protectionStatus ?? rep.protection_status ?? 'UNMAPPED',
    protectionGroupId: rep.protectionGroupId ?? rep.protection_group_id ?? null,
    protectionGroupName: rep.protectionGroupName ?? rep.protection_group_name ?? null,
    recoveryPlanId: rep.recoveryPlanId ?? rep.recovery_plan_id ?? null,
    recoveryPlanName: rep.recoveryPlanName ?? rep.recovery_plan_name ?? null,
    protectionResolutionStatus: rep.protectionResolutionStatus ?? rep.protection_resolution_status ?? null,

    pairingId: rep.pairingId ?? rep.pairing_id ?? null,
    connectionId: rep.connectionId ?? rep.connection_id ?? null,
    actions: Array.isArray(rep.actions) ? rep.actions : [],

    replicationServerId: rep.replicationServerId ?? null,
    replicationServerName: rep.replicationServerName ?? null,
    replicationServerNameAvailability: rep.replicationServerNameAvailability ?? 'NOT_PROVIDED_BY_API',
    apiReportedServerAddress: rep.apiReportedServerAddress ?? null,
    apiReportedServerAddressType: rep.apiReportedServerAddressType ?? null,
    vrApplianceHost: rep.vrApplianceHost ?? null,
    serverResolutionStatus: rep.serverResolutionStatus ?? null,
    
    // Nested observations for Canonical items
    observations: Array.isArray(rep.observations) ? rep.observations.map(mapReplicationToViewModel) : [],
    
    _raw: rep
  };
}

export function mapVrSitePairView(view) {
  if (!view || typeof view !== 'object') return null;
  return {
    viewKey: view.viewKey ?? null,
    localSiteName: view.localSiteName ?? null,
    localVcenterName: view.localVcenterName ?? null,
    localVcenterStableId: view.localVcenterStableId ?? null,
    localVcenterHost: view.localVcenterHost ?? null,
    remoteSiteName: view.remoteSiteName ?? null,
    remoteVcenterName: view.remoteVcenterName ?? null,
    remoteVcenterStableId: view.remoteVcenterStableId ?? null,
    remoteVcenterHost: view.remoteVcenterHost ?? null,
    preferredDirection: String(view.preferredDirection || '').toUpperCase() === 'INCOMING'
      ? 'INCOMING'
      : 'OUTGOING',
    incomingCanonicalReplicationKeys: Array.isArray(view.incomingCanonicalReplicationKeys)
      ? view.incomingCanonicalReplicationKeys.filter(Boolean)
      : [],
    outgoingCanonicalReplicationKeys: Array.isArray(view.outgoingCanonicalReplicationKeys)
      ? view.outgoingCanonicalReplicationKeys.filter(Boolean)
      : []
  };
}

export function unwrapApiEnvelope(payload, _contractName) {
  if (!payload || typeof payload !== 'object') {
    return { contractError: true, errorReason: 'Invalid payload format' };
  }
  
  if (payload.success !== true) {
    return { contractError: true, errorReason: payload.error || 'API reported failure' };
  }
  
  if (!payload.data || typeof payload.data !== 'object') {
    return { contractError: true, errorReason: 'Missing data object in envelope' };
  }
  
  return { 
    data: payload.data,
    state: payload.state || payload.data?.dataState || null,
    freshness: normalizeFreshness(payload.freshness || payload.data?.freshness),
    contractError: false
  };
}

export function normalizeFreshness(value) {
  if (!value || typeof value !== 'object') return null;
  const allowed = new Set(['FRESH', 'STALE', 'NEVER_COLLECTED', 'COLLECTION_FAILED', 'PARTIAL', 'NOT_AVAILABLE']);
  return {
    freshnessStatus: allowed.has(value.freshnessStatus) ? value.freshnessStatus : 'NOT_AVAILABLE',
    lastCollectedAt: value.lastCollectedAt ?? null,
    lastSuccessfulCollectionAt: value.lastSuccessfulCollectionAt ?? null,
    lastCollectionAttemptAt: value.lastCollectionAttemptAt ?? null,
    collectionAgeSeconds: value.collectionAgeSeconds !== null && value.collectionAgeSeconds !== undefined && Number.isFinite(Number(value.collectionAgeSeconds)) ? Number(value.collectionAgeSeconds) : null,
    collectionErrorType: value.collectionErrorType ?? null,
    collectionErrorCode: value.collectionErrorCode ?? null,
    staleSeverity: value.staleSeverity ?? null
  };
}

export function parseReplicationPayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'replications');
  if (unwrapped.contractError) {
    return { observations: [], canonicalReplications: [], unmappedObservations: [], canonicalRows: [], sitePairViews: [], metrics: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  
  const { data } = unwrapped;
  
  if (!Array.isArray(data.observations) || !Array.isArray(data.canonicalReplications) ||
      !Array.isArray(data.unmappedObservations) || !data.metrics || typeof data.state !== 'string') {
    return { observations: [], canonicalReplications: [], unmappedObservations: [], canonicalRows: [], sitePairViews: [], metrics: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  const rawObservations = data.observations;
  const rawCanonical = Array.isArray(data.canonicalReplications) ? data.canonicalReplications
    : Array.isArray(data.canonicalRows) ? data.canonicalRows : [];
  const rawUnmapped = Array.isArray(data.unmappedObservations) ? data.unmappedObservations : [];

  return {
    observations: rawObservations.map(mapReplicationToViewModel).filter(Boolean),
    canonicalReplications: rawCanonical.map(mapReplicationToViewModel).filter(Boolean),
    canonicalRows: rawCanonical.map(mapReplicationToViewModel).filter(Boolean),
    sitePairViews: Array.isArray(data.sitePairViews)
      ? data.sitePairViews.map(mapVrSitePairView).filter(view => view?.viewKey)
      : [],
    unmappedObservations: rawUnmapped.map(mapReplicationToViewModel).filter(Boolean),
    metrics: {
      logicalCount: data.metrics.logicalReplicationCount ?? null,
      observationCount: data.metrics.observationCount ?? null,
      mappedCount: data.metrics.mappedObservationCount ?? null,
      unmappedCount: data.metrics.unmappedObservationCount ?? null,
      protectedCount: data.metrics.protectedCount ?? null,
      unprotectedCount: data.metrics.unprotectedCount ?? null,
      protectionUnmappedCount: data.metrics.protectionUnmappedCount ?? null,
      outgoingObservationCount: data.metrics.outgoingObservationCount ?? null,
      incomingObservationCount: data.metrics.incomingObservationCount ?? null
    },
    state: data.state || 'SUCCESS',
    dataState: data.dataState || unwrapped.state || 'SUCCESS',
    freshness: unwrapped.freshness,
    collectionRunIds: Array.isArray(data.collectionRunIds) ? data.collectionRunIds : [],
    contractError: false
  };
}

export function parseProtectionGroupPayload(payload) {
  // Preserve the pre-envelope read contract for older cached clients while the
  // current API continues to use the canonical success envelope.
  if (payload && payload.success === undefined) {
    const legacyData = payload.data;
    const observations = Array.isArray(legacyData)
      ? legacyData
      : (Array.isArray(legacyData?.observations) ? legacyData.observations : []);
    const canonicalGroups = Array.isArray(legacyData?.canonicalGroups) ? legacyData.canonicalGroups : [];
    const unmappedObservations = Array.isArray(legacyData)
      ? legacyData
      : observations.filter(row => (row.canonicalIdentityStatus ?? row.canonical_identity_status) !== 'COMPLETE');
    return {
      observations: observations.map(mapProtectionGroupToViewModel).filter(Boolean),
      canonicalGroups: canonicalGroups.map(mapProtectionGroupToViewModel).filter(Boolean),
      canonicalRows: canonicalGroups.map(mapProtectionGroupToViewModel).filter(Boolean),
      unmappedObservations: unmappedObservations.map(mapProtectionGroupToViewModel).filter(Boolean),
      metrics: {},
      state: observations.length ? 'SUCCESS' : 'SUCCESS_EMPTY',
      dataState: 'SUCCESS',
      freshness: null,
      contractError: false
    };
  }
  const unwrapped = unwrapApiEnvelope(payload, 'protectionGroups');
  if (unwrapped.contractError) {
    return { observations: [], canonicalGroups: [], unmappedObservations: [], metrics: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  
  const { data } = unwrapped;
  if (!Array.isArray(data.observations) || !Array.isArray(data.canonicalGroups) || !Array.isArray(data.unmappedObservations) || !data.metrics) {
    return { observations: [], canonicalGroups: [], unmappedObservations: [], metrics: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  const rawObs = data.observations;
  const rawCanonical = data.canonicalGroups;
  const rawUnmapped = data.unmappedObservations;

  return {
    observations: rawObs.map(mapProtectionGroupToViewModel).filter(Boolean),
    canonicalGroups: rawCanonical.map(mapProtectionGroupToViewModel).filter(Boolean),
    canonicalRows: rawCanonical.map(mapProtectionGroupToViewModel).filter(Boolean),
    unmappedObservations: rawUnmapped.map(mapProtectionGroupToViewModel).filter(Boolean),
    metrics: data.metrics || {},
    state: data.state || 'SUCCESS',
    dataState: data.dataState || unwrapped.state || 'SUCCESS',
    freshness: unwrapped.freshness,
    contractError: false
  };
}

export function mapProtectionGroupToViewModel(pg) {
  if (!pg) return null;
  return {
    id: pg.observationId ?? pg.id ?? pg.protectionGroupId ?? pg.protection_group_id ?? null,
    connectionId: pg.connectionId ?? pg.connection_id ?? null,
    pairingId: pg.pairingId ?? pg.pairing_id ?? null,
    rowKey: pg.canonicalKey ?? pg.canonical_key ?? pg.protectionGroupId ?? pg.protection_group_id ?? null,
    canonicalKey: pg.canonicalKey ?? pg.canonical_key ?? null,
    canonicalIdentityStatus: pg.canonicalIdentityStatus ?? pg.canonical_identity_status ?? 'INSUFFICIENT',
    observationCount: pg.observationCount ?? pg.observation_count ?? null,
    observationSiteName: pg.observationSiteName ?? null,
    observationSrmName: pg.observationSrmName ?? pg.observation_srm_name ?? null,
    observationSrmHost: pg.observationSrmHost ?? pg.observation_srm_host ?? null,
    observationVcenterName: pg.observationVcenterName ?? pg.observation_vcenter_name ?? null,
    observationVcenterHost: pg.observationVcenterHost ?? pg.observation_vcenter_host ?? null,
    
    protectionGroupId: pg.protectionGroupId ?? pg.protection_group_id ?? null,
    name: pg.name ?? null,
    protectionGroupName: pg.name ?? pg.protectionGroupName ?? null,
    description: pg.description ?? null,
    type: pg.type ?? pg.protectionType ?? pg.replicationType ?? pg.group_type ?? 'Not provided by API',
    replicationType: pg.replicationType ?? pg.protectionType ?? pg.type ?? pg.group_type ?? null,
    protectionType: pg.protectionType ?? pg.replicationType ?? pg.type ?? pg.group_type ?? null,
    
    status: pg.normalizedStatus ?? pg.normalized_status ?? pg.rawStatus ?? pg.raw_status ?? pg.status ?? 'NOT_PROVIDED_BY_API',
    normalizedStatus: pg.normalizedStatus ?? pg.normalized_status ?? pg.rawStatus ?? pg.raw_status ?? pg.status ?? 'NOT_PROVIDED_BY_API',
    protectionStatus: pg.protectionStatus ?? pg.normalizedStatus ?? pg.normalized_status ?? pg.rawStatus ?? pg.raw_status ?? pg.status ?? 'NOT_PROVIDED_BY_API',
    rawRecoveryStatus: pg.rawRecoveryStatus ?? pg.raw_recovery_status ?? null,
    normalizedRecoveryStatus: pg.normalizedRecoveryStatus ?? pg.normalized_recovery_status ?? pg.rawRecoveryStatus ?? pg.raw_recovery_status ?? null,
    recoveryStatus: pg.recoveryStatus ?? pg.normalizedRecoveryStatus ?? pg.normalized_recovery_status ?? pg.rawRecoveryStatus ?? pg.raw_recovery_status ?? 'NOT_PROVIDED_BY_API',
    
    protectedSite: pg.protectedSiteName ?? pg.protected_site_name ?? pg.protected_site ?? pg.protectedVcenterName ?? pg.protected_vcenter_name ?? (pg.canonicalIdentityStatus === 'COMPLETE' ? 'Not provided by API' : 'Unmapped identity'),
    recoverySite: pg.recoverySiteName ?? pg.recovery_site_name ?? pg.recovery_site ?? pg.recoveryVcenterName ?? pg.recovery_vcenter_name ?? (pg.canonicalIdentityStatus === 'COMPLETE' ? 'Not provided by API' : 'Unmapped identity'),
    protectedSiteName: pg.protectedSiteName ?? pg.protected_site_name ?? null,
    recoverySiteName: pg.recoverySiteName ?? pg.recovery_site_name ?? null,
    
    vmCount: pg.vmCount ?? pg.vm_count ?? null,
    vmCountResolutionStatus: pg.vmCountResolutionStatus ?? null,
    protectedVmCount: pg.protectedVmCount ?? null,
    protectedVms: Array.isArray(pg.protectedVms) ? pg.protectedVms : [],
    recoveryPlanCount: pg.recoveryPlanCount ?? null,
    recoveryPlans: Array.isArray(pg.recoveryPlans) ? pg.recoveryPlans : [],
    issueCount: pg.issueCount ?? pg.issue_count ?? null,
    protectedVcenterName: pg.protectedVcenterName ?? null,
    protectedVcenterHost: pg.protectedVcenterHost ?? null,
    recoveryVcenterName: pg.recoveryVcenterName ?? null,
    recoveryVcenterHost: pg.recoveryVcenterHost ?? null,
    
    lastObservationAt: pg.lastObservationAt ?? pg.last_seen_at ?? pg.last_sync ?? null,
    lastCollectedAt: pg.lastCollectedAt ?? pg.lastObservationAt ?? pg.last_seen_at ?? null,
    lastSync: pg.lastObservationAt ?? pg.last_seen_at ?? pg.last_sync ?? null, // alias for ProtectionGroupsTable
    
    observations: Array.isArray(pg.observations) ? pg.observations.map(mapProtectionGroupToViewModel) : [],
    _raw: pg
  };
}

export function parseRecoveryPlanPayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'recoveryPlans');
  if (unwrapped.contractError) {
    return { observations: [], canonicalPlans: [], unmappedObservations: [], metrics: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  
  const { data } = unwrapped;
  if (!Array.isArray(data.observations) || !Array.isArray(data.canonicalPlans) || !Array.isArray(data.unmappedObservations) || !data.metrics) {
    return { observations: [], canonicalPlans: [], unmappedObservations: [], metrics: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  const rawObs = data.observations;
  const rawCanonical = data.canonicalPlans;
  const rawUnmapped = data.unmappedObservations;

  return {
    observations: rawObs.map(mapRecoveryPlanToViewModel).filter(Boolean),
    canonicalPlans: rawCanonical.map(mapRecoveryPlanToViewModel).filter(Boolean),
    canonicalRows: rawCanonical.map(mapRecoveryPlanToViewModel).filter(Boolean),
    unmappedObservations: rawUnmapped.map(mapRecoveryPlanToViewModel).filter(Boolean),
    metrics: data.metrics || {},
    state: data.state || 'SUCCESS',
    dataState: data.dataState || unwrapped.state || 'SUCCESS',
    freshness: unwrapped.freshness,
    contractError: false
  };
}

export function mapRecoveryPlanToViewModel(rp) {
  if (!rp) return null;
  return {
    id: rp.observationId ?? rp.id ?? null,
    connectionId: rp.connectionId ?? rp.connection_id ?? null,
    pairingId: rp.pairingId ?? rp.pairing_id ?? null,
    rowKey: rp.canonicalKey ?? rp.canonical_key ?? rp.recoveryPlanId ?? rp.recovery_plan_id ?? null,
    canonicalKey: rp.canonicalKey ?? rp.canonical_key ?? null,
    canonicalIdentityStatus: rp.canonicalIdentityStatus ?? rp.canonical_identity_status ?? 'INSUFFICIENT',
    observationCount: rp.observationCount ?? null,
    observationSiteName: rp.observationSiteName ?? null,
    
    recoveryPlanId: rp.recoveryPlanId ?? rp.recovery_plan_id ?? null,
    name: rp.name ?? null,
    recoveryPlanName: rp.name ?? rp.recoveryPlanName ?? null,
    
    status: rp.normalizedStatus ?? rp.normalized_status ?? rp.rawStatus ?? rp.raw_status ?? rp.status ?? 'NOT_PROVIDED_BY_API',
    normalizedStatus: rp.normalizedStatus ?? rp.normalized_status ?? rp.rawStatus ?? rp.raw_status ?? rp.status ?? 'NOT_PROVIDED_BY_API',
    
    protectedSite: rp.protectedVcenterName ?? rp.protectedSiteName ?? rp.protected_vcenter_name ?? rp.protected_site_name ?? rp.protected_site ?? (rp.canonicalIdentityStatus === 'COMPLETE' ? 'Not provided by API' : 'Unmapped identity'),
    recoverySite: rp.recoveryVcenterName ?? rp.recoverySiteName ?? rp.recovery_vcenter_name ?? rp.recovery_site_name ?? rp.recovery_site ?? (rp.canonicalIdentityStatus === 'COMPLETE' ? 'Not provided by API' : 'Unmapped identity'),
    protectedSiteName: rp.protectedSiteName ?? rp.protected_site_name ?? null,
    recoverySiteName: rp.recoverySiteName ?? rp.recovery_site_name ?? null,
    
    protectionGroupCount: rp.protectionGroupCount ?? rp.protection_group_count ?? null,
    protectionGroupCountResolutionStatus: rp.protectionGroupCountResolutionStatus ?? null,
    protectionGroupIds: [...new Set((rp.protectionGroupIds ?? rp.protection_group_ids ?? []).filter(Boolean).map(String))],
    protectionGroupNames: [...new Set((rp.protectionGroupNames ?? rp.protection_group_names ?? []).filter(Boolean).map(String))],
    vmCount: rp.vmCount ?? rp.vm_count ?? null,
    vmCountResolutionStatus: rp.vmCountResolutionStatus ?? null,
    issueCount: rp.issueCount ?? rp.issue_count ?? null,
    protectedVcenterName: rp.protectedVcenterName ?? null,
    protectedVcenterHost: rp.protectedVcenterHost ?? null,
    recoveryVcenterName: rp.recoveryVcenterName ?? null,
    recoveryVcenterHost: rp.recoveryVcenterHost ?? null,

    operationTaskId: rp.operationTaskId ?? rp.operation_task_id ?? null,
    operationStatus: rp.operationStatus ?? rp.operation_status ?? null,
    operationProgressPercent: rp.operationProgressPercent ?? rp.operation_progress_percent ?? null,
    operationStartedAt: rp.operationStartedAt ?? rp.operation_started_at ?? null,
    operationCompletedAt: rp.operationCompletedAt ?? rp.operation_completed_at ?? null,
    operationDescription: rp.operationDescription ?? rp.operation_description ?? null,
    operationResolutionStatus: rp.operationResolutionStatus ?? rp.operation_resolution_status ?? 'NOT_AVAILABLE',
    
    lastRunType: rp.lastRunType ?? rp.last_run_type ?? null,
    lastRunStatus: rp.lastRunStatus ?? rp.last_run_status ?? 'NOT_RUN',
    lastRunStartedAt: rp.lastRunStartedAt ?? rp.last_run_started_at ?? null,
    lastRunTime: rp.lastRunStartedAt ?? rp.last_run_started_at ?? rp.lastRunTime ?? rp.last_run_time ?? null, // alias for RecoveryPlansTable
    lastRunCompletedAt: rp.lastRunCompletedAt ?? rp.last_run_completed_at ?? null,
    lastRunDuration: rp.lastRunDuration ?? rp.last_run_duration ?? null,
    historyResolutionStatus: rp.historyResolutionStatus ?? null,
    lastObservationAt: rp.lastObservationAt ?? rp.last_seen_at ?? null,
    lastCollectedAt: rp.lastCollectedAt ?? rp.lastObservationAt ?? rp.last_seen_at ?? null,
    
    observations: Array.isArray(rp.observations) ? rp.observations.map(mapRecoveryPlanToViewModel) : [],
    _raw: rp
  };
}

export function parseVrServersPayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'servers');
  
  let rows = [];
  let contractError = unwrapped.contractError;
  
  if (!contractError && Array.isArray(unwrapped.data.replicationServers)) {
    rows = unwrapped.data.replicationServers;
  } else if (!contractError && Array.isArray(unwrapped.data.observations)) {
    rows = unwrapped.data.observations;
  } else if (!contractError && Array.isArray(unwrapped.data)) {
    rows = unwrapped.data;
  } else {
    contractError = true;
  }

  const map = new Map();
  rows.forEach(s => {
    // Stable key: site/connection + server_uuid
    const key = `conn-${s.connection_id}-pairing-${s.pairing_id || 'null'}-server-${s.server_uuid || s.server_id || s.id}`;
    if (!key) return;
    
    if (!map.has(key)) {
      const isEmbedded = ['127.0.0.1', 'localhost', '::1'].includes(s.hostname) || ['127.0.0.1', 'localhost', '::1'].includes(s.name);
      
      map.set(key, {
        id: key,
        stableKey: key,
        canonicalIdentityStatus: 'COMPLETE',
        observationCount: 1,

        connectionId: s.connection_id,
        associatedVcenterId: s.vrms_id,
        site: s.server_scope,
        pairingId: s.pairing_id,
        serverId: s.server_id,
        serverUuid: s.server_uuid,

        name: s.name || null,
        hostname: s.hostname || null,
        address: null,
        addressAvailability: 'NOT_PROVIDED_BY_API',
        port: null,

        serverType: isEmbedded ? 'EMBEDDED' : 'STANDARD',

        rawStatus: s.status || null,
        normalizedStatus: typeof s.connected === 'boolean' ? (s.connected ? 'CONNECTED' : 'DISCONNECTED') : (s.status || 'UNKNOWN'),
        connected: typeof s.connected === 'boolean' ? s.connected : null,

        version: null,
        versionAvailability: 'NOT_PROVIDED_BY_API',
        build: null,

        internallyManaged: s.internally_managed,
        decommissioned: s.decommissioned,
        replicationCount: s.replication_count,

        lastSeenAt: s.last_seen_at || null,
        observations: [s]
      });
    } else {
      const existing = map.get(key);
      existing.observations.push(s);
      existing.observationCount += 1;
    }
  });
  
  return {
    observations: Array.from(map.values()),
    contractError: contractError
  };
}

export function mapInventoryMappingToViewModel(mapping) {
  if (!mapping) return null;
  
  const normalizedStatus = mapping.normalizedStatus || mapping.normalized_status || mapping.resolved_mapping_status || mapping.mapping_status || 'UNMAPPED_IDENTITY';
  
  let type = mapping.mapping_type || 'UNSUPPORTED';
  if (type.includes('Network')) type = type.includes('Test') ? 'TEST_NETWORK' : 'NETWORK';
  else if (type.includes('Folder')) type = 'FOLDER';
  else if (type.includes('Resource') || type.includes('Compute')) type = 'RESOURCE';
  else if (type.includes('Storage')) type = 'STORAGE_POLICY';

  const mappingId = mapping.mapping_id || mapping.mappingId || (typeof mapping.id === 'string' && mapping.id.includes(':') ? mapping.id.split(':').pop() : mapping.id) || null;
  const connectionId = mapping.connection_id || mapping.connectionId || (typeof mapping.id === 'string' && mapping.id.includes(':') ? mapping.id.split(':')[0] : null) || null;
  const pairingId = mapping.pairing_id || mapping.pairingId || (typeof mapping.id === 'string' && mapping.id.includes(':') ? mapping.id.split(':')[1] : null) || null;

  return {
    id: mapping.mappingKey || mapping.mapping_id || mapping.id,
    mappingKey: mapping.mappingKey || null,
    mappingId,
    connectionId,
    pairingId,
    pairId: mapping.pair_id || mapping.pairId || null,
    mappingType: type,
    observationSiteName: mapping.observationSiteName || mapping.observation_site_name || null,
    sourceSite: mapping.resolved_source_site || mapping.source_site_name || null,
    sourceVcenterName: mapping.source_vcenter_name || null,
    sourceVcenterHost: mapping.source_vcenter_host || null,
    sourceObjectId: mapping.source_object_id || null,
    sourceObjectName: mapping.source_item_name || mapping.source_object_name || null,
    sourceObject: mapping.source_item_name || mapping.source_object_name || null,
    sourceDisplayName: mapping.source_display_name || mapping.source_resolved_policy_name || mapping.source_item_name || mapping.source_object_name || null,
    sourceDisplayType: mapping.source_display_type || null,
    sourceDisplayResolutionSource: mapping.source_display_resolution_source || null,
    sourceType: mapping.source_object_type || type,
    sourceObjectNameAvailability: mapping.source_object_name_availability || null,
    sourceObjectResolutionStatus: mapping.source_object_resolution_status || null,
    sourceObjectResolutionSource: mapping.source_object_resolution_source || null,
    sourceVcenterStableId: mapping.source_vcenter_stable_id || null,
    targetSite: mapping.resolved_target_site || mapping.target_site_name || null,
    targetVcenterName: mapping.target_vcenter_name || null,
    targetVcenterHost: mapping.target_vcenter_host || null,
    targetObjectId: mapping.target_object_id || null,
    targetObjectName: mapping.target_item_name || mapping.target_object_name || null,
    targetObject: mapping.target_item_name || mapping.target_object_name || null,
    targetDisplayName: mapping.target_display_name || mapping.target_resolved_policy_name || mapping.target_item_name || mapping.target_object_name || null,
    targetDisplayType: mapping.target_display_type || null,
    targetDisplayResolutionSource: mapping.target_display_resolution_source || null,
    targetType: mapping.target_object_type || type,
    targetObjectNameAvailability: mapping.target_object_name_availability || null,
    targetObjectResolutionStatus: mapping.target_object_resolution_status || null,
    targetObjectResolutionSource: mapping.target_object_resolution_source || null,
    targetVcenterStableId: mapping.target_vcenter_stable_id || null,
    sourceResourcePool: mapping.source_resource_pool || null,
    sourceResourceParent: mapping.source_resource_parent || null,
    sourceComputeContainer: mapping.source_compute_container || null,
    sourceResourceHierarchyStatus: mapping.source_resource_hierarchy_status || null,
    sourceResourceHierarchySource: mapping.source_resource_hierarchy_source || null,
    targetResourcePool: mapping.target_resource_pool || null,
    targetResourceParent: mapping.target_resource_parent || null,
    targetComputeContainer: mapping.target_compute_container || null,
    targetResourceHierarchyStatus: mapping.target_resource_hierarchy_status || null,
    targetResourceHierarchySource: mapping.target_resource_hierarchy_source || null,
    sourceApiReportedPolicyName: mapping.source_api_reported_policy_name ?? null,
    sourceResolvedPolicyName: mapping.source_resolved_policy_name ?? null,
    sourcePolicyNameAvailability: mapping.source_policy_name_availability || null,
    sourcePolicyResolutionStatus: mapping.source_policy_resolution_status || null,
    sourcePolicyResolutionSource: mapping.source_policy_resolution_source || null,
    sourcePolicyVcenterStableId: mapping.source_policy_vcenter_stable_id || null,
    sourcePolicyVcenterHost: mapping.source_policy_vcenter_host || null,
    targetApiReportedPolicyName: mapping.target_api_reported_policy_name ?? null,
    targetResolvedPolicyName: mapping.target_resolved_policy_name ?? null,
    targetPolicyNameAvailability: mapping.target_policy_name_availability || null,
    targetPolicyResolutionStatus: mapping.target_policy_resolution_status || null,
    targetPolicyResolutionSource: mapping.target_policy_resolution_source || null,
    targetPolicyVcenterStableId: mapping.target_policy_vcenter_stable_id || null,
    targetPolicyVcenterHost: mapping.target_policy_vcenter_host || null,
    status: normalizedStatus,
    normalizedStatus,
    siteResolutionStatus: mapping.site_resolution_status || null,
    siteResolutionEvidence: mapping.site_resolution_evidence || [],
    fetchStatus: mapping.fetchStatus || mapping.fetch_status || null,
    freshnessStatus: mapping.freshnessStatus || mapping.freshness_status || null,
    stale: mapping.stale === true,
    collectionErrorCode: mapping.collectionErrorCode || mapping.collection_error_code || null,
    dataSource: mapping.data_source || 'REST',
    reverseMapping: mapping.reverse_mapping ?? null,
    reverseMappingAvailability: mapping.reverse_mapping_availability || 'NOT_PROVIDED_BY_API',
    reverseRecoveryObjectId: mapping.reverse_recovery_object_id ?? null,
    reverseRecoveryObjectName: mapping.reverse_recovery_object_name ?? null,
    testNetworkMapping: mapping.test_network_mapping ?? null,
    testNetworkId: mapping.test_network_id ?? null,
    testNetworkName: mapping.test_network_name ?? null,
    testNetworkResolutionStatus: mapping.test_network_resolution_status || 'NOT_PROVIDED_BY_API',
    ipCustomization: mapping.ip_customization == null
      ? null
      : (typeof mapping.ip_customization === 'string' ? mapping.ip_customization : JSON.stringify(mapping.ip_customization)),
    ipCustomizationAvailability: mapping.ip_customization_availability || 'NOT_PROVIDED_BY_API',
    lastCollectedAt: mapping.last_collected_at ?? mapping.updated_at ?? mapping.last_seen_at ?? mapping.created_at ?? null,
    lastSuccessfulCollectionAt: mapping.last_successful_collection_at ?? mapping.updated_at ?? mapping.last_seen_at ?? null,
    lastCollectionAttemptAt: mapping.last_collection_attempt_at ?? null,
    _raw: mapping
  };
}

export function parseInventoryMappingPayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'inventoryMappings');
  if (unwrapped.contractError || !Array.isArray(unwrapped.data.observations) || !unwrapped.data.metrics || !unwrapped.data.scopeStates) {
    return { observations: [], metrics: {}, scopeStates: {}, state: 'CONTRACT_ERROR', contractError: true };
  }
  return {
    observations: unwrapped.data.observations.map(mapInventoryMappingToViewModel).filter(Boolean),
    metrics: unwrapped.data.metrics,
    scopeStates: unwrapped.data.scopeStates,
    state: unwrapped.data.scopeStatus || 'SUCCESS',
    dataState: unwrapped.data.dataState || unwrapped.state || 'SUCCESS',
    freshness: unwrapped.freshness,
    contractError: false
  };
}

export function parsePlaceholderDatastorePayload(payload) {
  const unwrapped = unwrapApiEnvelope(payload, 'placeholderDatastores');
  if (unwrapped.contractError) {
    return { observations: [], scopeState: null, contractError: true };
  }
  
  const { data } = unwrapped;
  const rawRows = Array.isArray(data)
    ? data
    : Array.isArray(data?.observations)
      ? data.observations
      : Array.isArray(data?.data)
        ? data.data
        : [];
  const mapped = rawRows.map(mapPlaceholderDatastoreToViewModel).filter(Boolean);
  
  return {
    data: mapped,
    observations: mapped,
    scopeState: data && !Array.isArray(data) ? (data.scopeState || null) : null,
    freshness: data && !Array.isArray(data) ? (data.freshness || unwrapped.freshness || null) : unwrapped.freshness,
    dataState: data && !Array.isArray(data) ? (data.dataState || unwrapped.state || null) : unwrapped.state,
    contractError: false
  };
}

export function mapPlaceholderDatastoreToViewModel(ds) {
  if (!ds) return null;
  return {
    id: ds.id,
    connectionId: ds.connection_id ?? null,
    pairingId: ds.pairing_id ?? null,
    srmId: ds.srm_id,
    placeholderDatastoreId: ds.placeholder_datastore_id,
    observationId: ds.observation_id ?? ds.id,
    siteName: ds.site_name || null,
    siteRole: ds.site_role || ds.server_scope || null,
    vcenterStableId: ds.vcenter_stable_id || ds.vcenter_external_id || null,
    vcenterHost: ds.vcenter_host || null,
    datastoreName: ds.datastore_name || null,
    datastoreNameAvailability: ds.datastore_name_availability || 'NOT_PROVIDED_BY_API',
    datastoreMoid: ds.datastore_moid || null,
    hostClusterName: ds.host_cluster_name || null,
    inventoryMatchStatus: ds.inventory_match_status || 'NOT_PROVIDED_BY_API',
    status: ds.inventory_match_status || ds.datastore_status || 'NOT_PROVIDED_BY_API',
    capacityBytes: ds.capacity_bytes,
    freeSpaceBytes: ds.free_space_bytes,
    dataSource: ds.data_source || 'REST',
    lastCollectedAt: ds.last_seen_at || ds.created_at || null,
    _raw: ds
  };
}
