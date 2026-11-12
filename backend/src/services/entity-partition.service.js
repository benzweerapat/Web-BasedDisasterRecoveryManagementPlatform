/**
 * Entity Partition Service
 * 
 * Provides centralized logic for partitioning raw observation rows from the database
 * into logical canonical entities and unmapped observations.
 * 
 * Rules:
 * - Observations that belong to a fully canonicalized entity (i.e., canonical_identity_status === 'COMPLETE')
 *   are considered "mapped" and should NOT appear in the unmapped observations list.
 * - Observations that lack sufficient identity evidence to join a canonical entity
 *   will be grouped into the unmapped observations list.
 */

/**
 * Partitions raw observation rows based on their canonical identity status and key.
 * 
 * @param {Array} observations Raw observation rows from the database.
 * @param {string} canonicalKeyField The field name in the observation that holds the canonical key.
 * @param {Function} canonicalMapper A mapping function to convert a raw observation (or a group of them) into a Canonical Entity View Model.
 * @param {Function} observationMapper A mapping function to convert a raw observation into an Observation View Model.
 * @returns {Object} { canonicalRows, mappedObservations, unmappedObservations }
 */
exports.partitionCanonicalAndUnmapped = (
  observations,
  canonicalKeyField,
  canonicalMapper,
  observationMapper
) => {
  const canonicalMap = new Map();
  const unmappedObservations = [];
  const mappedObservations = [];

  if (!Array.isArray(observations)) {
    return {
      canonicalRows: [],
      mappedObservations: [],
      unmappedObservations: []
    };
  }

  observations.forEach(obs => {
    const isComplete =
      obs.canonical_identity_status ===
      'COMPLETE';

    const key = obs[canonicalKeyField];

    if (isComplete && key) {
      if (!canonicalMap.has(key)) {
        canonicalMap.set(key, {
          rawRows: []
        });
      }

      canonicalMap
        .get(key)
        .rawRows
        .push(obs);

      if (observationMapper) {
        mappedObservations.push(
          observationMapper(obs)
        );
      }
    } else {
      if (observationMapper) {
        unmappedObservations.push(
          observationMapper(obs)
        );
      }
    }
  });

  const canonicalRows = Array
    .from(canonicalMap.values())
    .map(group => {
      return canonicalMapper(
        group.rawRows
      );
    });

  return {
    canonicalRows,
    mappedObservations,
    unmappedObservations
  };
};