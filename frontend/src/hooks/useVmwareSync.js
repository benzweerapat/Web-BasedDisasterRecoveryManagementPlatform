import { useCallback, useState } from 'react';
import apiClient from '../api/apiClient';
import {runSync} from '../api/sync-schedule';

export const VMWARE_SYNC_ENDPOINTS = Object.freeze({
  VR: '/sync/vr',
  SRM: '/sync/srm'
});

export const canRunVmwareSync = user => ['ADMIN', 'OPERATOR'].includes(String(user?.role || '').toUpperCase());

function safeSyncError(error, endpoint) {
  const apiError = error?.response?.data?.error;
  return {
    type: apiError?.type || 'BACKEND_ERROR',
    code: apiError?.code || 'VMWARE_SYNC_FAILED',
    httpStatus: apiError?.httpStatus || error?.response?.status || 500,
    endpoint: apiError?.endpoint || endpoint,
    requestId: apiError?.requestId || error?.response?.data?.requestId || 'unknown',
    safeMessage: apiError?.safeMessage || 'Unable to synchronize data from VMware'
  };
}

export function useVmwareSync(type, { onCompleted, requestSync } = {}) {
  const normalizedType = String(type || '').toUpperCase();
  const endpoint = VMWARE_SYNC_ENDPOINTS[normalizedType];
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const sync = useCallback(async () => {
    if (!endpoint || syncing) return null;
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const response = await runSync(() => requestSync
        ? requestSync(endpoint)
        : apiClient.post(endpoint, {}));
      const data = response?.data?.data || response?.data;
      setResult(data);
      if (onCompleted) await onCompleted(data);
      return data;
    } catch (requestError) {
      const normalized = safeSyncError(requestError, endpoint);
      setError(normalized);
      return null;
    } finally {
      setSyncing(false);
    }
  }, [endpoint, onCompleted, requestSync, syncing]);

  const reset = useCallback(() => {
    if (!syncing) {
      setResult(null);
      setError(null);
    }
  }, [syncing]);

  return { endpoint, syncing, result, error, sync, reset };
}

export const useSyncVr = options => useVmwareSync('VR', options);
export const useSyncSrm = options => useVmwareSync('SRM', options);
