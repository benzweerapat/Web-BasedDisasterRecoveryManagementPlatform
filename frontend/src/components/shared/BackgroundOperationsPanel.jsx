import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, X, XCircle } from 'lucide-react';
import {
  backgroundOperationDetails,
  backgroundOperationLabel,
  backgroundOperationMessage,
  clearCompletedOperations,
  dismissBackgroundOperation,
  getBackgroundOperationsSnapshot,
  subscribeBackgroundOperations
} from '../../api/backgroundOperations';
import { compactBackgroundOperation } from '../../utils/backgroundOperationPresentation';

const tones = {
  pending: 'bg-amber-50 text-amber-700',
  success: 'bg-emerald-50 text-emerald-700',
  error: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-700',
  neutral: 'bg-slate-100 text-slate-600'
};

function OperationRow({ item }) {
  const { title, statusLabel, tone } = compactBackgroundOperation(item, backgroundOperationDetails(item));
  const fullLabel = backgroundOperationLabel(item);
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? XCircle : Clock3;
  return (
    <div className="flex items-start gap-1 border-b border-slate-100 px-3 last:border-0">
      <details className="group min-w-0 flex-1">
        <summary aria-label={`Details for ${title}`} title={fullLabel} className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded py-2 outline-none focus-visible:ring-2 focus-visible:ring-orange-400 [&::-webkit-details-marker]:hidden">
          <Icon size={14} className={`shrink-0 ${tone === 'success' ? 'text-emerald-600' : tone === 'error' ? 'text-red-600' : tone === 'neutral' ? 'text-slate-400' : 'text-amber-600'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{title}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone] || tones.neutral}`}>{statusLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-1 pb-3 pl-5 text-[11px] leading-4">
          <p className="break-words font-semibold text-slate-700">{fullLabel}</p>
          <p className={`break-words ${tone === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{backgroundOperationMessage(item)}</p>
          {item.status && <p className="break-words text-slate-400">Status: {item.status}</p>}
        </div>
      </details>
      {item.phase !== 'pending' && <button type="button" aria-label={`Dismiss ${item.label}`} onClick={() => dismissBackgroundOperation(item.provider, item.id)} className="mt-1 flex h-8 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={12} aria-hidden="true" /></button>}
    </div>
  );
}

export default function BackgroundOperationsPanel() {
  const operations = React.useSyncExternalStore(subscribeBackgroundOperations, getBackgroundOperationsSnapshot);
  const [expanded, setExpanded] = useState(true);
  const visible = useMemo(() => operations.slice(0, 8), [operations]);
  if (!visible.length) return null;
  const pending = operations.filter(item => item.phase === 'pending').length;
  const failed = operations.filter(item => item.phase === 'failed').length;
  const finished = operations.length - pending;
  const summary = pending ? `${pending} active${failed ? ` · ${failed} issues` : ''}` : failed ? `${failed} need attention` : `${finished} done`;
  const HeaderIcon = pending ? Clock3 : failed ? XCircle : CheckCircle2;

  return (
    <section className="fixed bottom-24 right-5 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" aria-label="Background operations">
      <button type="button" aria-expanded={expanded} aria-controls="background-operations-list" onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50">
        <HeaderIcon size={15} className={`shrink-0 ${pending ? 'text-amber-600' : failed ? 'text-red-600' : 'text-emerald-600'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900">Background operations</span>
        <span className={`shrink-0 text-[10px] ${failed ? 'text-red-600' : 'text-slate-500'}`}>{summary}</span>
        {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>
      {expanded && (
        <div id="background-operations-list" className="max-h-56 overflow-y-auto border-t border-slate-100">
          {visible.map(item => <OperationRow key={`${item.provider}:${item.id}`} item={item} />)}
          {finished > 0 && <div className="flex justify-end px-3 py-1.5"><button type="button" onClick={clearCompletedOperations} className="text-[10px] font-semibold text-slate-500 hover:text-slate-900">Clear completed</button></div>}
        </div>
      )}
    </section>
  );
}
