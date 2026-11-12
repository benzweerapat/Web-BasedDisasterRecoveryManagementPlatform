const { pool } = require('../../db');
const connectionRepository = require('../repositories/connection.repository');
const AuditService = require('./audit.service');
const { getVmwareAdapter } = require('../adapters/vmware/vmware-adapter.factory');
const crypto = require('crypto');

// Single-flight lock (In-memory)
const activeConnectionTests = new Set();

class ConnectionTestService {
  
  /**
   * Safe helper to decrypt password
   */
  _decryptPassword(encrypted, iv, authTag, key) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      throw new Error('Credential Decryption Failed');
    }
  }

  async testConnection(id, user, clientIp, requestId) {
    if (activeConnectionTests.has(id)) {
      return {
        success: false,
        status: 409,
        data: {
          success: false,
          code: 'CONNECTION_TEST_IN_PROGRESS',
          message: 'This connection is currently being tested',
          requestId
        }
      };
    }

    activeConnectionTests.add(id);

    try {
      // Transaction A: Pre-flight Audit
      let connectionData;
      let transactionClient = await pool.connect();
      try {
        await transactionClient.begin();
        
        connectionData = await connectionRepository.findConnectionWithCredentialById(id, transactionClient);
        
        if (!connectionData) {
          throw new Error('NOT_FOUND');
        }

        if (!connectionData.isActive) {
          throw new Error('INACTIVE');
        }

        await AuditService.logActivity(
          user,
          'CONNECTION_TEST_REQUESTED',
          'connections',
          'SUCCESS',
          {
            connectionId: connectionData.id,
            connectionName: connectionData.connectionName,
            systemType: connectionData.systemType,
            site: connectionData.site,
            requestId,
            timestamp: new Date()
          },
          clientIp,
          transactionClient
        );
        
        await transactionClient.commit();
      } catch (err) {
        await transactionClient.rollback();
        if (err.message === 'NOT_FOUND') {
          return { success: false, status: 404, data: { success: false, code: 'NOT_FOUND', message: 'Connection not found' } };
        }
        if (err.message === 'INACTIVE') {
          return { success: false, status: 400, data: { success: false, code: 'CONNECTION_INACTIVE', message: 'The connection is disabled' } };
        }
        return { success: false, status: 500, data: { success: false, code: 'INTERNAL_ERROR', message: 'An internal error occurred' } };
      } finally {
        transactionClient.release();
      }

      // Network Operation (No DB Lock)
      const adapter = getVmwareAdapter(connectionData.systemType);
      
      let password = null;
      if (connectionData.encryptedPassword) {
        // Prepare Key
        const rawKey = process.env.VMWARE_CREDENTIAL_KEY;
        const keyBuffer = Buffer.from(rawKey, 'base64');
        password = this._decryptPassword(connectionData.encryptedPassword, connectionData.encryptionIv, connectionData.encryptionAuthTag, keyBuffer);
      }

      let adapterResult;
      try {
        adapterResult = await adapter.testConnection({
          baseUrl: connectionData.baseUrl,
          username: connectionData.username,
          password: password,
          verifyTls: connectionData.verifyTls
        });
      } catch (err) {
        // Adapter threw unexpected error
        adapterResult = {
          success: false,
          status: 'INTERNAL_ERROR',
          errorCode: 'VMWARE_INTERNAL_ERROR',
          safeMessage: 'The adapter operation failed'
        };
      } finally {
        // Force garbage collection path for password
        password = null;
      }

      // Transaction B: Result & Audit Update
      let updateClient = await pool.connect();
      try {
        await updateClient.begin();
        
        // Update Connection Status if VR/SRM isn't just a 501 bypass
        // For NOT_IMPLEMENTED, we don't update last_tested_at or status
        if (adapterResult.status !== 'NOT_IMPLEMENTED') {
          await connectionRepository.updateConnectionTestStatus(
            id, 
            adapterResult.status, 
            new Date(), 
            updateClient
          );
        }
        
        let auditAction = 'CONNECTION_TEST_FAILED';
        if (adapterResult.status === 'NOT_IMPLEMENTED') {
          auditAction = 'CONNECTION_TEST_NOT_IMPLEMENTED';
        } else if (adapterResult.success) {
          auditAction = 'CONNECTION_TEST_SUCCEEDED';
        }

        await AuditService.logActivity(
          user,
          auditAction,
          'connections',
          adapterResult.success ? 'SUCCESS' : 'FAILED',
          {
            connectionId: connectionData.id,
            connectionName: connectionData.connectionName,
            systemType: connectionData.systemType,
            site: connectionData.site,
            requestId,
            resultStatus: adapterResult.status,
            latencyMs: adapterResult.latencyMs || null,
            tlsVerified: adapterResult.tlsVerified,
            timestamp: new Date()
          },
          clientIp,
          updateClient
        );
        
        await updateClient.commit();
      } catch (err) {
        await updateClient.rollback();
        return { success: false, status: 500, data: { success: false, code: 'INTERNAL_ERROR', message: 'Unable to save the connection test result' } };
      } finally {
        updateClient.release();
      }

      // Prepare final safe response
      if (adapterResult.status === 'NOT_IMPLEMENTED') {
        return {
          success: false, 
          status: 501, 
          data: {
            success: false,
            code: adapterResult.errorCode,
            message: adapterResult.safeMessage,
            requestId
          }
        };
      }

      if (adapterResult.success) {
        const productName = {
          VCENTER: 'vCenter Server',
          VR: 'vSphere Replication',
          SRM: 'Site Recovery Manager'
        }[String(connectionData.systemType || '').toUpperCase()] || 'VMware service';
        let endpoint = '';
        try { endpoint = new URL(connectionData.baseUrl).host; } catch {}
        return {
          success: true,
          status: 200,
          data: {
            success: true,
            connection: {
              id: connectionData.id,
              systemType: connectionData.systemType,
              status: adapterResult.status,
              lastTestedAt: new Date().toISOString(),
              latencyMs: adapterResult.latencyMs,
              tlsVerified: adapterResult.tlsVerified
            },
            message: `Connected to ${productName}${endpoint ? ` at ${endpoint}` : ''}`,
            requestId
          }
        };
      }

      // Safe Failure (403, 502, 504 based on adapter)
      let httpStatus = 502;
      if (adapterResult.status === 'TIMEOUT') httpStatus = 504;
      if (adapterResult.errorCode === 'VMWARE_TARGET_NOT_ALLOWED') httpStatus = 403;

      return {
        success: false,
        status: httpStatus,
        data: {
          success: false,
          code: adapterResult.errorCode,
          message: adapterResult.safeMessage,
          status: adapterResult.status,
          requestId
        }
      };

    } finally {
      activeConnectionTests.delete(id);
    }
  }
}

module.exports = new ConnectionTestService();
