/**
 * Resolves Inventory Mapping Source and Target Sites
 */
exports.resolveMappingSites = (
  mappingRow,
  sitePairContext
) => {
  let sourceSite = null;
  let targetSite = null;

  let mappingStatus =
    'UNMAPPED_IDENTITY';

  const evidence = [];

  if (sitePairContext?.localSiteName) {
    sourceSite =
      sitePairContext.localSiteName;

    evidence.push(
      'OBSERVATION_CONNECTION+LOCAL_VCENTER_STABLE_ID'
    );
  }

  if (sitePairContext?.remoteSiteName) {
    targetSite =
      sitePairContext.remoteSiteName;

    evidence.push(
      'SRM_PAIRING+REMOTE_VCENTER_STABLE_ID'
    );
  }

  // Evaluate final status strictly
  if (mappingRow.fetch_status === 'FAILED') {
    mappingStatus = 'FETCH_FAILED';
  } else if (
    sourceSite &&
    targetSite &&
    mappingRow.source_object_id &&
    mappingRow.target_object_id
  ) {
    mappingStatus = mappingRow.stale
      ? 'STALE'
      : 'PRESENT';
  }

  // Specifically for Storage Policies that aren't fully supported
  if (
    mappingRow.mapping_type ===
      'STORAGE_POLICY' &&
    mappingRow.capability_status ===
      'UNSUPPORTED'
  ) {
    mappingStatus = 'UNSUPPORTED';
  }

  return {
    sourceSite,
    targetSite,

    sourceVcenterName:
      sitePairContext?.localVcenterName ||
      null,

    sourceVcenterHost:
      sitePairContext?.localVcenterHost ||
      null,

    targetVcenterName:
      sitePairContext?.remoteVcenterName ||
      null,

    targetVcenterHost:
      sitePairContext?.remoteVcenterHost ||
      null,

    mappingStatus,

    siteResolutionStatus:
      sourceSite && targetSite
        ? 'PRESENT'
        : 'UNMAPPED_IDENTITY',

    siteResolutionEvidence:
      evidence
  };
};