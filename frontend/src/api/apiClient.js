import { createReadCache } from './read-cache';
import axios from 'axios';

// The Vite environment variable VITE_API_BASE_URL (e.g. '/api' for prod)
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';
const clientBuildId = import.meta.env.VITE_APP_BUILD_ID || null;
let buildReloadRequested = false;

export function isAppBuildMismatch(serverBuildId, currentClientBuildId = clientBuildId) {
  return Boolean(
    serverBuildId &&
    currentClientBuildId &&
    serverBuildId !== currentClientBuildId
  );
}

function reloadForNewBuild(serverBuildId) {
  if (buildReloadRequested || !isAppBuildMismatch(serverBuildId)) return;

  const reloadKey = `srm-app-build-reload:${serverBuildId}`;
  if (window.sessionStorage?.getItem(reloadKey)) return;

  buildReloadRequested = true;
  window.sessionStorage?.setItem(reloadKey, '1');
  window.location.reload();
}

const apiClient = axios.create({
  baseURL,
  withCredentials: true, // Extremely important for sending/receiving HttpOnly session cookies
  headers: {
    "Content-Type": "application/json"
  }
});


const readCache = createReadCache();
const readPaths = new Set(['/vms','/vcenters','/hosts','/datastores','/connections','/dr/overview','/srm/site-pairs','/srm/protection-groups','/srm/recovery-plans','/srm/mappings','/srm/inventory-mappings','/srm/placeholder-datastores','/vr/replications','/vr/servers','/vr/overview','/vr/pairings']);
const readPath = url => String(url || '').split('?')[0];
const cacheableReadPatterns = [
 /^\/vr\/management\/pairings(?:\/[^/]+\/(?:vms|replications|configuration|current-configuration))?$/,
 /^\/srm\/pairings\/[^/]+\/(?:options|replicated-vms)$/
];
const isCacheableRead = url => {
 const path=readPath(url);
 return readPaths.has(path)||cacheableReadPatterns.some(pattern=>pattern.test(path));
};
const originalGet = apiClient.get.bind(apiClient);
const cacheKey = (url,config={}) => apiClient.getUri({url,params:config.params});
apiClient.peek = (url,config={}) => readCache.peek(cacheKey(url,config));
apiClient.get = (url,config={}) => {
 if(!isCacheableRead(url))return originalGet(url,config);
 return readCache.read(cacheKey(url,config),async()=>{
  const r=await originalGet(url,config);return {data:r.data,status:r.status,headers:{...r.headers}};
 },config.refresh===true);
};
export function invalidateReadCache(){readCache.invalidate();window.dispatchEvent(new Event('inventory-cache-invalidated'));}

// Store CSRF token in memory
let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = typeof token === "string" ? token : null;
}

export function getCsrfToken() {
  return csrfToken;
}

export function clearCsrfToken() {
  csrfToken = null;
  readCache.clear();
}

// Add CSRF token to every request
apiClient.interceptors.request.use(async (config) => {
  const method = config.method?.toLowerCase();

  const unsafeMethods = new Set([
    "post",
    "put",
    "patch",
    "delete"
  ]);

  if (unsafeMethods.has(method)) {
    if (!csrfToken) {
      try {
        const res = await axios.get((config.baseURL || '/api') + '/security/csrf-token', { withCredentials: true });
        if (res.data?.csrfToken) {
          csrfToken = res.data.csrfToken;
        }
      } catch {}
    }
    if (csrfToken) {
      config.headers = config.headers || {};
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }

  return config;
});

// Handle global 401 Unauthorized and CSRF errors
apiClient.interceptors.response.use(
  (response) => {
    reloadForNewBuild(response.headers?.['x-app-build']);
    if (response.headers?.['x-csrf-token']) {
      setCsrfToken(response.headers['x-csrf-token']);
    }
    if (['post','put','patch','delete'].includes(response.config?.method?.toLowerCase())) {
      // Durable VMware writes return an operationId before the read model has
      // changed. Refreshing here shows the old data and causes another refresh
      // when the background operation actually completes.
      const acceptedOperation = response.status === 202 && response.data?.data?.operationId;
      if (!acceptedOperation) invalidateReadCache();
    }
    return response;
  },
  async (error) => {
    reloadForNewBuild(error.response?.headers?.['x-app-build']);
    const isCsrf = error.response?.status === 403 && (
      error.response?.data?.type === 'CSRF_ERROR' ||
      error.response?.data?.code === 'CSRF_ERROR' ||
      error.response?.data?.error?.code === 'CSRF_ERROR'
    );
    if (isCsrf && !error.config?._csrfRetry) {
      error.config._csrfRetry = true;
      try {
        const res = await axios.get((error.config.baseURL || '/api') + '/security/csrf-token', { withCredentials: true });
        if (res.data?.csrfToken) {
          setCsrfToken(res.data.csrfToken);
          error.config.headers = error.config.headers || {};
          error.config.headers["X-CSRF-Token"] = res.data.csrfToken;
          return apiClient(error.config);
        }
      } catch {}
    }
    if (error.response?.status === 401) {
      clearCsrfToken();
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export default apiClient;