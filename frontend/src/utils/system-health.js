const presentations = {
  HEALTHY: { label: 'System healthy', className: 'bg-emerald-50 text-emerald-700' },
  WARNING: { label: 'System warning', className: 'bg-amber-50 text-amber-700' },
  PARTIAL: { label: 'System partial', className: 'bg-amber-50 text-amber-700' },
  ERROR: { label: 'System error', className: 'bg-red-50 text-red-700' },
  UNKNOWN: { label: 'System unknown', className: 'bg-slate-100 text-slate-600' }
};

export const systemHealthPresentation = status => presentations[status] || presentations.UNKNOWN;
