import React from 'react';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';

export default function LastCollectedLabel({ freshness, value, label = 'Last collected' }) {
  const timestamp = value || freshness?.lastCollectedAt || freshness?.lastSuccessfulCollectionAt || null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
      <span className="font-medium">{label}:</span>
      <time dateTime={timestamp || undefined} title={timestamp ? formatDateTime(timestamp) : 'Never'}>
        {formatDateTime(timestamp)}
      </time>
      {timestamp && <span className="text-slate-400">({formatRelativeTime(timestamp)})</span>}
    </span>
  );
}
