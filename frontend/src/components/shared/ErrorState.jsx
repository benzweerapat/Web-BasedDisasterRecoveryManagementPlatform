import React from 'react';
import {CircleAlert,ServerOff,CloudOff,RefreshCw} from 'lucide-react';
import Button from './Button';
export default function ErrorState({title='Unable to load data',message,errorCode,retry}) {
 const code=errorCode||message?.code;
 const text=typeof message==='string'?message:message?.safeMessage;
 const Icon=code==='NETWORK_ERROR'||code==='BACKEND_UNAVAILABLE'?ServerOff:/SRM|VMWARE|UPSTREAM/.test(code||'')?CloudOff:CircleAlert;
 return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center" role="alert">
 <Icon className="mx-auto mb-3 text-slate-500" size={32}/><h3 className="font-semibold text-slate-800">{title}</h3>
 <p className="mt-2 text-sm text-slate-600">{text||'The request could not be completed.'}</p>
 {retry&&<Button icon={RefreshCw} onClick={retry} className="mt-4">Retry</Button>}
 {code&&<details className="mt-4 text-xs text-slate-500"><summary>Technical details</summary><p>{code}</p></details>}
 </div>;
}
