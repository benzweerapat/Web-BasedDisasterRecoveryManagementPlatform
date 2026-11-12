import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Clock, X, Check } from 'lucide-react';
import { getSyncState, subscribeSync, setSyncInterval, refreshSyncSchedule } from '../../api/sync-schedule';
import SyncStatusBadge from './SyncStatusBadge';

const PRESETS = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 }
];

export default function SyncScheduleControl({ hideBadge = false, className = '' }) {
  const state = useSyncExternalStore(subscribeSync, getSyncState);
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(300);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    refreshSyncSchedule().catch(() => setError('Unable to read sync schedule'));
    const refresh = () => refreshSyncSchedule().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('inventory-cache-invalidated', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('inventory-cache-invalidated', refresh);
    };
  }, []);

  // Sync state seconds to local state when opening
  useEffect(() => {
    if (open) {
      setSeconds(state.seconds || 300);
      setError('');
    }
  }, [open, state.seconds]);

  // Click outside and Escape handlers
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const save = async (value) => {
    setSaving(true);
    setError('');
    try {
      await setSyncInterval(value);
      setOpen(false);
    } catch {
      setError('Unable to save sync schedule');
    } finally {
      setSaving(false);
    }
  };

  const isEnabled = Boolean(state.seconds && state.seconds > 0);
  const isValidCustom = Number.isInteger(seconds) && seconds >= 60 && seconds <= 86400;

  return (
    <div className={`relative inline-flex items-center gap-2 ${className}`}>
      {!hideBadge && (
        <SyncStatusBadge
          status={state.status}
          lastAt={state.lastAt}
          running={state.running || state.manualRunning}
          error={error || state.error}
        />
      )}

      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Configure auto sync"
        title={isEnabled ? `Auto sync runs every ${state.seconds}s (click to edit)` : 'Click to configure auto sync'}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 h-6.5 px-2 py-0.5 rounded-md text-xs font-medium border transition-colors shadow-2xs select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          isEnabled
            ? 'bg-indigo-50/70 border-indigo-200/80 text-indigo-700 hover:bg-indigo-100/70'
            : 'bg-white border-slate-200/80 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <Clock size={12} className={isEnabled ? 'text-indigo-600' : 'text-slate-400'} aria-hidden="true" />
        <span>{isEnabled ? `Auto: ${state.seconds}s` : 'Auto sync'}</span>
      </button>

      {(error || state.error) && (
        <span role="alert" className="sr-only">
          {error || state.error}
        </span>
      )}

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          aria-label="Configure auto sync"
          className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl text-xs animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
            <div className="flex items-center gap-1.5 font-display font-semibold text-slate-800">
              <Clock size={14} className="text-indigo-600" aria-hidden="true" />
              <span>Auto sync</span>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>

          {/* Presets & Input */}
          <div className="py-3 space-y-3">
            <div>
              <span className="text-[11px] font-medium text-slate-500 block mb-1.5">
                Quick presets:
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setSeconds(preset.value)}
                    className={`py-1 px-1.5 text-[11px] rounded-md font-medium border text-center transition-colors ${
                      seconds === preset.value
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold'
                        : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center justify-between text-[11px] text-slate-600 font-medium mb-1">
                <span>Interval:</span>
                <span className="text-slate-400 font-normal">60 – 86,400 sec</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  aria-label="Auto sync interval in seconds"
                  type="number"
                  min="60"
                  max="86400"
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-slate-500 text-[11px] shrink-0">sec</span>
              </div>
            </div>

            {error && (
              <p className="text-[11px] text-red-600 font-medium">{error}</p>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
            <button
              type="button"
              disabled={saving || !isEnabled}
              onClick={() => save(0)}
              className="px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Disable Auto sync
            </button>
            <button
              type="button"
              disabled={saving || !isValidCustom}
              onClick={() => save(seconds)}
              className="inline-flex items-center gap-1 px-3.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 shadow-xs transition-colors"
            >
              {saving ? (
                'Loading...'
              ) : (
                <>
                  <Check size={12} aria-hidden="true" />
                  <span>Save</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
