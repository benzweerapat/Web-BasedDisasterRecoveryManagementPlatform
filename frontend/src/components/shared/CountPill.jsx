import React from 'react';
import Button from './Button';
export default function CountPill({label,icon:Icon,count,active=false,disabled=false,onClick,...props}) {
  const Tag=onClick?Button:'span';
  return <Tag {...props} {...(onClick?{variant:'ghost',type:'button',disabled,'aria-pressed':active,onClick}:{})}
    className={`inline-flex min-h-9 items-center gap-2 bg-white px-3 py-1.5 text-sm font-semibold ${active?'text-indigo-700':'text-slate-600'} ${disabled?'opacity-50':'hover:text-slate-800'}`}>
    {Icon&&<Icon size={16} aria-hidden="true"/>}<span>{label}</span>
    {count!=null&&<span aria-label={`${count} mapping${count===1?'':'s'}`} className="ml-1 min-w-6 rounded-lg bg-sky-100 px-1.5 py-0.5 text-center text-xs tabular-nums text-sky-700">{count}</span>}
  </Tag>;
}
