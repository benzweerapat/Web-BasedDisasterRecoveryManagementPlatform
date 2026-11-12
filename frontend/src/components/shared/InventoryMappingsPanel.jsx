import {displayName} from '../../utils/displayNames';
import Button from './Button';
import React, { useMemo, useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { useLocation } from '../../router-hooks';
import { formatNullable } from '../../utils/formatters';
import apiClient from '../../api/apiClient';
import useDialogFocus from '../../hooks/useDialogFocus';
import { safeErrorMessage } from '../../utils/safeErrorMessage';
import { InventoryMappingCreateModal, InventoryMappingReplaceModal, InventoryMappingDeleteModal } from './InventoryMappingModals';
import { mappingPairForSites, pairSite, placeholdersForSite } from '../../utils/inventoryMappingScope';

const CATEGORIES = [
  { key: 'NETWORK', label: 'Network' },
  { key: 'FOLDER', label: 'Folder' },
  { key: 'RESOURCE', label: 'Compute resource' },
  { key: 'STORAGE_POLICY', label: 'Storage policy' }
];
const EMPTY_PAIRS=[];
const scopeFor = (state, key) => state?.[key] || (key === 'RESOURCE' ? state?.COMPUTE_RESOURCE : null) || {};
const rowsFor = (state, key) => Array.isArray(scopeFor(state, key)?.data)
  ? scopeFor(state, key).data
  : (state?.observations || []).filter(row => row.mappingType === key || (key === 'RESOURCE' && ['RESOURCE', 'COMPUTE_RESOURCE'].includes(row.mappingType)));
const endpointKey = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

function hasAuthoritativeReverseMapping(row) {
  if (!row) return false;
  if (row.reverseMapping === true) return true;
  return typeof row.reverseMapping === 'string'
    && ['TRUE', 'YES', 'PRESENT', 'ENABLED'].includes(row.reverseMapping.trim().toUpperCase());
}

function mappingsForDirection(rows, leftSite, rightSite, isFallback = false) {
  const hasDirectionalIdentity = endpointKey(leftSite.host) !== endpointKey('Not reported')
    && endpointKey(rightSite.host) !== endpointKey('Not reported');

  // Backward-compatible rendering for legacy read-models that predate the
  // authoritative vCenter identity fields. No direction inference is made in
  // this branch because the contract contains no direction to compare.
  if (!hasDirectionalIdentity) {
    if (isFallback) {
      return [];
    }
    return (rows || []).map(mapping => ({ mapping, leftSide: 'source', rightSide: 'target' }));
  }

  const actual = rows.filter(row => (
    endpointKey(row.sourceVcenterHost) === endpointKey(leftSite.host)
    && endpointKey(row.targetVcenterHost) === endpointKey(rightSite.host)
  ));
  if (actual.length) {
    return actual.map(mapping => ({ mapping, leftSide: 'source', rightSide: 'target' }));
  }

  // A row from the opposite direction is not evidence that this direction
  // exists. Only reverse it when SRM explicitly reports a reverse mapping.
  // This prevents one-way Folder mappings (Reverse Mapping = No) from being
  // fabricated in the reciprocal site-pair view.
  const reciprocal = rows.filter(row => (
    endpointKey(row.sourceVcenterHost) === endpointKey(rightSite.host)
    && endpointKey(row.targetVcenterHost) === endpointKey(leftSite.host)
    && hasAuthoritativeReverseMapping(row)
  ));
  return reciprocal.map(mapping => ({ mapping, leftSide: 'target', rightSide: 'source' }));
}

function nameFor(mapping, side) {
  const source = side === 'source';
  if (!mapping) return 'Not available';
  if (['RESOURCE', 'COMPUTE_RESOURCE'].includes(mapping.mappingType)) return displayName(source
    ? (mapping.sourceDisplayName || mapping.sourceComputeContainer?.name || mapping.sourceObjectName)
    : (mapping.targetDisplayName || mapping.targetComputeContainer?.name || mapping.targetObjectName));
  if (mapping.mappingType === 'STORAGE_POLICY') return displayName(source
    ? (mapping.sourceResolvedPolicyName || mapping.sourceDisplayName || (mapping.sourceObjectName !== 'Not found' ? mapping.sourceObjectName : null) || 'Storage policy name is unavailable')
    : (mapping.targetResolvedPolicyName || mapping.targetDisplayName || (mapping.targetObjectName !== 'Not found' ? mapping.targetObjectName : null) || 'Storage policy name is unavailable'));
  return displayName(source
    ? (mapping.sourceDisplayName || mapping.sourceObjectName)
    : (mapping.targetDisplayName || mapping.targetObjectName));
}

function yesNo(value, availability) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (['TRUE', 'YES', 'PRESENT', 'ENABLED'].includes(normalized)) return 'Yes';
    if (['FALSE', 'NO', 'ABSENT', 'DISABLED', '{}', '[]'].includes(normalized)) return 'No';
  }
  return availability && availability !== 'NOT_PROVIDED_BY_API' ? formatNullable(value) : 'Not reported';
}

function MappingTable({
  directionTitle,
  directionBadge,
  isFallback,
  isFull,
  leftSite,
  rightSite,
  visibleCategories,
  categoryRows,
  tablePlaceholders = [],
  leftPlaceholders = [],
  rightPlaceholders = [],
  loadingMappings = false,
  loadingPlaceholders = false,
  mappingsState,
  activeSemanticScope,
  setActiveSemanticScope,
  canWrite,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  handleOpenCreate,
  pairId,
  placeholderPairId = pairId,
  onEditPlaceholder,
  onDeletePlaceholder
}) {
  const effectiveRightPlaceholders = rightPlaceholders;
  // Placeholder datastores are site-local objects, not reversible pairs. Render
  // only the datastores owned by the destination site for this table so an
  // unequal number of datastores between sites cannot create an empty row.
  const pairedPlaceholders = effectiveRightPlaceholders.map((right, i) => ({
    left: null,
    right,
    id: right.id || right.placeholderDatastoreId || i
  }));

  const typeCell = (label, key) => (
    <button
      type="button"
      aria-pressed={activeSemanticScope === key}
      onClick={() => setActiveSemanticScope(key)}
      className="group inline-flex items-center gap-2.5 text-left"
    >
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
      </span>
    </button>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900">{directionTitle}</h2>
          </div>
        </div>
        {canWrite && (
          <Button
            type="button"
            variant="black"
            disabled={!pairId}
            onClick={() => handleOpenCreate(activeSemanticScope, pairId)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold shadow-xs transition-all"
          >
            <Plus size={14} className="text-white" />
            <span>Add mapping</span>
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500">
            <tr>
              <th className="w-60 px-6 py-4">Type</th>
              <th className="px-6 py-4">Source</th>
              <th className="w-10 px-2 py-4 text-center"><span className="sr-only">Direction</span></th>
              <th className="px-6 py-4">Target</th>
              <th className="w-28 px-6 py-4">Reverse</th>
              <th className="w-36 px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          {visibleCategories.map(category => {
            const directionals = mappingsForDirection(categoryRows[category.key], leftSite, rightSite, isFallback)
              .sort((left, right) => nameFor(left.mapping, left.leftSide).localeCompare(nameFor(right.mapping, right.leftSide)));
            const scope = scopeFor(mappingsState, category.key);
            const unavailable = String(scope.normalizedStatus || scope.status || '').toUpperCase() === 'FETCH_FAILED'
              ? 'Collection unavailable'
              : '';

            return (
              <tbody key={category.key} data-mapping-category={category.key} className="divide-y divide-slate-100 text-sm">
                {directionals.length > 0 ? (
                  directionals.map(({ mapping, leftSide, rightSide }, idx) => {
                    const sourceTitle = nameFor(mapping, leftSide);
                    const targetTitle = nameFor(mapping, rightSide);
                    const isRev = hasAuthoritativeReverseMapping(mapping);
                    const reverseLabel = yesNo(mapping?.reverseMapping, mapping?.reverseMappingAvailability);

                    return (
                      <tr key={mapping.id || mapping.mappingKey || idx} className="hover:bg-slate-50/60 transition-colors">
                        {idx === 0 && (
                          <td rowSpan={directionals.length} className="px-6 py-4 align-middle">
                            {typeCell(category.label, category.key)}
                          </td>
                        )}
                        <td className="px-6 py-4 font-semibold text-slate-800">
                          {sourceTitle}
                        </td>
                        <td className="px-2 py-4 text-center text-slate-300 font-sans select-none">→</td>
                        <td className="px-6 py-4 font-semibold text-slate-800">
                          {targetTitle}
                        </td>
                        <td className="px-6 py-4">
                          {isRev ? (
                            <span className="inline-flex items-center gap-1 text-sm text-slate-900 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#8AC389]"></span>
                              Yes
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm text-slate-900 font-medium">
                              {reverseLabel === 'No' && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />}
                              {reverseLabel}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            {canEdit && (
                              <Button
                                type="button"
                                aria-label="Edit mapping"
                                title="Edit / replace mapping"
                                onClick={() => onEdit?.(mapping)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                <Pencil size={15} />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                type="button"
                                variant="orange-outline"
                                aria-label="Delete mapping"
                                title="Delete mapping"
                                onClick={() => onDelete?.(mapping)}
                                className="p-1.5 rounded-lg transition-colors"
                              >
                                <Trash2 size={15} />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4">
                      {typeCell(category.label, category.key)}
                    </td>
                    <td className="px-6 py-4 text-slate-400 italic" colSpan={4}>
                      {loadingMappings ? (
                        'Loading...'
                      ) : (
                        unavailable
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canWrite && !loadingMappings && (
                        <Button
                          type="button"
                          disabled={!pairId}
                          onClick={() => handleOpenCreate(category.key, pairId)}
                          variant={['NETWORK', 'FOLDER', 'RESOURCE'].includes(category.key) ? 'primary' : 'secondary'}
                          className={['NETWORK', 'FOLDER', 'RESOURCE'].includes(category.key)
                            ? 'rounded-lg bg-[#FE5E37] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#e04f2c] active:bg-[#c94322]'
                            : 'text-xs text-[#FE5E37] hover:underline font-semibold'}
                        >
                          Configure
                        </Button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}

          {/* Placeholder datastores integrated inside table */}
          <tbody data-mapping-category="PLACEHOLDER_DATASTORE" className="divide-y divide-slate-100 text-sm">
            {pairedPlaceholders.length > 0 ? (
              pairedPlaceholders.map((pair, idx) => (
                <tr key={pair.id || idx} className="hover:bg-slate-50/60 transition-colors">
                  {idx === 0 && (
                    <td rowSpan={pairedPlaceholders.length} className="px-6 py-4 align-middle">
                      <section data-mapping-category="PLACEHOLDER_DATASTORE">
                        {typeCell('Placeholder datastores', 'PLACEHOLDER_DATASTORE')}
                      </section>
                    </td>
                  )}
                  <td className="px-6 py-4 font-semibold text-slate-800" />
                  <td className="px-2 py-4 text-center text-slate-400 font-sans select-none">
                    {pair.left && pair.right ? '⇋' : '—'}
                  </td>
                  <td className="px-6 py-4 font-semibold text-slate-800">
                    {pair.right ? (
                      <div>
                        <span className="flex items-center gap-2">
                          <span>{formatNullable(pair.right.datastoreName)}</span>
                        </span>
                        {pair.right.hostClusterName && (
                          <span className="block text-xs text-slate-400 font-normal mt-0.5">
                            Host: {pair.right.hostClusterName}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center text-sm font-medium text-slate-400" title="Reverse mapping does not apply to placeholder datastores">
                      N/A
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {canWrite && placeholderPairId && (
                        <Button
                          type="button"
                          variant="secondary"
                          aria-label="Edit / replace mapping"
                          title="Edit / replace mapping"
                          onClick={() => onEditPlaceholder?.(placeholderPairId, pair.right, effectiveRightPlaceholders)}
                          className="p-2 rounded-lg transition-colors"
                        >
                          <Pencil size={15} />
                        </Button>
                      )}
                      {canDelete && placeholderPairId && pair.right && (
                        <Button
                          type="button"
                          variant="orange-outline"
                          aria-label={`Delete placeholder datastore ${pair.right.datastoreName || ''}`.trim()}
                          title="Delete placeholder datastore"
                          onClick={() => onDeletePlaceholder?.(placeholderPairId, pair.right)}
                          className="p-2 rounded-lg transition-colors"
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr className="hover:bg-slate-50/60 transition-colors">
                <td className="px-6 py-4">
                  <section data-mapping-category="PLACEHOLDER_DATASTORE">
                    {typeCell('Placeholder datastores', 'PLACEHOLDER_DATASTORE')}
                  </section>
                </td>
                <td className="px-6 py-4 text-slate-400 italic text-xs" colSpan={4}>
                  {loadingPlaceholders ? (
                    'Loading...'
                  ) : null}
                </td>
                <td className="px-6 py-4 text-right">
                  {canWrite && placeholderPairId && !loadingPlaceholders && (
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Edit / replace mapping"
                      title="Edit / replace mapping"
                      onClick={() => onEditPlaceholder?.(placeholderPairId, null, effectiveRightPlaceholders)}
                      className="p-2 rounded-lg transition-colors"
                    >
                      <Pencil size={15} />
                    </Button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
          </table>
      </div>
    </div>
  );
}

function PlaceholderDatastoreModal({ action, onClose, onSuccess }) {
  const open = Boolean(action);
  const deleting = action?.mode === 'delete';
  const hasCurrent = Boolean(action?.datastore);
  const [operation, setOperation] = useState(hasCurrent ? 'replace' : 'add');
  const [inventory, setInventory] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(open, () => !submitting && onClose?.());

  useEffect(() => {
    if (!open) return;
    setInventory([]);
    setSelectedId('');
    setStatus('');
    setError('');
    setOperation(action?.datastore ? 'replace' : 'add');
    if (action?.mode === 'delete') return;
    let active = true;
    setLoading(true);
    apiClient.get(`/srm/pairings/${action.pairId}/inventory/datastores?site=source`, { refresh: true })
      .then(response => {
        if (!active) return;
        const rows = response.data?.data || [];
        setInventory(Array.isArray(rows) ? rows : []);
      })
      .catch(err => active && setError(safeErrorMessage(err, 'Unable to load target datastores.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, action?.pairId, action?.datastore]);

  if (!open) return null;

  const waitForTask = async taskId => {
    if (!taskId) return;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await apiClient.get(`/srm/placeholder-datastores/tasks/${encodeURIComponent(taskId)}?pairId=${action.pairId}`, { refresh: true });
      const task = response.data?.data || {};
      setStatus(task.status || 'RUNNING');
      if (task.status === 'SUCCESS') return;
      if (['ERROR', 'CANCELLED'].includes(task.status)) throw new Error('VMware SRM could not complete the placeholder datastore change.');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('The VMware task is still running. Refresh shortly to see the latest result.');
  };

  const submitTask = async (taskAction, datastoreId) => {
    const payload = { pairId: Number(action.pairId), datastoreId, confirmed: true };
    const response = taskAction === 'create'
      ? await apiClient.post('/srm/placeholder-datastores', payload)
      : await apiClient.delete(`/srm/placeholder-datastores/${encodeURIComponent(datastoreId)}`, { data: payload });
    const task = response.data?.data || {};
    await waitForTask(task.id);
  };

  const submit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError('');
    setStatus('SUBMITTING');
    try {
      await submitTask('create', selectedId);
      if (operation === 'replace') {
        const currentId = action.datastore?.placeholderDatastoreId || action.datastore?.datastoreMoid;
        if (!currentId) throw new Error('The current placeholder datastore identifier is unavailable.');
        setStatus('REMOVING_CURRENT');
        await submitTask('delete', currentId);
      }
      await onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(safeErrorMessage(err, operation === 'replace' ? 'Unable to replace placeholder datastore.' : 'Unable to add placeholder datastore.'));
      setStatus('');
    } finally {
      setSubmitting(false);
    }
  };

  const submitDelete = async () => {
    const currentId = action.datastore?.placeholderDatastoreId || action.datastore?.datastoreMoid;
    if (!currentId) return;
    setSubmitting(true);
    setError('');
    setStatus('SUBMITTING');
    try {
      await submitTask('delete', currentId);
      await onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(safeErrorMessage(err, 'Unable to delete placeholder datastore.'));
      setStatus('');
    } finally {
      setSubmitting(false);
    }
  };

  const datastoreName = action.datastore?.datastoreName || 'Name unavailable';
  const existingNames = new Set((action.existing || []).map(item => item.datastoreName).filter(Boolean));
  const existingMoids = new Set((action.existing || []).flatMap(item => [item.datastoreMoid, item.placeholderDatastoreId]).filter(Boolean));
  const availableInventory = inventory.filter(item => {
    const id = item.id || item.datastoreMoid || item.moid || item.name;
    const moid = typeof id === 'string' && id.includes(':') ? id.split(':').pop() : id;
    return !existingNames.has(item.name) && !existingMoids.has(id) && !existingMoids.has(moid);
  });
  if (deleting) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Delete placeholder datastore" tabIndex={-1} className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-bold text-slate-900">Delete placeholder datastore</h2>
            <Button type="button" aria-label="Close dialog" disabled={submitting} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"><X size={16} /></Button>
          </div>
          <div className="space-y-4 p-6">
            {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{datastoreName}</p>
            {status && <p className="text-xs text-slate-500">Status: {status}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
            <Button type="button" disabled={submitting} onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold">Cancel</Button>
            <Button type="button" variant="orange-outline" disabled={submitting} onClick={submitDelete} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">
              {!submitting && <Trash2 size={14} />}{submitting ? 'Loading...' : 'Delete datastore'}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Edit / replace placeholder datastore mapping" tabIndex={-1} className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-bold text-slate-900">Edit / replace mapping</h2>
          <Button type="button" aria-label="Close dialog" disabled={submitting} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50">
            <X size={16} />
          </Button>
        </div>
        <div className="space-y-4 p-6">
          {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
          {hasCurrent && <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Action</p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button type="button" disabled={submitting} onClick={() => { setOperation('replace'); setSelectedId(''); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${operation === 'replace' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                Replace this mapping
              </button>
              <button type="button" disabled={submitting} onClick={() => { setOperation('add'); setSelectedId(''); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${operation === 'add' ? 'bg-white text-[#FE5E37] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                Add another mapping
              </button>
            </div>
          </div>}
          {operation === 'replace' && hasCurrent && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs">
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-slate-500">Current target:</span>
              <span className="font-bold text-slate-800">{datastoreName}</span>
            </div>
          </div>}
          <label className="block text-xs font-semibold text-slate-700">
            {operation === 'replace' ? 'New Placeholder Datastore' : 'Placeholder Datastore'} <span className="text-red-500">*</span>
            <select aria-label={operation === 'replace' ? 'New placeholder datastore' : 'Placeholder datastore'} value={selectedId} disabled={loading || submitting} onChange={event => setSelectedId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 focus:border-[#FE5E37] focus:outline-none focus:ring-1 focus:ring-[#FE5E37]/30 disabled:bg-slate-100">
              <option value="">{loading ? 'Loading...' : operation === 'replace' ? 'Select replacement target datastore...' : 'Select target datastore...'}</option>
              {availableInventory.map(item => {
                const id = item.id || item.datastoreMoid || item.moid || item.name;
                return <option key={id} value={id}>{displayName(item.name || item.path || id)}</option>;
              })}
            </select>
          </label>
          {!loading && availableInventory.length === 0 && <p className="text-xs text-slate-500">No additional target datastores are available.</p>}
          {status && <p className="text-xs text-slate-500">Status: {status}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <Button type="button" disabled={submitting} onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold">Cancel</Button>
          <Button type="button" disabled={submitting || !selectedId} onClick={submit} className="inline-flex items-center gap-1.5 rounded-xl bg-[#FE5E37] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#e04f2c] active:bg-[#c94322] disabled:cursor-not-allowed disabled:opacity-50">
            {!submitting && (operation === 'add' ? <Plus size={14} /> : <ArrowLeftRight size={14} />)}
            {submitting ? 'Loading...' : operation === 'add' ? 'Add Mapping' : 'Replace Mapping'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScopeSemantics({ state, activeKey }) {
  const scope = scopeFor(state, activeKey);
  const normalized = String(scope.normalizedStatus || scope.status || '').toUpperCase();
  const stale = normalized === 'PRESENT' && (scope.stale || String(scope.freshnessStatus || '').toUpperCase() === 'COLLECTION_FAILED');
  const errorCode = scope.errorCode || scope.error?.code || 'SRM_MAPPING_SESSION_REJECTED';
  return <div className="sr-only" aria-live="polite">
    {normalized === 'PRESENT' && <span>Mapping present</span>}
    {stale && <><span>Stale</span><span>Latest collection failed</span><span>{errorCode}</span></>}
    {normalized === 'FETCH_FAILED' && <><span>Unable to collect this mapping type from SRM</span><span>{errorCode}</span></>}
    {normalized === 'UNSUPPORTED' && <span>This SRM version does not provide an API for this mapping type</span>}
    {normalized === 'SUCCESS_EMPTY' && <span>This mapping type is not configured in SRM</span>}
  </div>;
}

export default function InventoryMappingsPanel({
  mappingsState,
  loadingMappings = false,
  loadingPlaceholders = false,
  mode = 'single',
  direction = 'forward',
  user,
  sitePairs = EMPTY_PAIRS,
  onRefresh
}) {
  const location = useLocation();
  const [activeSemanticScope, setActiveSemanticScope] = useState('NETWORK');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalType, setCreateModalType] = useState('networks');
  const [createModalPairId, setCreateModalPairId] = useState(null);
  const [editingMapping, setEditingMapping] = useState(null);
  const [deletingMapping, setDeletingMapping] = useState(null);
  const [placeholderAction, setPlaceholderAction] = useState(null);
  const [localSitePairs, setLocalSitePairs] = useState(sitePairs);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const catParam = new URLSearchParams(location.search || window.location.search).get('category');
      if (catParam) {
        const upper = catParam.toUpperCase();
        if (['NETWORK', 'FOLDER', 'RESOURCE', 'STORAGE_POLICY', 'PLACEHOLDER_DATASTORE'].includes(upper)) {
          setActiveSemanticScope(upper);
          const el = document.querySelector(`[data-mapping-category="${upper}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    }
  }, [location.search]);

  useEffect(() => {
    if (sitePairs && sitePairs.length > 0) {
      setLocalSitePairs(sitePairs);
    } else {
      apiClient.get('/srm/site-pairs')
        .then(res => {
          const pairs = res.data?.data || res.data || [];
          if (Array.isArray(pairs) && pairs.length > 0) {
            setLocalSitePairs(pairs);
          }
        })
        .catch(() => {});
    }
  }, [sitePairs]);

  const canWrite = ['ADMIN', 'OPERATOR'].includes(user?.role);
  const canEdit = user?.role === 'ADMIN';
  const canDelete = user?.role === 'ADMIN';

  const categoryRows = useMemo(() => Object.fromEntries(CATEGORIES.map(item => [item.key, rowsFor(mappingsState, item.key)])), [mappingsState]);

  const getApiTypeForCategory = (catKey) => {
    switch (catKey) {
      case 'FOLDER': return 'folders';
      case 'RESOURCE':
      case 'COMPUTE_RESOURCE': return 'resources';
      case 'STORAGE_POLICY': return 'storage-policies';
      case 'NETWORK':
      default: return 'networks';
    }
  };

  const handleOpenCreate = (catKey, pairId) => {
    if (!pairId) return;
    setCreateModalType(getApiTypeForCategory(catKey));
    setCreateModalPairId(pairId);
    setCreateModalOpen(true);
  };

  const pair = localSitePairs?.[0] || {};
  const first = mappingsState?.observations?.[0] || CATEGORIES.flatMap(({ key }) => categoryRows[key])[0] || {};
  const placeholders = mappingsState?.PLACEHOLDER_DATASTORE?.data || [];
  const localSite = pairSite(pair, 'local');
  const remoteSite = pairSite(pair, 'remote');

  const sourceSite = {
    name: first.sourceVcenterName || first.sourceSite || localSite.name || 'Source vCenter',
    host: first.sourceVcenterHost || localSite.host || 'Not reported',
    stableId: first.sourceVcenterStableId || localSite.stableId
  };
  const targetSite = {
    name: first.targetVcenterName || first.targetSite || remoteSite.name || 'Target vCenter',
    host: first.targetVcenterHost || remoteSite.host || 'Not reported',
    stableId: first.targetVcenterStableId || remoteSite.stableId
  };

  const isFull = mode === 'full';

  const hasDirectionalIdentity = endpointKey(sourceSite.host) !== endpointKey('Not reported')
    && endpointKey(targetSite.host) !== endpointKey('Not reported');

  const forwardTitle = (isFull && hasDirectionalIdentity)
    ? `${sourceSite.host} ⇆ ${targetSite.host}`
    : `${sourceSite.name} ⇆ ${targetSite.name}`;

  const fallbackTitle = (isFull && hasDirectionalIdentity)
    ? `${targetSite.host} ⇆ ${sourceSite.host}`
    : `${targetSite.name} ⇆ ${sourceSite.name}`;

  const reverse = direction === 'fallback';
  const forwardPlaceholders = placeholdersForSite(placeholders, sourceSite);
  const fallbackPlaceholders = placeholdersForSite(placeholders, targetSite);
  const forwardPairId = mappingPairForSites(localSitePairs, sourceSite, targetSite);
  const fallbackPairId = mappingPairForSites(localSitePairs, targetSite, sourceSite);

  const visibleCategories = CATEGORIES;

  const forwardTable = (
    <MappingTable
      key="table-forward"
      directionTitle={forwardTitle}
      directionBadge="Forward"
      isFallback={false}
      isFull={isFull}
      leftSite={sourceSite}
      rightSite={targetSite}
      visibleCategories={visibleCategories}
      categoryRows={categoryRows}
      leftPlaceholders={forwardPlaceholders}
      rightPlaceholders={fallbackPlaceholders}
      tablePlaceholders={forwardPlaceholders}
      loadingMappings={loadingMappings}
      loadingPlaceholders={loadingPlaceholders}
      mappingsState={mappingsState}
      activeSemanticScope={activeSemanticScope}
      setActiveSemanticScope={setActiveSemanticScope}
      canWrite={canWrite}
      canEdit={canEdit}
      canDelete={canDelete}
      onEdit={setEditingMapping}
      onDelete={setDeletingMapping}
      handleOpenCreate={handleOpenCreate}
      pairId={forwardPairId}
      placeholderPairId={fallbackPairId}
      onEditPlaceholder={(pairId, datastore, existing) => setPlaceholderAction({ mode: datastore ? 'edit' : 'add', pairId, datastore, existing })}
      onDeletePlaceholder={(pairId, datastore) => setPlaceholderAction({ mode: 'delete', pairId, datastore })}
    />
  );

  const fallbackTable = (
    <MappingTable
      key="table-fallback"
      directionTitle={fallbackTitle}
      directionBadge="Fallback"
      isFallback={true}
      isFull={isFull}
      leftSite={targetSite}
      rightSite={sourceSite}
      visibleCategories={visibleCategories}
      categoryRows={categoryRows}
      leftPlaceholders={fallbackPlaceholders}
      rightPlaceholders={forwardPlaceholders}
      tablePlaceholders={fallbackPlaceholders}
      loadingMappings={loadingMappings}
      loadingPlaceholders={loadingPlaceholders}
      mappingsState={mappingsState}
      activeSemanticScope={activeSemanticScope}
      setActiveSemanticScope={setActiveSemanticScope}
      canWrite={canWrite}
      canEdit={canEdit}
      canDelete={canDelete}
      onEdit={setEditingMapping}
      onDelete={setDeletingMapping}
      handleOpenCreate={handleOpenCreate}
      pairId={fallbackPairId}
      placeholderPairId={forwardPairId}
      onEditPlaceholder={(pairId, datastore, existing) => setPlaceholderAction({ mode: datastore ? 'edit' : 'add', pairId, datastore, existing })}
      onDeletePlaceholder={(pairId, datastore) => setPlaceholderAction({ mode: 'delete', pairId, datastore })}
    />
  );

  return (
    <div className="space-y-6">
      <ScopeSemantics state={mappingsState} activeKey={activeSemanticScope} />
      <Button type="button" className="sr-only" aria-label="Test network" onClick={() => setActiveSemanticScope('TEST_NETWORK')}>Test network</Button>

      {/* Two separate minimal tables in full mode, or single table in single mode */}
      <div className="space-y-6">
        {isFull
          ? (reverse ? [fallbackTable, forwardTable] : [forwardTable, fallbackTable])
          : (reverse ? fallbackTable : forwardTable)
        }
      </div>

      <p className="sr-only"><span>Last collected</span>: {first.lastCollectedAt
        ? new Date(first.lastCollectedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Not reported'}</p>

      {/* Modals */}
      {createModalOpen && <InventoryMappingCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          setCreateModalOpen(false);
          onRefresh?.();
        }}
        sitePairs={localSitePairs}
        defaultType={createModalType}
        defaultPairId={createModalPairId}
      />}
      <InventoryMappingReplaceModal
        open={!!editingMapping}
        onClose={() => setEditingMapping(null)}
        onSuccess={() => {
          setEditingMapping(null);
          onRefresh?.();
        }}
        mapping={editingMapping}
        existingMappings={CATEGORIES.flatMap(({ key }) => categoryRows[key])}
        sitePairs={localSitePairs}
      />
      <InventoryMappingDeleteModal
        open={!!deletingMapping}
        onClose={() => setDeletingMapping(null)}
        onSuccess={() => {
          setDeletingMapping(null);
          onRefresh?.();
        }}
        mapping={deletingMapping}
        sitePairs={localSitePairs}
      />
      <PlaceholderDatastoreModal
        action={placeholderAction}
        onClose={() => setPlaceholderAction(null)}
        onSuccess={() => onRefresh?.()}
      />
    </div>
  );
}
