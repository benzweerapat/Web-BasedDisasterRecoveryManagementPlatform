'use strict';
const { z } = require('zod');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { pool } = require('../../db');
const { encryptCredential, decryptCredential } = require('../utils/encryption.util');
async function readAi() { return pool.run(s => s.read('app_settings').find(x => x.key === 'ai')?.value || { enabled:false, model:'', fallbackModel:'', timeoutMs:30000 }, [], false); }
async function publicAi() {
  const value = await readAi();
  return { enabled: value.enabled === true, model: value.model || '', fallbackModel: value.fallbackModel || '', timeoutMs:value.timeoutMs || 30000, hasApiKey:Boolean(value.encryptedKey) };
}
async function aiRuntime() {
  const value = await readAi();
  const key = value.encryptedKey ? decryptCredential(value.encryptedKey.encryptedPassword,value.encryptedKey.encryptionIv,value.encryptedKey.encryptionAuthTag) : '';
  return { AI_CHAT_ENABLED:value.enabled ? 'true':'false', GEMINI_API_KEY:key, GEMINI_MODEL:value.model, GEMINI_FALLBACK_MODEL:value.fallbackModel, GEMINI_TIMEOUT_MS:value.timeoutMs };
}
async function saveAi(input) {
  const parsed = z.object({ enabled:z.boolean(), model:z.string().trim().max(100).regex(/^[a-zA-Z0-9._-]*$/), fallbackModel:z.string().trim().max(100).regex(/^[a-zA-Z0-9._-]*$/), timeoutMs:z.number().int().min(5000).max(60000), apiKey:z.string().trim().max(500).optional(), clearApiKey:z.boolean().optional(), allowExternalSharing:z.boolean() }).strict().parse(input);
  if (parsed.enabled && !parsed.allowExternalSharing) throw Object.assign(Error('Confirm permission to share selected inventory with Google Gemini'),{status:400});
  const encrypted = parsed.apiKey ? encryptCredential(parsed.apiKey) : null;
  await pool.run(s => {
    const old = s.read('app_settings').find(x => x.key === 'ai')?.value || {};
    const value = { enabled:parsed.enabled, model:parsed.model, fallbackModel:parsed.fallbackModel, timeoutMs:parsed.timeoutMs, encryptedKey:parsed.clearApiKey ? null : encrypted || old.encryptedKey || null };
    if (value.enabled && (!value.encryptedKey || !value.model)) throw Object.assign(Error('Set an API key and model before enabling AI'),{status:400});
    s.insert('app_settings',[{key:'ai',value,updated_at:s.now()}],{key:r=>r.key,change:(_,row)=>row});
  },[],true);
  return publicAi();
}
async function saveCa(input) {
  const { certificate } = z.object({certificate:z.string().max(65536)}).strict().parse(input);
  const filename = path.join(path.dirname(pool.filename),'vmware-ca.pem');
  const config = require('../config/vmware.config');
  if (!certificate.trim()) {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    config.caCertPath = null;
    return { configured:false };
  }
  const certificates = certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certificates?.length || certificate.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,'').trim()) throw Object.assign(Error('Upload a PEM CA certificate, not a private key'),{status:400});
  for (const pem of certificates) { try { new X509Certificate(pem); } catch { throw Object.assign(Error('Invalid CA certificate'),{status:400}); } }
  const temp = filename+'.tmp';
  fs.writeFileSync(temp,certificates.join('\n')+'\n',{mode:0o600});fs.renameSync(temp,filename);config.caCertPath=filename;
  return { configured:true };
}
module.exports = { publicAi, aiRuntime, saveAi, saveCa };
