import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocation } from '../router-hooks';
import { InventoryMappingsPanel, ErrorState, VmwareSyncButton, ActionButton } from '../components/shared';
import { useInventoryMappingsData, usePlaceholderDatastoresData } from '../hooks/useDataHooks';

export default function Mappings({ user }) {
  const location = useLocation();
  const { data: srmMappings, loading: loadingMaps, refreshing: refreshingMaps, error: errorMaps, fetch: fetchMappings } = useInventoryMappingsData();
  const { data: phdsData, loading: loadingPhds, refreshing: refreshingPhds, error: errorPhds, fetch: fetchPlaceholderDatastores } = usePlaceholderDatastoresData();

  const loading = loadingMaps || loadingPhds;
  const error = errorMaps || errorPhds;
  const hasData = (srmMappings?.observations?.length || 0) > 0 || (phdsData?.data?.length || 0) > 0;

  const getDirFromSearch = (searchStr) => {
    const params = new URLSearchParams(searchStr || (typeof window !== 'undefined' ? window.location.search : ''));
    const dir = params.get('direction');
    if (dir && ['forward', 'fallback'].includes(dir.toLowerCase())) return dir.toLowerCase();
    return 'forward';
  };

  const [direction, setDirection] = useState(() => getDirFromSearch(location.search));

  useEffect(() => {
    setDirection(getDirFromSearch(location.search));
  }, [location.search]);

  const mappingsState = {
    ...srmMappings,
    PLACEHOLDER_DATASTORE: phdsData || { data: [], status: 'SYNCED' }
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto animate-fade-in pb-12">
      <h1 className="sr-only">Inventory mappings</h1>

      <div className="hidden">
        <ActionButton
          variant="secondary"
          icon={RefreshCw}
          loading={loading || refreshingMaps || refreshingPhds}
          onClick={() => Promise.all([fetchMappings(true), fetchPlaceholderDatastores(true)])}
          aria-label="Refresh"
        >
          Refresh
        </ActionButton>
        <VmwareSyncButton type="SRM" user={user} onCompleted={() => Promise.all([fetchMappings(true), fetchPlaceholderDatastores(true)])} />
      </div>
      
      {error && !hasData && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <ErrorState message={error} retry={()=>{fetchMappings(true);fetchPlaceholderDatastores(true);}} />
        </div>
      )}
        <InventoryMappingsPanel
          mappingsState={mappingsState} 
          // Keep the current rows visible during background collection. The
          // refresh flag is only for controls; treating it as initial loading
          // made the table blink every time auto-sync completed.
          loadingMappings={loadingMaps}
          loadingPlaceholders={loadingPhds}
          mode="full"
          direction={direction}
          user={user}
          onRefresh={() => Promise.all([fetchMappings(true), fetchPlaceholderDatastores(true)])}
        />
    </div>
  );
}
