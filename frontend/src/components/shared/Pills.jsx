import Button from './Button';
import React from 'react';
import { ArrowRight } from 'lucide-react';

export function CountPill({ label, icon: Icon, count, active = false, disabled = false, onClick, ...props }) {
  const Tag = onClick ? Button : 'span';
  return (
    <Tag
      {...props}
      {...(onClick ? { type: 'button', disabled, 'aria-pressed': active, onClick } : {})}
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border bg-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors select-none ${
        active
          ? 'border-indigo-400 text-indigo-700 ring-1 ring-indigo-200'
          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {Icon && <Icon size={14} className={active ? 'text-indigo-600' : 'text-slate-400'} aria-hidden="true" />}
      <span>{label}</span>
      {count != null && (
        <span aria-label={`${count} mapping${count === 1 ? '' : 's'}`} className="ml-1 min-w-5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.2 text-center text-[11px] font-mono tabular-nums text-slate-700">
          {count}
        </span>
      )}
    </Tag>
  );
}

export function FilterPill({ label, icon: Icon, active = false, count, disabled = false, onClick, ...props }) {
  return (
    <Button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      {...props}
      className={`inline-flex min-h-8 items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-medium shadow-sm transition-all select-none ${
        active
          ? 'border-indigo-500 text-indigo-700 font-semibold ring-1 ring-indigo-200'
          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {Icon && <Icon size={13} className={active ? 'text-indigo-600' : 'text-slate-400'} aria-hidden="true" />}
      <span>{label}</span>
      {count != null && (
        <span className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono ${active ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
          {count}
        </span>
      )}
    </Button>
  );
}

export function StatusPill({ status, label, className = '' }) {
  const s = String(status || '').toUpperCase();
  let dotClass = 'bg-slate-400';
  let borderClass = 'border-slate-200 text-slate-700';
  

  if (['OK', 'READY', 'READY_STATE', 'PROTECTED', 'CONFIGURED', 'HEALTHY', 'SUCCESS', 'CONNECTED', 'SYNCED'].includes(s)) {
    dotClass = 'bg-emerald-500';
    borderClass = 'border-emerald-200 text-emerald-800';
    
  } else if (['WARNING', 'DEGRADED', 'PARTIAL', 'STALE', 'CONFIGURING', 'NOT_READY'].includes(s)) {
    dotClass = 'bg-amber-500';
    borderClass = 'border-amber-200 text-amber-800';
    
  } else if (['PAUSED'].includes(s)) {
    dotClass = 'bg-amber-400';
    borderClass = 'border-amber-200 text-amber-700';
    
  } else if (['RUNNING', 'SYNCING', 'PROGRESS', 'IN_PROGRESS', 'RECOVERING', 'TEST_IN_PROGRESS', 'CLEANUP_IN_PROGRESS', 'MIGRATION_IN_PROGRESS', 'RECOVERY_IN_PROGRESS', 'REPROTECT_IN_PROGRESS'].includes(s)) {
    dotClass = 'bg-blue-500 animate-pulse';
    borderClass = 'border-blue-200 text-blue-700';
    
  } else if (['ERROR', 'FAILED', 'DISCONNECTED', 'CRITICAL', 'NOT_CONFIGURED'].includes(s)) {
    dotClass = 'bg-red-500';
    borderClass = 'border-red-200 text-red-800';
    
  }

  let displayLabel = label;
  if (!displayLabel) {
    if (s === 'READY' || s === 'READY_STATE') displayLabel = 'Ready';
    else displayLabel = (s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown');
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-xs font-medium shadow-sm ${borderClass} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span>{displayLabel}</span>
    </span>
  );
}

export function DirectionPill({ sourceSite, targetSite, active = false, onClick, className = '' }) {
  const Tag = onClick ? Button : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, 'aria-pressed': active } : {})}
      className={`inline-flex items-center gap-2 rounded-full border bg-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
        active
          ? 'border-indigo-400 text-indigo-700 ring-1 ring-indigo-200'
          : 'border-slate-200 text-slate-700 hover:border-slate-300'
      } ${className}`}
    >
      <span>{sourceSite || 'Source'}</span>
      <ArrowRight size={13} className="text-slate-400" aria-hidden="true" />
      <span>{targetSite || 'Target'}</span>
    </Tag>
  );
}
