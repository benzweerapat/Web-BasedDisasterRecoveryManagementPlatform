import {srmMutation,waitSrmOperation,pairForObject} from '../../api/srmOperations';
import { trackBackgroundOperation } from '../../api/backgroundOperations';
import useDialogFocus from '../../hooks/useDialogFocus';
import {displayName} from '../../utils/displayNames';
import Button from './Button';
import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Trash2, Plus, Shield } from 'lucide-react';
import { StatusPill } from './Pills';
import {safeErrorMessage} from '../../utils/safeErrorMessage';
import {validateVmwareObjectName} from '../../utils/vmwareObjectName';
import {matchesPairDirection} from '../../utils/srmPairDirection';
const EMPTY=[];
const pgId = pg => String(typeof pg === 'string' ? pg : (pg?.protectionGroupId || pg?.protection_group_id || pg?.id || ''));
const uniqueProtectionGroups = groups => [...new Map((groups || []).filter(pg=>pgId(pg)).map(pg=>[pgId(pg),pg])).values()];
const planProtectionGroupIds = plan => [...new Set((plan?.protectionGroupIds || plan?.protection_group_ids || plan?.protectionGroups || plan?.groups || []).map(pgId).filter(Boolean))];

export function RecoveryPlanCreateModal({ open, onClose, onSuccess, sitePairs = EMPTY, protectionGroups = EMPTY }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPairId, setSelectedPairId] = useState('');
  const [selectedPgIds, setSelectedPgIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setSelectedPgIds(new Set());
      setSubmitting(false);
      setError(null);
      setTaskStatus(null);
      setSelectedPairId('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || submitting) return;
    setSelectedPairId(current => sitePairs.some(pair => String(pair.id) === current)
      ? current
      : sitePairs.length === 1 ? String(sitePairs[0].id) : '');
  }, [open, sitePairs, submitting]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open) return null;

  const activePair = sitePairs.find(p => String(p.id) === String(selectedPairId));
  const nameError = validateVmwareObjectName(name);
  const availableGroups = uniqueProtectionGroups(protectionGroups).filter(pg =>
    String(pairForObject(sitePairs, pg)) === String(activePair?.id) && matchesPairDirection(pg, activePair));

  const togglePg = (id) => {
    setSelectedPgIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (nameError || !activePair || submitting) return;
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const payload = {
        pairId: Number(activePair.id),
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds: Array.from(selectedPgIds),
        confirmed: true
      };

      const res = await srmMutation.post('/srm/recovery-plans', payload, {
        headers: { 'Idempotency-Key': `rp-create-${Date.now()}` }
      });

      const opData = res.data?.data;
      const opId = opData?.operationId || opData?.id;

      if (opId) trackBackgroundOperation({
        id: opId,
        provider: 'SRM',
        label: `Create recovery plan ${name.trim()}`,
        resourceKey: `recovery-plan:${activePair.id}:${name.trim()}`
      });

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err,'Unable to create recovery plan.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Recovery plan create" tabIndex={-1} className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div>
              <h2 className="text-base font-bold text-slate-800">New recovery plan</h2>
            </div>
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Plan name <span className="text-red-500">*</span>
            </label>
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
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Direction <span className="text-red-500">*</span>
            </label>
            <div className="space-y-1.5">
              {sitePairs.map(p => (
                <label
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition-colors ${
                    String(selectedPairId) === String(p.id)
                      ? 'border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-200'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="rpPair"
                      checked={String(selectedPairId) === String(p.id)}
                      onChange={() => {
                        setSelectedPairId(String(p.id));
                        setSelectedPgIds(new Set());
                      }}
                      className="h-4 w-4 text-indigo-600 border-slate-300"
                    />
                    <span className="text-xs font-bold text-slate-800">
                      {p.local_site_name || 'Protected'} → {p.remote_site_name || 'Recovery'}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Include protection groups ({selectedPgIds.size} selected)
            </label>
            {availableGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                No protection groups available. You can add them later.
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                {availableGroups.map(pg => {
                  const pgId = pg.protectionGroupId || pg.id;
                  const isChecked = selectedPgIds.has(pgId);
                  return (
                    <label
                      key={pgId}
                      className={`flex items-center justify-between p-2.5 cursor-pointer hover:bg-slate-50 text-xs ${
                        isChecked ? 'bg-indigo-50/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => togglePg(pgId)}
                          className="h-4 w-4 rounded text-indigo-600 border-slate-300"
                        />
                        <Shield size={14} className="text-indigo-600" />
                        <span className="font-semibold text-slate-800">{pg.name}</span>
                      </div>
                      <StatusPill status={pg.protectionStatus || pg.status || 'OK'} />
                    </label>
                  );
                })}
              </div>
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
            disabled={submitting || Boolean(nameError) || !activePair}
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
          >
            {submitting ? 'Loading...' : 'Create recovery plan'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RecoveryPlanEditModal({ open, onClose, onSuccess, plan, sitePairs = EMPTY, protectionGroups = EMPTY }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currentPgIds, setCurrentPgIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [selectedPgToAdd, setSelectedPgToAdd] = useState('');

  useEffect(() => {
    if (open && plan) {
      setName(plan.name || '');
      setDescription(plan.description || '');
      setError(null);
      setSubmitting(false);
      setTaskStatus(null);
      setSelectedPgToAdd('');

      setCurrentPgIds(planProtectionGroupIds(plan));
    }
  }, [open, plan]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open || !plan) return null;
  const nameError = validateVmwareObjectName(name);
  const pairId = pairForObject(sitePairs,plan);
  const activePair = sitePairs.find(pair => String(pair.id) === String(pairId));
  const availableGroups = uniqueProtectionGroups(protectionGroups).filter(pg =>
    String(pairForObject(sitePairs, pg)) === String(pairId) && matchesPairDirection(pg, activePair));
  const addableGroups = availableGroups.filter(pg => !currentPgIds.includes(pgId(pg)));

  const handleAddPg = () => {
    if (!selectedPgToAdd) return;
    if (!currentPgIds.includes(selectedPgToAdd)) {
      setCurrentPgIds(prev => [...prev, selectedPgToAdd]);
    }
    setSelectedPgToAdd('');
  };

  const handleRemovePg = (pgId) => {
    setCurrentPgIds(prev => prev.filter(id => id !== pgId));
  };

  const pollOperation = id => waitSrmOperation(id,setTaskStatus);

  const handleSave = async () => {
    if (nameError) return;
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const targetId = plan.recoveryPlanId || plan.id;
      // Metadata edit and membership intents are separate durable operations.
      const payload = {
        pairId: Number(pairId),
        name: name.trim(),
        description: description.trim() || undefined,
        confirmed: true
      };

      const originalIds=planProtectionGroupIds(plan);
      for(const [action,ids] of [['add',currentPgIds.filter(id=>!originalIds.includes(id))],['remove',originalIds.filter(id=>!currentPgIds.includes(id))]]) {
        for(const protectionGroupId of ids){
          const change=await srmMutation.post('/srm/recovery-plans/'+encodeURIComponent(targetId)+'/protection-groups',{pairId:Number(pairId),action,protectionGroupId,confirmed:true});
          await pollOperation(change.data.data.operationId);
        }
      }

      const metadataChanged=name.trim()!==String(plan.name||'').trim()||description.trim()!==String(plan.description||'').trim();
      if(metadataChanged){
        const res = await srmMutation.post(`/srm/recovery-plans/${encodeURIComponent(targetId)}/reconfigure`, payload, {
          headers: { 'Idempotency-Key': `rp-edit-${Date.now()}` }
        });
        const opData = res.data?.data;
        const opId = opData?.operationId || opData?.id;
        if (opId) {
          setTaskStatus('QUEUED');
          await pollOperation(opId);
        }
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err,'Unable to update recovery plan.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Recovery plan edit" tabIndex={-1} className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-800">Edit recovery plan</h2>
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Plan name</label>
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
              Associated protection groups ({currentPgIds.length})
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-2 max-h-36 overflow-y-auto space-y-1.5 divide-y divide-slate-100">
              {currentPgIds.map(id => {
                const pg = availableGroups.find(p => pgId(p) === id);
                return (
                  <div key={id} className="flex items-center justify-between text-xs py-1 px-1">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                      {displayName(pg?.name)}
                    </span>
                    <Button
                      type="button"
                      onClick={() => handleRemovePg(id)}
                      className="text-[11px] font-semibold text-red-600 hover:text-red-800"
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
              {currentPgIds.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-2">No protection groups attached</div>
              )}
            </div>
          </div>

          {addableGroups.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Add protection group</label>
              <div className="flex gap-2">
                <select
                  value={selectedPgToAdd}
                  onChange={e => setSelectedPgToAdd(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Select a protection group to add...</option>
                  {addableGroups.map(p => (
                    <option key={pgId(p)} value={pgId(p)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={handleAddPg}
                  disabled={!selectedPgToAdd}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  <Plus size={14} /> Add
                </Button>
              </div>
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

export function RecoveryPlanDeleteModal({ open, onClose, onSuccess, plan, sitePairs=[] }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setError(null);
      setTaskStatus(null);
    }
  }, [open, plan]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open || !plan) return null;

  const targetId = plan.recoveryPlanId || plan.id;

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const res = await srmMutation.delete(`/srm/recovery-plans/${encodeURIComponent(targetId)}`, {
        data:{pairId:Number(pairForObject(sitePairs,plan)),confirmed:true},
        headers: { 'Idempotency-Key': `rp-del-${Date.now()}` }
      });

      const opData = res.data?.data;
      const opId = opData?.operationId || opData?.id;

      if (opId) trackBackgroundOperation({
        id: opId,
        provider: 'SRM',
        label: `Delete recovery plan ${plan.name || targetId}`,
        resourceKey: `recovery-plan:${pairForObject(sitePairs,plan)}:${targetId}`
      });

      setSubmitting(false);
      setTaskStatus(null);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err,'Unable to delete recovery plan.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Recovery plan delete" tabIndex={-1} className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <Button aria-label="Close dialog" type="button" onClick={onClose} className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
          <X size={18} />
        </Button>
        <div className="p-6 space-y-4">

          <div>
            <h2 className="text-base font-bold text-slate-800">Delete recovery plan</h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Permanently delete this recovery plan?
            </p>
            <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="font-semibold text-slate-500">Plan name:</span>{' '}
              <span className="font-bold text-slate-800">{plan.name}</span>
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
            {!submitting && <Trash2 size={14} />}
            {submitting ? 'Loading...' : 'Delete recovery plan'}
          </Button>
        </div>
      </div>
    </div>
  );
}
