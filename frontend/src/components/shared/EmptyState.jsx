import SemanticIcon from "./SemanticIcon";
import React from 'react';

export default function EmptyState({ icon = "fa-folder-open", title = "No items", description = "This scope contains no items." }) {
  const Icon = typeof icon === 'function' ? icon : null;

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-50 border border-slate-200 border-dashed rounded-xl m-4">
      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
        {Icon
          ? <Icon size={26} strokeWidth={1.8} aria-hidden="true" />
          : <SemanticIcon className={`fa-solid ${icon} text-2xl`} aria-hidden="true"></SemanticIcon>}
      </div>
      <h3 className="text-base font-bold text-slate-700 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm">{description}</p>
    </div>
  );
}
