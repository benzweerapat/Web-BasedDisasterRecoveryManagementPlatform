import React from 'react';
import { Clock } from 'lucide-react';

export default function StaleDataBanner({ title = "Data may be stale", message, errorCode }) {
  return (
    <div className="mx-4 mt-4 mb-2 bg-orange-50 border border-orange-200 rounded-lg p-3 flex gap-3 items-start shadow-sm" role="alert">
      <div className="text-orange-500 mt-0.5">
        <Clock size={16} />
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-bold text-orange-800">{title}</h4>
        <p className="text-xs text-orange-700 mt-0.5 leading-relaxed">
          {message}
        </p>
        {errorCode && <details className="mt-1 text-xs text-orange-700"><summary>Technical details</summary><code>{errorCode}</code></details>}
      </div>
    </div>
  );
}
