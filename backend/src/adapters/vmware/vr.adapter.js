const vmwareHttpService = require('../../services/vmware-http.service');

function resolveVrApiBasePath(baseUrl) {
  const pathname = new URL(baseUrl).pathname.replace(/\/$/, '');
  return pathname && pathname !== '/' ? pathname : '/api/rest/vr/v1';
}

class VRAdapter {
  constructor() {
    this.name = 'VRAdapter';
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
        tlsVerified: verifyTls
      };
    } catch (err) {
      // Ensure we attempt logout if session was somehow created but failed later
      if (sessionId) {
        await this.logoutLocal(baseUrl, sessionId, verifyTls).catch(() => {});
      }
      
      let status = 'INTERNAL_ERROR';
      let errorCode = 'VMWARE_INTERNAL_ERROR';
      let safeMessage = 'Unable to connect to VR';

      if (err.code === 'VR_TARGET_NOT_ALLOWED') {
        status = 'TARGET_NOT_ALLOWED';
        errorCode = 'VMWARE_TARGET_NOT_ALLOWED';
        safeMessage = 'The IP address or hostname is not permitted by network policy';
      } else if (err.code === 'VR_AUTH_FAILED') {
        status = 'AUTH_FAILED';
        errorCode = 'VMWARE_AUTH_FAILED';
        safeMessage = 'Unable to authenticate with the VR server';
      } else if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
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
        error.code = 'VR_TARGET_NOT_ALLOWED';
        throw error;
      }
      throw err;
    }
  }

  async loginLocal(baseUrl, username, password, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    try {
      const loginResponse = await httpClient.post(`${basePath}/session`, '', {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      if (loginResponse.status === 200 || loginResponse.status === 201) {
        return loginResponse.data.session_id;
      }
      throw new Error(`VR_LOGIN_FAILED_STATUS_${loginResponse.status}`);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        const error = new Error('AUTH_FAILED');
        error.code = 'VR_AUTH_FAILED';
        throw error;
      }
      throw err;
    }
  }

  async logoutLocal(baseUrl, sessionId, verifyTls = true) {
    if (!sessionId) return;
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    try {
      await httpClient.delete(`${basePath}/session`, {
        headers: { 'x-dr-session': sessionId }
      });
    } catch (err) {
      // Ignore logout errors
    }
  }

  async getCurrentSession(baseUrl, sessionId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/session`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getPairings(baseUrl, sessionId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/pairings`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getPairing(baseUrl, sessionId, pairingId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/pairings/${pairingId}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async createRemoteSession(baseUrl, sessionId, pairingId, remoteUsername, remotePassword, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const auth = Buffer.from(`${remoteUsername}:${remotePassword}`).toString('base64');
    try {
      const response = await httpClient.post(`${basePath}/pairings/${pairingId}/remote-session`, '', {
        headers: {
          'x-dr-session': sessionId,
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      if (response.status === 204 || response.status === 200) {
        return true;
      }
      throw new Error(`VR_REMOTE_SESSION_FAILED_STATUS_${response.status}`);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        const error = new Error('VR_REMOTE_SESSION_FAILED');
        error.code = 'VR_REMOTE_AUTH_FAILED';
        throw error;
      }
      throw err;
    }
  }

  async getRemoteSession(baseUrl, sessionId, pairingId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/pairings/${pairingId}/remote-session`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getReplicationsPage(baseUrl, sessionId, pairingId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/pairings/${pairingId}/replications?extended_info=true&limit=${limit}&offset=${offset}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    if (response.status !== 200) throw Object.assign(new Error('VR_REPLICATIONS_HTTP_ERROR'), { code: 'VR_HTTP_' + response.status, httpStatus: response.status });
    return response.data;
  }

  async getAllReplications(baseUrl, sessionId, pairingId, verifyTls = true) {
    const results = [];
    let offset = 0;
    const limit = 100;
    const maximumPages = 50;
    const maximumReplications = 5000;
    const deadline = Date.now() + 30000; // 30s deadline
    let pageCount = 0;
    const seenOffsets = new Set();
    
    while (pageCount < maximumPages) {
      if (Date.now() > deadline) {
        throw new Error('VR_REPLICATIONS_PAGINATION_DEADLINE_EXCEEDED');
      }
      if (seenOffsets.has(offset)) {
        throw new Error('VR_REPLICATIONS_PAGINATION_REPEATED_OFFSET');
      }
      seenOffsets.add(offset);

      const pageData = await this.getReplicationsPage(baseUrl, sessionId, pairingId, limit, offset, verifyTls);
      if (!Array.isArray(pageData?.list) || pageData?._meta?.errors?.length) throw new Error('VR_REPLICATIONS_CONTRACT_ERROR');
      const total = Number.isInteger(pageData._meta?.total) ? pageData._meta.total : null;
      if (pageData.list.length === 0) {
        if (total !== null && results.length < total) throw new Error('VR_REPLICATIONS_TRUNCATED');
        return results;
      }
      results.push(...pageData.list);
      
      if (results.length > maximumReplications) {
        throw new Error('VR_REPLICATIONS_MAXIMUM_EXCEEDED');
      }
      
      offset += pageData.list.length; // strict offset advancement by actual list length
      pageCount++;
      
      if (total !== null ? results.length >= total : pageData.list.length < limit) return results;
    }
    throw new Error('VR_REPLICATIONS_TRUNCATED');
  }

  async getReplication(baseUrl, sessionId, pairingId, replicationId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const pid = encodeURIComponent(pairingId);
    const rid = encodeURIComponent(replicationId);
    const response = await httpClient.get(`${basePath}/pairings/${pid}/replications/${rid}?extended_info=true`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getReplicatedVmDisksPage(baseUrl, sessionId, pairingId, replicationId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const pid = encodeURIComponent(pairingId);
    const rid = encodeURIComponent(replicationId);
    const response = await httpClient.get(
      `${basePath}/pairings/${pid}/replications/${rid}/disks?limit=${limit}&offset=${offset}`,
      { headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' } }
    );
    return response.data;
  }

  async getAllReplicatedVmDisks(baseUrl, sessionId, pairingId, replicationId, verifyTls = true) {
    return this.paginate(
      (limit, offset) => this.getReplicatedVmDisksPage(
        baseUrl,
        sessionId,
        pairingId,
        replicationId,
        limit,
        offset,
        verifyTls
      )
    );
  }

  async getVrInfo(baseUrl, sessionId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/info`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getAllReplicationServersPage(baseUrl, sessionId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/replication-servers?limit=${limit}&offset=${offset}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getAllReplicationServers(baseUrl, sessionId, verifyTls = true) {
    return this.paginate(
      (limit, offset) => this.getAllReplicationServersPage(baseUrl, sessionId, limit, offset, verifyTls)
    );
  }

  async getPairingIssuesPage(baseUrl, sessionId, pairingId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const pid = encodeURIComponent(pairingId);
    const response = await httpClient.get(`${basePath}/pairings/${pid}/issues?limit=${limit}&offset=${offset}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getAllPairingIssues(baseUrl, sessionId, pairingId, verifyTls = true) {
    return this.paginate(
      (limit, offset) => this.getPairingIssuesPage(baseUrl, sessionId, pairingId, limit, offset, verifyTls)
    );
  }

  async getReplicationIssuesPage(baseUrl, sessionId, pairingId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const pid = encodeURIComponent(pairingId);
    const response = await httpClient.get(`${basePath}/pairings/${pid}/replications/issues?limit=${limit}&offset=${offset}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getAllReplicationIssues(baseUrl, sessionId, pairingId, verifyTls = true) {
    return this.paginate(
      (limit, offset) => this.getReplicationIssuesPage(baseUrl, sessionId, pairingId, limit, offset, verifyTls)
    );
  }

  async getVrDetailsInPairing(baseUrl, sessionId, pairingId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const pid = encodeURIComponent(pairingId);
    const response = await httpClient.get(`${basePath}/pairings/${pid}/vrs`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getReplicationServersInPairingPage(baseUrl, sessionId, pairingId, vrId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const pid = encodeURIComponent(pairingId);
    const vid = encodeURIComponent(vrId);
    const response = await httpClient.get(`${basePath}/pairings/${pid}/vrs/${vid}/replication-servers?limit=${limit}&offset=${offset}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getAllReplicationServersInPairing(baseUrl, sessionId, pairingId, vrId, verifyTls = true) {
    return this.paginate(
      (limit, offset) => this.getReplicationServersInPairingPage(baseUrl, sessionId, pairingId, vrId, limit, offset, verifyTls)
    );
  }

  async getRecentTasksPage(baseUrl, sessionId, limit = 100, offset = 0, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const response = await httpClient.get(`${basePath}/tasks?limit=${limit}&offset=${offset}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async getAllRecentTasks(baseUrl, sessionId, verifyTls = true) {
    return this.paginate(
      (limit, offset) => this.getRecentTasksPage(baseUrl, sessionId, limit, offset, verifyTls)
    );
  }

  async getTask(baseUrl, sessionId, taskId, verifyTls = true) {
    const httpClient = await this.createClient(baseUrl, verifyTls);
    const basePath = resolveVrApiBasePath(baseUrl);
    const tid = encodeURIComponent(taskId);
    const response = await httpClient.get(`${basePath}/tasks/${tid}`, {
      headers: { 'x-dr-session': sessionId, 'Accept': 'application/json' }
    });
    return response.data;
  }

  async paginate(fetchPageFn) {
    const results = [];
    let offset = 0;
    const limit = 100;
    const maximumPages = 100; // Large enough for tasks
    const maximumObjects = 10000;
    const deadline = Date.now() + 60000; // 60s
    let pageCount = 0;
    const seenOffsets = new Set();
    
    while (pageCount < maximumPages) {
      if (Date.now() > deadline) {
        throw new Error('VR_VISIBILITY_TIMEOUT');
      }
      if (seenOffsets.has(offset)) {
        throw new Error('VR_VISIBILITY_PAGINATION_LIMIT');
      }
      seenOffsets.add(offset);

      const pageData = await fetchPageFn(limit, offset);
      if (!Array.isArray(pageData?.list) || pageData?._meta?.errors?.length) throw new Error('VR_VISIBILITY_CONTRACT_ERROR');
      const total = Number.isInteger(pageData._meta?.total) ? pageData._meta.total : null;
      if (pageData.list.length === 0) {
        if (total !== null && results.length < total) throw new Error('VR_VISIBILITY_TRUNCATED');
        return results;
      }
      results.push(...pageData.list);
      
      if (results.length > maximumObjects) {
        throw new Error('VR_VISIBILITY_RESPONSE_TOO_LARGE');
      }
      
      offset += pageData.list.length;
      pageCount++;
      
      if (total !== null ? results.length >= total : pageData.list.length < limit) return results;
    }
    throw new Error('VR_VISIBILITY_TRUNCATED');
  }
}

module.exports = new VRAdapter();
