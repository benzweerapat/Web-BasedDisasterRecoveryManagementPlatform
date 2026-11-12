import React,{useCallback,useEffect,useState,useRef} from 'react';
import {Play,RotateCcw,FlaskConical,ArrowRightLeft,LifeBuoy,CircleX,ChevronDown} from 'lucide-react';
import api from '../../api/apiClient';
import useDialogFocus from '../../hooks/useDialogFocus';
import {displayName} from '../../utils/displayNames';
import {classifyApiError} from '../../utils/apiErrors';
import ErrorState from './ErrorState';
import {recoveryExecutionStatus} from '../../utils/recoveryExecutionStatus';
import {trackBackgroundOperation} from '../../api/backgroundOperations';
import {recoveryActionAvailability} from '../../utils/recoveryActionAvailability';

const labels={reprotect:'Reprotect',test:'Test',cleanup:'Cleanup',migration:'Planned migration',recovery:'Disaster recovery',cancel:'Cancel operation'};
const icons={reprotect:ArrowRightLeft,test:FlaskConical,cleanup:RotateCcw,migration:ArrowRightLeft,recovery:LifeBuoy,cancel:CircleX};
const settled=new Set(['SUCCESS','FAILED','RECONCILIATION_BLOCKED','ROLLBACK_SUCCESS','ROLLBACK_FAILED']);
const blockerText=blocker=>({
 RECOVERY_PREFLIGHT_UNAVAILABLE:'SRM could not verify protection readiness. Refresh after resolving the collection error. Execution remains blocked.',
 RECOVERY_PLAN_HAS_NO_PROTECTION_GROUPS:'Recovery plan has no protection group.',
 PROTECTION_GROUP_NOT_READY:`Protection group ${displayName(blocker.groupName)} is ${displayName(blocker.status)}.`,
 PROTECTION_GROUP_HAS_NO_VMS:`Protection group ${displayName(blocker.groupName)} has no VM.`,
 VM_NOT_PROTECTED:`VM ${displayName(blocker.vmName)} in ${displayName(blocker.groupName)} is ${displayName(blocker.status)}.`,
 PROTECTION_GROUP_HAS_ISSUES:`Protection group ${displayName(blocker.groupName)} has ${blocker.count||1} issue(s).`,
 RECOVERY_PLAN_HAS_ISSUES:`Recovery plan has ${blocker.count||1} issue(s).`
}[blocker.code]||'Recovery preflight found an unresolved blocker.');

export default function RecoveryExecution({plan,pairId,targets=[],onUpdated,onLockChange,lockKey,actionsRevision=0,userRole,disabled=false}) {
 const requestKey=useRef(null),updated=useRef(onUpdated),previous=useRef(null),submitting=useRef(false);
 updated.current=onUpdated;
 const [info,setInfo]=useState(null),[error,setError]=useState(''),[action,setAction]=useState(''),[name,setName]=useState(''),[replicateRecentChanges,setReplicateRecentChanges]=useState(false),[busy,setBusy]=useState(false),[operation,setOperation]=useState(null);
 const [migrateOpen,setMigrateOpen]=useState(false);
 const [availability,setAvailability]=useState({key:'',phase:'loading'});
 const previousActions=useRef([]);
 const [openUpward,setOpenUpward]=useState(false);
 const menuRef = useRef(null);
 const id=plan.recoveryPlanId||plan.id,base='/srm/recovery-plans/'+encodeURIComponent(id);
 const activeTarget=useRef(null);
 const targetSignature=(targets.length?targets:[{plan,pairId}]).map(target=>`${target.pairId}:${target.plan?.recoveryPlanId||target.plan?.id}`).join('|');
 const contextKey=JSON.stringify([targetSignature,plan.name,plan.status,plan.normalizedStatus,actionsRevision]);
 const currentContext=useRef(contextKey);
 currentContext.current=contextKey;
 const highImpact=['migration','recovery','reprotect'].includes(action);
 const locked=operation&&!settled.has(operation.state);
 const operationDisplayStatus=recoveryExecutionStatus(operation);
 const dialog=useDialogFocus(Boolean(action),()=>setAction(''));
 const inFlight=useRef(false);
 const queuedRefresh=useRef(false),latestLoad=useRef(null),mounted=useRef(true),conflictRetries=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{conflictRetries.current=0;},[contextKey]);
 const availabilityPhase=availability.key===contextKey?availability.phase:'loading';
 const controls=recoveryActionAvailability({info,previousActions:previousActions.current,phase:availabilityPhase,role:userRole,busy,locked,disabled});

 useEffect(()=>{
   onLockChange?.(lockKey,Boolean(locked),operationDisplayStatus);
   return ()=>onLockChange?.(lockKey,false,null);
 },[locked,operationDisplayStatus,onLockChange,lockKey]);

 useEffect(() => {
   if (!migrateOpen) return;
   const handlePointerDown = (e) => {
     if (menuRef.current && !menuRef.current.contains(e.target)) {
       setMigrateOpen(false);
     }
   };
   window.addEventListener('pointerdown', handlePointerDown);
   return () => window.removeEventListener('pointerdown', handlePointerDown);
 }, [migrateOpen]);

 const toggleMigrate = () => {
   if (!migrateOpen && menuRef.current) {
     const rect = menuRef.current.getBoundingClientRect();
     const spaceBelow = window.innerHeight - rect.bottom;
     setOpenUpward(spaceBelow < 140);
   }
   setMigrateOpen(prev => !prev);
 };

 const load=useCallback(async(pollOnly=false)=>{
   pollOnly = pollOnly === true;
   if(inFlight.current){if(!pollOnly)queuedRefresh.current=true;return;}
   inFlight.current=true;
   const loadContext=contextKey;
   const isCurrent=()=>mounted.current&&currentContext.current===loadContext;
   if(!pollOnly)setAvailability({key:loadContext,phase:'loading'});
   try {
   const candidates=(pollOnly
     ? [activeTarget.current||{plan,pairId}]
     : (targets.length?targets:[{plan,pairId}]))
     .filter(target=>target?.pairId&&(target.plan?.recoveryPlanId||target.plan?.id));
   const matchingTarget=candidates.find(candidate=>String(candidate.pairId)===String(activeTarget.current?.pairId)
     &&String(candidate.plan?.recoveryPlanId||candidate.plan?.id)===String(activeTarget.current?.plan?.recoveryPlanId||activeTarget.current?.plan?.id));
   let chosen=matchingTarget||candidates[0]||null;
   let actionsResponse=null,actionsError=null,refreshError=null;
   if(!pollOnly){
     for(const candidate of candidates){
       const candidateId=candidate.plan.recoveryPlanId||candidate.plan.id;
       const candidateBase='/srm/recovery-plans/'+encodeURIComponent(candidateId);
       try{
         actionsResponse=await api.get(candidateBase+'/available-actions',{params:{pairId:candidate.pairId}});
         chosen=candidate;
         if(isCurrent())activeTarget.current=candidate;
         break;
       }catch(reason){actionsError=reason;}
     }
     if(!isCurrent())return;
     if(actionsResponse&&Array.isArray(actionsResponse.data?.data?.actions)){
       const nextInfo=actionsResponse.data.data;
       setInfo(nextInfo);
       if(nextInfo.actions.length)previousActions.current=nextInfo.actions;
       setAvailability({key:loadContext,phase:'ready'});
     }else{
       // Keep the last rendered controls, but never their permissions, when a
       // refresh fails or returns an incomplete capability response.
       setAvailability({key:loadContext,phase:'error'});
     }
   }
   let operationResponse=null;
   if(chosen){
     const chosenId=chosen.plan.recoveryPlanId||chosen.plan.id;
     const chosenBase='/srm/recovery-plans/'+encodeURIComponent(chosenId);
     try{operationResponse=await api.get(chosenBase+'/active-operation',{params:{pairId:chosen.pairId}});}catch{/* Action availability remains usable when journal polling fails. */}
   }
   if(operationResponse){
     if(!isCurrent())return;
     const op=operationResponse.data.data;setOperation(op);
     if(op&&settled.has(op.state)&&previous.current&&!settled.has(previous.current)){
       // The operation collector has just refreshed SRM. Refresh the action
       // matrix in the same cycle so a completed Cleanup cannot leave stale
       // TEST_COMPLETE blockers beside a READY plan.
       setAvailability({key:loadContext,phase:'loading'});
       try {
         const chosenId=chosen.plan.recoveryPlanId||chosen.plan.id;
         const chosenBase='/srm/recovery-plans/'+encodeURIComponent(chosenId);
         const actions=await api.get(chosenBase+'/available-actions',{params:{pairId:chosen.pairId}});
         if(!isCurrent())return;
         if(!Array.isArray(actions.data?.data?.actions))throw Error('Invalid action availability');
         setInfo(actions.data.data);
         if(actions.data.data.actions.length)previousActions.current=actions.data.data.actions;
         setAvailability({key:loadContext,phase:'ready'});
       } catch (reason) {
         if(!isCurrent())return;
         setAvailability({key:loadContext,phase:'error'});
         refreshError=classifyApiError(reason,base);
       }
       updated.current?.();
     }
     previous.current=op?.state;
   }
   if(isCurrent()&&!pollOnly)setError(actionsResponse?(refreshError||''):actionsError?classifyApiError(actionsError,base):'');
   } finally {
     inFlight.current=false;
     if(mounted.current&&(queuedRefresh.current||currentContext.current!==loadContext)){
       queuedRefresh.current=false;
       // Inventory invalidation commonly arrives while a capability request is
       // running. Coalesce it into one fresh request instead of dropping it.
       latestLoad.current?.();
     }
   }
 },[base,pairId,contextKey]);
 latestLoad.current=load;

 useEffect(()=>{if(!pairId)return;load();const refresh=()=>load();window.addEventListener('inventory-cache-invalidated',refresh);return()=>window.removeEventListener('inventory-cache-invalidated',refresh);},[load,pairId]);
 useEffect(()=>{if(!pairId||!locked)return;const timer=setInterval(()=>load(true),10000);return()=>clearInterval(timer);},[load,pairId,locked]);
 // A create/rename may briefly leave a write-conflict capability response after
 // the table already says Ready. Recheck it instead of requiring navigation.
 useEffect(()=>{
   if(!pairId||locked||!controls.conflict||availabilityPhase!=='ready'||conflictRetries.current>=3)return;
   const timer=setTimeout(()=>{conflictRetries.current+=1;load();},10000);
   return()=>clearTimeout(timer);
 },[load,pairId,locked,controls.conflict,availabilityPhase,info]);

 const submit=async()=>{
   if(submitting.current||busy||(highImpact&&name!==info?.name)
      ||(action==='cancel'?!operation?.cancelAllowed:!controls.available.includes(action)))return;
   submitting.current=true;setBusy(true);setError('');
   try {
     const cancel=action==='cancel';
     const target=activeTarget.current||{plan,pairId};
     const targetId=target.plan.recoveryPlanId||target.plan.id;
     const targetBase='/srm/recovery-plans/'+encodeURIComponent(targetId);
     const url=cancel?targetBase+'/operations/'+encodeURIComponent(operation.operationId)+'/cancel':targetBase+'/execute/'+action;
     const body=cancel?{pairId:target.pairId,confirmed:true}:{pairId:target.pairId,confirmed:true,confirmName:info.name,...(action==='test'?{syncData:replicateRecentChanges}:{})};
     const r=await api.post(url,body,{headers:{'Idempotency-Key':requestKey.current}});
     if(!r.data?.data?.operationId)throw Error('Missing durable operation');
     if(!cancel)trackBackgroundOperation({
       id:r.data.data.operationId,
       provider:'SRM',
       label:`${labels[action]} ${info.name}`,
       resourceKey:`recovery-plan:${target.pairId}:${targetId}`,
       entityType:'Recovery plan',
       entityName:info.name,
       action
     });
     setOperation(r.data.data);setAction('');await load();
   }catch(err){setError(classifyApiError(err,base));}
   finally{submitting.current=false;setBusy(false);}
 };

 if(!pairId)return <span className="text-xs text-slate-400">Pairing unavailable</span>;

 const actionsList = controls.available;
 const hasTest = controls.showTest;
 const hasCleanup = controls.showCleanup;
 const hasMigrationActions = controls.showRun;
 const canRun=actionsList.some(action=>['migration','recovery','reprotect'].includes(action));

 return (
  <div className="inline-flex flex-col items-end gap-2 text-xs">
   <div className="inline-flex items-center gap-1 flex-nowrap">
    {/* Screen-reader alert for preflight blockers (required for accessibility and tests) */}
    {!locked && availabilityPhase==='ready' && info?.preflight?.ready === false && (
      <div className="sr-only" role="alert">
        <p className="font-bold">{controls.preflightUnavailable?'Protection readiness is unavailable':'Recovery plan is not ready'}</p>
        <ul className="mt-1 list-disc pl-5">
          {(info.preflight.blockers||[]).map((blocker, index) => (
            <li key={`${blocker.code}-${index}`}>{blockerText(blocker)}</li>
          ))}
        </ul>
      </div>
    )}

    {/* Visible minimal badge if not ready */}
    {!locked && availabilityPhase==='ready' && info?.preflight?.ready === false && (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-800 font-semibold text-xs shadow-2xs select-none"
        title={(info.preflight.blockers||[]).map(b => blockerText(b)).join('\n')}
      >
        <span>{controls.preflightUnavailable?'Readiness unavailable':'Plan not ready'}</span>
      </span>
    )}

    {/* Visible minimal progress badge while operation is running */}
    {locked && (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-orange-200 bg-white text-[#FE5E37] font-semibold text-xs shadow-2xs select-none animate-pulse">
        <span>Loading...</span>
      </span>
    )}

    {/* Primary Action: Test Button */}
    {hasTest && (
      <button
        type="button"
        disabled={!actionsList.includes('test')}
        title={!actionsList.includes('test')?(controls.message||'Test is not available in the current state.'):undefined}
        onClick={() => {
          requestKey.current = crypto.randomUUID();
          setAction('test');
          setName('');
          setReplicateRecentChanges(false);
        }}
        className="inline-flex h-10 min-h-10 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#8AC389] bg-white text-[#6EAC6C] hover:bg-emerald-50 font-bold text-xs transition-all shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>Test</span>
      </button>
    )}

    {/* Primary Action: Cleanup Button (shown when test is complete) */}
    {hasCleanup && (
      <button
        type="button"
        disabled={!actionsList.includes('cleanup')}
        title={!actionsList.includes('cleanup')?(controls.message||'Cleanup is not available in the current state.'):undefined}
        onClick={() => {
          requestKey.current = crypto.randomUUID();
          setAction('cleanup');
          setName('');
          setReplicateRecentChanges(false);
        }}
        className="inline-flex h-10 min-h-10 items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#FE5E37] text-white hover:bg-[#e04f2c] font-bold text-xs transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RotateCcw size={14} className="text-white" />
        <span>Cleanup</span>
      </button>
    )}

    {/* Run ▾ Dropdown (combines Planned migration, Disaster recovery, Reprotect) */}
    {hasMigrationActions && (
      <div ref={menuRef} className="relative inline-block text-left group">
        <button
          type="button"
          disabled={!canRun}
          title={!canRun?(controls.message||'Run is not available in the current state.'):undefined}
          onClick={toggleMigrate}
          className="inline-flex h-10 min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#FE5E37] bg-[#FE5E37] text-white hover:bg-[#e04f2c] font-semibold text-xs transition-colors shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>Run</span>
          <ChevronDown size={12} className="text-white" />
        </button>

        <div
          className={`${
            migrateOpen && canRun ? 'block' : 'hidden'
          } ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } absolute right-0 w-48 rounded-xl border border-slate-200 bg-white shadow-xl p-1 z-50 text-left`}
        >
          {actionsList.includes('migration') && (
            <button
              type="button"
              disabled={busy || locked}
              onClick={() => {
                setMigrateOpen(false);
                requestKey.current = crypto.randomUUID();
                setAction('migration');
                setName('');
                setReplicateRecentChanges(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center gap-2 transition-colors"
            >
              <span>Planned migration</span>
            </button>
          )}
          {actionsList.includes('recovery') && (
            <button
              type="button"
              disabled={busy || locked}
              onClick={() => {
                setMigrateOpen(false);
                requestKey.current = crypto.randomUUID();
                setAction('recovery');
                setName('');
                setReplicateRecentChanges(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 text-xs font-medium text-red-600 flex items-center gap-2 transition-colors"
            >
              <span>Disaster recovery</span>
            </button>
          )}
          {actionsList.includes('reprotect') && (
            <button
              type="button"
              disabled={busy || locked}
              onClick={() => {
                setMigrateOpen(false);
                requestKey.current = crypto.randomUUID();
                setAction('reprotect');
                setName('');
                setReplicateRecentChanges(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center gap-2 transition-colors"
            >
              <ArrowRightLeft size={14} className="text-slate-500 shrink-0" />
              <span>Reprotect</span>
            </button>
          )}
        </div>
      </div>
    )}

    {/* Cancel operation button (visually removed as requested, sr-only for contract support) */}
    {operation?.cancelAllowed && (
      <button
        type="button"
        disabled={busy}
        onClick={() => setAction('cancel')}
        aria-label="Cancel operation"
        className="sr-only"
      >
        Cancel operation
      </button>
    )}
   </div>

   {controls.message&&<div className="max-w-64 whitespace-normal text-right text-[11px] text-slate-500" role="status" aria-live="polite">
     {controls.message}
     {(availabilityPhase==='error'||controls.conflict||controls.preflightUnavailable)&&<button type="button" disabled={availabilityPhase==='loading'} onClick={()=>{conflictRetries.current=0;load();}} className="ml-1 font-semibold text-slate-700 underline disabled:opacity-50">Refresh actions</button>}
   </div>}

    {/* Minimal Confirmation Dialog */}
    {action && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 text-left animate-fade-in">
        <div
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={labels[action]}
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
        >
          <div>
            <span className="text-[10px] font-bold tracking-wider text-[#FE5E37]">Recovery execution</span>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">{labels[action]} Recovery plan</h2>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 text-[10px] font-bold block">Plan</span>
              <span className="font-bold text-slate-900">{displayName(info?.name)}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 text-[10px] font-bold block">Direction</span>
              <span className="font-semibold text-slate-700">
                {displayName(info?.source)} → {displayName(info?.target)}
              </span>
            </div>
          </div>

          {action === 'test' && (
            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/90 hover:bg-slate-50 cursor-pointer transition-colors text-xs font-semibold text-slate-800">
              <input
                type="checkbox"
                className="w-4 h-4 rounded text-[#FE5E37] focus:ring-[#FE5E37] border-slate-300"
                checked={replicateRecentChanges}
                onChange={e => setReplicateRecentChanges(e.target.checked)}
              />
              <span>Replicate recent changes to recovery site</span>
            </label>
          )}

          {highImpact && (
            <label className="block text-xs font-medium text-slate-700">
              Type <span className="font-bold text-slate-900 font-mono">{info?.name}</span> to confirm
              <input
                className="mt-1.5 block box-border w-full min-w-0 rounded-xl border border-slate-200 p-2.5 text-xs font-mono focus:outline-none focus:border-[#FE5E37]"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Type plan name..."
              />
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAction('')}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              disabled={
                busy ||
                (highImpact && name !== info?.name) ||
                (action === 'cancel' ? !operation?.cancelAllowed : !actionsList.includes(action))
              }
              onClick={submit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FE5E37] text-white hover:bg-[#e04f2c] font-bold text-xs transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={14} className="fill-current" />
              <span>Confirm {labels[action]}</span>
            </button>
          </div>

          {error && <ErrorState title="Operation not confirmed" message={error} retry={load} />}
        </div>
      </div>
    )}
  </div>
 );
}
