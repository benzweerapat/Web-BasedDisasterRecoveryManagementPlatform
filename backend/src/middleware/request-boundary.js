'use strict';

// This origin/Host boundary protects a local app from browser-origin attacks.
// It is not authentication: a non-browser client can forge both headers.
function createRequestBoundary(env = process.env) {
  const port = Number(env.PORT || 3003);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid PORT');
  const localOrigins = [
    `http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`
  ];
  const origins = new Set(localOrigins);
  if (env.NODE_ENV !== 'production') {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) origins.add(`http://${host}:5175`);
  }
  for (const value of String(env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(value); } catch { throw Error('FRONTEND_ORIGIN must contain exact HTTP(S) origins'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw Error('FRONTEND_ORIGIN must contain exact HTTP(S) origins');
    }
    origins.add(url.origin);
  }
  const hosts = new Set([...origins].map(value => new URL(value).host));
  const allowed = origin => {
    try { return origins.has(origin) && new URL(origin).origin === origin; }
    catch { return false; }
  };
  const guard = (req, res, next) => {
    if (process.env.SRM_BOUND_PORT) {
      for (const name of ['localhost', '127.0.0.1', '[::1]']) { const origin = `http://${name}:${process.env.SRM_BOUND_PORT}`; origins.add(origin); hosts.add(new URL(origin).host); }
    }
    const host = String(req.get('Host') || '').toLowerCase();
    const origin = req.get('Origin');
    if (!hosts.has(host) || (origin && !allowed(origin)) ||
        (!origin && req.get('Sec-Fetch-Site') === 'cross-site')) {
      return res.status(403).json({ success: false, error: {
        code: 'REQUEST_ORIGIN_DENIED', httpStatus: 403,
        safeMessage: 'The request origin or host is not allowed', requestId: req.id
      } });
    }
    next();
  };
  return { guard, corsOrigin: (origin, callback) => callback(null, Boolean(origin && allowed(origin))) };
}

module.exports = { createRequestBoundary };
