// เป็น แม่แบบกลาง สำหรับ adapter ที่ทดสอบการเชื่อมต่อกับระบบ VMware แต่ละ type
// ไฟล์นี้กำหนด 3 อย่าง:

class BaseVmwareAdapter {
  /**
   * Test the connection to the VMware system.
   * @param {Object} options
   * @param {string} options.baseUrl
   * @param {string} options.username
   * @param {string} options.password (Plaintext, decrypted just in time)
   * @param {boolean} options.verifyTls
   * @returns {Promise<Object>} Safe result object
   */
  async testConnection(options) {
    throw new Error('Not implemented');
  }

  /**
   * Helper to format a successful response securely
   */
  createSuccessResult(systemType, latencyMs, tlsVerified) {
    return {
      success: true,
      systemType,
      status: 'CONNECTED',
      latencyMs,
      tlsVerified
    };
  }

  /**
   * Helper to format a failure response securely
   */
  createFailureResult(systemType, errorCode, safeMessage, status) {
    return {
      success: false,
      systemType,
      status,
      errorCode,
      safeMessage
    };
  }
}

module.exports = BaseVmwareAdapter;
