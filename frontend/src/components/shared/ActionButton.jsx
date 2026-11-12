import React from 'react';

const VARIANT_STYLES = {
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 active:bg-slate-100',
  primary: 'border border-transparent bg-indigo-600 text-white shadow-2xs hover:bg-indigo-700 active:bg-indigo-800',
  black: 'border border-[#0A0A0A] bg-[#0A0A0A] text-white shadow-2xs hover:bg-[#262626] active:bg-black',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 shadow-none',
  danger: 'border border-red-200 bg-white text-red-600 shadow-2xs hover:bg-red-50 hover:border-red-300 active:bg-red-100'
};

export default function ActionButton({
  variant = 'secondary',
  icon: Icon,
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...props
}) {
  const variantClass = VARIANT_STYLES[variant] || VARIANT_STYLES.secondary;
  const isPending = Boolean(loading);
  const isDisabled = Boolean(disabled || isPending);

  return (
    <button
      {...props}
      type={type}
      disabled={isDisabled}
      aria-busy={isPending || undefined}
      data-button-variant={variant}
      className={`inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium transition-all duration-150 select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${variantClass} ${className}`}
    >
      {!isPending && Icon ? (
        <Icon size={14} className="shrink-0 text-current" aria-hidden="true" />
      ) : null}
      {isPending ? <span>Loading...</span> : children != null && <span>{children}</span>}
    </button>
  );
}
