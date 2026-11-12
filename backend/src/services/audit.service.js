const {
  pool
} = require('../../db');
const {
  redact
} = require('../utils/redact.util');

//
class AuditService {
  /**
   * Logs a user activity
   */
  async logActivity(user, action, target, status, resultObject, ip, client = pool) {
    try {
      const redactedResult = redact(resultObject);
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};
        const rows = s.insert("activity_logs", [[p[0], p[1], p[2], p[3], p[4], p[5], p[6]]].map(a => Object.fromEntries(["username", "role", "action", "target", "status", "result", "ip"].map((k, i) => [k, a[i]]))), null);
        return R.changed(rows.length);
      }, [user?.username, user?.role, action, target, status, JSON.stringify(redactedResult), ip], true);
    } catch (err) {
      console.error('[AuditService] Failed to log activity:', err);
      throw err; // Re-throw to trigger rollback in transaction
    }
  }

  /**
   * Logs a system event (e.g. VMware sync, failures)
   */
  async logSystemEvent(eventType, severity, source, message, objectName = null, site = null, client = pool) {
    try {
      await client.run((s, p) => {
        const R = s.helpers;
        const views = {};
        const rows = s.insert("system_events", [[p[0], p[1], p[2], p[3], p[4], p[5]]].map(a => Object.fromEntries(["event_type", "severity", "source", "message", "object", "site"].map((k, i) => [k, a[i]]))), null);
        return R.changed(rows.length);
      }, [eventType, severity, source, message, objectName, site], true);
    } catch (err) {
      console.error('[AuditService] Failed to log system event:', err);
    }
  }
}
module.exports = new AuditService();