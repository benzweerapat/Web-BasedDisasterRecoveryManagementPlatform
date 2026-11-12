

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const { isIP } = require('node:net');
//ตรวจว่า hostname หรือ IP ของ VMware เป็นปลายทางที่ระบบอนุญาตให้ติดต่อหรือไม่
const { validateTarget, NetworkPolicyError } = require('../utils/network-policy.util');
const vmwareConfig = require('../config/vmware.config');

//รวม logic การสร้าง VMware HTTP Client ไว้ในจุดเดียว
class VmwareHttpService {
  
  async createClient(baseUrl, verifyTls = true) {
    let parsedUrl;
    //ตรวจรูปแบบ URL
    try {
      //new URL() แยก URL ออกเป็นส่วนต่าง ๆ
      parsedUrl = new URL(baseUrl);
    } catch (e) {
      throw new NetworkPolicyError('Invalid URL format');
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new NetworkPolicyError('Only HTTPS is supported');
    }
    //ห้ามฝังรหัสผ่านใน URL
    if (parsedUrl.username || parsedUrl.password) {
      throw new NetworkPolicyError('Credentials must not be embedded in the URL');
    }
    if (parsedUrl.hash) {
      throw new NetworkPolicyError('The URL must not contain a fragment');
    }

    // SSRF Validation & DNS Resolution
    const validIps = await validateTarget(parsedUrl.hostname);
    // Pin to the first valid IP to prevent DNS rebinding attacks during the request
    const pinnedIp = validIps[0];

    // Configure TLS
    const httpsAgentOptions = {
      rejectUnauthorized: verifyTls,
      servername: parsedUrl.hostname, // Preserve TLS servername
      // Custom lookup to enforce DNS Pinning
      lookup: (hostname, options, callback) => {
        // Axios/Node uses this signature for lookup. We bypass actual resolution.
        if (options?.all) callback(null, [{ address: pinnedIp, family: isIP(pinnedIp) }]);
        else callback(null, pinnedIp, isIP(pinnedIp));
      }
    };

    if (verifyTls && vmwareConfig.caCertPath) {
      try {
        const ca = fs.readFileSync(vmwareConfig.caCertPath);
        httpsAgentOptions.ca = ca;
      } catch (err) {
        throw new Error('Failed to load Custom CA certificate for VMware');
      }
    }

    const agent = new https.Agent(httpsAgentOptions);

    //สร้าง Axios Client
    const client = axios.create({
      baseURL: parsedUrl.origin,
      adapter: 'http', // Preserve our pinned DNS lookup and no-redirect policy.
      timeout: vmwareConfig.timeoutMs,
      maxContentLength: vmwareConfig.maxResponseBytes,
      maxBodyLength: vmwareConfig.maxResponseBytes,
      maxRedirects: 0, // No redirects
      proxy: false, // Force no proxy
      httpsAgent: agent,
      // We will handle status validation ourselves instead of throwing on everything
      validateStatus: (status) => true 
    });

    // Remove any default headers that might leak context
    delete client.defaults.headers.common['Authorization'];
    delete client.defaults.headers.common['Cookie'];

    return client;
  }
}

module.exports = new VmwareHttpService();
