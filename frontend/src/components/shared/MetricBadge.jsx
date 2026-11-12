import React from 'react';

const displayCount = value => (value === null || value === undefined ? '0' : Number(value).toLocaleString());

export default function MetricBadge({ label, count, color, icon, className = '' }) {
  return (
    <div 
      className={`flex flex-col items-center justify-center px-2.5 sm:px-3 py-0.5 text-center select-none ${className}`}
      data-metric-card={label}
      aria-label={label}
    >
      <span className="text-[11px] sm:text-xs font-semibold text-slate-800 whitespace-nowrap">{label}</span>
      <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5">{displayCount(count)}</span>
    </div>
  );
}


