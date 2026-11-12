import React from 'react';
import { displayDatastoreName } from '../../utils/displayNames';

export default function ReplicationDatastores({ rep }) {
  const summary = rep?.replicatedDiskSummary;
  const disks = Array.isArray(summary?.disks) ? summary.disks : [];
  const primary = summary?.destinationDatastores?.[0] || disks.find(d => d.datastoreName)?.datastoreName;
  const diskCount = disks.filter(d => !d.isVmHome).length;
  const datastoreLabel = displayDatastoreName(primary);

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-left font-mono text-xs text-slate-700"
      title={datastoreLabel}
    >
      <span className="truncate">{datastoreLabel}</span>
      {diskCount > 1 && (
        <span className="shrink-0 font-sans text-[10px] font-medium text-slate-500">+{diskCount - 1}</span>
      )}
    </span>
  );
}
