import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import ActionButton from './ActionButton';
import SyncScheduleControl from './SyncScheduleControl';
import SyncAllVmwarePanel from './SyncAllVmwarePanel';
import VmwareSyncButton from './VmwareSyncButton';

export default function PageActionHeader({
  onRefresh,
  refreshing = false,
  refreshLabel = 'Refresh',
  refreshAriaLabel,
  refreshTitle,
  user,
  onSyncCompleted,
  syncType = 'all', // 'all' | 'srm' | 'vr' | 'none'
  extraActions,
  hideSchedule = false,
  className = ''
}) {
  const [inMainLayout, setInMainLayout] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setInMainLayout(Boolean(document.getElementById('main-header-actions')));
    }
  }, []);

  // When inside MainLayout, action buttons are already in MainLayout.jsx header
  if (inMainLayout) {
    if (!extraActions) return null;
    return <div className={`flex items-center gap-2 ${className}`}>{extraActions}</div>;
  }

  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 shrink-0 ${className}`} data-page-header-actions>
      {extraActions}

      {onRefresh && (
        <ActionButton
          variant="secondary"
          icon={RefreshCw}
          loading={refreshing}
          onClick={onRefresh}
          aria-label={refreshAriaLabel || (refreshLabel !== 'Refresh' ? refreshLabel : undefined)}
          title={refreshTitle || refreshLabel}
        >
          {refreshLabel}
        </ActionButton>
      )}

      {syncType === 'all' && (
        <SyncAllVmwarePanel
          user={user}
          onCompleted={onSyncCompleted}
          compact
          hideSchedule
        />
      )}

      {syncType === 'srm' && (
        <VmwareSyncButton
          type="SRM"
          user={user}
          onCompleted={onSyncCompleted}
          hideSchedule
        />
      )}

      {syncType === 'vr' && (
        <VmwareSyncButton
          type="VR"
          user={user}
          onCompleted={onSyncCompleted}
          hideSchedule
        />
      )}

      {!hideSchedule && (
        <SyncScheduleControl />
      )}
    </div>
  );
}
