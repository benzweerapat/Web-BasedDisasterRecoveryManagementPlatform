import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import Button from './Button';

export default function DirectionToggle({ 
  direction, 
  setDirection, 
  sourceName = "vCenter DC", 
  targetName = "vCenter DR",
  compact = false
}) {
  return (
    <div className="flex items-center gap-2" aria-label="Mapping direction">
      {/* rounded-full border bg-white */}
      {[
        { key: 'forward', source: sourceName, target: targetName },
        { key: 'fallback', source: targetName, target: sourceName }
      ].map(item => {
        const active = direction === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => setDirection(item.key)}
            className={`inline-flex items-center gap-2 whitespace-nowrap px-4 py-1.5 text-xs font-semibold rounded-xl border transition-all ${
              active 
                ? 'border-[#FE5E37] text-[#FE5E37] bg-white' 
                : 'border-slate-200 text-slate-900 bg-white hover:bg-slate-50 hover:border-slate-300'
            }`}
          >
            <span>{item.source}</span>
            <ArrowLeftRight size={13} className={active ? 'text-[#FE5E37]' : 'text-slate-800'} aria-hidden="true" />
            <span>{item.target}</span>
          </button>
        );
      })}
    </div>
  );
}
