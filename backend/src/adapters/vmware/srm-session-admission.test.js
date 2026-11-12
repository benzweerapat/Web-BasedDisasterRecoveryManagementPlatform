const test = require('node:test');
const assert = require('node:assert/strict');
const { SrmAdapter } = require('./srm.adapter');
const { SrmSessionAdmission } = require('./srm-session-admission');

const url = 'https://srm.example.invalid';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// No real clients, requests, credentials or environment files are used.
function setup({ timeoutMs = 200, post, remove } = {}) {
  const adapter = new SrmAdapter({ sessionAdmissionTimeoutMs: timeoutMs });
  let serial = 0;
  const posts = [], deletes = [], live = new Set();
  let maximumLive = 0;
  adapter.createClient = async () => ({
    post: async (...args) => {
      posts.push(args[0]);
      if (post) return post(...args);
      const token = `mock-session-${++serial}`;
      live.add(token);
      maximumLive = Math.max(maximumLive, live.size);
      return { status: 201, headers: { 'x-dr-session': token } };
    },
    delete: async (path, options) => {
      const token = options.headers['x-dr-session'];
      deletes.push(token);
      const response = remove ? await remove(token) : { status: 204 };
      if ([204, 401].includes(response.status)) live.delete(token);
      return response;
    }
  });
  return { adapter, posts, deletes, live, maximumLive: () => maximumLive };
}

const login = adapter => adapter.loginLocal(url, 'mock-user', 'mock-password', true);
const hasCode = code => error => error.code === code && error.message === code;

test('more than two callers wait FIFO and use a freed owned session without overflow', async () => {
  const { adapter, posts, maximumLive } = setup();
  const first = await login(adapter), second = await login(adapter);
  let thirdDone = false, fourthDone = false;
  const third = login(adapter).then(value => { thirdDone = true; return value; });
  const fourth = login(adapter).then(value => { fourthDone = true; return value; });
  await tick();
  assert.equal(posts.length, 2);
  assert.equal(thirdDone, false);
  assert.equal(fourthDone, false);
  await adapter.logoutLocal(url, first);
  const thirdToken = await third;
  assert.equal(posts.length, 3);
  assert.equal(fourthDone, false);
  await adapter.logoutLocal(url, second);
  const fourthToken = await fourth;
  assert.equal(maximumLive(), 2);
  assert.equal(adapter.sessionHost(url).opening, 0);
  await adapter.logoutLocal(url, thirdToken);
  await adapter.logoutLocal(url, fourthToken);
});

test('slot reservation is atomic across delayed client creation', async () => {
  const { adapter, posts } = setup();
  const clientReady = deferred(), original = adapter.createClient;
  adapter.createClient = async (...args) => { await clientReady.promise; return original(...args); };
  const a = login(adapter), b = login(adapter), c = login(adapter);
  await tick();
  assert.equal(adapter.sessionHost(url).opening, 2);
  assert.equal(posts.length, 0);
  clientReady.resolve();
  const [one, two] = await Promise.all([a, b]);
  assert.equal(posts.length, 2);
  await adapter.logoutLocal(url, one);
  const three = await c;
  assert.equal(posts.length, 3);
  await adapter.logoutLocal(url, two);
  await adapter.logoutLocal(url, three);
});

test('admission times out with sanitized busy error and cannot submit later', async () => {
  const { adapter, posts } = setup({ timeoutMs: 15 });
  const one = await login(adapter), two = await login(adapter);
  await assert.rejects(login(adapter), hasCode('SRM_SESSION_BUSY'));
  assert.equal(posts.length, 2);
  assert.equal(adapter.sessionHost(url).admission.pendingCount, 0);
  await adapter.logoutLocal(url, one);
  await tick();
  assert.equal(posts.length, 2);
  await adapter.logoutLocal(url, two);
});

test('definite login failure releases reservation for a queued caller', async () => {
  const response = deferred();
  let call = 0;
  const { adapter, posts } = setup({ post: async () => {
    call++;
    if (call === 1) return response.promise;
    return { status: 201, headers: { 'x-dr-session': `session-${call}` } };
  } });
  const failed = assert.rejects(login(adapter), hasCode('SRM_AUTH_FAILED'));
  const second = await login(adapter);
  const third = login(adapter);
  await tick();
  assert.equal(posts.length, 2);
  response.resolve({ status: 401, headers: {} });
  await failed;
  const thirdToken = await third;
  assert.equal(posts.length, 3);
  assert.equal(adapter.sessionHost(url).opening, 0);
  await adapter.logoutLocal(url, second);
  await adapter.logoutLocal(url, thirdToken);
});

test('cooldown and uncertain outcomes reject without starting another login', async () => {
  const { adapter, posts } = setup();
  const host = adapter.sessionHost(url);
  host.cooldownUntil = Date.now() + 10000;
  await assert.rejects(login(adapter), hasCode('SRM_SESSION_BUSY'));
  host.cooldownUntil = 0;
  host.uncertain = true;
  host.uncertainUntil = Date.now() + 10000;
  await assert.rejects(login(adapter), hasCode('SRM_SESSION_LOGIN_UNCERTAIN'));
  assert.equal(posts.length, 0);
  assert.equal(host.opening, 0);
});

test('a rate-limited opening rejects queued callers instead of retrying login', async () => {
  const limited = deferred();
  let calls = 0;
  const { adapter, posts } = setup({ post: async () => {
    if (++calls === 1) return limited.promise;
    return { status: 201, headers: { 'x-dr-session': 'owned-second' } };
  } });
  const first = assert.rejects(login(adapter), hasCode('SRM_SESSION_BUSY'));
  await login(adapter);
  const waiting = assert.rejects(login(adapter), hasCode('SRM_SESSION_BUSY'));
  limited.resolve({ status: 429, headers: { 'retry-after': '30' } });
  await Promise.all([first, waiting]);
  assert.equal(posts.length, 2);
  assert.equal(adapter.sessionHost(url).opening, 0);
});

test('successful concurrent login cannot clear another uncertain login outcome', async () => {
  const lost = deferred(), success = deferred();
  let calls = 0;
  const { adapter, posts } = setup({ post: () => ++calls === 1 ? lost.promise : success.promise });
  const first = assert.rejects(login(adapter), hasCode('SRM_SESSION_LOGIN_UNCERTAIN'));
  const second = login(adapter);
  await tick();
  lost.reject(Object.assign(new Error('mock lost response'), { code: 'ECONNRESET' }));
  await first;
  success.resolve({ status: 201, headers: { 'x-dr-session': 'known-second' } });
  await second;
  assert.equal(adapter.sessionHost(url).uncertain, true);
  await assert.rejects(login(adapter), hasCode('SRM_SESSION_LOGIN_UNCERTAIN'));
  assert.equal(posts.length, 2);
});

test('owned failed logout must reconcile; failure never releases its lease', async () => {
  const { adapter, posts, deletes } = setup({ remove: async () => ({ status: 503 }) });
  const host = adapter.sessionHost(url);
  host.sessions.set('owned-failed', { failed: true, verifyTls: true, closing: null, remotePairs: new Set() });
  host.sessions.set('owned-healthy', { failed: false, verifyTls: true, closing: null, remotePairs: new Set() });
  await assert.rejects(login(adapter), hasCode('SRM_SESSION_CLEANUP_FAILED'));
  assert.equal(posts.length, 0);
  assert.deepEqual(deletes, ['owned-failed', 'owned-failed']);
  assert.equal(host.sessions.size, 2);
  assert.equal(host.opening, 0);
});

test('successful failed-logout reconciliation frees only the owned failed session', async () => {
  const { adapter, deletes } = setup();
  const host = adapter.sessionHost(url);
  host.sessions.set('owned-failed', { failed: true, verifyTls: true, closing: null, remotePairs: new Set() });
  host.sessions.set('owned-healthy', { failed: false, verifyTls: true, closing: null, remotePairs: new Set() });
  await login(adapter);
  assert.deepEqual(deletes, ['owned-failed']);
  assert.equal(host.sessions.has('owned-healthy'), true);
  assert.equal(host.sessions.size, 2);
});

test('clearSessionHost cannot forget owned leases, pending requests or safety guards', async () => {
  const { adapter } = setup();
  const one = await login(adapter), two = await login(adapter);
  const third = login(adapter);
  await tick();
  assert.throws(() => adapter.clearSessionHost(url), hasCode('SRM_SESSION_BUSY'));
  assert.throws(() => adapter.clearSessionHost(), hasCode('SRM_SESSION_BUSY'));
  await adapter.logoutLocal(url, one);
  const three = await third;
  await adapter.logoutLocal(url, two);
  await adapter.logoutLocal(url, three);
  const host = adapter.sessionHost(url);
  host.cooldownUntil = Date.now() + 10000;
  assert.throws(() => adapter.clearSessionHost(url), hasCode('SRM_SESSION_BUSY'));
  host.cooldownUntil = 0;
  host.uncertain = true;
  host.uncertainUntil = Date.now() + 10000;
  assert.throws(() => adapter.clearSessionHost(url), hasCode('SRM_SESSION_BUSY'));
  host.uncertainUntil = 0;
  adapter.clearSessionHost(url);
  assert.notEqual(adapter.sessionHost(url), host);
});

test('admission deadline during cleanup never submits a late login', async () => {
  const cleanup = deferred();
  const { adapter, posts } = setup({ timeoutMs: 15, remove: () => cleanup.promise });
  const host = adapter.sessionHost(url);
  host.sessions.set('owned-failed', { failed: true, verifyTls: true, closing: null, remotePairs: new Set() });
  await assert.rejects(login(adapter), hasCode('SRM_SESSION_BUSY'));
  assert.equal(posts.length, 0);
  cleanup.resolve({ status: 204 });
  await tick();
  assert.equal(posts.length, 0);
  assert.equal(host.opening, 0);
});

test('client preparation failure releases its reserved slot without logging in', async () => {
  const { adapter, posts } = setup();
  const createClient = adapter.createClient;
  adapter.createClient = async () => { throw Object.assign(new Error('mock blocked target'), { code: 'SRM_TARGET_NOT_ALLOWED' }); };
  await assert.rejects(login(adapter), error => error.code === 'SRM_TARGET_NOT_ALLOWED');
  assert.equal(adapter.sessionHost(url).opening, 0);
  adapter.createClient = createClient;
  const token = await login(adapter);
  assert.equal(posts.length, 1);
  await adapter.logoutLocal(url, token);
});

test('admission bounds queued callers as well as wait time', async () => {
  const queue = new SrmSessionAdmission({ maxPending: 1 });
  const options = { prepare: async () => {}, reserve: () => null, timeoutMs: 15,
    busyError: () => Object.assign(new Error('SRM_SESSION_BUSY'), { code: 'SRM_SESSION_BUSY' }) };
  const first = assert.rejects(queue.acquire(options), hasCode('SRM_SESSION_BUSY'));
  await assert.rejects(queue.acquire(options), hasCode('SRM_SESSION_BUSY'));
  assert.equal(queue.pendingCount, 1);
  await first;
  assert.equal(queue.pendingCount, 0);
});
