import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMappingPairId, mappingPairForSites, pairSite, placeholdersForSite } from './inventoryMappingScope.js';

const dc = { stableId: 'vc-dc', host: '192.0.2.211', name: 'DC' };
const dr = { stableId: 'vc-dr', host: '192.0.2.221', name: 'DR' };
const forward = { id: 11, local_vcenter_id: dc.stableId, remote_vcenter_id: dr.stableId };
const reverse = { id: 22, local_vcenter_id: dr.stableId, remote_vcenter_id: dc.stableId };
const drPlaceholder = {
  placeholderDatastoreId: 'datastore-1',
  vcenterStableId: dr.stableId,
  vcenterHost: dr.host,
  datastoreName: 'NFS-DR',
  siteName: 'DR',
  hostClusterName: '192.0.2.220'
};

test('create direction follows the clicked table regardless of site pair order', () => {
  for (const pairs of [[forward, reverse], [reverse, forward]]) {
    assert.equal(initialMappingPairId(pairs, mappingPairForSites(pairs, dr, dc)), '22');
    assert.equal(initialMappingPairId(pairs, mappingPairForSites(pairs, dc, dr)), '11');
  }
});

test('missing or ambiguous reciprocal pairing never uses the other direction', () => {
  assert.equal(mappingPairForSites([forward], dr, dc), null);
  assert.equal(mappingPairForSites([reverse, { ...reverse, id: 33 }], dr, dc), null);
  assert.equal(initialMappingPairId([forward], reverse.id), '');
  assert.equal(initialMappingPairId([forward, reverse], null), '');
  assert.equal(initialMappingPairId([forward], null), '11');
});

test('pairing supports camelCase identities and known host-only contracts', () => {
  const camel = { id: 33, localVcenterStableId: 'vc-dr', remoteVcenterStableId: 'vc-dc' };
  assert.equal(mappingPairForSites([camel], dr, dc), 33);
  const hostPair = { id: 44, localVcenterHost: 'https://192.0.2.211/', remoteVcenterHost: dr.host };
  assert.equal(mappingPairForSites([hostPair], dc, dr), 44);
  assert.equal(pairSite({ local_site_name: 'srm-DC' }, 'local').name, 'srm-DC');
  assert.equal(mappingPairForSites([{ id: 55 }], { host: 'Not reported' }, { host: 'Not reported' }), null);
});

test('one DR placeholder leaves DC empty instead of falling back to all rows', () => {
  assert.deepEqual(placeholdersForSite([drPlaceholder], dc), []);
  assert.deepEqual(placeholdersForSite([drPlaceholder], dr), [drPlaceholder]);
});

test('each site keeps its own placeholders even when names or datastore IDs coincide', () => {
  const dcPlaceholder = { ...drPlaceholder, vcenterStableId: dc.stableId, vcenterHost: dc.host };
  const rows = [drPlaceholder, dcPlaceholder];
  assert.deepEqual(placeholdersForSite(rows, dc), [dcPlaceholder]);
  assert.deepEqual(placeholdersForSite(rows, dr), [drPlaceholder]);
  assert.deepEqual(placeholdersForSite([drPlaceholder, { ...drPlaceholder }], dr), [drPlaceholder]);
});

test('site-looking names and array order cannot assign unidentified placeholders', () => {
  const unidentified = { datastoreName: 'DC', siteName: 'DC', hostClusterName: '192.0.2.210' };
  const other = { ...drPlaceholder, vcenterStableId: 'unrelated-vcenter', vcenterHost: '192.0.2.99' };
  for (const rows of [[unidentified, other], [other, unidentified]]) {
    assert.deepEqual(placeholdersForSite(rows, dc), []);
    assert.deepEqual(placeholdersForSite(rows, dr), []);
  }
});

test('stable ID mismatch is not overridden by a matching display host or site label', () => {
  const conflicting = { ...drPlaceholder, vcenterHost: dc.host, siteName: 'DC' };
  assert.deepEqual(placeholdersForSite([conflicting], dc), []);
});

test('host identity can scope legacy placeholders when a stable ID is absent', () => {
  const hostOnly = { ...drPlaceholder, vcenterStableId: null, vcenterHost: 'https://192.0.2.221/' };
  assert.deepEqual(placeholdersForSite([hostOnly], dr), [hostOnly]);
  assert.deepEqual(placeholdersForSite([hostOnly], dc), []);
  assert.deepEqual(placeholdersForSite([hostOnly], { name: 'DR', host: 'Not reported' }), []);
});
