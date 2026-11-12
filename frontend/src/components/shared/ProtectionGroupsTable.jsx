import Button from './Button';
import { directionalObjectForPair, pairForObject, srmMutation, waitSrmOperation } from '../../api/srmOperations';
import {trackBackgroundOperation} from '../../api/backgroundOperations';
import React, { useState, useMemo, useEffect } from 'react';
import { Pencil, Plus, Trash2, AlertCircle, ChevronRight, FileText, Monitor, X } from 'lucide-react';
import { formatNullable } from '../../utils/formatters';
import { StatusPill } from './Pills';
import apiClient from '../../api/apiClient';
import useDialogFocus from '../../hooks/useDialogFocus';
import {safeErrorMessage} from '../../utils/safeErrorMessage';
import {validateVmwareObjectName} from '../../utils/vmwareObjectName';

function protectionTypeLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'HBR') return 'Individual VMs';
  if (normalized === 'ABR') return 'Datastore groups';
  if (['VVOL', 'VVOL_REPLICATION'].includes(normalized)) return 'vSphere Virtual Volumes';
  return normalized
    ? normalized.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())
    : null;
}

const protectedVmId=vm=>String(typeof vm==='string'?vm:(vm?.protected_vm_id||vm?.protectedVmId||vm?.vm_id||vm?.id||''));
const protectedVmName=(vm,index=0)=>typeof vm==='string'?vm:(vm?.vm_name||vm?.name||vm?.protected_vm_name||`VM ${index+1}`);

function InlineVirtualMachineEditor({group,pairId,currentVms,disabled,onUpdated}) {
  const [addOpen,setAddOpen]=useState(false);
  const [options,setOptions]=useState([]);
  const [selectedId,setSelectedId]=useState('');
  const [loadingOptions,setLoadingOptions]=useState(false);
  const [pendingRemoval,setPendingRemoval]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const groupId=group.protectionGroupId||group.id;
  const currentIds=[...new Set(currentVms.map(protectedVmId).filter(Boolean))];
  const addableVms=options.filter(vm=>vm?.id&&!currentIds.includes(String(vm.id)));

  const toggleAdd=async()=>{
    const next=!addOpen;
    setAddOpen(next);setError('');
    if(!next||options.length||loadingOptions||!pairId)return;
    setLoadingOptions(true);
    try{
      const response=await apiClient.get(`/srm/pairings/${pairId}/options`);
      const rows=response.data?.data?.vms||[];
      setOptions(Array.isArray(rows)?rows:[]);
    }catch(reason){
      setError(safeErrorMessage(reason,'Unable to load available replicated VMs.'));
    }finally{setLoadingOptions(false);}
  };

  const changeMembership=async(action,vmId)=>{
    if(!groupId||!pairId||submitting||disabled)return;
    setSubmitting(true);setError('');
    try{
      const response=await srmMutation.post(`/srm/protection-groups/${encodeURIComponent(groupId)}/members`,{
        pairId:Number(pairId),action,vmId,confirmed:true
      });
      const operationId=response.data?.data?.operationId;
      if(operationId){
        const vm=options.find(item=>String(item.id)===String(vmId))||currentVms.find(item=>protectedVmId(item)===String(vmId));
        const name=protectedVmName(vm);
        trackBackgroundOperation({
          id:operationId,provider:'SRM',label:`${action==='add'?'Add':'Remove'} virtual machine ${name}`,
          resourceKey:`protection-group:${pairId}:${groupId}`,
          entityType:'Protection group',entityName:group.name,action:action==='add'?'add virtual machine':'remove virtual machine'
        });
        await waitSrmOperation(operationId);
      }
      setSelectedId('');setAddOpen(false);
      onUpdated?.();
    }catch(reason){
      setError(safeErrorMessage(reason,`Unable to ${action} the virtual machine.`));
    }finally{setSubmitting(false);}
  };

  return <div className="space-y-3">
    {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div>}
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900"><Monitor size={15} className="text-[#FE5E37]"/>Virtual machines</h3>
      <button type="button" disabled={disabled||submitting} onClick={toggleAdd} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="Add virtual machine"><Plus size={13}/>Add VM</button>
    </div>
    {addOpen&&(
      <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <select value={selectedId} disabled={disabled||submitting||loadingOptions||addableVms.length===0} onChange={event=>setSelectedId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-orange-500 focus:outline-none disabled:opacity-50">
          <option value="">{loadingOptions?'Loading available replicated VMs...':addableVms.length?'Select a virtual machine to add...':'No compatible replicated VMs available'}</option>
          {addableVms.map(vm=><option key={vm.id} value={vm.id}>{vm.name||vm.id}</option>)}
        </select>
        <button type="button" disabled={disabled||submitting||!selectedId} onClick={()=>changeMembership('add',selectedId)} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={14}/>{submitting?'Loading...':'Add'}</button>
      </div>
    )}
    {currentVms.length===0?(
      <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-500">No virtual machines found.</p>
    ):(
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {currentVms.map((vm,index)=>{const id=protectedVmId(vm),name=protectedVmName(vm,index),status=typeof vm==='object'?(vm.normalized_protection_status||vm.protection_status||vm.raw_protection_status||vm.status||'UNKNOWN'):'UNKNOWN';return <div key={id||name} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{name}</span>
          <StatusPill status={status}/>
          <Button type="button" variant="orange-outline" disabled={disabled||submitting||!id} onClick={()=>setPendingRemoval({id,name})} title={`Remove ${name} from protection group`} aria-label={`Remove ${name} from protection group`} className="shrink-0 p-1.5 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={14}/></Button>
        </div>;})}
      </div>
    )}
    {pendingRemoval&&(
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)setPendingRemoval(null);}}>
        <div role="dialog" aria-modal="true" aria-labelledby="remove-vm-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <h4 id="remove-vm-title" className="text-sm font-bold text-slate-900">Remove virtual machine?</h4>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={()=>setPendingRemoval(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={()=>{const id=pendingRemoval.id;setPendingRemoval(null);changeMembership('remove',id);}} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">Remove virtual machine</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

export default function ProtectionGroupsTable({ 
  groups, 
  loading = false,
  user,
  sitePairs = [],
  recoveryPlans = [],
  onDelete,
  onRefresh,
  emptyMessage = "No protection groups in SRM" 
}) {
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const [groupDetails, setGroupDetails] = useState({});
  const [configuringGroupId, setConfiguringGroupId] = useState(null);
  const [actionToast, setActionToast] = useState(null);
  const [renameTarget,setRenameTarget]=useState(null);
  const [renameName,setRenameName]=useState('');
  const [renameError,setRenameError]=useState('');
  const [renameSubmitting,setRenameSubmitting]=useState(false);
  const renameDialogRef=useDialogFocus(Boolean(renameTarget),()=>{if(!renameSubmitting)setRenameTarget(null);});

  const canonicalList = useMemo(() => Array.isArray(groups) ? groups : (groups?.canonicalGroups || groups?.observations || []), [groups]);

  const canEdit = ['ADMIN', 'OPERATOR'].includes(user?.role);
  const canDelete = user?.role === 'ADMIN';

  const openRename=group=>{
    setRenameTarget(group);
    setRenameName(group.name||'');
    setRenameError('');
  };

  const submitRename=async event=>{
    event.preventDefault();
    if(!renameTarget||renameSubmitting)return;
    const nameError=validateVmwareObjectName(renameName);
    if(nameError){setRenameError(nameError);return;}
    const nextName=renameName.trim();
    if(nextName===String(renameTarget.name||'').trim()){setRenameTarget(null);return;}
    const targetId=renameTarget.protectionGroupId||renameTarget.id;
    const pairId=pairForObject(sitePairs,renameTarget);
    if(!targetId||!pairId){setRenameError('Protection group identity is unavailable.');return;}
    setRenameSubmitting(true);setRenameError('');
    try{
      const response=await srmMutation.post(`/srm/protection-groups/${encodeURIComponent(targetId)}/reconfigure`,{
        pairId:Number(pairId),name:nextName,confirmed:true
      });
      const operationId=response.data?.data?.operationId;
      if(operationId){
        trackBackgroundOperation({
          id:operationId,provider:'SRM',label:`Rename protection group ${nextName}`,
          resourceKey:`protection-group:${pairId}:${targetId}`,
          entityType:'Protection group',entityName:nextName,action:'rename'
        });
        await waitSrmOperation(operationId);
      }
      setRenameTarget(null);
      onRefresh?.();
    }catch(reason){
      setRenameError(safeErrorMessage(reason,'Unable to rename the protection group.'));
    }finally{
      setRenameSubmitting(false);
    }
  };

  useEffect(() => {
    setExpandedGroupId(null);
    setGroupDetails({});
  }, [canonicalList, recoveryPlans]);

  const recoveryPlansForGroup = (group) => {
    const directPlans = group.recoveryPlans || group.recovery_plans || [];
    if (directPlans.length > 0) return directPlans;

    const targetId = String(group.protectionGroupId || group.protection_group_id || group.id || '');
    const targetName = String(group.name || group.protectionGroupName || group.protection_group_name || '');
    return recoveryPlans.filter(plan => {
      const ids = plan.protectionGroupIds || plan.protection_group_ids || [];
      const names = plan.protectionGroupNames || plan.protection_group_names || [];
      const linkedGroups = plan.protectionGroups || plan.groups || [];
      return ids.some(id => String(id) === targetId)
        || names.some(name => String(name) === targetName)
        || linkedGroups.some(linked => {
          if (typeof linked === 'string') return linked === targetId || linked === targetName;
          const linkedId = linked.id || linked.protection_group_id || linked.protectionGroupId;
          const linkedName = linked.name || linked.protection_group_name || linked.protectionGroupName;
          return String(linkedId || '') === targetId || String(linkedName || '') === targetName;
        });
    });
  };

  const toggleGroupDetails = async (group, groupId) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
      return;
    }

    setExpandedGroupId(groupId);
    if (groupDetails[groupId]) return;

    const initialVms = group.protectedVms || group.protected_vms || group.vms || [];
    const plans = recoveryPlansForGroup(group);
    const apiGroupId = group.protectionGroupId || group.protection_group_id || group.id;
    if (!apiGroupId) {
      setGroupDetails(current => ({
        ...current,
        [groupId]: { vms: initialVms, plans, loading: false, error: 'Protection group identity is unavailable.' }
      }));
      return;
    }

    setGroupDetails(current => ({
      ...current,
      [groupId]: { vms: initialVms, plans, loading: true, error: '' }
    }));
    try {
      const response = await apiClient.get(`/srm/protection-groups/${encodeURIComponent(apiGroupId)}/vms`);
      const fetched = Array.isArray(response.data?.data)
        ? response.data.data.filter(vm => vm.is_present !== false)
        : [];
      setGroupDetails(current => ({
        ...current,
        [groupId]: { vms: fetched.length > 0 ? fetched : initialVms, plans, loading: false, error: '' }
      }));
    } catch {
      setGroupDetails(current => ({
        ...current,
        [groupId]: {
          vms: current[groupId]?.vms || initialVms,
          plans,
          loading: false,
          error: 'Unable to load all virtual machines for this protection group.'
        }
      }));
    }
  };

  const handleConfigureAllVms = async (group) => {
    group = directionalObjectForPair(sitePairs, group);
    const groupId = group.protectionGroupId || group.id;
    if (!groupId || configuringGroupId) return;
    setConfiguringGroupId(groupId);
    setActionToast(null);
    try {
      const candidate = pairForObject(sitePairs, group) || group.pairId || group.pairing_row_id;
      const pairId = Number.isInteger(Number(candidate)) && Number(candidate) > 0 ? Number(candidate) : undefined;
      await apiClient.post(`/srm/protection-groups/${encodeURIComponent(groupId)}/configure-all-vms`, {
        pairId
      }, {
        headers: { 'Idempotency-Key': `pg-cfgall-${Date.now()}` }
      });
      onRefresh?.();
    } catch (err) {
      const msg = err.response?.data?.safeMessage || err.response?.data?.error?.safeMessage || err.message || 'Failed to configure VMs.';
      setActionToast({
        type: 'error',
        text: `Unable to configure VMs: ${msg}`
      });
    } finally {
      setConfiguringGroupId(null);
    }
  };

  return (
    <div className="space-y-3">
      {actionToast && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800 shadow-2xs transition-all">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-rose-600" />
            <span>{actionToast.text}</span>
          </div>
          <button type="button" onClick={() => setActionToast(null)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50/70 border-b border-slate-200 text-xs font-bold text-slate-800">
              <tr>
                <th className="px-5 py-3.5">Name</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Direction</th>
                <th className="px-4 py-3.5 text-center">Virtual machines</th>
                <th className="px-4 py-3.5 text-center">Recovery plans</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {canonicalList.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    {loading ? (
                      'Loading...'
                    ) : (
                      emptyMessage
                    )}
                  </td>
                </tr>
              )}
              {canonicalList.map((g, idx) => {
                const operationalGroup = directionalObjectForPair(sitePairs, g);
                const groupId = operationalGroup.protectionGroupId || operationalGroup.id || g.groupId || g.id || idx;
                const vms = operationalGroup.protectedVmCount ?? operationalGroup.vmCount ?? (operationalGroup.protectedVms ? operationalGroup.protectedVms.length : (operationalGroup.vms ? operationalGroup.vms.length : 0));
                const rpCount = operationalGroup.recoveryPlanCount ?? (operationalGroup.recoveryPlans ? operationalGroup.recoveryPlans.length : 0);
                const protectionType = protectionTypeLabel(operationalGroup.protectionType || operationalGroup.replicationType || operationalGroup.type);
                const protectedSite = operationalGroup.protectedSiteName || operationalGroup.protectedSite || operationalGroup.protectedVcenterName || operationalGroup.sourceSiteName;
                const recoverySite = operationalGroup.recoverySiteName || operationalGroup.recoverySite || operationalGroup.recoveryVcenterName || operationalGroup.targetSiteName;
                const statusVal = operationalGroup.protectionStatus || operationalGroup.normalizedStatus || operationalGroup.status || 'OK';
                const isConfiguring = configuringGroupId === groupId;
                const isExpanded = expandedGroupId === groupId;
                const details = groupDetails[groupId] || {vms:[],plans:[],loading:false,error:''};

                return (
                  <React.Fragment key={groupId}>
                  <tr className={`transition-colors ${isExpanded?'bg-slate-50':'hover:bg-slate-50/60'}`}>
                    <td className="px-5 py-4 font-semibold text-slate-900 align-middle">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => toggleGroupDetails(operationalGroup,groupId)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
                          aria-expanded={isExpanded}
                          aria-controls={`protection-group-details-${groupId}`}
                          aria-label={`${isExpanded?'Hide':'Show'} recovery plans and virtual machines for protection group ${operationalGroup.name}`}
                          title={`${isExpanded?'Hide':'Show'} recovery plans and virtual machines`}
                        >
                          <ChevronRight size={16} className={`transition-transform ${isExpanded?'rotate-90':''}`} />
                        </button>
                        <span className="block max-w-xs truncate text-sm font-semibold text-slate-900" title={operationalGroup.name}>{formatNullable(operationalGroup.name)}</span>
                        {canEdit&&(
                          <button
                            type="button"
                            disabled={isConfiguring||renameSubmitting}
                            onClick={()=>openRename(operationalGroup)}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
                            title={isConfiguring?'Protection configuration in progress':'Rename protection group'}
                            aria-label={`Rename protection group ${operationalGroup.name}`}
                          >
                            <Pencil size={13}/>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <StatusPill status={statusVal} />
                    </td>
                    <td className="px-5 py-4 align-middle font-medium text-slate-600">
                      {formatNullable(protectionType, 'vSphere Replication')}
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className="font-semibold text-slate-800">{formatNullable(protectedSite, 'Primary site')}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-semibold text-slate-800">{formatNullable(recoverySite, 'Recovery site')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700 shadow-2xs">
                        <span>{vms}</span>
                        <span className="text-[11px] font-sans text-slate-500 font-normal">
                          {vms === 1 ? 'VM' : 'VMs'}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-4 align-middle text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700 shadow-2xs">
                        <span>{rpCount}</span>
                        <span className="text-[11px] font-sans text-slate-500 font-normal">
                          {rpCount === 1 ? 'Plan' : 'Plans'}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-4 align-middle text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {canEdit && (
                          <Button
                            type="button"
                            variant="success"
                            disabled={isConfiguring}
                            onClick={() => handleConfigureAllVms(operationalGroup)}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs cursor-pointer"
                            title="Configure protection and placeholder VMs for all virtual machines in this group"
                          >
                            <span>{isConfiguring ? "Loading..." : "Configure all VMs"}</span>
                          </Button>
                        )}
                        {canEdit && canDelete && (
                          <div className="h-4 w-px bg-slate-200 mx-0.5" />
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="orange-outline"
                            aria-label="Delete protection group"
                            onClick={() => onDelete?.(operationalGroup)}
                            title="Delete protection group"
                            className="p-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr id={`protection-group-details-${groupId}`} className="bg-slate-50/70">
                      <td colSpan="7" className="px-5 py-5">
                        {details.loading ? (
                          <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-xs font-medium text-slate-500">
                            Loading recovery plans and virtual machines...
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {details.error && (
                              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                {details.error}
                              </div>
                            )}
                            <div className="grid gap-4 lg:grid-cols-2">
                              <section className="order-2 rounded-xl border border-slate-200 bg-white p-4" aria-label={`Recovery plans for ${operationalGroup.name}`}>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900"><FileText size={15} className="text-[#FE5E37]" />Recovery plans</h3>
                                </div>
                                {details.plans.length === 0 ? (
                                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-500">No recovery plans found.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {details.plans.map((plan,index) => {
                                      const planName=typeof plan==='string'?plan:(plan.name||plan.recoveryPlanName||plan.recovery_plan_name||`Plan ${index+1}`);
                                      const planStatus=typeof plan==='object'?(plan.normalizedStatus||plan.normalized_status||plan.rawStatus||plan.raw_status||plan.status||'READY_STATE'):'READY_STATE';
                                      return (
                                        <div key={plan.id||plan.recovery_plan_id||plan.recoveryPlanId||planName} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                          <span className="truncate text-xs font-semibold text-slate-800">{planName}</span>
                                          <StatusPill status={planStatus} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </section>
                              <section className="order-1 rounded-xl border border-slate-200 bg-white p-4" aria-label={`Virtual machines for ${operationalGroup.name}`}>
                                {canEdit?(
                                  <InlineVirtualMachineEditor group={operationalGroup} pairId={pairForObject(sitePairs,operationalGroup)} currentVms={details.vms} disabled={isConfiguring} onUpdated={onRefresh}/>
                                ):(<><div className="mb-3 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xs font-bold text-slate-900"><Monitor size={15} className="text-[#FE5E37]"/>Virtual machines</h3></div>{details.vms.length===0?(
                                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-500">No virtual machines found.</p>
                                ):(<div className="max-h-72 space-y-2 overflow-y-auto pr-1">{details.vms.map((vm,index)=>{const name=protectedVmName(vm,index),status=typeof vm==='object'?(vm.normalized_protection_status||vm.protection_status||vm.raw_protection_status||vm.status||'UNKNOWN'):'UNKNOWN';return <div key={protectedVmId(vm)||name} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><span className="truncate text-xs font-semibold text-slate-800">{name}</span><StatusPill status={status}/></div>;})}</div>)}</>)}
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
      </div>

      {renameTarget&&(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={event=>{if(event.target===event.currentTarget&&!renameSubmitting)setRenameTarget(null);}}>
          <form ref={renameDialogRef} role="dialog" aria-modal="true" aria-labelledby="rename-group-title" onSubmit={submitRename} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h4 id="rename-group-title" className="text-sm font-bold text-slate-900">Rename protection group</h4>
            <label htmlFor="protection-group-name" className="mt-4 block text-xs font-semibold text-slate-700">Protection group name</label>
            <input id="protection-group-name" autoFocus maxLength={80} value={renameName} onChange={event=>{setRenameName(event.target.value);setRenameError('');}} disabled={renameSubmitting} className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 focus:border-orange-500 focus:outline-none disabled:opacity-50"/>
            {renameError&&<p role="alert" className="mt-2 text-[11px] text-red-600">{renameError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={renameSubmitting} onClick={()=>setRenameTarget(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={renameSubmitting||Boolean(validateVmwareObjectName(renameName))||renameName.trim()===String(renameTarget.name||'').trim()} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40">{renameSubmitting?'Renaming...':'Save name'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
