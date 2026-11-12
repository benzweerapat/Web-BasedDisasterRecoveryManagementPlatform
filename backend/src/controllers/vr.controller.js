const vrSyncService = require('../services/vr-sync.service');
const { getVrFreshness } = require('../services/collection-metadata.service');
const { buildFreshness, deriveDataState, latestTimestamp } = require('../services/data-freshness.service');
const { buildSafeError, sendReadResponse } = require('../utils/api-response.util');

async function safeVrFreshness(scopeColumn, values) {
  const lastCollectedAt = latestTimestamp(values);
  try {
    return await getVrFreshness(scopeColumn, lastCollectedAt);
  } catch (_error) {
    return buildFreshness({
      lastCollectedAt,
      collectionErrorType: 'BACKEND_ERROR',
      collectionErrorCode: 'FRESHNESS_QUERY_FAILED'
    });
  }
}

exports.getOverview = async (req, res, next) => {
  try {
    const data = await vrSyncService.getOverview();
    const freshness = await safeVrFreshness('sync_status', data.map(row => row.lastCoreSyncAt || row.lastCollectedAt));
    const dataState = deriveDataState({ hasData: data.length > 0, freshnessStatus: freshness.freshnessStatus });
    sendReadResponse(res, data, { dataState, freshness });
  } catch (err) {
    next(err);
  }
};

exports.getPairings = async (req, res, next) => {
  try {
    const data = await vrSyncService.getPairings();
    const freshness = await safeVrFreshness('sync_status', data.map(row => row.last_seen_at));
    const dataState = deriveDataState({ hasData: data.length > 0, freshnessStatus: freshness.freshnessStatus });
    sendReadResponse(res, data, { dataState, freshness });
  } catch (err) {
    next(err);
  }
};
exports.getPairingById = async (req, res, next) => {
  try {
    const pairings = await vrSyncService.getPairings();
    const pairing = pairings.find(p => p.id === parseInt(req.params.id, 10));
    if (!pairing) {
      return res.status(404).json(buildSafeError(req, { type: 'NOT_FOUND_ERROR', code: 'PAIRING_NOT_FOUND', httpStatus: 404, safeMessage: 'The requested pairing was not found' }));
    }
    res.json(pairing);
  } catch (err) {
    next(err);
  }
};

exports.getReplications = async (req, res, next) => {
  try {
    const data = await vrSyncService.getReplications();
    const freshness = await safeVrFreshness('sync_status', (data.observations || []).map(row => row.lastCollectedAt || row.lastObservationAt));
    const dataState = data.state === 'CANONICAL_EMPTY_WITH_OBSERVATIONS'
      ? 'CANONICAL_EMPTY_WITH_OBSERVATIONS'
      : deriveDataState({
      hasData: (data.observations || []).length > 0,
      observationCount: data.metrics?.observationCount,
      canonicalCount: data.metrics?.logicalReplicationCount,
      freshnessStatus: freshness.freshnessStatus
      });
    sendReadResponse(res, { ...data, freshness, dataState }, { dataState, freshness });
  } catch (err) {
    next(err);
  }
};
exports.getReplicationById = async (req, res, next) => {
  try {
    const reps = await vrSyncService.getReplications();
    const rep = reps.find(r => r.id === parseInt(req.params.id, 10));
    if (!rep) {
      return res.status(404).json(buildSafeError(req, { type: 'NOT_FOUND_ERROR', code: 'REPLICATION_NOT_FOUND', httpStatus: 404, safeMessage: 'The requested replication was not found' }));
    }
    res.json(rep);
  } catch (err) {
    next(err);
  }
};

exports.syncConnection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await vrSyncService.runSync(id, { requestedBy: req.authUser, requestId: req.id });
    res.status(200).json(result);
  } catch (err) {
    if (err.code === 'VR_SYNC_IN_PROGRESS' || err.code === 'SYNC_IN_PROGRESS') {
      return res.status(409).json(buildSafeError(req, { type: 'SYNC_IN_PROGRESS', code: 'SYNC_IN_PROGRESS', httpStatus: 409, safeMessage: 'Synchronization is already in progress. Please wait for the current operation to finish.' }));
    }
    next(err);
  }
};
const vrRepo = require('../repositories/vr.repository');

exports.getIssues = async (req, res, next) => {
  try {
    const connectionId = req.query.connectionId || null;
    const issues = await vrRepo.getIssues(connectionId);
    const rows = [...(issues.pairingIssues || []), ...(issues.replicationIssues || [])];
    const freshness = await safeVrFreshness('visibility_sync_status', rows.map(row => row.last_seen_at));
    const dataState = deriveDataState({ hasData: rows.length > 0, freshnessStatus: freshness.freshnessStatus });
    sendReadResponse(res, issues, { dataState, freshness });
  } catch (err) {
    next(err);
  }
};

const vrMapperService = require('../services/vr-mapper.service');

exports.getServers = async (req, res, next) => {
  try {
    const connectionId = req.query.connectionId || null;
    const rawServers = await vrRepo.getServers(connectionId);
    const servers = await vrMapperService.buildServersViewModel(rawServers);
    const rows = [...(servers.managementServers || []), ...(servers.replicationServers || [])];
    const freshness = await safeVrFreshness('replication_servers_sync_status', rows.map(row => row.last_seen_at));
    const dataState = deriveDataState({ hasData: rows.length > 0, freshnessStatus: freshness.freshnessStatus });
    sendReadResponse(res, { ...servers, freshness, dataState }, { dataState, freshness });
  } catch (err) {
    next(err);
  }
};
