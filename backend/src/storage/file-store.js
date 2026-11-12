'use strict';

const fs = require('node:fs'),
  path = require('node:path');
const helpers = require('./records'),
  fields = require('./fields.json'),
  views = require('./views');
const clone = x => structuredClone(x);
class FileStore {
  constructor(filename) {
    this.filename = filename;
    this.helpers = helpers;
    this.tail = Promise.resolve();
    this.locks = new Map();
    this.writing = 0;
    this.viewCache = new Map();
    this.viewCacheData = null;
    this.data = {
      collections: {},
      sequences: {}
    };
    if (filename && fs.existsSync(filename)) {
      this.data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!this.data.collections || !this.data.sequences) throw Error('Invalid application state file');
    }
  }
  now() {
    return new Date().toISOString();
  }
  hasCollection(name) {
    name = String(name).split('.').pop();
    return !!fields[name] || !!views[name];
  }
  read(name) {
    if (name === 'tables') return Object.keys(fields).map(table_name => ({
      table_schema: 'public',
      table_name
    }));
    if (views[name]) return this.readView(name);
    if (!fields[name] && !Object.hasOwn(this.data.collections, name)) throw Error('Unknown application collection ' + name);
    return this.data.collections[name] || [];
  }
  // A view depends only on committed data, so its rows are reused until the next write.
  readView(name) {
    const store = this.viewStore();
    if (!store || store.writing || this.data !== store.data) return views[name](this, []).rows;
    if (store.viewCacheData !== store.data) {
      store.viewCache.clear();
      store.viewCacheData = store.data;
    }
    if (!store.viewCache.has(name)) store.viewCache.set(name, views[name](this, []).rows);
    return store.viewCache.get(name);
  }
  viewStore() {
    return this;
  }
  clearViewCache() {
    this.viewCache.clear();
    this.viewCacheData = null;
  }
  normalize(name, row) {
    for (const [k, v] of Object.entries(row)) {
      const type = fields[name]?.[k]?.type;
      if (v === undefined) row[k] = null;else if (typeof v === 'string' && ['json', 'jsonb'].includes(type)) {
        try {
          row[k] = JSON.parse(v);
        } catch {
          throw Error('Invalid JSON field ' + k);
        }
      } else if (v !== null && ['timestamp', 'timestamptz'].includes(type)) row[k] = new Date(v).toISOString();else if (v !== null && ['integer', 'int', 'serial', 'bigint', 'real', 'numeric'].includes(type)) row[k] = Number(v);
    }
    return row;
  }
  defaults(name) {
    const out = {};
    for (const [k, v] of Object.entries(fields[name] || {})) out[k] = v.default?.$now ? this.now() : clone(v.default);
    if (fields[name]?.id?.type === 'serial') out.id = this.data.sequences[name] = (this.data.sequences[name] || 0) + 1;
    return out;
  }
  checkUnique(name, row, old) {
    const rows = this.data.collections[name] || [];
    const collision = pred => rows.some(r => r !== old && pred(r));
    const err = () => {
      throw Object.assign(new Error('Record already exists or operation is in progress'), {
        code: '23505'
      });
    };
    if (name === 'users' && collision(r => r.username === row.username)) err();
    if (name === 'tasks') {
      if (row.task_id && collision(r => r.task_id === row.task_id)) err();
      if (row.operation_provider === 'SRM') {
        const terminal = new Set(['SUCCESS', 'FAILED', 'ROLLBACK_SUCCESS']);
        if (row.idempotency_key && collision(r => r.operation_provider === 'SRM' && r.username === row.username && r.idempotency_key === row.idempotency_key)) err();
        if (row.srm_scope_key && !terminal.has(row.status) && collision(r => r.operation_provider === 'SRM' && r.srm_scope_key === row.srm_scope_key && !terminal.has(r.status))) err();
      } else if (row.operation_type && ['SUBMITTING', 'SUBMITTED', 'RUNNING', 'REFRESH_PENDING', 'UNKNOWN'].includes(row.status) && collision(r => row.vm_id != null && r.operation_type && r.vm_id === row.vm_id && ['SUBMITTING', 'SUBMITTED', 'RUNNING', 'REFRESH_PENDING', 'UNKNOWN'].includes(r.status))) err();
    }
  }
  insert(name, incoming, conflict = null) {
    if (!fields[name]) throw Error('Unknown application collection ' + name);
    this.viewStore()?.clearViewCache();
    const rows = this.data.collections[name] ||= [];
    return incoming.flatMap(value => {
      const input = this.normalize(name, clone(value));
      const old = conflict ? rows.find(r => JSON.stringify(conflict.key(r)) === JSON.stringify(conflict.key(input))) : null;
      if (old) {
        if (!conflict.change) return [];
        const updated = this.normalize(name, {
          ...old,
          ...conflict.change(old, input)
        });
        this.checkUnique(name, updated, old);
        Object.assign(old, updated);
        return [clone(old)];
      }
      const row = this.normalize(name, {
        ...this.defaults(name),
        ...input
      });
      this.checkUnique(name, row);
      rows.push(row);
      return [clone(row)];
    });
  }
  update(name, predicate, change) {
    this.viewStore()?.clearViewCache();
    const out = [];
    for (const row of this.data.collections[name] || []) {
      if (!predicate(row)) continue;
      const next = this.normalize(name, {
        ...row,
        ...change(row)
      });
      if (name === 'connections' && (next.base_url !== row.base_url || next.system_type !== row.system_type || next.associated_vcenter_connection_id !== row.associated_vcenter_connection_id || next.is_active && !row.is_active)) {
        next.scope_invalidated_at = this.now();
        next.last_sync_at = null;
        next.last_sync_status = 'NEVER_SYNCED';
      }
      this.checkUnique(name, next, row);
      Object.assign(row, next);
      out.push(clone(row));
    }
    return out;
  }
  remove(name, predicate) {
    this.viewStore()?.clearViewCache();
    const rows = this.data.collections[name] || [];
    const removed = rows.filter(predicate);
    this.data.collections[name] = rows.filter(r => !removed.includes(r));
    if (name === 'connections') {
      for (const r of removed) {
        for (const row of this.data.collections.connections || []) {
          if (row.associated_vcenter_connection_id === r.id) row.associated_vcenter_connection_id = null;
          if (row.credential_source_connection_id === r.id) row.credential_source_connection_id = null;
        }
      }
    }
    return clone(removed);
  }
  persist() {
    if (!this.filename) return;
    fs.mkdirSync(path.dirname(this.filename), {
      recursive: true,
      mode: 0o700
    });
    const tmp = this.filename + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(this.data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.filename);
  }
  async acquire() {
    let release;
    const old = this.tail;
    this.tail = new Promise(r => release = r);
    await old;
    return release;
  }
  async run(fn, params = [], write = false) {
    if (typeof fn !== 'function') throw Error('Only native record callbacks are supported');
    if (!write) return clone(fn(this, params));
    const release = await this.acquire();
    const before = clone(this.data);
    this.writing++;
    try {
      const result = fn(this, params);
      this.persist();
      return clone(result);
    } catch (e) {
      this.data = before;
      throw e;
    } finally {
      this.writing--;
      this.clearViewCache();
      release();
    }
  }
  async connect() {
    return new FileSession(this);
  }
  async end() {}
  async begin() {
    throw Error('Use a file session for grouped updates');
  }
  async commit() {}
  async rollback() {}
  lock() {
    return true;
  }
  tryLock(key) {
    if (this.locks.has(key)) return false;
    this.locks.set(key, this);
    return true;
  }
  unlock(key) {
    return this.locks.delete(key);
  }
}
class FileSession extends FileStore {
  constructor(parent) {
    super(null);
    this.parent = parent;
    this.data = parent.data;
    this.locks = parent.locks;
    this.active = false;
  }
  // An open transaction reads its own uncommitted copy, which must never fill the shared cache.
  viewStore() {
    return this.active ? null : this.parent;
  }
  async begin() {
    if (this.active) throw Error('Session already active');
    this.releaseWrite = await this.parent.acquire();
    this.data = clone(this.parent.data);
    this.active = true;
  }
  async run(fn, p = [], write = false) {
    if (this.active) return clone(fn(this, p));
    this.data = this.parent.data;
    return this.parent.run(s => {
      this.data = s.data;
      return fn(this, p);
    }, [], write);
  }
  async commit() {
    if (!this.active) return;
    const before = this.parent.data;
    try {
      this.parent.data = this.data;
      this.parent.persist();
    } catch (e) {
      this.parent.data = before;
      throw e;
    } finally {
      this.active = false;
      this.parent.clearViewCache();
      this.releaseWrite();
    }
  }
  async rollback() {
    if (this.active) {
      this.active = false;
      this.data = this.parent.data;
      this.releaseWrite();
    }
  }
  release() {
    if (this.active) {
      this.active = false;
      this.data = this.parent.data;
      this.releaseWrite();
    }
    for (const [k, v] of this.locks) if (v === this) this.locks.delete(k);
  }
  tryLock(key) {
    if (this.locks.has(key)) return false;
    this.locks.set(key, this);
    return true;
  }
  unlock(key) {
    return this.locks.get(key) === this && this.locks.delete(key);
  }
}
module.exports = {
  FileStore
};
