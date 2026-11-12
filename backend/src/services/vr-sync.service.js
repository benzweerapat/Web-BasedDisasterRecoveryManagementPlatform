const vrAdapter = require('../adapters/vmware/vr.adapter');
const visibilityNormalizer = require('./vr-visibility-normalizer.service');
const vrRepo = require('../repositories/vr.repository');
const connectionRepository = require('../repositories/connection.repository');
const srmRepo = require('../repositories/srm.repository');
const {
  resolveReplicationRoute,
  classifyPairing,
  canonicalizeReplications
} = require('./vr-resolution.service');
const normalizer = require('./vr-normalizer.service');
const {
  decryptCredential
} = require('../utils/encryption.util');
const {
  pool
} = require('../../db');
const {
  randomUUID
} = require('crypto');
const logger = console;
const syncCoordinator = require('./sync-coordinator.service');
const {
  createLiveCollectionResult
} = require('./live-collection-evidence.service');
const {
  resolveVmwareConnectionFailureStatus
} = require('./vmware-connection-status.service');
const syncLocks = new Set();

function resolveConnectionCredential(connection) {
  const ownCredentialComplete = connection?.username && connection?.encrypted_password && connection?.encryption_iv && connection?.encryption_auth_tag;
  if (ownCredentialComplete) {
    return {
      username: connection.username,
      password: decryptCredential(connection.encrypted_password, connection.encryption_iv, connection.encryption_auth_tag),
      source: 'CONNECTION'
    };
  }
  const inheritedCredentialComplete = connection?.credential_source_connection_id && connection?.source_system_type === 'VCENTER' && connection?.source_is_active && connection?.source_username && connection?.source_encrypted_password && connection?.source_encryption_iv && connection?.source_encryption_auth_tag;
  if (inheritedCredentialComplete) {
    return {
      username: connection.source_username,
      password: decryptCredential(connection.source_encrypted_password, connection.source_encryption_iv, connection.source_encryption_auth_tag),
      source: 'LEGACY_VCENTER_REFERENCE'
    };
  }
  const err = new Error('CONNECTION_CREDENTIAL_NOT_CONFIGURED');
  err.code = 'CONNECTION_CREDENTIAL_NOT_CONFIGURED';
  err.statusCode = 422;
  err.safeMessage = 'Edit this vSphere Replication connection and provide a username and password before syncing.';
  throw err;
}

function redactErrorText(value) {
  if (!value) return null;
  if (typeof value === 'string') return visibilityNormalizer.redactText(value);
  try {
    return visibilityNormalizer.redactText(JSON.stringify(value));
  } catch {
    return visibilityNormalizer.redactText(String(value));
  }
}
class VRSyncService {
  async runSync(connectionId, requestContext = {}) {
    if (!connectionId) throw new Error('connectionId is required');

    // 2. Acquire single-flight lock
    if (syncLocks.has(connectionId)) {
      const err = new Error('Sync already in progress');
      err.code = 'VR_SYNC_IN_PROGRESS';
      throw err;
    }
    let coordinatorToken = requestContext.coordinatorToken || null;
    let ownsCoordinator = false;
    if (!coordinatorToken) {
      coordinatorToken = syncCoordinator.acquire({
        kind: 'VR_SYNC',
        requestId: requestContext.requestId,
        connectionId
      });
      ownsCoordinator = true;
    }
    syncLocks.add(connectionId);
    const syncRunId = randomUUID();
    const parentSyncRunId = requestContext.syncRunId || requestContext.requestId || syncRunId;
    const collectionStartedAt = new Date();
    let localSessionId = null;
    let localSessionAuthenticated = false;
    let syncStatus = 'OK';
    let errorCode = null;
    let localConn = null;
    try {
      // 3. Load local VR connection
      const connections = await vrRepo.getLocalConnections();
      localConn = connections.find(c => c.id === parseInt(connectionId, 10));
      if (!localConn) throw new Error(`VR Connection ${connectionId} not found or inactive`);

      // 4. Use the VR connection's own credential. Legacy vCenter references remain a fallback.
      const localCredential = resolveConnectionCredential(localConn);

      // 7. Login local VR
      localSessionId = await vrAdapter.loginLocal(localConn.base_url, localCredential.username, localCredential.password, localConn.verify_tls);
      localSessionAuthenticated = true;
      await connectionRepository.updateConnectionTestStatus(localConn.id, 'CONNECTED', new Date()).catch(() => {});
      const {
        URL
      } = require('url');
      const net = require('net');
      const apiEndpointHost = new URL(localConn.base_url).hostname;
      const apiEndpointHostType = net.isIP(apiEndpointHost) ? 'IP' : 'FQDN';

      // 8. Get pairings
      const pairingsResponse = await vrAdapter.getPairings(localConn.base_url, localSessionId, localConn.verify_tls);
      const pairings = pairingsResponse.list || [];
      const replicationObservations = [];
      const pairingLinks = await vrRepo.getPairingLinks(localConn.id);

      // 9. For each pairing
            for (const pairing of pairings) {
        let pairingSuccess = false;
        try {
          const isSelfPaired = pairing.local_vc_server?.id && pairing.local_vc_server?.id === pairing.remote_vc_server?.id;
          if (!isSelfPaired) {
            let link = pairingLinks.find(l => l.pairing_id === pairing.pairing_id);
            if (!link) {
              const reciprocal = await vrRepo.findReciprocalRemoteConnection(localConn.id, pairing);
              if (reciprocal) {
                link = await vrRepo.upsertPairingLink(localConn.id, reciprocal.remote_vr_connection_id, pairing.pairing_id);
                pairingLinks.push(link);
                if (logger && logger.info) logger.info(`Resolved reciprocal VR connection ${reciprocal.remote_vr_connection_id} for pairing ${pairing.pairing_id}`);
              }
            }
            if (!link) {
              if (logger && logger.warn) logger.warn(`No VR connection link found for pairing ${pairing.pairing_id}`);
              pairing.remote_session_status = 'VR_REMOTE_CONNECTION_NOT_CONFIGURED';
              syncStatus = 'PARTIAL';
              continue;
            }
            const remoteConn = await vrRepo.getRemoteConnection(link.remote_vr_connection_id);
            if (!remoteConn) {
              if (logger && logger.warn) logger.warn(`Remote VR connection missing for pairing ${pairing.pairing_id}`);
              pairing.remote_session_status = 'VR_REMOTE_CONNECTION_NOT_CONFIGURED';
              syncStatus = 'PARTIAL';
              continue;
            }
            const remoteCredential = resolveConnectionCredential(remoteConn);
            await vrAdapter.createRemoteSession(localConn.base_url, localSessionId, pairing.pairing_id, remoteCredential.username, remoteCredential.password, localConn.verify_tls);
            const remoteSessionState = await vrAdapter.getRemoteSession(localConn.base_url, localSessionId, pairing.pairing_id, localConn.verify_tls);
            if (remoteSessionState && remoteSessionState.status && remoteSessionState.status.status !== 'CONNECTED') {
              const err = new Error('VR_REMOTE_SESSION_VERIFICATION_FAILED');
              err.code = 'VR_REMOTE_SESSION_VERIFICATION_FAILED';
              throw err;
            }
          }
          pairing.remote_session_status = 'OK';
                    const replications = await vrAdapter.getAllReplications(localConn.base_url, localSessionId, pairing.pairing_id, localConn.verify_tls);

          // Collect the read-only disk contract used by the expanded replication details.
          // Limit concurrency so a site with many replications does not overwhelm VRMS.
          const diskDetailBatchSize = 4;
          for (let index = 0; index < replications.length; index += diskDetailBatchSize) {
            const batch = replications.slice(index, index + diskDetailBatchSize);
            await Promise.all(batch.map(async rep => {
              try {
                const disks = await vrAdapter.getAllReplicatedVmDisks(localConn.base_url, localSessionId, pairing.pairing_id, rep.id, localConn.verify_tls);
                rep.replicated_disk_summary = normalizer.summarizeReplicationDisks(disks);
                rep.disk_collection_status = 'SYNCED';
                rep.disk_collection_error_code = null;
              } catch (diskError) {
                rep.replicated_disk_summary = null;
                rep.disk_collection_status = 'FAILED';
                rep.disk_collection_error_code = diskError.code || 'VR_REPLICATION_DISKS_FETCH_FAILED';
              }
            }));
          }
          for (const rep of replications) {
            const localVcenterId = pairing.local_vc_server?.id;
            rep.direction = normalizer.normalizeDirection(rep, localVcenterId);
            rep.normalized_status = normalizer.normalizeStatus(rep.status?.status);
            rep.rpo = normalizer.normalizeRpoMinutes(rep.rpo);
            rep.current_rpo_violation = normalizer.normalizeRpoViolation(rep.current_rpo_violation);
            rep.sync_progress = normalizer.normalizeSyncProgress(rep.sync_progress);
            rep.last_sync_duration = normalizer.normalizeInteger(rep.last_sync_duration);
            rep.last_sync_size = normalizer.normalizeInteger(rep.last_sync_size);
            rep.quiescing_enabled = normalizer.normalizeBoolean(rep.quiescing_enabled);
            rep.network_compression_enabled = normalizer.normalizeBoolean(rep.network_compression_enabled);
            rep.encryption_enabled = normalizer.normalizeBoolean(rep.encryption_enabled);
            rep.auto_replicate_new_disks_enabled = normalizer.normalizeBoolean(rep.auto_replicate_new_disks_enabled);
            rep.mpit_enabled = normalizer.normalizeBoolean(rep.mpit_enabled);
            rep.mpit_instances = normalizer.normalizeInteger(rep.mpit_instances);
            rep.mpit_days = normalizer.normalizeInteger(rep.mpit_days);
            rep.vm_data_sets_replication_enabled = normalizer.normalizeBoolean(rep.vm_data_sets_replication_enabled);
            rep.enhanced_replication = normalizer.normalizeBoolean(rep.enhanced_replication);
            rep.configuration_error_message = redactErrorText(rep.configuration_error?.message);
            rep.configuration_error_details = redactErrorText(rep.configuration_error?.details);
            rep.last_group_error_message = redactErrorText(rep.last_group_error?.message);
            rep.last_group_error_details = redactErrorText(rep.last_group_error?.details);
            rep.recovery_error_message = redactErrorText(rep.recovery_error);
            const canonInfo = normalizer.computeCanonicalKey(pairing.pairing_id, rep.source_vc_id, rep.target_vc_id, rep.vm_id, rep.id);
            rep.canonical_replication_key = canonInfo.key;
            rep.canonical_identity_status = canonInfo.status;
            rep.canonical_key_version = canonInfo.version;
            replicationObservations.push({
              pairingId: pairing.pairing_id,
              data: rep
            });
          }
          pairingSuccess = true;
                  } catch (err) {
          if (logger && logger.error) logger.error(`Error processing pairing ${pairing.pairing_id}: ${err.message}`);
          pairing.remote_session_status = err.code || 'ERROR';
          syncStatus = 'PARTIAL';
          if (!errorCode) errorCode = err.code || 'VR_REMOTE_SESSION_FAILED';
        }
      }

      // 10. Complete all network requests -> move to DB phase

      // --- PHASE E3A.2 VISIBILITY GATHERING ---
      let visibilityStatus = 'OK';
      const visStatuses = {
        vrInfo: 'OK',
        managementServers: 'OK',
        replicationServers: 'OK',
        pairingIssues: 'OK',
        replicationIssues: 'OK',
        tasks: 'OK'
      };
      const visData = {
        managementServers: [],
        replicationServers: [],
        pairingIssues: [],
        replicationIssues: [],
        tasks: []
      };
      try {
        const info = await vrAdapter.getVrInfo(localConn.base_url, localSessionId, localConn.verify_tls);
        const cert = info.certificates && info.certificates.length > 0 ? info.certificates[0] : null;
        const originalUrl = visibilityNormalizer.sanitizeUrl(info.url);
        const discoveredInfo = {
          original: originalUrl,
          apiEndpointHost,
          apiEndpointHostType,
          applianceIp: apiEndpointHostType === 'IP' ? apiEndpointHost : null // Assuming API doesn't send distinct IP directly
        };
        visData.managementServers.push({
          pairing_id: null,
          vrms_id: info.id || 'local',
          server_scope: 'LOCAL',
          name: info.name,
          safe_url: JSON.stringify(discoveredInfo),
          server_status: info.server_status,
          version: info.version || null,
          build_number: info.build || null,
          certificate_warning_count: cert ? cert.warning_count : 0,
          certificate_status: visibilityNormalizer.extractSafeCertificateSummary(cert)?.status || 'UNKNOWN',
          certificate_not_after: cert ? cert.not_after : null
        });
      } catch (e) {
        visStatuses.vrInfo = 'FAILED';
        visibilityStatus = 'PARTIAL';
      }
            try {
        const reps = await vrAdapter.getAllReplicationServers(localConn.base_url, localSessionId, localConn.verify_tls);
        for (const r of reps) {
          visData.replicationServers.push({
            pairing_id: null,
            vrms_id: 'local',
            server_id: r.id,
            server_scope: 'LOCAL',
            server_uuid: r.uuid,
            name: r.name,
            hostname: r.hostname,
            safe_configuration_url: visibilityNormalizer.sanitizeUrl(r.configuration_url),
            connected: r.connected,
            decommissioned: r.decommissioned,
            internally_managed: r.internally_managed,
            replication_count: r.replication_count,
            safe_fault: visibilityNormalizer.redactText(r.fault)
          });
        }
      } catch (e) {
        visStatuses.replicationServers = 'FAILED';
        visibilityStatus = 'PARTIAL';
      }
      try {
        const tasks = await vrAdapter.getAllRecentTasks(localConn.base_url, localSessionId, localConn.verify_tls);
        for (const t of tasks) {
          const sError = visibilityNormalizer.extractSafeTaskError(t.error);
          const sResult = visibilityNormalizer.extractSafeResultSummary(t.result);
          visData.tasks.push({
            task_id: t.id,
            description: t.description,
            description_id: t.description_id,
            entity: t.entity,
            entity_name: t.entity_name,
            raw_status: t.status,
            normalized_status: visibilityNormalizer.normalizeTaskStatus(t.status),
            progress_percent: t.progress,
            queued_at: t.queued_time ? new Date(t.queued_time) : null,
            started_at: t.start_time ? new Date(t.start_time) : null,
            completed_at: t.complete_time ? new Date(t.complete_time) : null,
            safe_error_message: sError.message,
            safe_error_details: sError.details,
            safe_result_summary: sResult.summary,
            result_truncated: sResult.truncated,
            normalization_status: 'OK'
          });
        }
      } catch (e) {
        visStatuses.tasks = 'FAILED';
        visibilityStatus = 'PARTIAL';
      }
            for (const pairing of pairings) {
        if (pairing.remote_session_status !== 'OK') continue;
        const pid = pairing.pairing_id;
        try {
          const vrInfo = await vrAdapter.getVrDetailsInPairing(localConn.base_url, localSessionId, pid, localConn.verify_tls);
          for (const info of vrInfo.list || []) {
            const cert = info.certificates && info.certificates.length > 0 ? info.certificates[0] : null;
            const originalUrl = visibilityNormalizer.sanitizeUrl(info.url);

            // For remote, we try to derive the API endpoint host from the info.url, or fallback to the paired vCenter's known data if any.
            // VR API gives info.url for the remote vrms
            let remoteApiHost = null;
            let remoteApiHostType = 'FQDN';
            try {
              if (info.url) {
                remoteApiHost = new URL(info.url).hostname;
                remoteApiHostType = require('net').isIP(remoteApiHost) ? 'IP' : 'FQDN';
              }
            } catch (e) {}
            const discoveredInfo = {
              original: originalUrl,
              apiEndpointHost: remoteApiHost,
              apiEndpointHostType: remoteApiHostType,
              applianceIp: info.network && info.network.ip || (remoteApiHostType === 'IP' ? remoteApiHost : null)
            };
            visData.managementServers.push({
              pairing_id: pid,
              vrms_id: info.id || 'remote',
              server_scope: 'PAIRED',
              name: info.name,
              safe_url: JSON.stringify(discoveredInfo),
              server_status: info.server_status,
              version: info.version || null,
              build_number: info.build || null,
              certificate_warning_count: cert ? cert.warning_count : 0,
              certificate_status: visibilityNormalizer.extractSafeCertificateSummary(cert)?.status || 'UNKNOWN',
              certificate_not_after: cert ? cert.not_after : null
            });
            try {
              const pairedReps = await vrAdapter.getAllReplicationServersInPairing(localConn.base_url, localSessionId, pid, info.id, localConn.verify_tls);
              for (const r of pairedReps) {
                visData.replicationServers.push({
                  pairing_id: pid,
                  vrms_id: info.id,
                  server_id: r.id,
                  server_scope: 'PAIRED',
                  server_uuid: r.uuid,
                  name: r.name,
                  hostname: r.hostname,
                  safe_configuration_url: visibilityNormalizer.sanitizeUrl(r.configuration_url),
                  connected: r.connected,
                  decommissioned: r.decommissioned,
                  internally_managed: r.internally_managed,
                  replication_count: r.replication_count,
                  safe_fault: visibilityNormalizer.redactText(r.fault)
                });
              }
            } catch (e) {
              visStatuses.replicationServers = 'PARTIAL';
              visibilityStatus = 'PARTIAL';
            }
          }
        } catch (e) {
          visStatuses.vrInfo = 'PARTIAL';
          visibilityStatus = 'PARTIAL';
        }
                try {
          const pi = await vrAdapter.getAllPairingIssues(localConn.base_url, localSessionId, pid, localConn.verify_tls);
          for (const i of pi) {
            const fp = visibilityNormalizer.generateIssueFingerprint('PAIRING', pid, null, i.entity, i.issue_type, i.description, i.occurred_time);
            visData.pairingIssues.push({
              pairing_id: pid,
              issue_fingerprint: fp,
              entity: i.entity,
              entity_name: i.entity_name,
              description: visibilityNormalizer.redactText(i.description),
              occurred_at: i.occurred_time ? new Date(i.occurred_time) : null,
              raw_status: i.severity,
              severity: visibilityNormalizer.normalizeSeverity(i.severity),
              issue_type: i.issue_type
            });
          }
        } catch (e) {
          visStatuses.pairingIssues = 'FAILED';
          visibilityStatus = 'PARTIAL';
        }
        try {
          const ri = await vrAdapter.getAllReplicationIssues(localConn.base_url, localSessionId, pid, localConn.verify_tls);
          for (const i of ri) {
            let mappingStatus = 'UNMATCHED';
            let canonicalKey = null;
            if (i.replication_id && i.source_vc_id && i.target_vc_id && i.vm_id) {
              const canonInfo = normalizer.computeCanonicalKey(pid, i.source_vc_id, i.target_vc_id, i.vm_id, i.replication_id);
              canonicalKey = canonInfo.key;
              mappingStatus = 'MATCHED';
            } else {
              mappingStatus = i.replication_id ? 'AMBIGUOUS' : 'NOT_APPLICABLE';
            }
            const fp = visibilityNormalizer.generateIssueFingerprint('REPLICATION', pid, canonicalKey, i.entity, i.issue_type, i.description, i.occurred_time);
            visData.replicationIssues.push({
              pairing_id: pid,
              replication_id: i.replication_id,
              canonical_replication_key: canonicalKey,
              direction: i.direction,
              mapping_status: mappingStatus,
              issue_fingerprint: fp,
              entity: i.entity,
              entity_name: i.entity_name,
              description: visibilityNormalizer.redactText(i.description),
              occurred_at: i.occurred_time ? new Date(i.occurred_time) : null,
              raw_status: i.severity,
              severity: visibilityNormalizer.normalizeSeverity(i.severity),
              issue_type: i.issue_type
            });
          }
        } catch (e) {
          visStatuses.replicationIssues = 'FAILED';
          visibilityStatus = 'PARTIAL';
        }
      }
            // 11. BEGIN database transaction
      let persistedCanonicalCount = 0;
      const client = await pool.connect();
      try {
        await client.begin();

        // 12. UPSERT pairings
        await vrRepo.upsertPairings(localConn.id, pairings, syncRunId, client);

        // Pairing IDs are scoped to a specific vCenter/VR environment. When a
        // connection is repointed to another environment, observations from
        // pairings that disappeared must not remain visible as live data.
        await vrRepo.markReplicationsForMissingPairings(localConn.id, client);

        // 13. UPSERT replication observations
        // Group by pairing to reconcile only successfully fetched scopes
        const scopes = new Set(pairings.filter(p => p.remote_session_status === 'OK').map(p => p.pairing_id));
        for (const scope of scopes) {
          const repsInScope = replicationObservations.filter(r => r.pairingId === scope).map(r => r.data);
          await vrRepo.upsertReplications(localConn.id, scope, repsInScope, syncRunId, client);
        }

        // 15. update sync state
        await vrRepo.updateSyncState(localConn.id, syncStatus, syncRunId, errorCode, client);

        // Deduplicate counts
        const {
          rows: canonicalRows
        } = await client.run((s, p) => {
          const R = s.helpers;
          const views = {};
          return R.result((parent => {
            let rows = [R.context(parent)];
            rows = R.join(rows, "vr_replications", r => views["vr_replications"] || s.read("vr_replications"), r => true, "INNER JOIN");
            rows = rows.filter(r => R.binary("AND", R.binary("=", R.ref(r, "connection_id", null), p[0]), R.binary("=", R.ref(r, "is_present", null), true)));
            let groups = R.groups(rows, null);
            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);
              return R.expand({
                "count": R.aggregate("count", g.filter(a => true).map(a => R.ref(a, "replication_id", null)), "distinct", null)
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });
            return result.slice(0).map(x => x.value);
          })(null));
        }, [localConn.id], false);
        persistedCanonicalCount = parseInt(canonicalRows[0].count, 10);
        await vrRepo.updateSyncStateCounts(localConn.id, pairings.length, replicationObservations.length, persistedCanonicalCount, client);
                // UPSERT Visibility Scopes
        if (visStatuses.vrInfo !== 'FAILED') {
          await vrRepo.upsertManagementServers(localConn.id, visData.managementServers, syncRunId, client);
        }
        if (visStatuses.replicationServers !== 'FAILED') {
          await vrRepo.upsertReplicationServers(localConn.id, visData.replicationServers, syncRunId, client);
        }
        if (visStatuses.pairingIssues !== 'FAILED') {
          // Reconcile every successfully fetched pairing, including an empty
          // issue list, so issues that disappeared are marked not present.
          for (const pid of scopes) {
            const issues = visData.pairingIssues.filter(i => i.pairing_id === pid);
            await vrRepo.upsertPairingIssues(localConn.id, pid, issues, syncRunId, client);
          }
        }
        if (visStatuses.replicationIssues !== 'FAILED') {
          for (const pid of scopes) {
            const issues = visData.replicationIssues.filter(i => i.pairing_id === pid);
            await vrRepo.upsertReplicationIssues(localConn.id, pid, issues, syncRunId, client);
          }
        }
        if (visStatuses.tasks !== 'FAILED') {
          await vrRepo.upsertTasks(localConn.id, visData.tasks, syncRunId, client);
        }
        await vrRepo.updateVisibilitySyncState(localConn.id, visibilityStatus, syncRunId, visStatuses, {
          issues: visData.pairingIssues.length + visData.replicationIssues.length,
          servers: visData.managementServers.length + visData.replicationServers.length,
          tasks: visData.tasks.length
        }, client);
        await require('./current-scope.service').reconcileCurrentChildren(client, 'VR', localConn.id);
        // 17. COMMIT
        await client.commit();
      } catch (dbErr) {
        await client.rollback();
        throw dbErr;
      } finally {
        client.release();
      }
            const collectionCompletedAt = new Date();
      const visibilityOperationStatus = value => value === 'OK' ? 'SUCCESS' : value;
      const outgoingCollected = replicationObservations.filter(item => item.data.direction === 'OUTGOING').length;
      const incomingCollected = replicationObservations.filter(item => item.data.direction === 'INCOMING').length;
      return {
        status: syncStatus,
        runId: syncRunId,
        connectionId: localConn.id,
        ...createLiveCollectionResult({
          system: 'VR',
          connectionId: localConn.id,
          syncRunId: parentSyncRunId,
          collectorRunId: syncRunId,
          startedAt: collectionStartedAt,
          completedAt: collectionCompletedAt,
          status: syncStatus === 'OK' ? 'SUCCESS' : 'PARTIAL',
          rowsCollected: {
            pairings: pairings.length,
            replications: replicationObservations.length,
            outgoingReplications: outgoingCollected,
            incomingReplications: incomingCollected,
            canonicalReplications: persistedCanonicalCount,
            managementServers: visData.managementServers.length,
            replicationServers: visData.replicationServers.length,
            tasks: visData.tasks.length,
            issues: visData.pairingIssues.length + visData.replicationIssues.length
          },
          operations: [{
            operation: 'GET_PAIRINGS',
            endpointCategory: 'VR_REST_API',
            status: 'SUCCESS',
            rowCount: pairings.length
          }, {
            operation: 'GET_REPLICATIONS',
            endpointCategory: 'VR_REST_API',
            status: syncStatus === 'OK' ? 'SUCCESS' : 'PARTIAL',
            rowCount: replicationObservations.length
          }, {
            operation: 'COLLECT_OUTGOING_REPLICATIONS',
            endpointCategory: 'VR_REST_API',
            status: outgoingCollected > 0 ? 'SUCCESS' : 'SUCCESS_EMPTY',
            rowCount: outgoingCollected
          }, {
            operation: 'COLLECT_INCOMING_REPLICATIONS',
            endpointCategory: 'VR_REST_API',
            status: incomingCollected > 0 ? 'SUCCESS' : 'SUCCESS_EMPTY',
            rowCount: incomingCollected
          }, {
            operation: 'GET_VR_INFO',
            endpointCategory: 'VR_REST_API',
            status: visibilityOperationStatus(visStatuses.vrInfo),
            rowCount: visData.managementServers.length
          }, {
            operation: 'GET_REPLICATION_SERVERS',
            endpointCategory: 'VR_REST_API',
            status: visibilityOperationStatus(visStatuses.replicationServers),
            rowCount: visData.replicationServers.length
          }, {
            operation: 'GET_TASKS',
            endpointCategory: 'VR_REST_API',
            status: visibilityOperationStatus(visStatuses.tasks),
            rowCount: visData.tasks.length
          }, {
            operation: 'GET_PAIRING_ISSUES',
            endpointCategory: 'VR_REST_API',
            status: visibilityOperationStatus(visStatuses.pairingIssues),
            rowCount: visData.pairingIssues.length
          }, {
            operation: 'GET_REPLICATION_ISSUES',
            endpointCategory: 'VR_REST_API',
            status: visibilityOperationStatus(visStatuses.replicationIssues),
            rowCount: visData.replicationIssues.length
          }],
          canonicalization: {
            status: 'SUCCESS',
            phase: 'POST_PERSISTENCE_VERIFIED',
            canonicalRows: persistedCanonicalCount
          }
        })
      };
          } catch (err) {
      syncStatus = 'ERROR';
      errorCode = err.code || 'VR_SYNC_FAILED';
      if (localConn && !localSessionAuthenticated) {
        const connectionStatus = resolveVmwareConnectionFailureStatus(err);
        await connectionRepository.updateConnectionTestStatus(localConn.id, connectionStatus, new Date()).catch(() => {});
      }
      try {
        await vrRepo.updateSyncState(connectionId, syncStatus, syncRunId, errorCode);
      } catch (e) {
        if (logger && logger.error) logger.error(`Failed to record sync error state: ${e.message}`);
      }
      throw err;
    } finally {
      // 18. logout local VR session in finally
      if (localSessionId && localConn) {
        try {
          await vrAdapter.logoutLocal(localConn.base_url, localSessionId, localConn.verify_tls);
        } catch (e) {}
      }
      // 19. clear sync lock in finally
      syncLocks.delete(connectionId);
      if (ownsCoordinator) syncCoordinator.release(coordinatorToken);
    }
  }
  async getOverview() {
    return vrRepo.getOverview();
  }
  async getPairings() {
    return vrRepo.getPairingsSummary();
  }
  async getReplications() {
    const rawReplications = await vrRepo.getReplicationsSummary();
    const vcUuidMap = await vrRepo.getVcUuidMap();
    let pairings = [];
    try {
      const vrManagementService = require('./vr-management.service');
      pairings = await vrManagementService.getPairs();
    } catch {
      try {
        pairings = await vrRepo.getPairingsSummary();
      } catch {}
    }
    const vrMapperService = require('./vr-mapper.service');
    return vrMapperService.buildReplicationsViewModel(rawReplications, vcUuidMap, pairings);
  }
}
module.exports = new VRSyncService();
