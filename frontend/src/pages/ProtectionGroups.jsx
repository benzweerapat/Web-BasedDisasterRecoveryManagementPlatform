import Button from '../components/shared/Button';
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Shield } from 'lucide-react';
import { ProtectionGroupsTable, ErrorState, DataStateBanner, VmwareSyncButton, ActionButton } from '../components/shared';
import ProtectionGroupWizard from '../components/shared/ProtectionGroupWizard';
import { ProtectionGroupDeleteModal } from '../components/shared/ProtectionGroupModals';
import { useProtectionGroupsData } from '../hooks/useDataHooks';
import apiClient from '../api/apiClient';
import {directionalObjectForPair} from '../api/srmOperations';

export default function ProtectionGroups({ user }) {
  const { data: groups, loading, refreshing, error, state, fetch: fetchGroups } = useProtectionGroupsData();
  const [selectedCollectorId, setSelectedCollectorId] = useState(null);
  const [sitePairs, setSitePairs] = useState([]);
  const [recoveryPlans, setRecoveryPlans] = useState([]);
  
  // Modals state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const canWrite = ['ADMIN', 'OPERATOR'].includes(user?.role);

  // Fetch site pairs and recovery plans for wizard/modals
  useEffect(() => {
    apiClient.get('/srm/site-pairs')
      .then(res => {
        const pairs = res.data?.data || res.data || [];
        setSitePairs(Array.isArray(pairs) ? pairs : []);
      })
      .catch(() => setSitePairs([]));

    apiClient.get('/srm/recovery-plans')
      .then(res => {
        const plans = res.data?.data?.observations || res.data?.data || res.data || [];
        setRecoveryPlans(Array.isArray(plans) ? plans : []);
      })
      .catch(() => setRecoveryPlans([]));
  }, []);

  const hasData = ((groups?.canonicalGroups?.length || 0) + (groups?.observations?.length || 0)) > 0;
  
  const visibleGroups = useMemo(() => {
    if (groups?.canonicalGroups?.length) return groups.canonicalGroups;
    return groups?.observations || [];
  }, [groups]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleCreated = () => {
    fetchGroups(true);
    showToast('Protection group created.');
  };

  const handleDeleted = () => {
    fetchGroups(true);
    showToast('Protection group deleted.');
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl border border-slate-700 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Shield size={14} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <h1 className="sr-only">Protection groups</h1>
      <div className="flex flex-wrap items-center justify-end gap-2.5">
          {canWrite && (
            <ActionButton
              variant="black"
              icon={Plus}
              onClick={() => setWizardOpen(true)}
            >
              New protection group
            </ActionButton>
          )}

          <div className="hidden">
            <ActionButton
              variant="secondary"
              icon={RefreshCw}
              loading={loading || refreshing}
              onClick={() => fetchGroups(true)}
              aria-label="Refresh"
            >
              Refresh
            </ActionButton>

            <VmwareSyncButton type="SRM" user={user} onCompleted={() => fetchGroups(true)} />
          </div>
      </div>
      
      {error && !hasData && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <ErrorState message={error} retry={() => fetchGroups(true)} />
        </div>
      )}
        <ProtectionGroupsTable
          groups={visibleGroups}
          loading={loading || refreshing}
          sitePairs={sitePairs}
          recoveryPlans={recoveryPlans}
          user={user}
          onDelete={(g) => setDeletingGroup(directionalObjectForPair(sitePairs,g))}
          onRefresh={() => fetchGroups(true)}
          emptyMessage={hasData ? "No protection groups found." : "No protection groups in SRM"}
        />

      {/* New PG Wizard */}
      <ProtectionGroupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={handleCreated}
        sitePairs={sitePairs}
        recoveryPlans={recoveryPlans}
      />

      {/* Delete PG Modal */}
      <ProtectionGroupDeleteModal
        open={Boolean(deletingGroup)}
        group={deletingGroup}
        onClose={() => setDeletingGroup(null)}
        onSuccess={handleDeleted}
        sitePairs={sitePairs}
      />
    </div>
  );
}
