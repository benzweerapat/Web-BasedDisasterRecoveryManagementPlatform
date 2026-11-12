import React from 'react';
import { Link } from '../../router';

/**
 * VmSemiCircleGauge - Gridgeist-compliant Speedometer Gauge for Virtual machines
 * 
 * Displays:
 * - 180-degree half-circle arc indicator (Speedometer)
 * - Green portion (#8AC389) for Power On VMs
 * - Orange portion (#FE5E37) for Power Off VMs
 * - Percentage of Powered on VMs in the center
 * - Stacked count of On (green dot) and Off (orange dot) VMs
 * - Optional link to VM filter
 */
export default function VmSemiCircleGauge({
  label = 'VMs',
  powerOn = 0,
  powerOff = 0,
  total,
  linkTo,
  className = ''
}) {
  const onCount = Number(powerOn) || 0;
  const offCount = Number(powerOff) || 0;
  const calcTotal = total != null ? Number(total) : onCount + offCount;
  const isAvailable = calcTotal > 0;

  // Percentage of VMs powered on
  const onPercent = isAvailable ? Math.round((onCount / calcTotal) * 100) : 0;

  // Half circle arc has perimeter 50 out of 100
  // arcValue represents the green On portion (0 to 50)
  const onArcValue = isAvailable ? ((onPercent / 100) * 50).toFixed(1) : 0;

  const content = (
    <div
      className={`flex flex-col items-center text-center p-2 rounded-xl bg-slate-50/70 border border-slate-100/90 transition-colors hover:bg-slate-50 group cursor-pointer ${className}`}
      data-capacity-metric="vms"
    >
      <div className="flex items-center justify-between w-full px-1 gap-1">
        <span className="text-[11px] sm:text-xs font-bold text-slate-800 tracking-tight truncate max-w-[65%]" title={label}>{label}</span>
        <span className="text-[9.5px] sm:text-[10px] font-mono font-semibold text-slate-400 shrink-0">{calcTotal} total</span>
      </div>

      {/* Speedometer Arc (Half-Circle) */}
      <div className="relative w-16 h-10 sm:w-20 sm:h-12 my-1 flex justify-center overflow-hidden">
        <svg
          className="w-16 h-16 sm:w-20 sm:h-20 -rotate-90 absolute top-0"
          viewBox="0 0 36 36"
          role="progressbar"
          aria-label={`${label} power state`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={onPercent}
        >
          {/* Background track: 50% = 180 degrees half-circle */}
          {/* If there are off VMs, background represents Off (#FE5E37) otherwise slate-200 */}
          <path
            stroke={offCount > 0 ? '#FE5E37' : '#e2e8f0'}
            strokeWidth="4.2"
            strokeDasharray="50, 100"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          {/* Active filled arc for Power On (#8AC389 green) */}
          {isAvailable && onCount > 0 && (
            <path
              strokeWidth="4.2"
              strokeDasharray={`${onArcValue}, 100`}
              strokeLinecap="round"
              stroke="#8AC389"
              fill="none"
              className="transition-all duration-500"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          )}
        </svg>

        {/* Center Percentage Display (Percentage On) */}
        <span className="absolute bottom-0 text-xs sm:text-sm font-bold font-mono leading-none text-slate-900">
          {isAvailable ? `${onPercent}%` : '—'}
        </span>
      </div>

      {/* On vs Off metrics footer (Left aligned labels, right aligned numbers) */}
      <div className="w-full mt-1 pt-1.5 border-t border-slate-200/60 px-1.5 sm:px-2 text-[9.5px] sm:text-[10.5px] leading-snug space-y-0.5">
        <div className="flex items-center justify-between text-slate-700 font-semibold gap-0.5">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-[#8AC389] shrink-0" aria-hidden="true" />
            <span>Power on</span>
          </span>
          <span className="text-slate-900 font-bold font-mono text-right truncate">{onCount}</span>
        </div>
        <div className="flex items-center justify-between text-slate-500 font-medium gap-0.5">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-[#FE5E37] shrink-0" aria-hidden="true" />
            <span>Power off</span>
          </span>
          <span className="text-slate-700 font-bold font-mono text-right truncate">{offCount}</span>
        </div>
      </div>
    </div>
  );

  if (linkTo) {
    return (
      <Link to={linkTo} className="block no-underline">
        {content}
      </Link>
    );
  }

  return content;
}
