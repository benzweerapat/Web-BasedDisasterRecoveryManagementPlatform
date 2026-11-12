import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Link2 } from 'lucide-react';
import { useLocation, useNavigate } from '../../router-hooks';

import { ErrorState, ApplianceSummaryWidget, PageActionHeader } from '../../components/shared';

import Replications from '../Replications';

// Data Hooks for real backend synchronization
import { 
  useDrOverviewData, 
} from '../../hooks/useDataHooks';

function PairingsTab() {
  const { data: overview, loading, error } = useDrOverviewData();
  if (loading && !overview) return <div role="status" className="flex items-center justify-center gap-3 p-8 text-slate-600">Loading...</div>;
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;
  return <ApplianceSummaryWidget overview={overview} />;
}

export default function VRDashboard({ user }) {
  const location = useLocation();
  const navigate = useNavigate();

  const getTabFromSearch = (searchStr) => {
    const params = new URLSearchParams(searchStr || (typeof window !== 'undefined' ? window.location.search : ''));
    const tab = params.get('tab');
    if (tab && ['replications', 'pairings'].includes(tab)) return tab;
    return 'replications';
  };

  const [activeTab, setActiveTab] = useState(() => getTabFromSearch(location.search));

  useEffect(() => {
    setActiveTab(getTabFromSearch(location.search));
  }, [location.search]);

  const [dataRevision, setDataRevision] = useState(0);
  const [headerLeftTarget, setHeaderLeftTarget] = useState(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setHeaderLeftTarget(document.getElementById('main-header-portal-left'));
    }
  }, []);

  const handleTabSelect = (id) => {
    setActiveTab(id);
    navigate(id === 'replications' ? '/replications' : `/replications?tab=${id}`);
  };

  const tabs = [
    { id: 'replications', label: 'Replications', Icon: Copy },
    { id: 'pairings', label: 'Site pairings', Icon: Link2 }
  ];

  const tabBar = (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 items-center shrink-0" data-vr-tab-bar="true">
      {tabs.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isActive}
            onClick={() => handleTabSelect(id)}
            className={`whitespace-nowrap px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${
              isActive
                ? 'font-bold bg-white text-slate-950 shadow-xs'
                : 'font-semibold text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon size={14} className={isActive ? 'text-slate-950' : 'text-slate-500'} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Header section & standalone fallback */}
      <h1 className="sr-only">vSphere Replication</h1>
      <div className="sr-only">
        <PageActionHeader
          onRefresh={() => setDataRevision(revision => revision + 1)}
          user={user}
          onSyncCompleted={() => setDataRevision(revision => revision + 1)}
        />
      </div>

      {headerLeftTarget ? (
        createPortal(tabBar, headerLeftTarget)
      ) : (
        <div className="mb-2">
          {tabBar}
        </div>
      )}

      {/* Content Area */}
      <div className="pb-6">
        <div className="h-full">
          <div className={activeTab === 'replications' ? 'block' : 'hidden'}>
            <Replications user={user} embedded headerLeftTarget={headerLeftTarget} />
          </div>
          {activeTab === 'pairings' && <PairingsTab />}
        </div>
      </div>
    </div>
  );
}
