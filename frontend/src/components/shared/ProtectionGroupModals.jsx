import useDialogFocus from '../../hooks/useDialogFocus';
import {displayName} from '../../utils/displayNames';
import Button from './Button';
import { srmMutation, waitSrmOperation, pairForObject } from '../../api/srmOperations';
import { trackBackgroundOperation } from '../../api/backgroundOperations';
import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Plus } from 'lucide-react';
import apiClient from '../../api/apiClient';
import {validateVmwareObjectName} from '../../utils/vmwareObjectName';


export function ProtectionGroupEditModal({ open, onClose, onSuccess, group, sitePairs = [] }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [availableVms, setAvailableVms] = useState([]);
  const [loadingVms, setLoadingVms] = useState(false);
  const [vmOptionsError, setVmOptionsError] = useState(null);
  const [selectedVmToAdd, setSelectedVmToAdd] = useState('');
  const [currentMembers, setCurrentMembers] = useState([]);

  useEffect(() => {
    let active = true;
    if (open && group) {
      setName(group.name || '');
      setDescription(group.description || '');
      setError(null);
      setSubmitting(false);
      setTaskStatus(null);
      setSelectedVmToAdd('');
      setAvailableVms([]);
      setLoadingVms(false);
      setVmOptionsError(null);
      
      const vms = group.protectedVms || group.vms || [];
      setCurrentMembers(vms.map(v => typeof v === 'string' ? v : (v.id || v.protected_vm_id || v.name)));

      // Load available replicated VMs
      const pairId = pairForObject(sitePairs,group);
      if (pairId) {
        setLoadingVms(true);
        apiClient.get(`/srm/pairings/${pairId}/options`)
          .then(res => {
            if (!active) return;
            const list = res.data?.data?.vms || [];
            setAvailableVms(Array.isArray(list) ? list : []);
          })
          .catch(() => {
            if (!active) return;
            setAvailableVms([]);
            setVmOptionsError('Unable to load available replicated VMs. Reopen this dialog to retry.');
          })
          .finally(() => { if (active) setLoadingVms(false); });
      }
    }
    return () => { active = false; };
  }, [open, group, sitePairs]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open || !group) return null;
  const nameError = validateVmwareObjectName(name);
  const addableVms = availableVms.filter(vm => vm?.id && !currentMembers.includes(vm.id));

  const handleAddMember = () => {
    if (!selectedVmToAdd) return;
    if (!currentMembers.includes(selectedVmToAdd)) {
      setCurrentMembers(prev => [...prev, selectedVmToAdd]);
    }
    setSelectedVmToAdd('');
  };

  const pollOperation = id => waitSrmOperation(id,setTaskStatus);

  const handleSave = async () => {
    if (nameError) return;
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const targetId = group.protectionGroupId || group.id;
      const pairId = pairForObject(sitePairs,group);

      if (name.trim() !== (group.name || '').trim() || (description.trim() || '') !== (group.description || '').trim()) {
        const payload = {
          pairId: Number(pairId),
          name: name.trim(),
          description: description.trim() || undefined,
          confirmed: true
        };

        const res = await srmMutation.post(`/srm/protection-groups/${encodeURIComponent(targetId)}/reconfigure`, payload, {
          headers: { 'Idempotency-Key': `pg-edit-${Date.now()}` }
        });

        const opData = res.data?.data;
        const opId = opData?.operationId || opData?.id;

        if (opId) {
          setTaskStatus('QUEUED');
          await pollOperation(opId);
        }
      }

      const originalVms = group.protectedVms || group.protected_vms || group.vms || [];
      const originalIds = new Set(originalVms.map(v => typeof v === 'string' ? v : (v.id || v.protected_vm_id || v.name)));
      const newVmIds = currentMembers.filter(id => !originalIds.has(id) && typeof id === 'string' && id.startsWith('VirtualMachine:'));

      for(const vmId of newVmIds){
        const membership=await srmMutation.post(`/srm/protection-groups/${encodeURIComponent(targetId)}/members`,{pairId:Number(pairId),action:'add',vmId,confirmed:true}, {
          headers: { 'Idempotency-Key': `pg-member-add-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
        });
        await pollOperation(membership.data.data.operationId);
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.safeMessage || err.response?.data?.error?.safeMessage || err.message || 'Unable to update protection group.';
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Protection group edit" tabIndex={-1} className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-800">Edit protection group</h2>
          </div>
          <Button aria-label="Close dialog" type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
            <X size={18} />
          </Button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 text-red-500 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Protection group name</label>
            <input
              type="text"
              maxLength={80}
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
            />
            {nameError && <p className="mt-1 text-[11px] text-red-600">{nameError}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Protected virtual machines ({currentMembers.length})
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 max-h-36 overflow-y-auto space-y-1.5 divide-y divide-slate-100">
              {currentMembers.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                    {displayName(availableVms.find(vm=>vm.id===m)?.name || (group.protectedVms || group.vms || []).find(vm=>typeof vm==='object'&&(vm.id===m||vm.protected_vm_id===m))?.name,'Unknown VM')}
                  </span>
                </div>
              ))}
              {currentMembers.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-2">No virtual machines assigned</div>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Add virtual machine</label>
            <div className="flex gap-2">
              <select
                value={selectedVmToAdd}
                onChange={e => setSelectedVmToAdd(e.target.value)}
                disabled={loadingVms || addableVms.length === 0}
                className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="">
                  {loadingVms
                    ? 'Loading available replicated VMs...'
                    : vmOptionsError
                      ? 'VM options unavailable'
                      : addableVms.length > 0
                      ? 'Select an available VM to add...'
                      : 'No available replicated VMs'}
                </option>
                {addableVms.map(vm => (
                  <option key={vm.id} value={vm.id}>{vm.name || 'Unknown VM'}</option>
                ))}
              </select>
              <Button
                type="button"
                onClick={handleAddMember}
                disabled={loadingVms || !selectedVmToAdd}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
              >
                <Plus size={14} /> Add
              </Button>
            </div>
            {vmOptionsError && <p role="alert" className="mt-1.5 text-xs text-red-600">{vmOptionsError}</p>}
            {!loadingVms && !vmOptionsError && addableVms.length === 0 && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Only replicated VMs that are not assigned to another protection group can be added.
              </p>
            )}
          </div>

          {submitting && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 flex items-center gap-2.5 text-xs text-indigo-800">
              <span>Loading...</span>
              <details className="ml-auto"><summary>Technical details</summary><span>{taskStatus || 'SUBMITTING'}</span></details>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-6 py-3.5 bg-slate-50/50">
          <Button
            type="button"
            disabled={submitting || Boolean(nameError)}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
          >
            {submitting ? 'Loading...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProtectionGroupDeleteModal({ open, onClose, onSuccess, group, sitePairs=[] }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setError(null);
      setTaskStatus(null);
    }
  }, [open, group]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open || !group) return null;

  const targetId = group.protectionGroupId || group.id;
  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const res = await srmMutation.delete(`/srm/protection-groups/${encodeURIComponent(targetId)}`, {
        data:{pairId:Number(pairForObject(sitePairs,group)),confirmed:true},
        headers: { 'Idempotency-Key': `pg-del-${Date.now()}` }
      });

      const opData = res.data?.data;
      const opId = opData?.operationId || opData?.id;

      if (opId) trackBackgroundOperation({
        id: opId,
        provider: 'SRM',
        label: `Delete protection group ${group.name || targetId}`,
        resourceKey: `protection-group:${pairForObject(sitePairs,group)}:${targetId}`
      });

      setSubmitting(false);
      setTaskStatus(null);
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.safeMessage || err.response?.data?.error?.safeMessage || err.message || 'Unable to delete protection group.';
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Protection group delete" tabIndex={-1} className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <Button aria-label="Close dialog" type="button" onClick={onClose} className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
          <X size={18} />
        </Button>
        <div className="p-6 space-y-4">

          <div>
            <h2 className="text-base font-bold text-slate-800">Delete protection group</h2>
            <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="font-bold text-slate-800">{group.name}</span>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {submitting && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 flex items-center gap-2.5 text-xs text-indigo-800">
              <span>Loading...</span>
              <details className="ml-auto"><summary>Technical details</summary><span>{taskStatus || 'SUBMITTING'}</span></details>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-6 py-3.5 bg-slate-50/50">
          <Button
            type="button"
            disabled={submitting}
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 shadow-sm"
          >
            {submitting ? 'Loading...' : 'Delete protection group'}
          </Button>
        </div>
      </div>
    </div>
  );
}
