const identityKey = value => String(value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const knownIdentity = value => {
  const key = identityKey(value);
  return key && key !== 'not reported' ? key : '';
};

// vCenter identities, not datastore names, host names or array positions, own
// a placeholder datastore. A known conflicting identity must never fall back.
export function sameMappingSite(left, right) {
  const leftId = knownIdentity(left?.stableId);
  const rightId = knownIdentity(right?.stableId);
  if (leftId && rightId) return leftId === rightId;
  const leftHost = knownIdentity(left?.host);
  const rightHost = knownIdentity(right?.host);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

export function pairSite(pair, side) {
  return {
    stableId: pair?.[`${side}_vcenter_id`] || pair?.[`${side}VcenterId`] || pair?.[`${side}VcenterStableId`] || null,
    host: pair?.[`${side}_vcenter_host`] || pair?.[`${side}VcenterHost`] || null,
    name: pair?.[`${side}_site_name`] || pair?.[`${side}SiteName`] || null
  };
}

export function mappingPairForSites(pairs, source, target) {
  const matches = pairs.filter(pair => sameMappingSite(pairSite(pair, 'local'), source)
    && sameMappingSite(pairSite(pair, 'remote'), target));
  return matches.length === 1 ? matches[0].id : null;
}

export function initialMappingPairId(pairs, requestedPairId) {
  if (requestedPairId !== null && requestedPairId !== undefined) {
    const match = pairs.find(pair => String(pair.id) === String(requestedPairId));
    return match ? String(match.id) : '';
  }
  return pairs.length === 1 ? String(pairs[0].id) : '';
}

export function placeholdersForSite(placeholders, site) {
  const matches = placeholders.filter(row => sameMappingSite({
    stableId: row.vcenterStableId,
    host: row.vcenterHost
  }, site));
  const seen = new Set();
  return matches.filter(row => {
    const id = row.placeholderDatastoreId || row.datastoreMoid || row.id;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
