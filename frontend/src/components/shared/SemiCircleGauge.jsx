import React from 'react';
import { getCapacitySeverity } from '../../utils/overview-severity';

/**
 * SemiCircleGauge - Gridgeist-compliant Speedometer Capacity Gauge
 * 
 * Displays:
 * - 180-degree half-circle arc indicator (Speedometer)
 * - Metric label & severity color
 * - Large percentage in the center
 * - Stacked Free & Total values
 * 
 * Strict palette: #FE5E37 (orange/red), #8AC389 (green), #0A0A0A (dark), #ECEDEF (canvas/border), #FFFFFF (white)
 */
export default function SemiCircleGauge({ label, percent, freeText, totalText, showDetails = true, className = '' }) {
  const isAvailable = percent !== null && percent !== undefined && Number.isFinite(Number(percent));
  const numericPct = isAvailable ? Math.min(100, Math.max(0, Number(percent))) : null;
  const severity = getCapacitySeverity(numericPct);

  // Colors according to brand palette
  let strokeColor = '#8AC389'; // Brand green (Healthy < 61%)
  const pctColorClass = isAvailable ? 'text-slate-900' : 'text-slate-400';

  if (severity === 'CRITICAL') {
    strokeColor = '#FE5E37'; // Brand orange/red (> 80%)
  } else if (severity === 'WARNING') {
    strokeColor = '#f59e0b'; // Amber (61-80%)
  } else if (!isAvailable) {
    strokeColor = '#cbd5e1';
  }

  // Dash array calculation for half-circle (perimeter 50)
  // 50 is half of the 100 circumfrence
  const arcValue = isAvailable ? ((numericPct / 100) * 50).toFixed(1) : 0;

  return (
    <div
      className={`flex flex-col items-center text-center p-2 rounded-xl bg-slate-50/70 border border-slate-100/90 transition-colors hover:bg-slate-50 ${className}`}
      data-capacity-metric={label ? label.toLowerCase() : undefined}
      data-capacity-severity={severity}
    >
      <div className="flex items-center justify-between w-full px-1">
        <span className="text-xs font-bold text-slate-800 tracking-tight">{label}</span>
      </div>

      {/* Speedometer Arc (Half-Circle) */}
      <div className="relative w-16 h-10 sm:w-20 sm:h-12 my-1 flex justify-center overflow-hidden">
        <svg
          className="w-16 h-16 sm:w-20 sm:h-20 -rotate-90 absolute top-0"
          viewBox="0 0 36 36"
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={isAvailable ? numericPct : undefined}
        >
          {/* Background track: 50% = 180 degrees */}
          <path
            className="text-slate-200"
            strokeWidth="4.2"
            strokeDasharray="50, 100"
            stroke="currentColor"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          {/* Active filled arc */}
          {isAvailable && (
            <path
              strokeWidth="4.2"
              strokeDasharray={`${arcValue}, 100`}
              strokeLinecap="round"
              stroke={strokeColor}
              fill="none"
              className="transition-all duration-500"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          )}
        </svg>

        {/* Center Percentage Display */}
        <span className={`absolute bottom-0 text-xs sm:text-sm font-bold font-mono leading-none ${pctColorClass}`}>
          {isAvailable ? `${numericPct}%` : '—'}
        </span>
      </div>

      {/* Free & Total metrics (conditional) */}
      {showDetails && (
        <div className="w-full mt-1 pt-1.5 border-t border-slate-200/60 px-1.5 sm:px-2 text-[9.5px] sm:text-[10.5px] leading-snug space-y-0.5">
          <div className="flex items-center justify-between text-slate-600 font-semibold gap-0.5">
            <span className="shrink-0 text-slate-500">Free</span>
            <span className="text-slate-900 font-bold font-mono text-right truncate" title={freeText}>{freeText || '—'}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400 font-medium gap-0.5">
            <span className="shrink-0">Total</span>
            <span className="text-slate-700 font-semibold font-mono text-right truncate" title={totalText}>{totalText || '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
