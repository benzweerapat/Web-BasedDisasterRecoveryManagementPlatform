import Button from './Button';
import { srmMutation, waitSrmOperation } from '../../api/srmOperations';
import { trackBackgroundOperation } from '../../api/backgroundOperations';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, X, AlertTriangle, Monitor } from 'lucide-react';
import apiClient from '../../api/apiClient';
import { StatusPill } from './Pills';
import {safeErrorMessage} from '../../utils/safeErrorMessage';
import {validateVmwareObjectName} from '../../utils/vmwareObjectName';
import {completeProtectionGroupCreation, toggleVisibleVmSelection} from '../../utils/protectionGroupCreation';

const PROTECTION_GROUP_STEPS = [
  'Name and direction',
  'Type',
  'Virtual machines',
  'Recovery plan',
  'Ready to complete'
];

export default function ProtectionGroupWizard({ open, onClose, onSuccess, sitePairs = [], _recoveryPlans = [] }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [selectedPairId, setSelectedPairId] = useState('');
  const [type, setType] = useState('HBR');
  const [replicatedVms, setReplicatedVms] = useState([]);
  const [loadingVms, setLoadingVms] = useState(false);
  const [selectedVmIds, setSelectedVmIds] = useState(new Set());
  const [vmSearch, setVmSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [rpOption, setRpOption] = useState('none'); // 'existing' | 'new' | 'none'
  const [selectedRpId, setSelectedRpId] = useState('');
  const [newRpName, setNewRpName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [plans, setPlans] = useState([]);
  const creation = useRef({});
  const submissionInFlight = useRef(false);
  const [creationProgress, setCreationProgress] = useState({});
  const groupLocked = Boolean(creationProgress.groupOperationId || creationProgress.groupId);
  const pendingStage = Boolean((!creationProgress.groupId && creationProgress.groupOperationId) || creationProgress.recoveryOperationId);

  useEffect(() => {
    if (open) {
      setStep(1);
      setName('');
      setType('HBR');
      setSelectedVmIds(new Set());
      setVmSearch('');
      setSelectedOnly(false);
      setRpOption('none');
      setSelectedRpId('');
      setNewRpName('');
      setSubmitting(false);
      setSubmitError(null);
      setTaskStatus(null);
      setSelectedPairId('');
      creation.current = {};
      setCreationProgress({});
      submissionInFlight.current = false;
    }
  }, [open]);

  const activePair = sitePairs.find(p => String(p.id) === String(selectedPairId));

  useEffect(() => {
    if (open && activePair?.id) {
      let active = true;
      setLoadingVms(true);
      setSubmitError(null);
      setPlans([]);
      setSelectedVmIds(new Set());
      setSelectedRpId('');
      setReplicatedVms([]);
      apiClient.get(`/srm/pairings/${activePair.id}/options`)
        .then(res => {
          if (!active) return;
          const vms = res.data?.data?.vms || [];
          setPlans(res.data?.data?.plans || []);
          setReplicatedVms(Array.isArray(vms) ? vms : []);
        })
        .catch(_err => {
          if (!active) return;
          setReplicatedVms([]);
          setSubmitError('SRM inventory could not be loaded for this direction.');
        })
        .finally(() => {
          if (active) setLoadingVms(false);
        });
      return () => { active = false; };
    }
  }, [open, activePair?.id]);

  if (!open) return null;

  const toggleVm = (id) => {
    setSelectedVmIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVms = () => {
    setSelectedVmIds(previous => toggleVisibleVmSelection(previous, filteredVms));
  };

  const filteredVms = replicatedVms.filter(v => {
    if (selectedOnly && !selectedVmIds.has(v.id)) return false;
    if (!vmSearch) return true;
    const q = vmSearch.toLowerCase();
    return (v.name && v.name.toLowerCase().includes(q)) || (v.id && v.id.toLowerCase().includes(q));
  });
  const nameError = validateVmwareObjectName(name);
  const newRpNameError = rpOption === 'new' ? validateVmwareObjectName(newRpName) : null;

  const canProceed = () => {
    if (step === 1) return !nameError && activePair;
    if (step === 2) return type === 'HBR';
    if (step === 3) return !loadingVms && !submitError;
    if (step === 4) {
      if (rpOption !== 'none' && selectedVmIds.size === 0) return false;
      if (rpOption === 'existing') return Boolean(selectedRpId);
      if (rpOption === 'new') return !newRpNameError;
      return true;
    }
    return true;
  };

  const pollOperation = id => waitSrmOperation(id,setTaskStatus);

  const handleSubmit = async () => {
    if (submissionInFlight.current) return;
    if (rpOption !== 'none' && selectedVmIds.size === 0) {
      setSubmitError('Select at least one replicated VM before adding this protection group to a recovery plan.');
      return;
    }
    submissionInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setTaskStatus('SUBMITTING');

    try {
      const payload = {
        pairId: Number(activePair.id),
        name: name.trim(),
        memberIds: Array.from(selectedVmIds),
        confirmed: true
      };

      if (rpOption === 'none') {
        const operation = (await srmMutation.post('/srm/protection-groups', payload)).data.data;
        trackBackgroundOperation({
          id: operation.operationId,
          provider: 'SRM',
          label: `Create protection group ${name.trim()}`,
          resourceKey: `protection-group:${activePair.id}:${name.trim()}`
        });
        onSuccess?.();
        onClose();
        return;
      }

      await completeProtectionGroupCreation({
        progress: creation.current,
        groupPayload: payload,
        recovery: {option: rpOption, planId: selectedRpId, name: newRpName},
        submit: async (url, body) => (await srmMutation.post(url, body)).data.data,
        wait: pollOperation,
        onProgress: () => setCreationProgress({...creation.current})
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      const message = safeErrorMessage(err, 'The operation could not be completed.');
      setSubmitError(creation.current.groupId
        ? `Protection group "${name.trim()}" was created. The recovery plan step is incomplete. ${message}`
        : message);
      setSubmitting(false);
    } finally {
      submissionInFlight.current = false;
    }
  };

  return (
    <div className="protection-group-create-theme fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label="New protection group" className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
          <h2 className="text-lg font-bold text-slate-900">New protection group</h2>
          <Button
            aria-label="Close dialog"
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
          >
            <X size={18} />
          </Button>
        </div>

        {/* Horizontal wizard steps — shared visual language with Create replication */}
        <nav aria-label="Protection group steps" className="mb-6">
          <ol className="flex items-center justify-between border-b border-slate-200 pb-4">
            {PROTECTION_GROUP_STEPS.map((label, idx) => {
              const number = idx + 1;
              const isActive = step === number;
              const isDone = step > number;
              return (
                <li key={label} className="flex items-center gap-2">
                  <Button
                    variant={isActive || isDone ? 'primary' : 'secondary'}
                    type="button"
                    disabled={submitting || pendingStage || (groupLocked && number < 4)}
                    onClick={() => {
                      if (number < step) setStep(number);
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      isActive
                        ? 'text-white ring-4 ring-[#FE5E37]/20'
                        : isDone
                          ? 'text-white'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isDone ? '✓' : number}
                  </Button>
                  <span className={`hidden text-xs font-medium sm:inline ${isActive ? 'font-semibold text-[#FE5E37]' : isDone ? 'text-slate-800' : 'text-slate-500'}`}>
                    {label}
                  </span>
                  {number < PROTECTION_GROUP_STEPS.length && <ArrowRight size={14} className="mx-1 hidden text-slate-300 sm:inline" />}
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Content Body */}
        <div className="min-h-80 max-h-[58vh] space-y-5 overflow-y-auto pr-1">
          {submitError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 text-red-500 mt-0.5" />
              <div>{submitError}</div>
            </div>
          )}

          {/* STEP 1: Name and Direction */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Protection group Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className={`text-[11px] mt-1 block ${nameError ? 'text-red-600' : 'text-slate-400'}`}>{nameError || 'Maximum 80 characters'}</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Replication direction <span className="text-red-500">*</span>
                </label>
                <div className="grid gap-2">
                  {sitePairs.map(p => (
                    <label
                      key={p.id}
                      className={`flex items-center justify-between rounded-xl border p-3.5 cursor-pointer transition-colors ${
                        String(selectedPairId) === String(p.id)
                          ? 'border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="sitePair"
                          checked={String(selectedPairId) === String(p.id)}
                          onChange={() => setSelectedPairId(String(p.id))}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        <div>
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                            <span>{p.local_site_name || 'Protected site'}</span>
                            <ArrowRight size={13} className="text-slate-400" />
                            <span>{p.remote_site_name || 'Recovery site'}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {p.pairing_status || 'CONNECTED'}
                          </span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Protection group Type */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Select the protection group type supported by this Site Recovery Manager deployment:
              </p>
              <label className="flex gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-400"><input type="radio" disabled/>Datastore groups (array-based replication) — configuration not implemented</label>
              <label
                className={`flex items-start gap-3.5 rounded-xl border p-4 cursor-pointer transition-colors ${
                  type === 'HBR'
                    ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-200'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="pgType"
                  checked={type === 'HBR'}
                  onChange={() => setType('HBR')}
                  className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">Individual VMs (vSphere Replication)</span>
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">HBR</span>
                  </div>
                </div>
              </label>

              <label className="flex gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-400"><input type="radio" disabled/>Virtual volumes (vVol replication) — configuration not implemented</label>
            </div>
          )}

          {/* STEP 3: Available replicated VMs */}
          {step === 3 && (
            <div className="space-y-3.5">
              <div className="flex gap-2" aria-label="VM selection filter">
                <Button type="button" aria-pressed={!selectedOnly} onClick={()=>setSelectedOnly(false)} className="rounded-full border bg-white px-4 py-2 text-sm text-indigo-700">All</Button>
                <Button type="button" aria-pressed={selectedOnly} onClick={()=>setSelectedOnly(true)} className="rounded-full border bg-white px-4 py-2 text-sm text-indigo-700">Selected ({selectedVmIds.size})</Button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-700">Available replicated VMs</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">
                    {selectedVmIds.size} of {filteredVms.length} selected
                  </span>
                  {filteredVms.length > 0 && (
                    <Button
                      type="button"
                      onClick={selectAllVms}
                      disabled={filteredVms.length === 0}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      {filteredVms.length > 0 && filteredVms.every(vm => selectedVmIds.has(vm.id)) ? 'Deselect all' : 'Select all'}
                    </Button>
                  )}
                </div>
              </div>

              <input
                type="text"
                value={vmSearch}
                onChange={e => setVmSearch(e.target.value)}
                placeholder="Filter replicated VMs by name..."
                className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />

              {loadingVms ? (
                <div className="flex items-center justify-center h-48 rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    Loading...
                  </div>
                </div>
              ) : filteredVms.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
                  No available replicated VMs found for this protection group direction.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                  {filteredVms.map(vm => {
                    const isChecked = selectedVmIds.has(vm.id);
                    return (
                      <label
                        key={vm.id}
                        className={`flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                          isChecked ? 'bg-indigo-50/30' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleVm(vm.id)}
                            className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                          />
                          <div className="flex items-center gap-2">
                            <Monitor size={15} className="text-slate-400" />
                            <span className="text-xs font-semibold text-slate-800">{vm.name || 'Unnamed VM'}</span>
                          </div>
                        </div>
                        <StatusPill status={vm.status || vm.replication_status || 'UNKNOWN'} />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Recovery plan Selection */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Optionally attach this protection group to a Recovery plan:
              </p>
              {rpOption !== 'none' && selectedVmIds.size === 0 && (
                <p className="text-xs text-red-600" role="alert">
                  Select at least one replicated VM before adding this protection group to a recovery plan.
                </p>
              )}

              <div className="space-y-2.5">
                <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer ${
                  rpOption === 'none' ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-200' : 'border-slate-200'
                }`}>
                  <input
                    type="radio"
                    name="rpOption"
                    checked={rpOption === 'none'}
                    onChange={() => setRpOption('none')}
                    className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800">Do not add to recovery plan now</span>
                    <p className="text-[11px] text-slate-500">Create the protection group without assigning it to a recovery plan.</p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer ${
                  rpOption === 'existing' ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-200' : 'border-slate-200'
                }`}>
                  <input
                    type="radio"
                    name="rpOption"
                    checked={rpOption === 'existing'}
                    onChange={() => setRpOption('existing')}
                    className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300"
                  />
                  <div className="flex-1">
                    <span className="text-xs font-bold text-slate-800">Add to existing recovery plan</span>
                    {rpOption === 'existing' && (
                      <select
                        value={selectedRpId}
                        onChange={e => setSelectedRpId(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">Select a recovery plan...</option>
                        {plans.map(rp => (
                          <option key={rp.id || rp.recovery_plan_id} value={rp.id || rp.recovery_plan_id}>
                            {rp.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>

                <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer ${
                  rpOption === 'new' ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-200' : 'border-slate-200'
                }`}>
                  <input
                    type="radio"
                    name="rpOption"
                    checked={rpOption === 'new'}
                    onChange={() => setRpOption('new')}
                    className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300"
                  />
                  <div className="flex-1 space-y-2">
                    <span className="text-xs font-bold text-slate-800">Add to new recovery plan</span>
                    {rpOption === 'new' && (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          maxLength={80}
                          value={newRpName}
                          onChange={e => setNewRpName(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                        />
                        {newRpNameError && <p className="text-[11px] text-red-600">{newRpNameError}</p>}
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 5: Ready to Complete */}
          {step === 5 && (
            <div className="space-y-4 text-xs">
              <p className="text-slate-600">{creationProgress.groupId ? 'The protection group is created. Review the remaining recovery plan step:' : 'Review your configuration before creating the protection group:'}</p>
              
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 divide-y divide-slate-100 overflow-hidden">
                <div className="grid grid-cols-3 p-3">
                  <span className="font-semibold text-slate-500">Name</span>
                  <span className="col-span-2 font-bold text-slate-800">{name}</span>
                </div>
                <div className="grid grid-cols-3 p-3">
                  <span className="font-semibold text-slate-500">Direction</span>
                  <span className="col-span-2 text-slate-700 flex items-center gap-1.5">
                    {activePair?.local_site_name || 'Protected'} <ArrowRight size={12} /> {activePair?.remote_site_name || 'Recovery'}
                  </span>
                </div>
                <div className="grid grid-cols-3 p-3">
                  <span className="font-semibold text-slate-500">Type</span>
                  <span className="col-span-2 text-slate-700">Individual VMs (vSphere Replication)</span>
                </div>
                <div className="grid grid-cols-3 p-3">
                  <span className="font-semibold text-slate-500">Selected VMs</span>
                  <span className="col-span-2 font-bold text-indigo-700">{selectedVmIds.size} Virtual machines</span>
                </div>
                <div className="grid grid-cols-3 p-3">
                  <span className="font-semibold text-slate-500">Recovery plan</span>
                  <span className="col-span-2 text-slate-700">
                    {rpOption === 'none' && 'None (Do not add to recovery plan)'}
                    {rpOption === 'existing' && `Add to: ${plans.find(r => String(r.id) === String(selectedRpId))?.name || 'Name unavailable'}`}
                    {rpOption === 'new' && `Create new: ${newRpName}`}
                  </span>
                </div>
              </div>

              {submitting && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 flex items-center gap-3">
                  <div>
                    <p className="font-semibold text-indigo-900">Loading...</p>
                    <details className="text-[11px] text-indigo-700"><summary>Technical details</summary>{taskStatus || 'SUBMITTING'}</details>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
          <div>
            {step > 1 && (
              <Button
                type="button"
                disabled={submitting || pendingStage || (groupLocked && step <= 4)}
                onClick={() => setStep(s => s - 1)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Back
              </Button>
            )}
          </div>

          <div>
            {step < 5 ? (
              <Button
                type="button"
                variant="orange-outline"
                disabled={!canProceed() || submitting}
                onClick={() => setStep(s => s + 1)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#FE5E37] bg-white px-4 py-2 text-sm font-semibold text-[#FE5E37] shadow-sm transition-colors hover:bg-[#FE5E37]/10 disabled:opacity-50"
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                variant="orange-outline"
                disabled={submitting}
                onClick={handleSubmit}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#FE5E37] bg-white px-5 py-2 text-sm font-semibold text-[#FE5E37] shadow-sm transition-colors hover:bg-[#FE5E37]/10 disabled:opacity-50"
              >
                {submitting ? 'Loading...' : pendingStage ? 'Check progress' : creationProgress.groupId ? 'Continue' : 'Create Protection group'}
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
