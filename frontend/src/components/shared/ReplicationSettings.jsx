import React from 'react';
import {formatRpo,validSettings} from '../../utils/replicationSettings';
export default function ReplicationSettings({config,form,onChange,id='replication-settings',showAutoReplicateNewDisks=true}) {
  const set=(key,value)=>onChange({...form,[key]:value}),s=config.settings||{},cap=config.capability||{};
  const input='rounded-lg border border-slate-300 bg-white p-2 text-sm';
  return <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Replication settings">
    <div><label htmlFor={`${id}-rpo`} className="block font-semibold text-slate-800">Recovery point objective (RPO)</label>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <input id={`${id}-rpo`} aria-label="RPO (minutes)" type="number" min={config.rpo.min} max={config.rpo.max} step="1" value={form.rpo} onChange={e=>set('rpo',e.target.value)} className={`${input} w-28`}/><span className="text-sm text-slate-500">minutes</span></div>
      <p className="mt-1 text-xs text-slate-500">{formatRpo(config.rpo.min)} – {formatRpo(config.rpo.max)}</p></div>
    {s.mpitSupported&&<div><label className="flex items-center gap-2"><input type="checkbox" checked={form.mpit===true} onChange={e=>onChange({...form,mpit:e.target.checked,mpitInstances:form.mpitInstances??1,mpitDays:form.mpitDays??1})}/>Enable point in time instances</label>
      {form.mpit&&<div className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4"><div className="flex flex-wrap gap-4">{[['mpitInstances','Instances per day'],['mpitDays','Days']].map(([key,label])=><label key={key} className="flex flex-col gap-1 text-sm">{label}<input type="number" min="1" max={s.mpitMaxTotal} step="1" className={`${input} w-32`} value={form[key]??''} onChange={e=>set(key,e.target.value)}/></label>)}</div>
        <p className="text-sm">Keep {form.mpitInstances} instances per day for the last {form.mpitDays} days.</p>
        <p className="text-xs text-slate-500">Maximum {s.mpitMaxTotal} retained instances in total.</p>
        {Number(form.rpo)*Number(form.mpitInstances)>1440&&<p className="text-sm text-amber-700">This RPO may not produce the requested number of daily instances.</p>}</div>}</div>}
    <div className="space-y-3">{[
      ['quiesce','Enable guest OS quiescing','quiescing_supported'],
      ['networkCompression','Enable network compression for VR data','network_compression_supported'],
      ['encryption','Enable network encryption for VR data','lwd_encryption_supported'],
      ['autoReplicateNewDisks','Auto-replicate newly added disks','auto_replicate_new_disks_supported']
    ].filter(([key,,capabilityKey])=>cap[capabilityKey]===true&&(key!=='autoReplicateNewDisks'||showAutoReplicateNewDisks)).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[key]===true} disabled={key==='encryption'&&s.encryptionRequired} onChange={e=>set(key,e.target.checked)}/>{label}</label>)}
      {s.encryptionRequired&&<p className="text-xs text-slate-500">Encryption is required for this encrypted VM.</p>}
      {s.dataSetsExposed&&<div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.dataSets===true} onChange={e=>set('dataSets',e.target.checked)}/>Enable DataSets replication</label></div>}
    </div>
    {!validSettings(config,form)&&<p role="alert" className="text-sm text-red-700">Check RPO, retention values and required encryption before continuing.</p>}
  </section>;
}
