// Required systems for this platform are vCenter, VR and SRM. HTTP 200 and last
// sync SUCCESS alone never establish health. API limitations are not incidents.
function buildSystemHealth({
  freshness = {},
  issueCount = null,
  issueDetails = [],
  failedScopes = 0,
  srmOverallState = 'NOT_AVAILABLE',
  requiredSystems = ['vcenter', 'vr', 'srm']
} = {}) {
  const states = requiredSystems.map(
    key =>
      freshness[key]?.freshnessStatus ||
      'NOT_AVAILABLE'
  );

  const critical = issueDetails.some(
    issue =>
      ['CRITICAL', 'ERROR'].includes(
        String(issue.severity).toUpperCase()
      ) &&
      issue.issue_type !== 'API_LIMITATION' &&
      issue.issue_type !== 'NOT_PROVIDED_BY_API'
  );

  let status;

  if (
    critical ||
    states.every(
      state => state === 'COLLECTION_FAILED'
    )
  ) {
    status = 'ERROR';
  } else if (
    failedScopes ||
    states.some(
      state =>
        ['PARTIAL', 'COLLECTION_FAILED']
          .includes(state)
    ) ||
    (
      ['FAILED', 'PARTIAL']
        .includes(srmOverallState) &&
      !states.includes('STALE')
    )
  ) {
    status = 'PARTIAL';
  } else if (
    states.some(
      state =>
        [
          'NEVER_COLLECTED',
          'NEVER_SYNCED',
          'NOT_AVAILABLE',
          'UNKNOWN'
        ].includes(state)
    ) ||
    issueCount == null
  ) {
    status = 'UNKNOWN';
  } else if (
    states.includes('STALE') ||
    issueCount > 0
  ) {
    status = 'WARNING';
  } else if (
    states.every(
      state => state === 'FRESH'
    ) &&
    srmOverallState === 'HEALTHY'
  ) {
    status = 'HEALTHY';
  } else {
    status = 'UNKNOWN';
  }

  return {
    status,
    policy: 'required-current-scopes-v1',
    requiredSystems
  };
}

module.exports = {
  buildSystemHealth
};