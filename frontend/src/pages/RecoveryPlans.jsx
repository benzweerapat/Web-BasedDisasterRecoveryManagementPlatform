import Button from '../components/shared/Button';
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Route } from 'lucide-react';
import { RecoveryPlansTable, ErrorState, DataStateBanner, LastCollectedLabel, VmwareSyncButton, ActionButton } from '../components/shared';
import { RecoveryPlanCreateModal, RecoveryPlanDeleteModal } from '../components/shared/RecoveryPlanModals';
import { useRecoveryPlansData } from '../hooks/useDataHooks';
import apiClient from '../api/apiClient';

export default function RecoveryPlans({ user }) {
  const { data: plans, loading, refreshing, error, state, freshness, fetch: fetchPlans } = useRecoveryPlansData();
  const [sitePairs, setSitePairs] = useState([]);
  const [actionsRevision, setActionsRevision] = useState(0);
  const [protectionGroups, setProtectionGroups] = useState([]);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const canWrite = ['ADMIN', 'OPERATOR'].includes(user?.role);
  const hasData = (plans?.observations?.length || 0) > 0;

  const fetchDependencies = useCallback((refresh = false) => {
    apiClient.get('/srm/site-pairs', { refresh })
      .then(res => {
        const pairs = res.data?.data || res.data || [];
        setSitePairs(Array.isArray(pairs) ? pairs : []);
      })
      // A transient refresh failure must not discard known plan identities and
      // unmount their action controls. Execution still revalidates capabilities.
      .catch(() => {});

    apiClient.get('/srm/protection-groups', { refresh })
      .then(res => {
        const pgs = res.data?.data?.observations || res.data?.data || res.data || [];
        setProtectionGroups(Array.isArray(pgs) ? pgs : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDependencies(false);
    const refresh = () => fetchDependencies(true);
    window.addEventListener('inventory-cache-invalidated', refresh);
    return () => window.removeEventListener('inventory-cache-invalidated', refresh);
  }, [fetchDependencies]);

  const handleOperationUpdated = useCallback(() => {
    fetchPlans(true);
    fetchDependencies(true);
    setActionsRevision(value => value + 1);
  }, [fetchPlans, fetchDependencies]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleCreated = () => {
    fetchPlans(true);
    showToast('Recovery plan created.');
  };

  const handleDeleted = () => {
    fetchPlans(true);
    showToast('Recovery plan deleted.');
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl border border-slate-700 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Route size={14} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <h1 className="sr-only">Recovery plans</h1>
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div></div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {canWrite && (
            <ActionButton
              variant="black"
              icon={Plus}
              onClick={() => setCreateModalOpen(true)}
            >
              New recovery plan
            </ActionButton>
          )}

          <div className="hidden">
            <ActionButton
              variant="secondary"
              icon={RefreshCw}
              loading={loading || refreshing}
              onClick={() => { fetchPlans(true); setActionsRevision(value => value + 1); }}
              aria-label="Refresh"
            >
              Refresh
            </ActionButton>
            <VmwareSyncButton type="SRM" user={user} onCompleted={() => fetchPlans(true)} />
          </div>
        </div>
      </div>
      
      {error && !hasData && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <ErrorState message={error} retry={() => fetchPlans(true)} />
        </div>
      )}
        <RecoveryPlansTable
          plans={plans} 
          loading={loading || refreshing}
          actionsRevision={actionsRevision}
          user={user}
          sitePairs={sitePairs}
          protectionGroups={protectionGroups}
          onUpdated={handleOperationUpdated}
          onDelete={(plan) => setDeletingPlan(plan)}
          mode="full"
          emptyMessage="No recovery plans in SRM"
        />

      {/* Create Modal */}
      <RecoveryPlanCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreated}
        sitePairs={sitePairs}
        protectionGroups={protectionGroups}
      />

      {/* Delete Modal */}
      <RecoveryPlanDeleteModal
        sitePairs={sitePairs}
        open={Boolean(deletingPlan)}
        plan={deletingPlan}
        onClose={() => setDeletingPlan(null)}
        onSuccess={handleDeleted}
      />
    </div>
  );
}
