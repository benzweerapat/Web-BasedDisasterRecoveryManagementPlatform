import Button from './Button';
import SemanticIcon from "./SemanticIcon";
import React from 'react';
import { RefreshCw, Search } from 'lucide-react';

export default function TableToolbar({ 
  title, 
  icon,
  searchQuery, 
  onSearchChange, 
  onRefresh, 
  isRefreshing, 
  actionComponent = null,
  totalCount = null,
  customSubText = null
}) {
  const ToolbarIcon = typeof icon === 'function' ? icon : null;
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border-b border-slate-200 gap-4 bg-white rounded-t-xl">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
            {ToolbarIcon ? <ToolbarIcon size={18} aria-hidden="true" /> : <SemanticIcon className={`fa-solid ${icon}`}></SemanticIcon>}
          </div>
        )}
        <div>
          <h2 className="font-display text-base font-semibold text-slate-800">{title}</h2>
          {customSubText ? (
            <p className="text-xs font-medium text-slate-500 mt-0.5">{customSubText}</p>
          ) : (
            totalCount !== null && (
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                Total {totalCount} items
              </p>
            )
          )}
        </div>
      </div>
      
      <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
        {onSearchChange && (
          <div className="relative flex-grow sm:flex-grow-0 sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={15} aria-hidden="true" />
            </div>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full rounded-full border border-slate-300 py-2 pl-9 pr-4 text-sm shadow-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}
        
        {actionComponent}
        
        {onRefresh && (
          <Button 
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`flex h-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${isRefreshing ? 'px-3' : 'w-10'}`}
            aria-label="Refresh data"
            title="Refresh data"
          >
            {isRefreshing ? 'Loading...' : <RefreshCw size={15} aria-hidden="true" />}
          </Button>
        )}
      </div>
    </div>
  );
}
