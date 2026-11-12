'use strict';
const { z } = require('zod');
const { pool } = require('../../db');
const { decryptCredential } = require('../utils/encryption.util');
const { apply } = require('../storage/connection-reconciliation');
const coordinator = require('./sync-coordinator.service');
const schema = z.object({
  name: z.string().trim().min(1).max(100), type: z.enum(['VCENTER','SRM','VR']),
  site: z.string().trim().min(1).max(80), baseUrl: z.string().max(500),
  username: z.string().trim().min(1).max(256), password: z.string().min(1).max(2048).optional(),
  verifyTls: z.boolean(), vcenterId: z.number().int().positive().nullable().optional()
}).strict();
const failure = (message, status = 400) => Object.assign(Error(message), { code: 'CONFIGURATION_ERROR', status });
const activeStates = new Set(['PENDING','QUEUED','NEW','ACCEPTED','SUBMITTING','SUBMITTED','RUNNING','REFRESH_PENDING','UNKNOWN','SUBMISSION_UNKNOWN','RECONCILING','RECONCILIATION_BLOCKED','ROLLBACK_FAILED']);
function rowsFrom(records) {
  return records.map(c => ({ id: c.id, name: c.connection_name, type: c.system_type, site: c.site, baseUrl: c.base_url, username: c.username, password: decryptCredential(c.encrypted_password,c.encryption_iv,c.encryption_auth_tag), verifyTls: c.verify_tls, vcenterId: c.associated_vcenter_connection_id }));
}
async function mutate(id, input, remove = false) {
  if (require('./configuration-admission').hasInFlight()) throw failure('Wait for in-flight VMware requests before changing servers',409);
  const token = coordinator.acquire({ kind: 'CONFIGURATION_CHANGE', connectionId: id });
  try {
    const { records, busy } = await pool.run(s => ({ records: structuredClone(s.read('connections')), busy: s.read('tasks').some(t => activeStates.has(t.status)) }), [], false);
    if (busy) throw failure('Wait for active or unresolved VMware operations before changing servers',409);
    const rows = rowsFrom(records);
    const old = rows.find(r => r.id === id);
    if (id && !old) throw failure('Server not found',404);
    let next;
    if (remove) {
      if (rows.some(r => r.vcenterId === id)) throw failure('Remove the associated SRM/VR servers first',409);
      next = rows.filter(r => r.id !== id);
    } else {
      const parsed = schema.parse(input);
      let url;
      try { url = new URL(parsed.baseUrl); } catch { throw failure('Use a valid HTTPS server address'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== '/') throw failure('Use an HTTPS origin without credentials, path, query or fragment');
      if (old && parsed.type !== old.type) throw failure('Create a new server to change its type');
      const entry = { ...parsed, baseUrl: url.origin, password: parsed.password || old?.password, id: id || Math.max(0,...rows.map(r => r.id)) + 1, vcenterId: parsed.type === 'VCENTER' ? null : parsed.vcenterId };
      if (!entry.password) throw failure('Password is required for a new server');
      next = old ? rows.map(r => r.id === id ? entry : r) : [...rows,entry];
      if (old?.type === 'VCENTER' && old.site !== entry.site) next = next.map(r => r.vcenterId === id ? { ...r, site: entry.site } : r);
    }
    const urls = new Set();
    for (const row of next) {
      if (urls.has(row.baseUrl)) throw failure('A server with that endpoint already exists',409);
      urls.add(row.baseUrl);
      if (row.type !== 'VCENTER' && !next.some(v => v.id === row.vcenterId && v.type === 'VCENTER' && v.site.toLowerCase() === row.site.toLowerCase())) throw failure('Select a vCenter in the same site');
    }
    await apply(pool,next);
    return { success: true };
  } finally { coordinator.release(token); }
}
module.exports = { mutate };
