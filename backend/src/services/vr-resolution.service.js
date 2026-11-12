/**
 * VR Resolution Service
 * 
 * Centralizes the logic to resolve VR Site Identities and Pairing Types,
 * removing it from the Repository or Controller layer.
 */

/**
 * Resolves Source and Target Sites for a replication based on verified stable IDs
 * and pairing context.
 * 
 * @param {Object} replicationRow The raw replication row from vr_replications
 * @param {Map} vcUuidMap A map of {uuid: fqdn} for known vCenter sites (e.g. from pairings)
 * @param {Object} connectionContext Connection context for the active connection
 */
exports.resolveReplicationRoute = (
  replicationRow,
  vcUuidMap,
  pairingContext,
  connectionContext
) => {
  const sourceUuid =
    replicationRow.source_vc_id;

  const targetUuid =
    replicationRow.target_vc_id;

  let logicalSourceSiteName =
    replicationRow.source_site_name ||
    null;

  let logicalTargetSiteName =
    replicationRow.target_site_name ||
    null;

  let routeResolutionStatus =
    'UNMAPPED_IDENTITY';

  let routeResolutionEvidence = [];

  // 1. Resolve from Stable Identity Maps (UUID to FQDN/Site Name)
  if (
    sourceUuid &&
    vcUuidMap.has(sourceUuid)
  ) {
    logicalSourceSiteName =
      vcUuidMap.get(sourceUuid);

    routeResolutionEvidence.push(
      'RESOLVED_SOURCE_VIA_UUID_MAP'
    );
  }

  if (
    targetUuid &&
    vcUuidMap.has(targetUuid)
  ) {
    logicalTargetSiteName =
      vcUuidMap.get(targetUuid);

    routeResolutionEvidence.push(
      'RESOLVED_TARGET_VIA_UUID_MAP'
    );
  }

  // 3. Pairing Context (if provided)
  const pairingLocal =
    pairingContext?.pairingLocalSite;

  const pairingRemote =
    pairingContext?.pairingRemoteSite;

  const isIncoming =
    replicationRow.direction ===
    'INCOMING';

  const isOutgoing =
    replicationRow.direction ===
    'OUTGOING';

  if (
    !logicalSourceSiteName &&
    (
      isOutgoing
        ? pairingLocal
        : isIncoming
          ? pairingRemote
          : null
    )
  ) {
    logicalSourceSiteName =
      isOutgoing
        ? pairingLocal
        : pairingRemote;

    routeResolutionEvidence.push(
      'INFERRED_SOURCE_VIA_PAIRING_CONTEXT'
    );
  }

  if (
    !logicalTargetSiteName &&
    (
      isIncoming
        ? pairingLocal
        : isOutgoing
          ? pairingRemote
          : null
    )
  ) {
    logicalTargetSiteName =
      isIncoming
        ? pairingLocal
        : pairingRemote;

    routeResolutionEvidence.push(
      'INFERRED_TARGET_VIA_PAIRING_CONTEXT'
    );
  }

  // 4. Observation Connection Context + 5. Direction (as supplementary fallback)
  if (
    !logicalSourceSiteName ||
    !logicalTargetSiteName
  ) {
    const connSite =
      connectionContext?.site;

    // We strictly use direction to infer local site, NEVER to swap remote without pairing context
    if (isOutgoing) {
      if (
        !logicalSourceSiteName &&
        connSite
      ) {
        logicalSourceSiteName =
          connSite;

        routeResolutionEvidence.push(
          'INFERRED_SOURCE_VIA_OUTGOING_CONNECTION'
        );
      }
    } else if (isIncoming) {
      if (
        !logicalTargetSiteName &&
        connSite
      ) {
        logicalTargetSiteName =
          connSite;

        routeResolutionEvidence.push(
          'INFERRED_TARGET_VIA_INCOMING_CONNECTION'
        );
      }
    }
  }

  if (
    logicalSourceSiteName &&
    logicalTargetSiteName
  ) {
    routeResolutionStatus = 'PRESENT';
  } else if (
    !logicalSourceSiteName &&
    !logicalTargetSiteName
  ) {
    routeResolutionStatus =
      'UNMAPPED_IDENTITY';
  } else {
    routeResolutionStatus =
      'PARTIAL_IDENTITY';
  }

  return {
    logicalSourceSiteName,
    logicalTargetSiteName,

    logicalSourceVcenterName:
      logicalSourceSiteName,

    logicalTargetVcenterName:
      logicalTargetSiteName,

    logicalSourceVcenterStableId:
      sourceUuid,

    logicalTargetVcenterStableId:
      targetUuid,

    logicalSourceVcenterHost: null,
    logicalTargetVcenterHost: null,

    observationSiteName:
      connectionContext?.site ||
      null,

    observationDirection:
      replicationRow.direction,

    routeResolutionStatus,

    routeResolutionEvidence:
      routeResolutionEvidence.join(',')
  };
};

exports.classifyPairing = (
  localVcenterId,
  remoteVcenterId
) => {
  if (
    !localVcenterId ||
    !remoteVcenterId
  ) {
    return {
      pairingType: 'UNKNOWN',
      isSelfPairing: false,
      remoteSessionStatus:
        'NOT_APPLICABLE'
    };
  }

  const isSelf =
    localVcenterId ===
    remoteVcenterId;

  if (isSelf) {
    return {
      pairingType: 'SELF',
      isSelfPairing: true,
      remoteSessionStatus:
        'NOT_APPLICABLE'
    };
  }

  return {
    pairingType: 'CROSS_SITE',
    isSelfPairing: false,
    remoteSessionStatus: 'UNKNOWN'
  };
};

exports.resolveReplicationObservationContext = (
  replicationObservation,
  connectionContext,
  pairingContext,
  vcenterIdentityMap
) => {
  const observationId =
    replicationObservation.id;

  const observationConnectionId =
    replicationObservation.connection_id;

  const observationSiteName =
    connectionContext?.site || null;

  const observationDirection =
    replicationObservation.direction;

  let localSiteName =
    observationSiteName;

  let remoteSiteName = null;

  if (pairingContext) {
    localSiteName =
      pairingContext.pairingLocalSite;

    remoteSiteName =
      pairingContext.pairingRemoteSite;
  }

  // Determine Logical Route based on Direction
  let logicalSourceSiteName = null;
  let logicalTargetSiteName = null;

  let logicalSourceVcenterStableId =
    null;

  let logicalTargetVcenterStableId =
    null;

  if (
    observationDirection ===
    'OUTGOING'
  ) {
    logicalSourceSiteName =
      localSiteName;

    logicalTargetSiteName =
      remoteSiteName;

    logicalSourceVcenterStableId =
      connectionContext?.base_url;
  } else if (
    observationDirection ===
    'INCOMING'
  ) {
    // INCOMING means we are observing from the target site.
    // The logical target is our local site.
    logicalTargetSiteName =
      localSiteName;

    logicalSourceSiteName =
      remoteSiteName;

    logicalTargetVcenterStableId =
      connectionContext?.base_url;
  }

  let routeResolutionStatus =
    'PRESENT';

  let routeResolutionEvidence =
    'OBSERVATION_DIRECTION';

  if (
    !logicalSourceSiteName ||
    !logicalTargetSiteName
  ) {
    routeResolutionStatus =
      'PARTIAL_IDENTITY';
  }

  return {
    observationId,
    observationConnectionId,
    observationSiteName,

    observationSiteRole:
      observationDirection ===
      'INCOMING'
        ? 'TARGET'
        : 'SOURCE',

    observationDirection,

    localSiteName,
    localVcenterStableId: null,
    localVcenterName:
      localSiteName,
    localVcenterHost: null,

    remoteSiteName,
    remoteVcenterStableId: null,
    remoteVcenterName:
      remoteSiteName,
    remoteVcenterHost: null,

    logicalSourceSiteName,
    logicalSourceVcenterStableId,

    logicalSourceVcenterName:
      logicalSourceSiteName,

    logicalSourceVcenterHost: null,

    logicalTargetSiteName,
    logicalTargetVcenterStableId,

    logicalTargetVcenterName:
      logicalTargetSiteName,

    logicalTargetVcenterHost: null,

    routeResolutionStatus,
    routeResolutionEvidence
  };
};