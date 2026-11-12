/**
 * Evaluates the final canonical state machine for collections
 * based on the Phase E3B.3.4.3 rules.
 */
function evaluateCanonicalStateMachine(
  observations,
  canonicalRows
) {
  if (observations.length === 0) {
    return 'SUCCESS_EMPTY';
  }

  if (canonicalRows.length > 0) {
    return 'SUCCESS_CANONICAL';
  }

  // Canonical is empty but observations exist
  return 'CANONICAL_EMPTY_WITH_OBSERVATIONS';
}

/**
 * Resolves Protection Group Canonical Identity.
 */
exports.resolveProtectionGroupsIdentity = (
  rows
) => {
  const map = new Map();

  rows.forEach(pg => {
    let key = pg.canonical_key;

    if (
      !key &&
      pg.protection_group_id
    ) {
      const parts =
        pg.protection_group_id.split(':');

      if (parts.length >= 3) {
        key = `fallback-${parts[2]}`;
      } else {
        key =
          `fallback-${pg.protection_group_id}`;
      }
    }

    if (!map.has(key)) {
      map.set(key, {
        ...pg,
        observation_count: 1,

        canonical_identity_status:
          pg.canonical_identity_status ||
          'COMPLETE'
      });
    } else {
      map.get(key).observation_count += 1;
    }
  });

  const allGroups =
    Array.from(map.values());

  const canonicalGroups =
    allGroups.filter(
      g =>
        g.canonical_identity_status ===
        'COMPLETE'
    );

  const state =
    evaluateCanonicalStateMachine(
      rows,
      canonicalGroups
    );

  return {
    observations: rows,
    canonicalGroups,

    metrics: {
      canonicalGroupCount:
        canonicalGroups.length,

      protectionGroupObservationCount:
        rows.length
    },

    state
  };
};

/**
 * Resolves Recovery Plan Canonical Identity.
 */
exports.resolveRecoveryPlansIdentity = (
  rows
) => {
  const map = new Map();

  rows.forEach(rp => {
    let key = rp.canonical_key;

    if (
      !key &&
      rp.recovery_plan_id
    ) {
      const parts =
        rp.recovery_plan_id.split(':');

      if (parts.length >= 3) {
        key = `fallback-${parts[2]}`;
      } else {
        key =
          `fallback-${rp.recovery_plan_id}`;
      }
    }

    if (!map.has(key)) {
      map.set(key, {
        ...rp,
        observation_count: 1,

        canonical_identity_status:
          rp.canonical_identity_status ||
          'COMPLETE'
      });
    } else {
      map.get(key).observation_count += 1;
    }
  });

  const allPlans =
    Array.from(map.values());

  const canonicalPlans =
    allPlans.filter(
      p =>
        p.canonical_identity_status ===
        'COMPLETE'
    );

  const state =
    evaluateCanonicalStateMachine(
      rows,
      canonicalPlans
    );

  return {
    observations: rows,
    canonicalPlans,

    metrics: {
      canonicalPlanCount:
        canonicalPlans.length,

      recoveryPlanObservationCount:
        rows.length
    },

    state
  };
};