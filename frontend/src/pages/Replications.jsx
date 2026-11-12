import React, { useEffect, useMemo, useRef } from 'react';
import { ErrorState, DataStateBanner, ActionButton } from '../components/shared';
import VrReplicationsLayout from '../components/shared/VrReplicationsLayout';
import { useReplicationsData } from '../hooks/useDataHooks';
import { Plus, RefreshCw } from "lucide-react";
import VrManagement from '../components/shared/VrManagement';
import VmwareSyncButton from '../components/shared/VmwareSyncButton';
import { useLocation } from '../router-hooks';

export default function Replications({ user, embedded = false }) {
  const location = useLocation();
  const { data: replicationsSummary, loading, error, state, fetch } = useReplicationsData();
  const vrMgmtRef = useRef(null);
  const handledCreateLink = useRef('');
  const createRequest = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    if (params.get('create') !== '1') return null;
    return {
      key: params.toString(),
      pairContext: {
        sourceVcenterId: params.get('vcenterId') || '',
        sourceHost: params.get('vcenterHost') || '',
      },
      preset: {
        vmId: params.get('vmId') || '',
        vmName: params.get('vmName') || '',
        startStep: params.get('step') === 'target' ? 2 : 1,
      },
    };
  }, [location.search]);

  useEffect(() => {
    if (!createRequest || handledCreateLink.current === createRequest.key) return;
    handledCreateLink.current = createRequest.key;
    vrMgmtRef.current?.openCreateWizard?.(createRequest.pairContext, createRequest.preset);
  }, [createRequest]);

  const canonicalReplications = replicationsSummary?.canonicalReplications ?? replicationsSummary?.canonicalRows ?? [];
  const observations          = replicationsSummary?.observations ?? [];
  const hasData = canonicalReplications.length > 0 || observations.length > 0;

  const canWrite = ['ADMIN', 'OPERATOR'].includes(user?.role);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="vr-replications-theme space-y-6 animate-fade-in pb-12">
      {!embedded && (
        <>
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="flex-1">
              <h1 className="font-display text-2xl font-semibold text-slate-800 tracking-tight">vSphere Replication</h1>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {canWrite && (
                <ActionButton
                  variant="primary"
                  icon={Plus}
                  onClick={() => vrMgmtRef.current?.openCreateWizard?.()}
                >
                  New replication
                </ActionButton>
              )}
              <ActionButton
                variant="secondary"
                icon={RefreshCw}
                loading={loading}
                onClick={() => fetch(true)}
                aria-label="Refresh"
              >
                Refresh
              </ActionButton>
              <VmwareSyncButton type="VR" user={user} display="inline" onCompleted={() => fetch(true)} />
            </div>
          </div>
        </>
      )}
      <VrManagement ref={vrMgmtRef} user={user} onUpdated={() => fetch(true)} showLaunchers={false} />

      {error && !hasData && !loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <ErrorState message={error} retry={() => fetch(true)} />
        </div>
      )}
        <VrReplicationsLayout
          replicationsSummary={replicationsSummary}
          loading={loading}
          canWrite={canWrite}
          isAdmin={isAdmin}
          onCreateReplication={(pairContext) => vrMgmtRef.current?.openCreateWizard?.(pairContext)}
          onAction={(action, rep, pairId) => vrMgmtRef.current?.openActionModal?.(action, rep, pairId)}
        />
    </div>
  );
}
