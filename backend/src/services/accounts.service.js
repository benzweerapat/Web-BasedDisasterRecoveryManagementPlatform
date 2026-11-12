'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { z } = require('zod');
const { pool } = require('../../db');
const kdf = promisify(crypto.scrypt);
const passwordSchema = z.string().min(12).max(128);
const usernameSchema = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,63}$/).transform(x => x.toLowerCase());
const roles = z.enum(['VIEWER', 'OPERATOR', 'ADMIN']);
const fail = (message, status = 400) => Object.assign(Error(message), { status, code: 'ACCOUNT_ERROR' });
const safe = user => ({ id: user.id, username: user.username, role: user.role, authVersion: user.auth_version || 1 });
async function hashPassword(password) {
  passwordSchema.parse(password);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await kdf(password, salt, 64);
  return ['scrypt', salt, hash.toString('hex')].join('$');
}
async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128 || typeof stored !== 'string') return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const actual = await kdf(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
async function needsSetup() { return pool.run(s => s.read('users').length === 0, [], false); }
async function setup(input) {
  const parsed = z.object({ username: usernameSchema, password: passwordSchema }).strict().parse(input);
  const passwordHash = await hashPassword(parsed.password);
  return pool.run(s => {
    if (s.read('users').length) throw fail('An administrator already exists', 409);
    return safe(s.insert('users', [{ username: parsed.username, password_hash: passwordHash, role: 'ADMIN', status: 'Active', auth_version: 1 }])[0]);
  }, [], true);
}
async function login(input) {
  const parsed = z.object({ username: usernameSchema, password: z.string().min(1).max(128) }).strict().parse(input);
  const user = await pool.run(s => s.read('users').find(u => u.username === parsed.username), [], false);
  // Pay the same KDF cost for unknown usernames.
  const dummy = ['scrypt', '0'.repeat(32), '0'.repeat(128)].join('$');
  if (!await verifyPassword(parsed.password, user?.password_hash || dummy) || user?.status !== 'Active') throw fail('Invalid username or password', 401);
  await pool.run(s => s.update('users', u => u.id === user.id, () => ({ last_login: s.now() })), [], true);
  return safe(user);
}
async function authenticateSession(session) {
  const saved = session?.user;
  if (!saved) return null;
  const user = await pool.run(s => s.read('users').find(u => u.id === saved.id), [], false);
  if (!user || user.status !== 'Active' || (user.auth_version || 1) !== saved.authVersion) return null;
  return safe(user);
}
async function reauthenticate(actor, password) {
  const user = await pool.run(s => s.read('users').find(u => u.id === actor.id), [], false);
  if (!user || !await verifyPassword(password, user.password_hash)) throw fail('Your current password is incorrect', 403);
}
async function saveUser(actor, id, input) {
  const parsed = z.object({ username: usernameSchema, role: roles, isActive: z.boolean(), password: z.string().max(128).optional(), currentPassword: z.string().max(128) }).strict().parse(input);
  await reauthenticate(actor, parsed.currentPassword);
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : null;
  return pool.run(s => {
    const existing = id ? s.read('users').find(u => u.id === id) : null;
    if (id && !existing) throw fail('User not found', 404);
    if (!existing && !passwordHash) throw fail('A password is required');
    if (s.read('users').some(u => u.id !== id && u.username === parsed.username)) throw fail('Username already exists', 409);
    const activeAdmin = parsed.role === 'ADMIN' && parsed.isActive;
    if (existing?.role === 'ADMIN' && existing.status === 'Active' && !activeAdmin && !s.read('users').some(u => u.id !== id && u.role === 'ADMIN' && u.status === 'Active')) throw fail('Keep at least one active administrator', 409);
    const row = { username: parsed.username, role: parsed.role, status: parsed.isActive ? 'Active' : 'Inactive', auth_version: (existing?.auth_version || 0) + 1 };
    if (passwordHash) row.password_hash = passwordHash;
    if (existing) { s.update('users', u => u.id === id, () => row); return safe({ ...existing, ...row }); }
    return safe(s.insert('users', [row])[0]);
  }, [], true);
}
async function changePassword(actor, input) {
  const parsed = z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }).strict().parse(input);
  await reauthenticate(actor, parsed.currentPassword);
  const passwordHash = await hashPassword(parsed.newPassword);
  return pool.run(s => { s.update('users', u => u.id === actor.id, u => ({ password_hash: passwordHash, auth_version: (u.auth_version || 1) + 1 })); return safe(s.read('users').find(u => u.id === actor.id)); }, [], true);
}
module.exports = { setup, needsSetup, login, authenticateSession, saveUser, changePassword, verifyPassword, hashPassword };
