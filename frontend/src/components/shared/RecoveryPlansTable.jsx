import RecoveryExecution from './RecoveryExecution';
import Button from './Button';
import {pairForObject,directionalObjectForPair,operationTargetsForObject,srmMutation,waitSrmOperation} from '../../api/srmOperations';
import {trackBackgroundOperation} from '../../api/backgroundOperations';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, Monitor, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { Link } from '../../router';
import apiClient from '../../api/apiClient';
import useDialogFocus from '../../hooks/useDialogFocus';

import StaleDataBanner from './StaleDataBanner';
import { formatNullable } from '../../utils/formatters';
import { StatusPill } from './Pills';
import {safeErrorMessage} from '../../utils/safeErrorMessage';
import {matchesPairDirection} from '../../utils/srmPairDirection';
import {validateVmwareObjectName} from '../../utils/vmwareObjectName';

const protectionGroupId = group => String(typeof group === 'string' ? group : (group?.protectionGroupId || group?.protection_group_id || group?.id || ''));

function InlineProtectionGroupEditor({plan,pairId,sitePairs,protectionGroups,currentGroups,disabled,onUpdated}) {
  const [selectedId,setSelectedId]=useState('');
  const [addOpen,setAddOpen]=useState(false);
  const [pendingRemoval,setPendingRemoval]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const activePair=sitePairs.find(pair=>String(pair.id)===String(pairId));
  const currentIds=[...new Set(currentGroups.map(protectionGroupId).filter(Boolean))];
  const availableGroups=[...new Map((protectionGroups||[]).filter(group=>protectionGroupId(group)).map(group=>[protectionGroupId(group),group])).values()]
    .filter(group=>String(pairForObject(sitePairs,group))===String(pairId)&&matchesPairDirection(group,activePair));
  const addableGroups=availableGroups.filter(group=>!currentIds.includes(protectionGroupId(group)));
  const targetId=plan.recoveryPlanId||plan.id;

  const changeMembership=async(action,groupId)=>{
    if(!targetId||!pairId||submitting||disabled)return;
    setSubmitting(true);setError('');
    try{
      const response=await srmMutation.post(`/srm/recovery-plans/${encodeURIComponent(targetId)}/protection-groups`,{
        pairId:Number(pairId),action,protectionGroupId:groupId,confirmed:true
      });
      const operationId=response.data?.data?.operationId;
      if(operationId){
        trackBackgroundOperation({
          id:operationId,
          provider:'SRM',
          label:`${action==='add'?'Add':'Remove'} protection group ${groupId}`,
          resourceKey:`recovery-plan:${pairId}:${targetId}`,
          entityType:'Recovery plan',
          entityName:plan.name,
          action:action==='add'?'add protection group':'remove protection group'
        });
        await waitSrmOperation(operationId);
      }
      setSelectedId('');
      onUpdated?.();
    }catch(reason){
      setError(safeErrorMessage(reason,`Unable to ${action} the protection group.`));
    }finally{setSubmitting(false);}
  };

  return (
    <div className="space-y-3">
      {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div>}
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900"><Shield size={15} className="text-indigo-600"/>Protection groups</h3>
        <div className="flex items-center gap-2">
          <button type="button" disabled={disabled||submitting||addableGroups.length===0} title={addableGroups.length===0?'No compatible protection groups are available to add.':'Add protection group'} onClick={()=>setAddOpen(value=>!value)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13}/>Add PG</button>
        </div>
      </div>
      {addOpen&&addableGroups.length>0&&(
        <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <select value={selectedId} disabled={disabled||submitting} onChange={event=>setSelectedId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-50">
            <option value="">Select a protection group to add...</option>
            {addableGroups.map(group=><option key={protectionGroupId(group)} value={protectionGroupId(group)}>{group.name}</option>)}
          </select>
          <button type="button" disabled={disabled||submitting||!selectedId} onClick={()=>changeMembership('add',selectedId)} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={14}/>{submitting?'Loading...':'Add'}</button>
        </div>
      )}
      {currentGroups.length===0?(
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-500">No protection groups attached.</p>
      ):(
        <div className="space-y-2">
          {currentGroups.map((group,index)=>{
            const id=protectionGroupId(group);
            const name=typeof group==='string'?group:(group.name||group.protection_group_name||group.protectionGroupName||`Group ${index+1}`);
            return <div key={id||name} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="truncate text-xs font-semibold text-slate-800">{name}</span>
              <Button type="button" variant="orange-outline" disabled={disabled||submitting||!id} onClick={()=>setPendingRemoval({id,name})} title={`Remove ${name} from recovery plan`} aria-label={`Remove ${name} from recovery plan`} className="shrink-0 p-1.5 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={14}/></Button>
            </div>;
          })}
        </div>
      )}
      {pendingRemoval&&(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)setPendingRemoval(null);}}>
          <div role="dialog" aria-modal="true" aria-labelledby="remove-pg-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h4 id="remove-pg-title" className="text-sm font-bold text-slate-900">Remove protection group?</h4>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={()=>setPendingRemoval(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={()=>{const id=pendingRemoval.id;setPendingRemoval(null);changeMembership('remove',id);}} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">Remove protection group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecoveryPlansTable({ 
  plans, 
  user,
  sitePairs=[],
  protectionGroups=[],
  actionsRevision=0,
  onUpdated,
  onDelete,
  loading, 
  error, 
  mode = 'full', 
  stale = false, 
  staleMessage = 'Data may be stale', 
  emptyMessage = 'No recovery plans in SRM' 
}) {
  const [expandedPlanKey, setExpandedPlanKey] = useState(null);
  const [planDetails, setPlanDetails] = useState({});
  const [lockedPlans, setLockedPlans] = useState({});
  const [executionStatuses, setExecutionStatuses] = useState({});
  const [renameTarget,setRenameTarget]=useState(null);
  const [renameName,setRenameName]=useState('');
  const [renameError,setRenameError]=useState('');
  const [renameSubmitting,setRenameSubmitting]=useState(false);
  const renameDialogRef=useDialogFocus(Boolean(renameTarget),()=>{if(!renameSubmitting)setRenameTarget(null);});
  const setPlanLocked=useCallback((key,locked,status)=>{
    setLockedPlans(current=>current[key]===locked?current:{...current,[key]:locked});
    setExecutionStatuses(current => {
      const nextStatus = locked ? status : null;
      if ((current[key] || null) === nextStatus) return current;
      const next = {...current};
      if (nextStatus) next[key] = nextStatus;
      else delete next[key];
      return next;
    });
  },[]);

  const canonicalList = useMemo(() => Array.isArray(plans) ? plans : (plans?.canonicalPlans || plans?.observations || []), [plans]);
  const displayData = mode === 'summary' ? canonicalList.slice(0, 5) : canonicalList;

  const canEdit = ['ADMIN', 'OPERATOR'].includes(user?.role);
  const canDelete = user?.role === 'ADMIN';

  const openRename=(plan,pairId,planKey)=>{
    setRenameTarget({plan,pairId,planKey});
    setRenameName(plan.name||'');
    setRenameError('');
  };

  const submitRename=async event=>{
    event.preventDefault();
    if(!renameTarget||renameSubmitting)return;
    const nameError=validateVmwareObjectName(renameName);
    if(nameError){setRenameError(nameError);return;}
    const nextName=renameName.trim();
    if(nextName===String(renameTarget.plan.name||'').trim()){setRenameTarget(null);return;}
    const targetId=renameTarget.plan.recoveryPlanId||renameTarget.plan.id;
    if(!targetId||!renameTarget.pairId){setRenameError('Recovery plan identity is unavailable.');return;}
    setRenameSubmitting(true);setRenameError('');
    setPlanLocked(renameTarget.planKey,true,'Renaming');
    try{
      const response=await srmMutation.post(`/srm/recovery-plans/${encodeURIComponent(targetId)}/reconfigure`,{
        pairId:Number(renameTarget.pairId),name:nextName,confirmed:true
      });
      const operationId=response.data?.data?.operationId;
      if(operationId){
        trackBackgroundOperation({
          id:operationId,provider:'SRM',label:`Rename recovery plan ${nextName}`,
          resourceKey:`recovery-plan:${renameTarget.pairId}:${targetId}`,
          entityType:'Recovery plan',entityName:nextName,action:'rename'
        });
        await waitSrmOperation(operationId);
      }
      setRenameTarget(null);
      onUpdated?.();
    }catch(reason){
      setRenameError(safeErrorMessage(reason,'Unable to rename the recovery plan.'));
    }finally{
      setRenameSubmitting(false);
      setPlanLocked(renameTarget.planKey,false);
    }
  };

  useEffect(() => {
    setExpandedPlanKey(null);
    setPlanDetails({});
  }, [actionsRevision]);

  const togglePlanDetails = useCallback(async (plan, operationalPlan, planKey) => {
    if (expandedPlanKey === planKey) {
      setExpandedPlanKey(null);
      return;
    }

    setExpandedPlanKey(planKey);
    if (planDetails[planKey]) return;

    const names = [...new Set(plan.protectionGroupNames || [])];
    const ids = [...new Set(plan.protectionGroupIds || [])];
    const fallbackGroups = (ids.length ? ids : names).map((value, index) => ids.length
      ? { id: value, name: names[index] || value }
      : { name: value });
    const planId = operationalPlan.recoveryPlanId || operationalPlan.id;

    if (!planId) {
      setPlanDetails(current => ({
        ...current,
        [planKey]: { groups: fallbackGroups, vms: [], loading: false, error: 'Recovery plan identity is unavailable.' }
      }));
      return;
    }

    setPlanDetails(current => ({
      ...current,
      [planKey]: { groups: fallbackGroups, vms: [], loading: true, error: '' }
    }));

    try {
      const groupsResponse = await apiClient.get(`/srm/recovery-plans/${encodeURIComponent(planId)}/protection-groups`);
      const groupsData = Array.isArray(groupsResponse.data?.data)
        ? groupsResponse.data.data.filter(group => group.is_present !== false)
        : [];
      const groups = groupsData.length > 0
        ? [...new Map(groupsData.map(group => [
          String(group.protection_group_id || group.id || group.protectionGroupId || group.name), group
        ])).values()]
        : fallbackGroups;

      const groupVms = await Promise.all(groups.map(async group => {
        const groupId = group.protection_group_id || group.id || group.protectionGroupId;
        if (!groupId) return [];
        const response = await apiClient.get(`/srm/protection-groups/${encodeURIComponent(groupId)}/vms`);
        const data = Array.isArray(response.data?.data) ? response.data.data : [];
        return data.filter(vm => vm.is_present !== false).map(vm => ({
          ...vm,
          name: vm.vm_name || vm.name || vm.protected_vm_id || vm.vm_id,
          groupName: group.name || group.protection_group_name || group.protectionGroupName || groupId
        }));
      }));
      const uniqueVms = [...new Map(groupVms.flat().map(vm => [
        String(vm.protected_vm_id || vm.vm_id || vm.name), vm
      ])).values()];

      setPlanDetails(current => ({
        ...current,
        [planKey]: { groups, vms: uniqueVms, loading: false, error: '' }
      }));
    } catch {
      setPlanDetails(current => ({
        ...current,
        [planKey]: {
          groups: current[planKey]?.groups || fallbackGroups,
          vms: current[planKey]?.vms || [],
          loading: false,
          error: 'Unable to load all protection groups and virtual machines for this recovery plan.'
        }
      }));
    }
  }, [expandedPlanKey, planDetails]);

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm relative">
      {stale && <StaleDataBanner message={staleMessage} />}
        <div className="overflow-x-auto lg:overflow-visible">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-500 tracking-wider">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Protected site</th>
                <th className="px-6 py-4">Recovery site</th>
                <th className="px-6 py-4 text-center">Protection groups</th>
                <th className="px-6 py-4">VMs</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {displayData.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    {loading ? (
                      'Loading...'
                    ) : error ? (
                      'Unable to load recovery plans.'
                    ) : (
                      emptyMessage
                    )}
                  </td>
                </tr>
              )}
              {displayData.map(plan => {
                const pgs = plan.protectionGroups || plan.groups || [];
                const uniquePgIds = [...new Set((plan.protectionGroupIds || []).filter(Boolean))];
                const pgCount = uniquePgIds.length || plan.protectionGroupCount || pgs.length;
                const operationalPlan=directionalObjectForPair(sitePairs,plan);
                const executionTargets=operationTargetsForObject(sitePairs,plan);
                const editPairId=pairForObject(sitePairs,operationalPlan);
                const planKey=plan.canonicalKey || plan.rowKey || plan.recoveryPlanId || plan.id;
                const writeLocked=Boolean(lockedPlans[planKey]);
                const isExpanded=expandedPlanKey===planKey;
                const details=planDetails[planKey] || {groups:[],vms:[],loading:false,error:''};
                return (
                  <React.Fragment key={planKey}>
                  <tr className={`transition-colors ${isExpanded?'bg-slate-50':'hover:bg-slate-50/70'}`}>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => togglePlanDetails(plan,operationalPlan,planKey)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                          aria-expanded={isExpanded}
                          aria-controls={`recovery-plan-details-${planKey}`}
                          aria-label={`${isExpanded?'Hide':'Show'} protection groups and virtual machines for recovery plan ${plan.name}`}
                          title={`${isExpanded?'Hide':'Show'} protection groups and virtual machines`}
                        >
                          <ChevronRight size={16} className={`transition-transform ${isExpanded?'rotate-90':''}`} />
                        </button>
                        <span className="truncate max-w-xs" title={plan.name}>{formatNullable(plan.name)}</span>
                        {canEdit&&(
                          <button
                            type="button"
                            disabled={writeLocked||!editPairId}
                            onClick={()=>openRename(operationalPlan,editPairId,planKey)}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                            title={writeLocked?'Recovery operation in progress':!editPairId?'Waiting for site pairing':'Rename recovery plan'}
                            aria-label={`Rename recovery plan ${plan.name}`}
                          >
                            <Pencil size={13}/>
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={executionStatuses[planKey] || plan.normalizedStatus || plan.rawStatus || plan.status || 'UNKNOWN'} />
                    </td>
                    <td className="px-6 py-4 text-slate-700 font-medium">
                      {formatNullable(plan.protectedSiteName || plan.protectedSite, 'Primary site')}
                    </td>
                    <td className="px-6 py-4 text-slate-700 font-medium">
                      {formatNullable(plan.recoverySiteName || plan.recoverySite, 'Recovery site')}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700 shadow-2xs">
                        <span>{pgCount}</span>
                        <span className="text-[11px] font-sans text-slate-500 font-normal">
                          {pgCount === 1 ? 'Group' : 'Groups'}
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {plan.vmCount == null ? (
                        <span className="text-slate-400">Unavailable</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs">
                          <span>{plan.vmCount}</span>
                          <span className="text-[11px] font-normal text-slate-500">
                            {Number(plan.vmCount) === 1 ? 'VM' : 'VMs'}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 justify-end">
                        {canEdit && (
                          <RecoveryExecution actionsRevision={actionsRevision} plan={operationalPlan} pairId={pairForObject(sitePairs,operationalPlan)} targets={executionTargets} onUpdated={onUpdated} onLockChange={setPlanLocked} lockKey={planKey} userRole={user?.role} disabled={writeLocked}/>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="orange-outline"
                            disabled={writeLocked || !editPairId}
                            onClick={() => { if(!writeLocked && editPairId) onDelete?.(operationalPlan); }}
                            title={writeLocked?'Recovery operation in progress':!editPairId?'Waiting for site pairing':'Delete recovery plan'}
                            aria-label="Delete recovery plan"
                            className="p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr id={`recovery-plan-details-${planKey}`} className="bg-slate-50/70">
                      <td colSpan="7" className="px-6 py-5">
                        {details.loading ? (
                          <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-xs font-medium text-slate-500">
                            Loading protection groups and virtual machines...
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {details.error && (
                              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                {details.error}
                              </div>
                            )}
                            <div className="grid gap-4 lg:grid-cols-2">
                              <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={`Protection groups for ${plan.name}`}>
                                {canEdit?(
                                  <InlineProtectionGroupEditor plan={operationalPlan} pairId={editPairId} sitePairs={sitePairs} protectionGroups={protectionGroups} currentGroups={details.groups} disabled={writeLocked||!editPairId} onUpdated={onUpdated}/>
                                ):(<><div className="mb-3 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xs font-bold text-slate-900"><Shield size={15} className="text-indigo-600"/>Protection groups</h3></div>{details.groups.length===0?(
                                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-500">No protection groups found.</p>
                                ):(
                                  <div className="space-y-2">{details.groups.map((group,index)=>{const groupName=typeof group==='string'?group:(group.name||group.protection_group_name||group.protectionGroupName||`Group ${index+1}`);return <div key={protectionGroupId(group)||groupName} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800">{groupName}</div>;})}</div>
                                )}</>)}
                              </section>
                              <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={`Virtual machines for ${plan.name}`}>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900"><Monitor size={15} className="text-indigo-600" />Virtual machines</h3>
                                </div>
                                {details.vms.length === 0 ? (
                                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-500">No virtual machines found.</p>
                                ) : (
                                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                    {details.vms.map((vm,index) => (
                                      <div key={vm.protected_vm_id||vm.vm_id||vm.name||index} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                        <div className="min-w-0">
                                          <p className="truncate text-xs font-semibold text-slate-800">{formatNullable(vm.name)}</p>
                                          <p className="truncate text-[10px] text-slate-500">{formatNullable(vm.groupName,'Protection group unavailable')}</p>
                                        </div>
                                        <StatusPill status={vm.normalized_protection_status||vm.raw_protection_status||'UNKNOWN'} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

      {mode === 'summary' && displayData.length > 0 && (
        <div className="border-t border-slate-100 px-6 py-3 text-right">
          <Link to="/recovery-plans" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
            View all plans <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {renameTarget&&(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={event=>{if(event.target===event.currentTarget&&!renameSubmitting)setRenameTarget(null);}}>
          <form ref={renameDialogRef} role="dialog" aria-modal="true" aria-labelledby="rename-plan-title" onSubmit={submitRename} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h4 id="rename-plan-title" className="text-sm font-bold text-slate-900">Rename recovery plan</h4>
            <label htmlFor="recovery-plan-name" className="mt-4 block text-xs font-semibold text-slate-700">Plan name</label>
            <input id="recovery-plan-name" autoFocus maxLength={80} value={renameName} onChange={event=>{setRenameName(event.target.value);setRenameError('');}} disabled={renameSubmitting} className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-50"/>
            {renameError&&<p role="alert" className="mt-2 text-[11px] text-red-600">{renameError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={renameSubmitting} onClick={()=>setRenameTarget(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={renameSubmitting||Boolean(validateVmwareObjectName(renameName))||renameName.trim()===String(renameTarget.plan.name||'').trim()} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40">{renameSubmitting?'Renaming...':'Save name'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
