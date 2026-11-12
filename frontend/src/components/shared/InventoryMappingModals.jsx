import useDialogFocus from '../../hooks/useDialogFocus';
import {displayName} from '../../utils/displayNames';
import Button from './Button';
import { srmMutation, pairForObject } from '../../api/srmOperations';
import { trackBackgroundOperation } from '../../api/backgroundOperations';
import React, { useState, useEffect } from 'react';
import { Network, Folder, Server, Layers, X, AlertTriangle, Trash2, ArrowRight, ArrowLeftRight, Plus } from 'lucide-react';
import apiClient from '../../api/apiClient';
import {safeErrorMessage} from '../../utils/safeErrorMessage';
import { initialMappingPairId } from '../../utils/inventoryMappingScope';


const TYPE_CONFIG = {
  networks: { label: 'Network', icon: Network, apiPath: 'networks' },
  folders: { label: 'Folder', icon: Folder, apiPath: 'folders' },
  resources: { label: 'Compute resource', icon: Server, apiPath: 'resources' },
  'storage-policies': { label: 'Storage policy', icon: Layers, apiPath: 'storage-policies' }
};

export function InventoryMappingCreateModal({ open, onClose, onSuccess, sitePairs = [], defaultType = 'networks', defaultPairId = null }) {
  const [mappingType, setMappingType] = useState(defaultType);
  const [selectedPairId, setSelectedPairId] = useState(() => initialMappingPairId(sitePairs, defaultPairId));
  const [sourceItems, setSourceItems] = useState([]);
  const [targetItems, setTargetItems] = useState([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedTarget, setSelectedTarget] = useState('');
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  useEffect(() => {
    if (open) {
      setMappingType(defaultType);
      setSelectedSource('');
      setSelectedTarget('');
      setSubmitting(false);
      setError(null);
      setTaskStatus(null);
      setSelectedPairId(initialMappingPairId(sitePairs, defaultPairId));
    }
  }, [open, defaultType, defaultPairId, sitePairs]);

  const activePair = sitePairs.find(p => String(p.id) === String(selectedPairId));

  useEffect(() => {
    if (open && activePair?.id && mappingType) {
      let active = true;
      setLoadingInventory(true);
      setError(null);
      setSelectedSource('');
      setSelectedTarget('');
      setSourceItems([]);
      setTargetItems([]);

      apiClient.get(`/srm/pairings/${activePair.id}/inventory/${mappingType}?site=both`).then(async res => {
        const data = res.data?.data || {};
        // Older API processes treat an unknown site value as source. Keep the
        // wizard usable until the combined endpoint is deployed everywhere.
        const inventory = Array.isArray(data)
          ? {
              source: data,
              target: (await apiClient.get(`/srm/pairings/${activePair.id}/inventory/${mappingType}?site=target`)).data?.data || []
            }
          : data;
        if (!active) return;
        const srcList = inventory.source || [];
        const tgtList = inventory.target || [];
        setSourceItems(Array.isArray(srcList) ? srcList : []);
        setTargetItems(Array.isArray(tgtList) ? tgtList : []);
      }).catch(err => {
        if (!active) return;
        setError(safeErrorMessage(err,'Unable to load SRM inventory. Both source and target must be available before saving.'));
        setSourceItems([]);
        setTargetItems([]);
      }).finally(() => {
        if (active) setLoadingInventory(false);
      });

      return () => { active = false; };
    }
  }, [open, activePair?.id, mappingType]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open) return null;

  const config = TYPE_CONFIG[mappingType] || TYPE_CONFIG.networks;

  const handleCreate = async () => {
    if (!activePair || !selectedSource || !selectedTarget) return;
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const payload = {
        pairId: Number(activePair.id),
        mappingType,
        sourceObject: selectedSource,
        targetObject: selectedTarget,
        confirmed: true
      };

      const res = await srmMutation.post(`/srm/inventory-mappings/${mappingType}`, payload, {
        headers: { 'Idempotency-Key': `map-create-${Date.now()}` }
      });

      const opData = res.data?.data;
      const opId = opData?.operationId || opData?.id;

      if (opId) trackBackgroundOperation({
        id: opId,
        provider: 'SRM',
        label: `Create ${config.label.toLowerCase()} mapping`,
        resourceKey: `mapping:${activePair.id}:${mappingType}:${selectedSource}`
      });

      setSubmitting(false);
      setTaskStatus(null);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err,'Unable to create mapping.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Inventory mapping create" tabIndex={-1} className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">New {config.label} Mapping</h2>
            </div>
          </div>
          <Button aria-label="Close dialog" type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
            <X size={16} />
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
            <label className="block text-xs font-semibold text-slate-700 mb-2">Mapping type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                const isSelected = mappingType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={loadingInventory}
                    onClick={() => { setMappingType(key); setSelectedSource(''); setSelectedTarget(''); }}
                    className={`group flex items-center justify-center p-2 rounded-2xl border text-center transition-all disabled:cursor-wait disabled:opacity-50 ${
                      isSelected
                        ? 'border-orange-200/90 bg-orange-50/50 shadow-xs ring-1 ring-orange-200/40'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60 shadow-2xs'
                    }`}
                  >
                    <div className="min-w-0 text-center">
                      <div className={`text-xs leading-tight transition-colors ${
                        isSelected
                          ? 'font-semibold text-[#FE5E37]'
                          : 'font-medium text-slate-800 group-hover:text-slate-900'
                      }`}>
                        {cfg.label.includes(' ') ? (
                          <>
                            <span className="block">{cfg.label.split(' ')[0]}</span>
                            <span className="block">{cfg.label.split(' ').slice(1).join(' ')}</span>
                          </>
                        ) : (
                          <span>{cfg.label}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Direction</label>
            {sitePairs.length > 1 ? <select aria-label="Mapping direction" value={selectedPairId} disabled={loadingInventory} onChange={e=>setSelectedPairId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-800 focus:border-[#FE5E37] focus:ring-1 focus:ring-[#FE5E37]/30 focus:outline-none disabled:cursor-wait disabled:opacity-50">
              <option value="">Select protected and recovery sites...</option>
              {sitePairs.map(pair=><option key={pair.id} value={pair.id}>{pair.local_site_name||pair.local_vcenter_host||'Protected site'} → {pair.remote_site_name||pair.remote_vcenter_host||'Recovery site'}</option>)}
            </select> : <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs">
              <span className="font-bold text-slate-800">{activePair?.local_site_name || 'Protected site'}</span>
              <ArrowRight size={14} className="text-slate-400" />
              <span className="font-bold text-slate-800">{activePair?.remote_site_name || 'Recovery site'}</span>
            </div>}
          </div>

          {loadingInventory ? (
            <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <span>Loading...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Source {config.label} <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedSource}
                  onChange={e => setSelectedSource(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-800 focus:border-[#FE5E37] focus:ring-1 focus:ring-[#FE5E37]/30 focus:outline-none"
                >
                  <option value="">Select source {config.label.toLowerCase()}...</option>
                  {sourceItems.map(item => {
                    const id = item.id || item.storage_policy_id || item.name;
                    return (
                      <option key={id} value={id}>
                        {displayName(item.name || item.path)}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target {config.label} <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedTarget}
                  onChange={e => setSelectedTarget(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-800 focus:border-[#FE5E37] focus:ring-1 focus:ring-[#FE5E37]/30 focus:outline-none"
                >
                  <option value="">Select target {config.label.toLowerCase()}...</option>
                  {targetItems.map(item => {
                    const id = item.id || item.storage_policy_id || item.name;
                    return (
                      <option key={id} value={id}>
                        {displayName(item.name || item.path)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )}

          {submitting && (
            <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 flex items-center gap-2.5 text-xs text-[#FE5E37]">
              <span>Loading...</span>
              <details className="ml-auto"><summary>Technical details</summary><span>{taskStatus || 'SUBMITTING'}</span></details>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-6 py-3.5 bg-slate-50/50">
          <Button
            type="button"
            disabled={submitting || !activePair || !selectedSource || !selectedTarget}
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#FE5E37] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#e04f2c] active:bg-[#c94322] disabled:opacity-50"
          >
            {!submitting && <Plus size={14} />}
            {submitting ? 'Loading...' : 'Create Mapping'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InventoryMappingReplaceModal({ open, onClose, onSuccess, mapping, existingMappings = [], sitePairs = [] }) {
  const [operation, setOperation] = useState('replace');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedTarget, setSelectedTarget] = useState('');
  const [sourceItems, setSourceItems] = useState([]);
  const [targetItems, setTargetItems] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  const mappingType = mapping?.mappingType?.toLowerCase()?.replace('_', '-') || 'networks';
  const apiType = mappingType.includes('network') ? 'networks' : mappingType.includes('folder') ? 'folders' : mappingType.includes('storage') ? 'storage-policies' : 'resources';

  useEffect(() => {
    if (open && mapping) {
      setOperation('replace');
      setSelectedSource('');
      setSelectedTarget('');
      setError(null);
      setSubmitting(false);
      setTaskStatus(null);

      const pairId = pairForObject(sitePairs,mapping);
      if (pairId) {
        setLoadingInventory(true);
        apiClient.get(`/srm/pairings/${pairId}/inventory/${apiType}?site=both`)
          .then(async res => {
            const data = res.data?.data || {};
            const inventory = Array.isArray(data)
              ? {
                  source: data,
                  target: (await apiClient.get(`/srm/pairings/${pairId}/inventory/${apiType}?site=target`)).data?.data || []
                }
              : data;
            setSourceItems(Array.isArray(inventory.source) ? inventory.source : []);
            setTargetItems(Array.isArray(inventory.target) ? inventory.target : []);
          })
          .catch(err => {setSourceItems([]);setTargetItems([]);setError(safeErrorMessage(err,'Unable to load source and target inventory from SRM.'));})
          .finally(() => setLoadingInventory(false));
      }
    }
  }, [open, mapping, apiType, sitePairs]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open || !mapping) return null;

  const handleSave = async () => {
    if (!selectedTarget || (operation === 'add' && !selectedSource)) return;
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const pairId = mapping.pairId || pairForObject(sitePairs, mapping) || (sitePairs.length === 1 ? sitePairs[0].id : null);
      const targetId = mapping.mappingId || (typeof mapping.id === 'string' && mapping.id.includes(':') ? mapping.id.split(':').pop() : mapping.id);
      const sourceMoid = mapping.sourceObjectId || mapping.source_object_id || mapping.sourceObject;
      const targetMoid = mapping.targetObjectId || mapping.target_object_id || mapping.targetObject;

      const payload = operation === 'add' ? {
        pairId: Number(pairId),
        sourceObject: selectedSource,
        targetObject: selectedTarget,
        confirmed: true
      } : {
        pairId: Number(pairId),
        sourceObject: sourceMoid,
        targetObject: selectedTarget,
        expected: {
          sourceObject: sourceMoid,
          targetObject: targetMoid
        },
        confirmed: true
      };

      const url = operation === 'add'
        ? `/srm/inventory-mappings/${apiType}`
        : `/srm/inventory-mappings/${apiType}/${encodeURIComponent(targetId)}/replace`;
      const res = await srmMutation.post(url, payload, {
        headers: { 'Idempotency-Key': `map-${operation}-${Date.now()}` }
      });

      const opData = res.data?.data;
      const opId = opData?.operationId || opData?.id;

      if (opId) trackBackgroundOperation({
        id: opId,
        provider: 'SRM',
        label: `${operation === 'add' ? 'Add' : 'Replace'} ${TYPE_CONFIG[apiType]?.label?.toLowerCase() || 'inventory'} mapping`,
        resourceKey: `mapping:${pairId}:${apiType}:${operation === 'add' ? selectedSource : targetId}`
      });

      setSubmitting(false);
      setTaskStatus(null);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err, operation === 'add' ? 'Unable to add mapping.' : 'Mapping replacement failed.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Inventory mapping replace" tabIndex={-1} className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Edit / replace mapping</h2>
            </div>
          </div>
          <Button aria-label="Close dialog" type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
            <X size={16} />
          </Button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Action</p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button type="button" disabled={submitting} onClick={() => { setOperation('replace'); setSelectedSource(''); setSelectedTarget(''); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${operation === 'replace' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                Replace this mapping
              </button>
              <button type="button" disabled={submitting} onClick={() => { setOperation('add'); setSelectedSource(''); setSelectedTarget(''); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${operation === 'add' ? 'bg-white text-[#FE5E37] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                Add another mapping
              </button>
            </div>
          </div>

          {operation === 'replace' && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="font-semibold text-slate-500">Source object:</span>
              <span className="font-bold text-slate-800">{mapping.sourceDisplayName || mapping.sourceObjectName || 'Name unavailable'}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold text-slate-500">Current target:</span>
              <span className="text-slate-700">{mapping.targetDisplayName || mapping.targetObjectName || 'Name unavailable'}</span>
            </div>
          </div>}

          {loadingInventory ? (
            <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <span>Loading...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {operation === 'add' && <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Source Resource <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedSource}
                  onChange={e => setSelectedSource(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-800 focus:border-[#FE5E37] focus:ring-1 focus:ring-[#FE5E37]/30 focus:outline-none"
                >
                  <option value="">Select source resource...</option>
                  {sourceItems.map(item => {
                    const id = item.id || item.storage_policy_id || item.name;
                    const used = existingMappings.some(existing => {
                      const existingType = existing?.mappingType?.toLowerCase()?.replace('_', '-') || '';
                      const existingApiType = existingType.includes('network') ? 'networks' : existingType.includes('folder') ? 'folders' : existingType.includes('storage') ? 'storage-policies' : 'resources';
                      const existingId = existing.sourceObjectId || existing.source_object_id;
                      const existingMoid = typeof existingId === 'string' && existingId.includes(':') ? existingId.split(':')[1] : existingId;
                      const itemMoid = typeof id === 'string' && id.includes(':') ? id.split(':')[1] : id;
                      return existingApiType === apiType && (
                        existingId === id
                        || (existingMoid && existingMoid === itemMoid)
                        || existing.sourceObjectName === item.name
                        || existing.sourceDisplayName === item.name
                      );
                    });
                    return <option key={id} value={id} disabled={used}>{displayName(item.name || item.path)}{used ? ' (already mapped)' : ''}</option>;
                  })}
                </select>
              </div>}
              <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {operation === 'add' ? 'Target Resource' : 'New Target Resource'} <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedTarget}
                onChange={e => setSelectedTarget(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-800 focus:border-[#FE5E37] focus:ring-1 focus:ring-[#FE5E37]/30 focus:outline-none"
              >
                <option value="">{operation === 'add' ? 'Select target resource...' : 'Select replacement target resource...'}</option>
                {targetItems.map(item => {
                  const id = item.id || item.storage_policy_id || item.name;
                  return (
                    <option key={id} value={id}>
                      {displayName(item.name || item.path)}
                    </option>
                  );
                })}
              </select>
              </div>
            </div>
          )}

          {submitting && (
            <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 flex items-center gap-2.5 text-xs text-[#FE5E37]">
              <span>Loading...</span>
              <details className="ml-auto"><summary>Technical details</summary><span>{taskStatus || 'SUBMITTING'}</span></details>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-6 py-3.5 bg-slate-50/50">
          <Button
            type="button"
            disabled={submitting || !selectedTarget || (operation === 'add' && !selectedSource)}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#FE5E37] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#e04f2c] active:bg-[#c94322] disabled:opacity-50"
          >
            {!submitting && (operation === 'add' ? <Plus size={14} /> : <ArrowLeftRight size={14} />)}
            {submitting ? 'Loading...' : operation === 'add' ? 'Add Mapping' : 'Replace Mapping'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InventoryMappingDeleteModal({ open, onClose, onSuccess, mapping, sitePairs = [] }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setError(null);
      setTaskStatus(null);
    }
  }, [open, mapping]);

  const dialogRef = useDialogFocus(open, () => onClose?.());
  if (!open || !mapping) return null;

  const mappingType = mapping?.mappingType?.toLowerCase()?.replace('_', '-') || 'networks';
  const apiType = mappingType.includes('network') ? 'networks' : mappingType.includes('folder') ? 'folders' : mappingType.includes('storage') ? 'storage-policies' : 'resources';

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    setTaskStatus('SUBMITTING');

    try {
      const pairId = mapping.pairId || pairForObject(sitePairs, mapping) || (sitePairs.length === 1 ? sitePairs[0].id : null);
      const targetId = mapping.mappingId || (typeof mapping.id === 'string' && mapping.id.includes(':') ? mapping.id.split(':').pop() : mapping.id);
      const sourceMoid = mapping.sourceObjectId || mapping.source_object_id || mapping.sourceObject;
      const targetMoid = mapping.targetObjectId || mapping.target_object_id || mapping.targetObject;

      const res = await srmMutation.delete(`/srm/inventory-mappings/${apiType}/${encodeURIComponent(targetId)}`, {
        data: {
          pairId: Number(pairId),
          expected: {
            sourceObject: sourceMoid,
            targetObject: targetMoid
          },
          confirmed: true
        },
        headers: { 'Idempotency-Key': `map-del-${Date.now()}` }
      });

      const opData = res.data?.data;
      const opId = opData?.operationId || opData?.id;

      if (opId) trackBackgroundOperation({
        id: opId,
        provider: 'SRM',
        label: `Delete ${TYPE_CONFIG[apiType]?.label?.toLowerCase() || 'inventory'} mapping`,
        resourceKey: `mapping:${pairId}:${apiType}:${targetId}`
      });

      setSubmitting(false);
      setTaskStatus(null);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err,'Unable to delete mapping.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Inventory mapping delete" tabIndex={-1} className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <Button aria-label="Close dialog" type="button" onClick={onClose} className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
          <X size={18} />
        </Button>
        <div className="p-6 space-y-4">

          <div>
            <h2 className="text-base font-bold text-slate-800">Delete inventory mapping</h2>
            <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
              <div>
                <span className="font-semibold text-slate-500">Source:</span>{' '}
                <span className="font-bold text-slate-800">{mapping.sourceDisplayName || mapping.sourceObjectName || 'Name unavailable'}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">Target:</span>{' '}
                <span className="text-slate-700">{mapping.targetDisplayName || mapping.targetObjectName || 'Name unavailable'}</span>
              </div>
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
            {submitting ? 'Loading...' : 'Delete mapping'}
          </Button>
        </div>
      </div>
    </div>
  );
}
