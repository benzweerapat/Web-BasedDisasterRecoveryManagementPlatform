const BaseVmwareAdapter = require('./base-vmware.adapter');
const vmwareHttpService = require('../../services/vmware-http.service');
const xmlParser = require('../../utils/xmlParser');

// Cache the confirmed release by connection ID (use base_url as key).
const viApiVersionCache = new Map();

class VcenterAdapter extends BaseVmwareAdapter {
  async testConnection({ baseUrl, username, password, verifyTls }) {
    const startTime = Date.now();
    let sessionId = null;
    let httpClient;

    try {
      httpClient = await vmwareHttpService.createClient(baseUrl, verifyTls);
    } catch (err) {
      if (err.name === 'NetworkPolicyError') {
        return this.createFailureResult('VCENTER', err.code, err.message, 'TARGET_NOT_ALLOWED');
      }
      return this.createFailureResult('VCENTER', 'VMWARE_INTERNAL_ERROR', 'A network configuration error occurred', 'INTERNAL_ERROR');
    }

    try {
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      const loginResponse = await httpClient.post('/api/session', null, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });

      if (loginResponse.status === 401) {
        return this.createFailureResult('VCENTER', 'VMWARE_AUTH_FAILED', 'Unable to authenticate with vCenter Server', 'AUTH_FAILED');
      }

      if (loginResponse.status !== 201 && loginResponse.status !== 200) {
        return this.createFailureResult('VCENTER', 'VMWARE_API_ERROR', 'VMware returned an unsupported response format', 'API_ERROR');
      }

      sessionId = loginResponse.data;
      if (typeof sessionId === 'object' && sessionId !== null && sessionId.value) {
        sessionId = sessionId.value;
      }
      if (typeof sessionId === 'string' && sessionId.startsWith('"')) { sessionId = sessionId.replace(/^"|"$/g, ''); }
      if (!sessionId || typeof sessionId !== 'string') {
        return this.createFailureResult('VCENTER', 'VMWARE_API_ERROR', 'vCenter did not return a session token', 'API_ERROR');
      }

      const verifyResponse = await httpClient.get('/api/session', {
        headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' }
      });

      if (verifyResponse.status !== 200) {
        return this.createFailureResult('VCENTER', 'VMWARE_API_ERROR', 'Unable to validate the vCenter session', 'API_ERROR');
      }

      const latencyMs = Date.now() - startTime;
      return this.createSuccessResult('VCENTER', latencyMs, verifyTls);
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        return this.createFailureResult('VCENTER', 'VMWARE_TIMEOUT', 'The VMware connection timed out', 'TIMEOUT');
      }
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH') {
        return this.createFailureResult('VCENTER', 'VMWARE_UNREACHABLE', 'Unable to reach VMware', 'UNREACHABLE');
      }
      if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || err.code === 'CERT_HAS_EXPIRED' || err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
        return this.createFailureResult('VCENTER', 'VMWARE_TLS_ERROR', 'Unable to verify VMware connection security', 'TLS_ERROR');
      }
      if (err.response && err.response.status === 401) {
        return this.createFailureResult('VCENTER', 'VMWARE_AUTH_FAILED', 'Unable to authenticate with vCenter Server', 'AUTH_FAILED');
      }
      return this.createFailureResult('VCENTER', 'VMWARE_API_ERROR', 'Unable to connect to vCenter Server', 'API_ERROR');
    } finally {
      if (sessionId && httpClient) {
        try {
          await httpClient.delete('/api/session', { headers: { 'vmware-api-session-id': sessionId } });
        } catch (logoutErr) {}
        sessionId = null; 
      }
    }
  }

  async loginAutomation(baseUrl, username, password, verifyTls) {
    try {
      const httpClient = await vmwareHttpService.createClient(baseUrl, verifyTls);
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      const loginResponse = await httpClient.post('/api/session', null, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });

      if (loginResponse.status === 401) {
        const err = new Error('VMWARE_AUTH_FAILED');
        err.code = 'AUTH_FAILED';
        throw err;
      }

      let sessionId = loginResponse.data;
      if (typeof sessionId === 'object' && sessionId !== null && sessionId.value) { sessionId = sessionId.value; }
      if (typeof sessionId === 'string' && sessionId.startsWith('"')) { sessionId = sessionId.replace(/^"|"$/g, ''); }
      if (!sessionId || typeof sessionId !== 'string') {
        const err = new Error('VMWARE_API_ERROR');
        err.code = 'API_ERROR';
        throw err;
      }

      return { httpClient, sessionId };
    } catch (err) {
      if (err.name === 'NetworkPolicyError') err.code = 'TARGET_NOT_ALLOWED';
      throw err;
    }
  }

  async logoutAutomation(httpClient, sessionId) {
    if (sessionId && httpClient) {
      try {
        await httpClient.delete('/api/session', { headers: { 'vmware-api-session-id': sessionId } });
      } catch (err) {}
    }
  }

  async getViApiVersion(httpClient, baseUrl) {
    if (viApiVersionCache.has(baseUrl)) {
      return viApiVersionCache.get(baseUrl);
    }
    
    let candidates = ["8.0.3.0"]; // Default fallback
    let discoveredApiVersion = null;
    try {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
   <soapenv:Body>
      <urn:RetrieveServiceContent>
         <urn:_this type="ServiceInstance">ServiceInstance</urn:_this>
      </urn:RetrieveServiceContent>
   </soapenv:Body>
</soapenv:Envelope>`;
      const res = await httpClient.post('/sdk', body, {
        headers: { 'Content-Type': 'text/xml' },
        timeout: 10000
      });
      discoveredApiVersion = await xmlParser.extractApiVersion(res.data);
      if (discoveredApiVersion) {
        candidates.unshift(discoveredApiVersion);
        if (discoveredApiVersion.split('.').length === 3) {
          candidates.unshift(discoveredApiVersion + ".0");
        }
      }
    } catch (err) {
      console.error('Failed to extract apiVersion via SOAP XML parser:', err.message);
    }

    // Probe Candidate via VI/JSON ServiceContent
    let confirmedViJsonRelease = null;
    let moids = null;
    for (const cand of candidates) {
      try {
        const res = await httpClient.get(`/sdk/vim25/${cand}/ServiceInstance/ServiceInstance/content`, {
           headers: { 'Accept': 'application/json' },
           validateStatus: (status) => true
        });
        
        if (res.status === 200 && res.data && typeof res.data === 'object') {
          const content = res.data;
          if (content.sessionManager?.value && content.propertyCollector?.value && content.viewManager?.value && content.rootFolder?.value) {
            confirmedViJsonRelease = cand;
            moids = {
              sessionManager: content.sessionManager.value,
              propertyCollector: content.propertyCollector.value,
              viewManager: content.viewManager.value,
              rootFolder: content.rootFolder.value
            };
            break;
          }
        }
      } catch (err) {}
    }
    
    if (!confirmedViJsonRelease || !moids) {
      // Fallback in worst case
      confirmedViJsonRelease = "8.0.3.0";
      moids = { sessionManager: 'SessionManager', propertyCollector: 'propertyCollector', viewManager: 'ViewManager', rootFolder: 'group-d1' };
    }

    const cacheEntry = {
      confirmedViJsonRelease,
      moids,
      discoveredApiVersion
    };
    console.log(`[VI/JSON Discovery] Host: ${baseUrl}, Discovered SOAP apiVersion: ${discoveredApiVersion}, Confirmed JSON Release: ${confirmedViJsonRelease}`);
    viApiVersionCache.set(baseUrl, cacheEntry);
    return cacheEntry;
  }

  async loginViJson(httpClient, baseUrl, username, password) {
    const cacheEntry = await this.getViApiVersion(httpClient, baseUrl);
    const apiVersion = cacheEntry.confirmedViJsonRelease;
    const moids = cacheEntry.moids;
    const body = { userName: username, password: password };
    try {
      const res = await httpClient.post(`/sdk/vim25/${apiVersion}/SessionManager/${moids.sessionManager}/Login`, body, { 
        headers: { 'Content-Type': 'application/json' }
      });
      const viSessionId = res.headers['vmware-api-session-id'];
      if (!viSessionId) {
        throw new Error('Failed to obtain VI/JSON vmware-api-session-id header');
      }
      return { viSessionId, apiVersion, moids };
    } catch (err) {
      console.error('VI/JSON Login Failed:', err.message);
      if (err.response?.status === 401) {
        const authErr = new Error('VMWARE_AUTH_FAILED');
        authErr.code = 'AUTH_FAILED';
        throw authErr;
      }
      if (err.name === 'NetworkPolicyError') err.code = 'TARGET_NOT_ALLOWED';
      throw err;
    }
  }

  async logoutViJson(httpClient, baseUrl, apiVersion, viSessionId) {
    if (httpClient && apiVersion && viSessionId) {
      try {
        const cacheEntry = viApiVersionCache.get(baseUrl) || { moids: { sessionManager: 'SessionManager' } };
        const moids = cacheEntry.moids;
        await httpClient.post(`/sdk/vim25/${apiVersion}/SessionManager/${moids.sessionManager}/Logout`, {}, { 
          headers: { 'vmware-api-session-id': viSessionId, 'Content-Type': 'application/json' }
        });
      } catch (err) {}
    }
  }

  async listDatacenters(httpClient, sessionId) {
    const res = await httpClient.get('/api/vcenter/datacenter', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } });
    if (!Array.isArray(res.data)) throw new Error('VMWARE_INVALID_RESPONSE');
    return res.data;
  }

  async listClusters(httpClient, sessionId) {
    const res = await httpClient.get('/api/vcenter/cluster', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } });
    if (!Array.isArray(res.data)) throw new Error('VMWARE_INVALID_RESPONSE');
    return res.data;
  }

  async listHosts(httpClient, sessionId) {
    const res = await httpClient.get('/api/vcenter/host', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } });
    if (!Array.isArray(res.data)) throw new Error('VMWARE_INVALID_RESPONSE');
    return res.data;
  }

  async listDatastores(httpClient, sessionId) {
    const res = await httpClient.get('/api/vcenter/datastore', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } });
    if (!Array.isArray(res.data)) throw new Error('VMWARE_INVALID_RESPONSE');
    return res.data;
  }

  async listResourcePools(httpClient, sessionId) {
    try {
      const res = await httpClient.get('/api/vcenter/resource-pool', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } });
      if (!Array.isArray(res.data)) return [];
      return res.data;
    } catch (err) {
      console.warn('Failed to list Resource Pools (may be unsupported on this vCenter version):', err.message);
      return [];
    }
  }

  async listVirtualMachines(httpClient, sessionId) {
    try {
      const res = await httpClient.get('/api/vcenter/vm', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } });
      if (!Array.isArray(res.data)) throw new Error('VMWARE_INVALID_RESPONSE');
      return res.data;
    } catch (err) {
      if (err.response && err.response.status === 500 && err.response.data && err.response.data.error_type === 'UnableToAllocateResource') {
        const customErr = new Error('INVENTORY_LIMIT_EXCEEDED');
        customErr.code = 'INVENTORY_LIMIT_EXCEEDED';
        throw customErr;
      }
      throw err;
    }
  }

  async getApplianceHealth(httpClient, sessionId) {
    try {
      const versionRes = await httpClient.get('/api/appliance/system/version', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } }).catch(() => null);
      const healthRes = await httpClient.get('/api/appliance/health/system', { headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' } }).catch(() => null);
      
      return {
        productName: versionRes?.data?.product || 'VMware vCenter Server',
        version: versionRes?.data?.version || null,
        build: versionRes?.data?.build || null,
        healthStatus: healthRes?.data || 'UNKNOWN',
        databaseHealth: 'UNKNOWN',
        storageHealth: 'UNKNOWN',
        memoryHealth: 'UNKNOWN',
        loadHealth: 'UNKNOWN',
        uptimeSeconds: null,
        lastHealthSyncAt: new Date()
      };
    } catch (e) {
      return { productName: 'VMware vCenter Server', version: null, build: null, healthStatus: 'UNKNOWN', lastHealthSyncAt: new Date() };
    }
  }

  async fetchDetailedProperties(httpClient, viSessionId, apiVersion, viewType, properties, moids, limits = {}) {
    const maxPages = Math.max(1, Math.min(200, limits.maxPages || 200));
    const maxObjects = Math.max(1, Math.min(50000, limits.maxObjects || 50000));
    const deadline = Date.now() + Math.max(1, Math.min(60000, limits.deadlineMs || 60000));
    const failure = code => Object.assign(new Error(code), { code });
    const createViewBody = {
      container: { type: "Folder", value: moids.rootFolder },
      type: [viewType],
      recursive: true
    };
    
    let viewMoid = null;
    try {
      const createViewRes = await httpClient.post(`/sdk/vim25/${apiVersion}/ViewManager/${moids.viewManager}/CreateContainerView`, createViewBody, {
        headers: { 'vmware-api-session-id': viSessionId, 'Accept': 'application/json', 'Content-Type': 'application/json' }
      });
      viewMoid = createViewRes.data?.value;
    } catch (err) {
      throw err;
    }

    if (!viewMoid) throw failure('PROPERTY_VIEW_CONTRACT_ERROR');

    const retrieveBody = {
      specSet: [
        {
          _typeName: "PropertyFilterSpec",
          propSet: [ { _typeName: "PropertySpec", type: viewType, pathSet: properties } ],
          objectSet: [
            {
              _typeName: "ObjectSpec",
              obj: { type: "ContainerView", value: viewMoid },
              skip: true,
              selectSet: [
                {
                  _typeName: "TraversalSpec",
                  name: "traverseEntities",
                  type: "ContainerView",
                  path: "view",
                  skip: false
                }
              ]
            }
          ]
        }
      ],
      options: { _typeName: "RetrieveOptions" }
    };

    let allObjects = [];
    let token = null;
    let pages = 0;
    const consumedTokens = new Set();

    try {
      do {
        if (++pages > maxPages) throw failure('PROPERTY_COLLECTION_TRUNCATED');
        if (Date.now() >= deadline) throw failure('ETIMEDOUT');
        if (token && consumedTokens.has(token)) throw failure('PROPERTY_TOKEN_CONTRACT_ERROR');
        if (token) consumedTokens.add(token);
        let pageRes;
        if (!token) {
          pageRes = await httpClient.post(`/sdk/vim25/${apiVersion}/PropertyCollector/${moids.propertyCollector}/RetrievePropertiesEx`, retrieveBody, {
            timeout: Math.max(1, deadline - Date.now()),
            headers: { 'vmware-api-session-id': viSessionId, 'Accept': 'application/json', 'Content-Type': 'application/json' }
          });
        } else {
          pageRes = await httpClient.post(`/sdk/vim25/${apiVersion}/PropertyCollector/${moids.propertyCollector}/ContinueRetrievePropertiesEx`, {
            token: token
          }, {
            timeout: Math.max(1, deadline - Date.now()),
            headers: { 'vmware-api-session-id': viSessionId, 'Accept': 'application/json', 'Content-Type': 'application/json' }
          });
        }
        
        // VMware returns an empty successful body when this object type has no instances.
        const returnval = pageRes.data === '' || pageRes.data === null ? { objects: [] } : (pageRes.data?.returnval || pageRes.data);
        if (!returnval || typeof returnval !== 'object' || (returnval.objects != null && !Array.isArray(returnval.objects))) throw failure('PROPERTY_RESPONSE_CONTRACT_ERROR');
        if (returnval && returnval.objects) {
          allObjects = allObjects.concat(returnval.objects);
        }
        token = returnval?.token;
        
        if (allObjects.length > maxObjects) throw failure('PROPERTY_COLLECTION_TRUNCATED');
        if (Date.now() >= deadline) throw failure('ETIMEDOUT');
      } while (token);
    } finally {
        // On failure/cap/deadline cancel only this outstanding retrieval, never the default collector.
        if (token) {
           try {
             await httpClient.post(`/sdk/vim25/${apiVersion}/PropertyCollector/${moids.propertyCollector}/CancelRetrievePropertiesEx`, { token: token }, {
                headers: { 'vmware-api-session-id': viSessionId, 'Accept': 'application/json', 'Content-Type': 'application/json' }
             });
           } catch (cancelErr) {
             console.error('Property retrieval cancellation was not confirmed');
           }
           token = null;
        }
      try {
        await httpClient.post(`/sdk/vim25/${apiVersion}/ContainerView/${viewMoid}/DestroyView`, {}, {
          headers: { 'vmware-api-session-id': viSessionId, 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('Property view cleanup was not confirmed');
      }
    }

    return allObjects;
  }

  getProp(obj, path) {
    if (!obj || !obj.propSet) return null;
    const prop = obj.propSet.find(p => p.name === path);
    if (!prop) return null;
    if (prop.val && prop.val._value !== undefined) return prop.val._value;
    return prop.val;
  }

  async batchGetVmDetails(httpClient, baseUrl, viSessionId, apiVersion, vms) {
    if (!vms || vms.length === 0) return [];
    const cacheEntry = viApiVersionCache.get(baseUrl) || { moids: { rootFolder: 'group-d1', viewManager: 'ViewManager', propertyCollector: 'propertyCollector' } };
    const moids = cacheEntry.moids;
    
    const properties = [
      "name", "parent", "runtime.host", "runtime.powerState", "runtime.connectionState", "resourcePool", 
      "guest.guestId", "guest.guestFullName", "guest.hostName", "guest.ipAddress", "guest.net", 
      "guest.toolsRunningStatus", "guest.toolsVersionStatus2", "config.version", "config.hardware.numCPU",
      "config.hardware.memoryMB", "summary.quickStats.overallCpuUsage", "summary.quickStats.guestMemoryUsage", 
      "summary.storage.committed", "summary.storage.uncommitted", "datastore", "network", "overallStatus"
    ];

    const viData = await this.fetchDetailedProperties(httpClient, viSessionId, apiVersion, 'VirtualMachine', properties, moids);
    
    const viMap = {};
    for (const obj of viData) {
      if (!obj || !obj.obj) continue;
      const id = obj.obj.value;
      const getP = (path) => this.getProp(obj, path);
      
      const net = getP("guest.net") || [];
      const ipAddresses = [];
      const netArr = Array.isArray(net) ? net : (net.VirtualMachineGuestOsIdentifier ? [net] : []);
      for (const nic of netArr) {
         if (nic.ipAddress) {
            if (Array.isArray(nic.ipAddress)) {
              ipAddresses.push(...nic.ipAddress);
            } else {
              ipAddresses.push(nic.ipAddress);
            }
         }
      }
      
      const datastores = getP("datastore") || [];
      const dsList = Array.isArray(datastores) ? datastores.map(d => d.value) : (datastores.value ? [datastores.value] : []);
      
      const networks = getP("network") || [];
      const netList = Array.isArray(networks) ? networks.map(n => n.value) : (networks.value ? [networks.value] : []);

      viMap[id] = {
        host: getP("runtime.host")?.value || null,
        resourcePool: getP("resourcePool")?.value || null,
        parentFolder: getP("parent")?.value || null,
        guestOsId: getP("guest.guestId") || null,
        guestOsFullName: getP("guest.guestFullName") || null,
        dnsName: getP("guest.hostName") || null,
        primaryIp: getP("guest.ipAddress") || null,
        ipAddresses: ipAddresses,
        toolsRunningStatus: getP("guest.toolsRunningStatus") || null,
        toolsVersionStatus: getP("guest.toolsVersionStatus2") || null,
        hardwareVersion: getP("config.version") || null,
        configuredVcpu: getP("config.hardware.numCPU") || null,
        configuredMemoryMib: getP("config.hardware.memoryMB") || null,
        cpuUsageMhz: getP("summary.quickStats.overallCpuUsage") || null,
        memoryUsageMib: getP("summary.quickStats.guestMemoryUsage") || null,
        storageCommittedBytes: getP("summary.storage.committed") || null,
        storageUncommittedBytes: getP("summary.storage.uncommitted") || null,
        powerState: getP("runtime.powerState") || null,
        connectionState: getP("runtime.connectionState") || null,
        overallStatus: getP("overallStatus") || null,
        mappedDatastores: dsList,
        mappedNetworks: netList
      };
    }

    const results = [];
    for (const vm of vms) {
      const data = viMap[vm.vm];
      if (data) {
        results.push({
          vm: vm.vm,
          ...data,
          detailStatus: 'COMPLETE'
        });
      } else {
        results.push({ vm: vm.vm, detailStatus: 'UNAVAILABLE', detailErrorCode: 'NOT_REPORTED_BY_VCENTER' });
      }
    }
    return results;
  }

  async batchGetHostDetails(httpClient, baseUrl, viSessionId, apiVersion, hosts) {
    if (!hosts || hosts.length === 0) return [];
    const cacheEntry = viApiVersionCache.get(baseUrl) || { moids: { rootFolder: 'group-d1', viewManager: 'ViewManager', propertyCollector: 'propertyCollector' } };
    const moids = cacheEntry.moids;

    const properties = [
      "name", "parent", "runtime.connectionState", "runtime.powerState", 
      "summary.hardware.vendor", "summary.hardware.model", "summary.hardware.cpuModel",
      "summary.hardware.cpuMhz", "summary.hardware.numCpuPkgs", "summary.hardware.numCpuCores", 
      "summary.hardware.numCpuThreads", "summary.hardware.memorySize", 
      "summary.quickStats.overallCpuUsage", "summary.quickStats.overallMemoryUsage", 
      "config.product.name", "config.product.fullName", "config.product.version", 
      "config.product.build", "overallStatus", "datastore", "network", "vm", "config.network.pnic",
      "config.storageDevice.hostBusAdapter", "config.storageDevice.scsiLun", "config.network.portgroup",
      "config.network.vswitch", "config.network.proxySwitch", "config.network.vnic"
    ];

    const viData = await this.fetchDetailedProperties(httpClient, viSessionId, apiVersion, 'HostSystem', properties, moids);

    const viMap = {};
    for (const obj of viData) {
      if (!obj || !obj.obj) continue;
      const id = obj.obj.value;
      const getP = (path) => this.getProp(obj, path);
      
      const datastores = getP("datastore") || [];
      const dsList = Array.isArray(datastores) ? datastores.map(d => d.value) : (datastores.value ? [datastores.value] : []);
      
      const networks = getP("network") || [];
      const netList = Array.isArray(networks) ? networks.map(n => n.value) : (networks.value ? [networks.value] : []);

      const pnics = getP("config.network.pnic");
      const rawPnics = Array.isArray(pnics) ? pnics : (pnics?.value ? (Array.isArray(pnics.value) ? pnics.value : [pnics.value]) : []);
      const pnicList = rawPnics.map(p => ({
        key: p.key || null,
        device: p.device,
        mac: p.mac,
        speedMb: p.linkSpeed?.speedMb || null,
        duplex: p.linkSpeed?.duplex ?? null,
        configuredSpeedMb: p.spec?.linkSpeed?.speedMb || null,
        configuredDuplex: p.spec?.linkSpeed?.duplex ?? null,
        autoNegotiate: !p.spec?.linkSpeed,
        switchName: null
      }));

      const hbas = getP("config.storageDevice.hostBusAdapter");
      const rawHbas = Array.isArray(hbas) ? hbas : (hbas?.value ? (Array.isArray(hbas.value) ? hbas.value : [hbas.value]) : []);
      const hbaList = rawHbas.map(h => {
        let type = 'Block';
        
        if (h._typeName === 'HostParallelScsiHba') type = 'SCSI';
        else if (h._typeName === 'HostBlockHba') type = 'Block SCSI';
        else if (h._typeName === 'HostFibreChannelHba') type = 'Fibre Channel';
        else if (h._typeName === 'HostFibreChannelOverEthernetHba') type = 'Fibre Channel';
        else if (h._typeName === 'HostInternetScsiHba') type = 'iSCSI';
        else if (h._typeName === 'HostSerialAttachedHba') type = 'SAS';
        
        const d = (h.driver || '').toLowerCase();
        const m = (h.model || '').toLowerCase();
        if (type === 'Block') {
          if (d.includes('fc') || d.includes('qlnative') || m.includes('fibre channel')) type = 'Fibre Channel';
          else if (d.includes('iscsi') || m.includes('iscsi') || d.includes('iscsi_vmk')) type = 'iSCSI';
          else if (d.includes('nvme') || m.includes('nvme')) type = 'NVMe';
          else if (d.includes('sas') || d.includes('hpsa') || d.includes('megaraid') || m.includes('sas') || m.includes('smart array')) type = 'SAS';
          else if (d.includes('usb') || m.includes('usb')) type = 'USB';
          else if (d.includes('fcoe') || m.includes('fcoe')) type = 'FCoE';
        }
        const formatWwn = (val) => {
          if (!val) return null;
          if (typeof val === 'string' && val.includes(':')) return val.toLowerCase();
          try {
            let hex = BigInt(val).toString(16).padStart(16, '0');
            return hex.match(/.{1,2}/g).join(':');
          } catch (e) {
            return String(val);
          }
        };
        return {
          device: h.device,
          model: h.model,
          status: h.status,
          driver: h.driver,
          type: type,
          pci: h.pci,
          wwnn: formatWwn(h.nodeWorldWideName || h.wwnn),
          wwpn: formatWwn(h.portWorldWideName || h.wwpn)
        };
      });

      const scsiLuns = getP("config.storageDevice.scsiLun");
      const rawLuns = Array.isArray(scsiLuns) ? scsiLuns : (scsiLuns?.value ? (Array.isArray(scsiLuns.value) ? scsiLuns.value : [scsiLuns.value]) : []);
      const lunList = rawLuns.map(l => {
        let lunId = '-';
        if (l.canonicalName && l.canonicalName.includes(':L')) {
          lunId = l.canonicalName.split(':L')[1];
        }
        return {
          uuid: l.uuid,
          canonicalName: l.canonicalName,
          lunId: lunId,
          lunType: l.lunType,
          vendor: l.vendor,
          model: l.model,
          displayName: l.displayName || null,
          ssd: l.ssd !== undefined ? l.ssd : null,
          capacity: l.capacity?.block ? (l.capacity.block * l.capacity.blockSize) : null,
          operationalState: Array.isArray(l.operationalState) ? l.operationalState.join(', ') : (l.operationalState || 'Unknown')
        };
      });

      const portgroups = getP("config.network.portgroup");
      const rawPortgroups = Array.isArray(portgroups) ? portgroups : (portgroups?.value ? (Array.isArray(portgroups.value) ? portgroups.value : [portgroups.value]) : []);
      const portgroupMap = {};
      rawPortgroups.forEach(pg => {
        if (pg.key) portgroupMap[pg.key] = pg;
      });

      const vswitches = getP("config.network.vswitch");
      const rawVswitches = Array.isArray(vswitches) ? vswitches : (vswitches?.value ? (Array.isArray(vswitches.value) ? vswitches.value : [vswitches.value]) : []);
      const vswitchList = rawVswitches.map(v => {
        const pgs = rawPortgroups.filter(pg => pg.spec?.vswitchName === v.name || pg.vswitch === v.name || (v.portgroup && (Array.isArray(v.portgroup) ? v.portgroup : [v.portgroup]).includes(pg.key))).map(pg => ({
          name: pg.spec?.name || pg.key,
          vlanId: pg.spec?.vlanId,
          type: 'Standard Network'
        }));
        return {
          name: v.name,
          numPorts: v.numPorts,
          mtu: v.mtu,
          portgroups: pgs
        };
      });

      const portgroupSwitchMap = new Map();
      rawPortgroups.forEach(pg => {
        const switchName = pg.spec?.vswitchName || pg.vswitch || null;
        if (!switchName) return;
        if (pg.key) portgroupSwitchMap.set(pg.key, switchName);
        if (pg.spec?.name) portgroupSwitchMap.set(pg.spec.name, switchName);
      });

      const proxySwitches = getP("config.network.proxySwitch");
      const rawProxySwitches = Array.isArray(proxySwitches) ? proxySwitches : (proxySwitches?.value ? (Array.isArray(proxySwitches.value) ? proxySwitches.value : [proxySwitches.value]) : []);
      const distributedSwitchMap = new Map();
      rawProxySwitches.forEach(proxySwitch => {
        const uuid = proxySwitch.dvsUuid || proxySwitch.uuid || null;
        const name = proxySwitch.dvsName || proxySwitch.name || uuid;
        if (uuid && name) distributedSwitchMap.set(uuid, name);
      });

      const bindPhysicalNicToSwitch = (reference, switchName) => {
        const ref = typeof reference === 'string' ? reference : reference?.value;
        if (!ref || !switchName) return;
        const pnic = pnicList.find(item => item.key === ref || item.device === ref || ref.endsWith(`-${item.device}`));
        if (pnic && !pnic.switchName) pnic.switchName = switchName;
      };

      rawVswitches.forEach(vswitch => {
        const references = [];
        const directPnics = Array.isArray(vswitch.pnic) ? vswitch.pnic : (vswitch.pnic ? [vswitch.pnic] : []);
        const bridgePnics = vswitch.spec?.bridge?.nicDevice;
        references.push(...directPnics);
        references.push(...(Array.isArray(bridgePnics) ? bridgePnics : (bridgePnics ? [bridgePnics] : [])));
        references.forEach(reference => bindPhysicalNicToSwitch(reference, vswitch.name));
      });

      rawProxySwitches.forEach(proxySwitch => {
        const switchName = proxySwitch.dvsName || proxySwitch.name || proxySwitch.dvsUuid || proxySwitch.uuid || null;
        const directPnics = Array.isArray(proxySwitch.pnic) ? proxySwitch.pnic : (proxySwitch.pnic ? [proxySwitch.pnic] : []);
        const backingSpecs = proxySwitch.spec?.backing?.pnicSpec;
        const specs = Array.isArray(backingSpecs) ? backingSpecs : (backingSpecs ? [backingSpecs] : []);
        directPnics.forEach(reference => bindPhysicalNicToSwitch(reference, switchName));
        specs.forEach(spec => bindPhysicalNicToSwitch(spec?.pnicDevice, switchName));
      });

      const vnics = getP("config.network.vnic");
      const rawVnics = Array.isArray(vnics) ? vnics : (vnics?.value ? (Array.isArray(vnics.value) ? vnics.value : [vnics.value]) : []);
      const vnicList = rawVnics.map(v => {
        const distributedSwitchUuid = v.spec?.distributedVirtualPort?.switchUuid || null;
        return {
          device: v.device,
          portgroup: v.portgroup,
          switchName: portgroupSwitchMap.get(v.portgroup)
            || distributedSwitchMap.get(distributedSwitchUuid)
            || distributedSwitchUuid
            || null,
          ipAddress: v.spec?.ip?.ipAddress || null,
          mac: v.spec?.mac || null,
          mtu: v.spec?.mtu || null
        };
      });

      viMap[id] = {
        cluster: getP("parent")?.value || null,
        vendor: getP("summary.hardware.vendor") || null,
        model: getP("summary.hardware.model") || null,
        cpuModel: getP("summary.hardware.cpuModel") || null,
        cpuMhz: getP("summary.hardware.cpuMhz") || null,
        cpuCores: getP("summary.hardware.numCpuCores") || null,
        cpuThreads: getP("summary.hardware.numCpuThreads") || null,
        cpuPackages: getP("summary.hardware.numCpuPkgs") || null,
        totalMemoryBytes: getP("summary.hardware.memorySize") || null,
        cpuUsageMhz: getP("summary.quickStats.overallCpuUsage") || null,
        memoryUsageMib: getP("summary.quickStats.overallMemoryUsage") || null,
        esxiProductName: getP("config.product.name") || null,
        esxiFullName: getP("config.product.fullName") || null,
        esxiVersion: getP("config.product.version") || null,
        esxiBuild: getP("config.product.build") || null,
        connectionState: getP("runtime.connectionState") || null,
        powerState: getP("runtime.powerState") || null,
        overallStatus: getP("overallStatus") || null,
        mappedDatastores: dsList,
        mappedNetworks: netList,
        pnicList: pnicList,
        hbaList: hbaList,
        lunList: lunList,
        vswitchList: vswitchList,
        vnicList: vnicList,
        pnicCount: pnicList.length,
        hbaCount: hbaList.length,
        lunCount: lunList.length,
        vswitchCount: vswitchList.length,
        vnicCount: vnicList.length
      };
    }

    const dsMap = {}; // canonicalName -> [datastore_names]
    try {
      // Fetch all Datastores to map them to LUNs
      const dsInfos = await this.fetchDetailedProperties(httpClient, viSessionId, apiVersion, 'Datastore', ['name', 'info'], moids);
      dsInfos.forEach(ds => {
        const nameProp = ds.propSet?.find(p => p.name === 'name');
        const infoProp = ds.propSet?.find(p => p.name === 'info');
        const dsName = nameProp ? (nameProp.val && nameProp.val._value !== undefined ? nameProp.val._value : nameProp.val) : 'Unknown';
        const dsInfo = infoProp ? (infoProp.val && infoProp.val._value !== undefined ? infoProp.val._value : infoProp.val) : null;
        
        if (dsInfo?.vmfs?.extent) {
          const extents = Array.isArray(dsInfo.vmfs.extent) ? dsInfo.vmfs.extent : [dsInfo.vmfs.extent];
          extents.forEach(ext => {
            if (ext.diskName) {
              if (!dsMap[ext.diskName]) dsMap[ext.diskName] = [];
              dsMap[ext.diskName].push(dsName);
            }
          });
        }
      });
    } catch (err) {
      console.warn("Failed to fetch datastore mappings for LUNs", err.message);
    }

    Object.values(viMap).forEach(data => {
      if (data.lunList) {
        data.lunList.forEach(lun => {
          if (dsMap[lun.canonicalName]) {
            lun.datastores = dsMap[lun.canonicalName];
          }
        });
      }
    });

    const results = [];
    for (const host of hosts) {
      const data = viMap[host.host];
      if (data) {
        results.push({
          host: host.host,
          ...data,
          status: 'COMPLETE'
        });
      } else {
        results.push({ host: host.host, status: 'UNAVAILABLE' });
      }
    }
    return results;
  }

  async getNetworkDetails(httpClient, baseUrl, viSessionId, apiVersion) {
    const cacheEntry = viApiVersionCache.get(baseUrl) || { moids: { rootFolder: 'group-d1', viewManager: 'ViewManager', propertyCollector: 'propertyCollector' } };
    const moids = cacheEntry.moids;
    const properties = ["name"];
    const viData = await this.fetchDetailedProperties(httpClient, viSessionId, apiVersion, 'Network', properties, moids);
    const dvpgData = await this.fetchDetailedProperties(httpClient, viSessionId, apiVersion, 'DistributedVirtualPortgroup', properties, moids);
    const opqData = await this.fetchDetailedProperties(httpClient, viSessionId, apiVersion, 'OpaqueNetwork', properties, moids);
    
    const results = [];
    
    for (const obj of viData) {
      if (!obj || !obj.obj) continue;
      results.push({ network: obj.obj.value, name: this.getProp(obj, "name") });
    }
    for (const obj of dvpgData) {
      if (!obj || !obj.obj) continue;
      results.push({ network: obj.obj.value, name: this.getProp(obj, "name") });
    }
    for (const obj of opqData) {
      if (!obj || !obj.obj) continue;
      results.push({ network: obj.obj.value, name: this.getProp(obj, "name") });
    }
    return results;
  }
}

module.exports = new VcenterAdapter();
