import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getReplicationFeedback } from '../../utils/replicationFeedback';
import { formatDateTime } from '../../utils/formatters';

export default function ReplicationStatusNotice({ rep }) {
  if (!rep) return null;
  const feedback = getReplicationFeedback(rep);
  if (!feedback.hasDetails) return null;
  const isInfo = feedback.severity === 'info' && !feedback.issues.length;
  const Icon = isInfo ? RefreshCw : AlertTriangle;
  const colors = feedback.severity === 'error' ? 'border-rose-300 bg-rose-50 text-rose-900'
    : isInfo ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-300 bg-amber-50 text-amber-900';
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-xs ${colors}`} data-vr-replication-feedback>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-2 leading-5">
        <p className="font-semibold">VMware status: {feedback.rawStatus || 'Not reported'}</p>
        {feedback.issues.map(issue => <p key={issue}>{issue}</p>)}
        {feedback.sourcePowerNote && <p>{feedback.sourcePowerNote}</p>}
        {feedback.guidance && <p>{feedback.guidance}</p>}
        {feedback.progressPercent != null && <p>Reported synchronization progress: {feedback.progressPercent}%</p>}
        <p>Last collected: {feedback.lastCollectedAt ? formatDateTime(feedback.lastCollectedAt) : 'Not reported'}
          {feedback.lastVrSyncAt ? ` · Last VR sync: ${formatDateTime(feedback.lastVrSyncAt)}` : ''}
        </p>
      </div>
    </div>
  );
}
