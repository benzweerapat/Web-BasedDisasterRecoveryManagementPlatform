const BaseVmwareAdapter = require('./base-vmware.adapter');
const vmwareHttpService = require('../../services/vmware-http.service');
const https = require('https');
const axios = require('axios');
const { SrmSessionAdmission } = require('./srm-session-admission');

class SrmAdapter extends BaseVmwareAdapter {
  constructor({ sessionAdmissionTimeoutMs = 10000 } = {}) {
    super();
    this.name = 'SrmAdapter';
    this.sessionHosts = new Map();
    this.sessionAdmissionTimeoutMs = Number.isFinite(sessionAdmissionTimeoutMs)
      ? Math.max(1, Math.min(sessionAdmissionTimeoutMs, 10000)) : 10000;
  }

  async testConnection({ baseUrl, username, password, verifyTls }) {
    const startTime = Date.now();
    let sessionId = null;

    try {
      sessionId = await this.loginLocal(baseUrl, username, password, verifyTls);
      
      const latencyMs = Date.now() - startTime;
      
      // Cleanup session
      if (sessionId) {
        await this.logoutLocal(baseUrl, sessionId, verifyTls);
      }
      
      return {
        success: true,
        status: 'CONNECTED',
        latencyMs,
        tlsVerified: verifyTls,
        apiBaseUrl: baseUrl + '/api/rest/srm/v1',
        apiVersion: '1.0',
        apiSchemaVersion: '9.0.2', // Hardcoded as per verification or we could fetch if there's an about endpoint
        lastVerifiedAt: new Date()
      };
    } catch (err) {
      if (sessionId) {
        await this.logoutLocal(baseUrl, sessionId, verifyTls).catch(() => {});
      }
      
      let status = 'INTERNAL_ERROR';
      let errorCode = 'VMWARE_INTERNAL_ERROR';
      let safeMessage = 'Unable to connect to SRM';

      if (err.code === 'SRM_TARGET_NOT_ALLOWED') {
        status = 'TARGET_NOT_ALLOWED';
        errorCode = 'VMWARE_TARGET_NOT_ALLOWED';
        safeMessage = 'The IP address or hostname is not permitted by network policy';
      } else if (err.code === 'SRM_AUTH_FAILED') {
        status = 'AUTH_FAILED';
        errorCode = 'VMWARE_AUTH_FAILED';
        safeMessage = 'Unable to authenticate with the SRM server';
      } else if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
        status = 'TIMEOUT';
        errorCode = 'VMWARE_CONNECTION_TIMEOUT';
        safeMessage = 'The connection timed out';
      }

      return {
        success: false,
        status,
        errorCode,
        safeMessage,
        latencyMs: Date.now() - startTime
      };
    }
  }

  async createClient(baseUrl, verifyTls = true) {
    try {
      return await vmwareHttpService.createClient(baseUrl, verifyTls);
    } catch (err) {
      if (err.name === 'NetworkPolicyError') {
        const error = new Error('TARGET_NOT_ALLOWED');
        error.code = 'SRM_TARGET_NOT_ALLOWED';
        throw error;
      }
      throw err;
    }
  }

  sessionHost(baseUrl) {
    const key = new URL(baseUrl).origin;
    if (!this.sessionHosts.has(key)) this.sessionHosts.set(key, { opening: 0, sessions: new Map(), uncertain: false, uncertainUntil: 0, admission: new SrmSessionAdmission() });
    return this.sessionHosts.get(key);
  }

  clearSessionHost(baseUrl) {
    const entries = baseUrl
      ? [[new URL(baseUrl).origin, this.sessionHosts.get(new URL(baseUrl).origin)]]
      : [...this.sessionHosts.entries()];
    // Forgetting a live host would also forget its owned leases, allowing a
    // fresh counter to exceed the session cap. Reset only quiescent hosts.
    for (const [, host] of entries) {
      if (host && (host.opening || host.sessions.size || host.admission.pendingCount || host.admission.pumping
        || host.cooldownUntil > Date.now() || (host.uncertain && host.uncertainUntil > Date.now()))) {
        throw this.sessionError('SRM_SESSION_BUSY');
      }
    }
    if (!baseUrl) {
      this.sessionHosts.clear();
      return;
    }
    const key = new URL(baseUrl).origin;
    this.sessionHosts.delete(key);
  }

  deferSessionRequests(host, response) {
    const value = response.headers?.['retry-after'];
    const seconds = Number(value);
    const until = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Date.parse(value);
    host.cooldownUntil = Math.max(Date.now() + 30000, Number.isFinite(until) ? until : 0);
  }

  sessionError(code) { return Object.assign(new Error(code), { code }); }

  checkSessionAdmission(host) {
    if (host.cooldownUntil > Date.now()) throw this.sessionError('SRM_SESSION_BUSY');
    if (host.uncertain) {
      if (host.uncertainUntil > Date.now()) {
        throw this.sessionError('SRM_SESSION_LOGIN_UNCERTAIN');
      }
      host.uncertain = false;
      host.uncertainUntil = 0;
    }
  }

  async loginLocal(baseUrl, username, password, verifyTls = true) {
    const host = this.sessionHost(baseUrl);
    // Reject cooldown/unknown outcomes immediately; only known owned capacity
    // exhaustion is queued, and every admission rechecks these safety gates.
    this.checkSessionAdmission(host);
    const releaseOpening = await host.admission.acquire({
      timeoutMs: this.sessionAdmissionTimeoutMs,
      busyError: () => this.sessionError('SRM_SESSION_BUSY'),
      prepare: async () => {
        this.checkSessionAdmission(host);
        // Reconcile only failed logouts for sessions already owned by us.
        for (const [token, state] of host.sessions) {
          if (state.failed) await this.logoutLocal(baseUrl, token, state.verifyTls);
        }
        this.checkSessionAdmission(host);
      },
      reserve: () => {
        this.checkSessionAdmission(host);
        if (host.opening + host.sessions.size >= 2) return null;
        host.opening++;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          host.opening--;
          host.admission.notify();
        };
      }
    });
    let submitted = false;
    try {
      this.checkSessionAdmission(host);
      const client = await this.createClient(baseUrl, verifyTls);
      this.checkSessionAdmission(host);
      const basePath = new URL(baseUrl).pathname.replace(/\/$/, '') + '/api/rest/srm/v1';
      submitted = true;
      const response = await client.post(`${basePath}/session`, '', {
        headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: 30000
      });
      if (response.status === 429) { this.deferSessionRequests(host, response); throw this.sessionError('SRM_SESSION_BUSY'); }
      if ([401, 403].includes(response.status)) throw this.sessionError('SRM_AUTH_FAILED');
      if (![200, 201].includes(response.status)) {
        if (response.status >= 500) {
          host.uncertain = true;
          host.uncertainUntil = Date.now() + 30000;
        }
        throw this.sessionError(`SRM_LOGIN_FAILED_STATUS_${response.status}`);
      }
      const token = response.headers['x-dr-session'] || response.data?.session_id;
      if (typeof token !== 'string' || !token.length) {
        host.uncertain = true;
        host.uncertainUntil = Date.now() + 30000;
        throw this.sessionError('SRM_LOGIN_SESSION_MISSING');
      }
      host.sessions.set(token, { verifyTls, failed: false, closing: null, remotePairs: new Set() });
      return token;
    } catch (error) {
      // A lost login response can leave a session that has no known token.
      // Auto-recover after 30 seconds so operations are not permanently blocked.
      if (submitted && !error.code?.startsWith('SRM_')) {
        host.uncertain = true;
        host.uncertainUntil = Date.now() + 30000;
        throw this.sessionError('SRM_SESSION_LOGIN_UNCERTAIN');
      }
      throw error;
    } finally { releaseOpening(); }
  }

  async logoutLocal(baseUrl, sessionId, verifyTls = true) {
    if (!sessionId) return;
    const host = this.sessionHost(baseUrl);
    let entry = host.sessions.get(sessionId);
    if (!entry) {
      entry = { verifyTls, failed: false, closing: null, remotePairs: new Set() };
      host.sessions.set(sessionId, entry);
    }
    if (entry.closing) return entry.closing;
    if (host.cooldownUntil > Date.now()) { entry.failed = true; throw this.sessionError('SRM_SESSION_CLEANUP_FAILED'); }
    const close = async () => {
      let status = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const client = await this.createClient(baseUrl, verifyTls);
          const basePath = new URL(baseUrl).pathname.replace(/\/$/, '') + '/api/rest/srm/v1';
          const response = await client.delete(`${basePath}/session`, { headers: { 'x-dr-session': sessionId }, timeout: 5000 });
          status = response.status;
          // 401 means this token is no longer authenticated, also a closed session.
          if ([204, 401].includes(status)) { host.sessions.delete(sessionId); return; }
          if (status === 429) { this.deferSessionRequests(host, response); break; }
          if (status < 500) break;
        } catch { status = null; }
      }
      entry.failed = true;
      console.warn('[SRM session cleanup]', JSON.stringify({ host: new URL(baseUrl).host, code: 'SRM_SESSION_CLEANUP_FAILED', httpStatus: status }));
      throw this.sessionError('SRM_SESSION_CLEANUP_FAILED');
    };
    entry.closing = close();
    try { return await entry.closing; } finally { entry.closing = null; host.admission.notify(); }
  }

  async createRemoteSession(localBaseUrl, localSessionId, pairingId, remoteUsername, remotePassword, verifyTls = true) {
    const httpClient = await this.createClient(localBaseUrl, verifyTls);
    const basePath = new URL(localBaseUrl).pathname.replace(/\/$/, '') + '/api/rest/srm/v1';
    const owned = this.sessionHost(localBaseUrl).sessions.get(localSessionId);
    if (owned?.remotePairs.has(pairingId)) return true;
    const remoteAuth = Buffer.from(`${remoteUsername}:${remotePassword}`).toString('base64');
    try {
      const response = await httpClient.post(`${basePath}/pairings/${pairingId}/remote-session`, '', {
        headers: {
          'x-dr-session': localSessionId,
          'Authorization': `Basic ${remoteAuth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });
      if (response.status === 200 || response.status === 201 || response.status === 204) {
        owned?.remotePairs.add(pairingId);
        return true;
      }
      throw new Error(`REMOTE_SESSION_FAILED_STATUS_${response.status}`);
    } catch (err) {
      const status = err.response?.status || err.status || null;
      if (status === 401 || status === 403) {
        const error = new Error('SRM_REMOTE_AUTH_FAILED');
        error.code = 'SRM_REMOTE_AUTH_FAILED';
        error.httpStatus = status;
        error.safeFaultType = status === 401 ? 'HTTP_UNAUTHORIZED' : 'HTTP_FORBIDDEN';
        error.protocol = 'REST';
        error.sessionPhase = 'PAIRING_REMOTE_AUTH';
        throw error;
      }
      throw err;
    }
  }

  async getRemoteSession(localBaseUrl, localSessionId, pairingId, verifyTls = true) {
    const httpClient = await this.createClient(localBaseUrl, verifyTls);
    const basePath = new URL(localBaseUrl).pathname.replace(/\/$/, '') + '/api/rest/srm/v1';
    const response = await httpClient.get(`${basePath}/pairings/${pairingId}/remote-session`, {
      headers: this.buildSrmSessionHeaders(localSessionId),
      timeout: 15000
    });
    return response.data;
  }
  buildSrmSessionHeaders(sessionId) {
    return {
      'x-dr-session': sessionId,
      'Accept': 'application/json'
    };
  }

  async fetchScope(baseUrl, sessionId, path, verifyTls = true, extractKey = null) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = new URL(baseUrl).pathname.replace(/\/$/, '') + '/api/rest/srm/v1';
    let allData = [];
    let pageToken = null;
    let offset = 0;
    let pageCount = 0;
    const MAX_PAGES = 50;

    do {
      pageCount++;
      const url = `${basePath}${path}`;
      const response = await httpClient.get(url, {
        headers: this.buildSrmSessionHeaders(sessionId),
        params: pageToken ? {page:pageToken} : {limit:100,offset},
        timeout: 15000
      });

      if (response.status !== 200 && response.status !== 201) {
        const error = new Error(`SRM_HTTP_${response.status}`);
        error.code = `SRM_HTTP_${response.status}`;
        error.httpStatus = response.status;
        throw error;
      }

      // Initial pairing discovery precedes remote authentication; remote descriptive fields can be unavailable.
      if(path !== '/pairings' && response.data?._meta?.errors?.length) throw Object.assign(new Error('SRM_PARTIAL_RESPONSE'),{code:'SRM_PARTIAL_RESPONSE'});
      const data = extractKey ? response.data[extractKey] : (Array.isArray(response.data) ? response.data : response.data?.list || response.data?.items);
      if (Array.isArray(data)) {
        allData = allData.concat(data);
      } else {
        throw Object.assign(new Error('SRM_COLLECTION_CONTRACT_ERROR'),{code:'SRM_COLLECTION_CONTRACT_ERROR'});
      }

      offset += data.length;
      const total = response.data?._meta?.total;
      const hasMore = Number.isInteger(total) && offset < total;
      pageToken = response.data.next_page || null;
      if(!hasMore && !pageToken) return allData;
      if(!data.length || pageCount >= MAX_PAGES) throw Object.assign(new Error('SRM_COLLECTION_TRUNCATED'),{code:'SRM_COLLECTION_TRUNCATED'});
    } while (true);

    return allData;
  }

  async getSitePairs(baseUrl, sessionId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, '/pairings', verifyTls);
  }

  async getSrmServers(baseUrl, sessionId, verifyTls) {
    // Handled manually from pairings in sync service
    return [];
  }

  async getPairingIssues(baseUrl, sessionId, pairingId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/issues`, verifyTls);
  }

  async getProtectionGroups(baseUrl, sessionId, pairingId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/protection-management/groups`, verifyTls);
  }

  async getProtectionGroupIssues(baseUrl, sessionId, pairingId, pgId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/protection-management/groups/${pgId}/issues`, verifyTls);
  }

  async getProtectedVms(baseUrl, sessionId, pairingId, pgId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/protection-management/groups/${pgId}/vms`, verifyTls);
  }

  async getRecoveryPlans(baseUrl, sessionId, pairingId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/recovery-management/plans`, verifyTls);
  }

  async getRecoveryPlanGroups(baseUrl, sessionId, pairingId, rpId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/recovery-management/plans/${rpId}/protection-groups`, verifyTls);
  }

  async getRecoveryPlanVms(baseUrl, sessionId, pairingId, rpId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/recovery-management/plans/${rpId}/vms`, verifyTls);
  }

  async getRecoveryPlanIssues(baseUrl, sessionId, pairingId, rpId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/recovery-management/plans/${rpId}/issues`, verifyTls);
  }

  async getRecoveryHistory(baseUrl, sessionId, pairingId, rpId, verifyTls) {
    return require('./srm-plan-read.adapter').history(baseUrl, sessionId, pairingId, rpId, verifyTls);
  }

  async getRecoverySteps(baseUrl, sessionId, pairingId, rpId, viewMode = 'test', verifyTls = true) {
    return require('./srm-plan-read.adapter').steps(baseUrl, sessionId, pairingId, rpId, viewMode, verifyTls);
  }

  async getInventoryMappings(baseUrl, sessionId, pairingId, srmId, mappingType, verifyTls) {
    const endpointPath = `/pairings/${pairingId}/srms/${srmId}/inventory-mappings/${mappingType}`;
    try {
      return await this.fetchScope(baseUrl, sessionId, endpointPath, verifyTls);
    } catch (err) {
      const status = err.response?.status || err.httpStatus || err.status ||
        (err.message?.match(/STATUS_(\d{3})/) ? Number(err.message.match(/STATUS_(\d{3})/)[1]) : null);
      if (status === 401) {
        const error = new Error(`SRM_MAPPING_SESSION_REJECTED: 401 Unauthorized for mapping ${mappingType} on SRM ${srmId}`);
        error.code = 'SRM_MAPPING_SESSION_REJECTED';
        error.mappingType = mappingType;
        error.srmId = srmId;
        error.httpStatus = 401;
        error.safeFaultType = 'HTTP_UNAUTHORIZED';
        error.endpointPath = endpointPath;
        error.protocol = 'REST';
        error.sessionPhase = 'MAPPING_READ';
        throw error;
      }
      if (status === 403) {
        const error = new Error(`SRM_MAPPING_AUTHORIZATION_REJECTED for mapping ${mappingType}`);
        error.code = 'SRM_MAPPING_AUTHORIZATION_REJECTED';
        error.mappingType = mappingType;
        error.srmId = srmId;
        error.httpStatus = 403;
        error.safeFaultType = 'HTTP_FORBIDDEN';
        error.endpointPath = endpointPath;
        error.protocol = 'REST';
        error.sessionPhase = 'MAPPING_READ';
        throw error;
      }
      if (status === 404 || status === 405) {
        const error = new Error(`SRM_MAPPING_ENDPOINT_UNSUPPORTED for mapping ${mappingType}`);
        error.code = 'SRM_MAPPING_ENDPOINT_UNSUPPORTED';
        error.mappingType = mappingType;
        error.srmId = srmId;
        error.httpStatus = status;
        error.safeFaultType = status === 404 ? 'HTTP_NOT_FOUND' : 'HTTP_METHOD_NOT_ALLOWED';
        error.endpointPath = endpointPath;
        error.protocol = 'REST';
        error.sessionPhase = 'CAPABILITY_DISCOVERY';
        throw error;
      }
      if (status === 500) {
        const error = new Error(`SRM_MAPPING_REST_SERVER_ERROR for mapping ${mappingType}`);
        error.code = 'SRM_MAPPING_REST_SERVER_ERROR';
        error.mappingType = mappingType;
        error.srmId = srmId;
        error.httpStatus = 500;
        error.safeFaultType = 'HTTP_INTERNAL_SERVER_ERROR';
        error.endpointPath = endpointPath;
        error.protocol = 'REST';
        error.sessionPhase = 'MAPPING_READ';
        throw error;
      }
      throw err;
    }
  }

  async getPlaceholderDatastores(baseUrl, sessionId, pairingId, srmId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, `/pairings/${pairingId}/srms/${srmId}/inventory-mappings/placeholder-datastores`, verifyTls);
  }

  async getTasks(baseUrl, sessionId, verifyTls) {
    return this.fetchScope(baseUrl, sessionId, '/tasks', verifyTls);
  }

  async getApplianceInfo(baseUrl, sessionId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = new URL(baseUrl).pathname.replace(/\/$/, '') + '/api/rest/srm/v1';
    
    // Try to get appliance info, if not available, return null
    try {
      const response = await httpClient.get(`${basePath}/about`, {
        headers: this.buildSrmSessionHeaders(sessionId),
        timeout: 5000
      });
      return response.data;
    } catch (err) {
      // Fallback
      return null;
    }
  }
}

module.exports = new SrmAdapter();
module.exports.SrmAdapter = SrmAdapter;
