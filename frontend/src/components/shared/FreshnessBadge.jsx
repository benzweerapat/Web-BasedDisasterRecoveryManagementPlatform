import SemanticIcon from "./SemanticIcon";
import React from 'react';
import { STATUS_TEXT } from '../../utils/ui-text';

const STYLES = {
  FRESH: [STATUS_TEXT.FRESH, 'bg-emerald-50 text-emerald-700 border-emerald-200', 'fa-circle-check'],
  AGING: ['Aging', 'bg-amber-50 text-amber-800 border-amber-200', 'fa-clock'],
  STALE: [STATUS_TEXT.STALE, 'bg-amber-50 text-amber-800 border-amber-200', 'fa-clock'],
  NEVER_COLLECTED: ['Not collected', 'bg-slate-100 text-slate-700 border-slate-200', 'fa-circle-minus'],
  COLLECTION_FAILED: ['Collection failed', 'bg-red-50 text-red-700 border-red-200', 'fa-triangle-exclamation'],
  PARTIAL: ['Partial', 'bg-orange-50 text-orange-700 border-orange-200', 'fa-circle-half-stroke'],
  NOT_AVAILABLE: [STATUS_TEXT.NOT_AVAILABLE, 'bg-slate-100 text-slate-600 border-slate-200', 'fa-ban']
};

export default function FreshnessBadge({ freshness, status, compact = false }) {
  const value = status || freshness?.freshnessStatus || 'NOT_AVAILABLE';
  const [label, style, icon] = STYLES[value] || STYLES.NOT_AVAILABLE;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'} ${style}`} title={`Freshness: ${value}`}>
      <SemanticIcon className={`fa-solid ${icon}`} aria-hidden="true"></SemanticIcon>
      {label}
    </span>
  );
}
