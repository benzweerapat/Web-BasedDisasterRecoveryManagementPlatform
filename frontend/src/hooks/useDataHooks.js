import { classifyApiError } from '../utils/apiErrors';
import { useState, useCallback, useEffect, useRef } from 'react';
import apiClient from '../api/apiClient';
import { 
  parseReplicationPayload,
  parseVrServersPayload,
  parseProtectionGroupPayload,
  parseRecoveryPlanPayload,
  parseInventoryMappingPayload,
  parseDrOverviewPayload,
  parsePlaceholderDatastorePayload,
  unwrapApiEnvelope
} from '../utils/adapters';

export function useDataFetch(endpoint, adapter, initialData = null) {
  const cached = () => apiClient.peek?.(endpoint);
  const initialCacheRef = useRef(cached());
  const [data, setData] = useState(() => initialCacheRef.current ? adapter(initialCacheRef.current.data) : initialData);
  const [loading, setLoading] = useState(() => !initialCacheRef.current);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [state, setState] = useState(() => initialCacheRef.current ? 'SUCCESS' : 'LOADING');
  const [freshness, setFreshness] = useState(null);
  const dataRef = useRef(data);
  const initialDataRef = useRef(initialData);
  const requestSequenceRef = useRef(0);
  
  const fetch = useCallback(async (isRefresh = true) => {
    const requestSequence = ++requestSequenceRef.current;
    if (isRefresh) setRefreshing(true);
    else if (!cached()) { setLoading(true); setState('LOADING'); }
    setError(null);
    try {
      // apiClient.get(endpoint) remains the read-only path; refresh explicitly
      // bypasses the in-memory cache when the user asks for new data.
      const response = await apiClient.get(endpoint, {refresh: isRefresh === true});
      let mapped;
      
      try {
        mapped = adapter(response.data);
      } catch (parseError) {
        throw {
          isContractError: true,
          httpStatus: response.status,
          endpoint,
          cause: parseError
        };
      }
      if (requestSequence !== requestSequenceRef.current) return mapped;
      
      dataRef.current = mapped;
      setData(mapped);
      const responseFreshness = mapped?.freshness || response.data?.freshness || response.data?.data?.freshness || null;
      setFreshness(responseFreshness);
      
      if (mapped?.contractError) {
        setState('CONTRACT_ERROR');
        setError({
          type: 'CONTRACT_ERROR',
          code: 'CONTRACT_ERROR',
          httpStatus: 200,
          endpoint,
          safeMessage: 'The response format is not supported by this interface'
        });
      } else {
        const isEmpty = Array.isArray(mapped) ? mapped.length === 0 : (mapped?.observations?.length === 0 && (!mapped?.data || mapped?.data?.length === 0));
        const responseState = mapped?.dataState || response.data?.state;
        setState(responseState || (isEmpty ? 'SUCCESS_EMPTY' : 'SUCCESS'));
      }
      return mapped;
    } catch (err) {
      if (requestSequence !== requestSequenceRef.current) return null;
      if (err.isContractError) {
        const errObj = {
          type: 'CONTRACT_ERROR',
          code: 'CONTRACT_ERROR',
          httpStatus: err.httpStatus,
          endpoint: err.endpoint,
          safeMessage: 'The response format is not supported by this interface'
        };
        setError(errObj);
        setState('CONTRACT_ERROR');
        return null;
      }

      const httpStatus = err.response?.status;
      const errObj = classifyApiError(err, endpoint);
      setError(errObj);
      
      if (dataRef.current && dataRef.current !== initialDataRef.current) {
        setState('STALE_WITH_DATA');
      } else {
        setState(httpStatus === 401 ? 'AUTH_REQUIRED' : (httpStatus === 403 ? 'FORBIDDEN' : 'FAILED'));
      }
      return null;
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [endpoint, adapter]);
  
  useEffect(() => {
    // Navigation remounts use the in-memory snapshot immediately. Only the
    // first visit or an explicit refresh contacts VMware again.
    if (!initialCacheRef.current) fetch(false);
    else if (initialCacheRef.current.stale) fetch(true);
    const refresh = () => fetch(true);
    window.addEventListener('inventory-cache-invalidated', refresh);
    return () => window.removeEventListener('inventory-cache-invalidated', refresh);
  }, [fetch]);
  
  return { 
    data, 
    loading, 
    refreshing, 
    error, 
    state,
    freshness,
    fetch,
    observations: data?.observations || [],
    canonicalRows: data?.canonicalGroups || data?.canonicalPlans || data?.canonicalReplications || [],
    unmappedObservations: data?.unmappedObservations || [],
    metrics: data?.metrics || {}
  };
}

export function useReplicationsData() {
  return useDataFetch('/vr/replications', parseReplicationPayload, { observations: [], canonicalReplications: [], unmappedObservations: [], sitePairViews: [], metrics: {}, state: 'LOADING' });
}

export function useReplicationServersData() {
  return useDataFetch('/vr/servers', parseVrServersPayload, { observations: [] });
}

export function useProtectionGroupsData() {
  return useDataFetch('/srm/protection-groups', parseProtectionGroupPayload, { observations: [], canonicalGroups: [], unmappedObservations: [], metrics: {}, state: 'LOADING' });
}

export function useRecoveryPlansData() {
  return useDataFetch('/srm/recovery-plans', parseRecoveryPlanPayload, { observations: [], canonicalPlans: [], unmappedObservations: [], metrics: {}, state: 'LOADING' });
}

const inventoryMappingsAdapter = (payload) => {
  const parsed = parseInventoryMappingPayload(payload);
  const scopeState = (scope) => ({
    ...(parsed.scopeStates?.[scope] || {}),
    data: [],
    status: parsed.scopeStates?.[scope]?.status || 'NEVER_SYNCED'
  });
  const resourceScope = scopeState('RESOURCE');
  const mappingsState = {
    NETWORK: scopeState('NETWORK'),
    TEST_NETWORK: scopeState('TEST_NETWORK'),
    FOLDER: scopeState('FOLDER'),
    RESOURCE: resourceScope,
    COMPUTE_RESOURCE: resourceScope,
    STORAGE_POLICY: scopeState('STORAGE_POLICY'),
    observations: parsed.observations || [],
    metrics: parsed.metrics || {},
    scopeStates: parsed.scopeStates || {},
    state: parsed.state,
    dataState: parsed.dataState,
    freshness: parsed.freshness,
    contractError: parsed.contractError
  };
  (parsed.observations || []).forEach(mapped => {
    if (mappingsState[mapped.mappingType]) {
      mappingsState[mapped.mappingType].data.push(mapped);
    }
  });
  return mappingsState;
};

export function useInventoryMappingsData() {
  const initialResource = { data: [], status: 'NEVER_SYNCED' };
  return useDataFetch('/srm/mappings', inventoryMappingsAdapter, {
      NETWORK: { data: [], status: 'NEVER_SYNCED' },
      TEST_NETWORK: { data: [], status: 'NEVER_SYNCED' },
      FOLDER: { data: [], status: 'NEVER_SYNCED' },
      RESOURCE: initialResource,
      COMPUTE_RESOURCE: initialResource,
      STORAGE_POLICY: { data: [], status: 'NEVER_SYNCED' },
      observations: [], metrics: {}, scopeStates: {}
  });
}

const placeholderDatastoresAdapter = (payload) => {
  const parsed = parsePlaceholderDatastorePayload(payload);
  const scopeState = parsed.scopeState || {};
  return {
    data: parsed.observations || [],
    ...scopeState,
    status: parsed.contractError ? 'CONTRACT_ERROR' : (scopeState.normalizedStatus || scopeState.status || 'NEVER_SYNCED'),
    normalizedStatus: parsed.contractError ? 'CONTRACT_ERROR' : (scopeState.normalizedStatus || scopeState.status || 'NEVER_SYNCED'),
    dataState: parsed.dataState || payload?.state || null,
    freshness: parsed.freshness || payload?.freshness || null,
    contractError: parsed.contractError
  };
};

export function usePlaceholderDatastoresData() {
  return useDataFetch('/srm/placeholder-datastores', placeholderDatastoresAdapter, { data: [], status: 'SYNCED' });
}

const drOverviewAdapter = (payload) => {
  return parseDrOverviewPayload(payload);
};
export function useDrOverviewData() {
  return useDataFetch('/dr/overview', drOverviewAdapter, null);
}
