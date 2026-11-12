import Button from './Button';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Plus, Settings, RefreshCw, X, ArrowRight, CheckCircle,
  AlertTriangle, Pause, Play, Sliders, Trash2, ChevronDown
} from 'lucide-react';
import api, {invalidateReadCache} from '../../api/apiClient';
import {submitSrm,waitSrmOperation} from '../../api/srmOperations';
import { trackBackgroundOperation } from '../../api/backgroundOperations';
import ReplicationSettings from './ReplicationSettings';
import {validSettings} from '../../utils/replicationSettings';
import {displayName} from '../../utils/displayNames';
import {safeErrorMessage} from '../../utils/safeErrorMessage';
import {validateVmwareObjectName} from '../../utils/vmwareObjectName';
import {getCapacitySeverity, getVmPowerStatePresentation} from '../../utils/overview-severity';
import {formatBytes} from '../../utils/formatters';
import {completeReplicationProtection, waitForReplicationOperations} from '../../utils/replicationProtectionFollowup';
import {getReplicationDatastoreReview, getReplicationFeedback, replicationVmName, REPLICATION_CREATE_COMPLETED_MESSAGE} from '../../utils/replicationFeedback';
import ReplicationStatusNotice from './ReplicationStatusNotice';



const WIZARD_STEPS = [
  { num: 1, label: 'Virtual machines' },
  { num: 2, label: 'Target site' },
  { num: 3, label: 'Target datastore' },
  { num: 4, label: 'Replication settings' },
  { num: 5, label: 'Protection group' },
  { num: 6, label: 'Ready to Complete' }
];

const RECONFIG_STEPS = [
  { num: 1, label: 'Target datastore' },
  { num: 2, label: 'Replication settings' },
  { num: 3, label: 'Review changes' }
];

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const buttonClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40';

function replicationPairId(rep,pairList,fallback){
  const directional=(pairList||[]).filter(p=>
    (!rep.logicalSourceVcenterStableId||p.sourceVcenterId===rep.logicalSourceVcenterStableId)&&
    (!rep.logicalTargetVcenterStableId||p.targetVcenterId===rep.logicalTargetVcenterStableId));
  if(directional.length===1)return Number(directional[0].id);
  const raw=String(fallback||rep.pairingId||'').trim();
  const matched=(pairList||[]).find(p=>p.pairingId===raw||String(p.id)===raw);
  return matched?Number(matched.id):0;
}

function endpointKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

const VrManagement = forwardRef(function VrManagement({ user, onUpdated, showLaunchers = true }, ref) {
  const canWrite = ['ADMIN', 'OPERATOR'].includes(user?.role);
  const isAdmin = user?.role === 'ADMIN';

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('configure'); // 'configure' | 'manage' | 'pause' | 'resume' | 'sync' | 'reconfigure' | 'unconfigure'
  const [wizardStep, setWizardStep] = useState(1);
  const [pairs, setPairs] = useState([]);
  const [pairId, setPairId] = useState('');
  const [lockedPairContext, setLockedPairContext] = useState(null);
  const [vms, setVms] = useState([]);
  const [reps, setReps] = useState([]);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingStage, setLoadingStage] = useState(null);
  const [selectedVmId, setSelectedVmId] = useState('');
  const [selectedVmIds, setSelectedVmIds] = useState([]);
  const [vmPickerOpen, setVmPickerOpen] = useState(false);
  const [operation, setOperation] = useState(null);
  const [activeRep, setActiveRep] = useState(null);

  // New operation states
  const [toast, setToast] = useState(null);
  const [syncingId, setSyncingId] = useState(null);
  const [reconfigStep, setReconfigStep] = useState(1);
  const [initialForm, setInitialForm] = useState(null);
  const [stopMode, setStopMode] = useState('graceful');
  const [retainReplicaDisks, setRetainReplicaDisks] = useState(false);

  // Decoupled SRM Protection states
  const [srmMode, setSrmMode] = useState('none'); // 'existing' | 'new' | 'none'
  const [srmPair, setSrmPair] = useState(null);
  const [srmLoading,setSrmLoading] = useState(false);
  const srmStarted=useRef(null);
  const srmRunning = useRef(false);
  const [newPgName, setNewPgName] = useState('');
  const [srmPgs, setSrmPgs] = useState([]);
  const [srmRps, setSrmRps] = useState([]);
  const [selectedPgId, setSelectedPgId] = useState('');
  const [selectedRpId, setSelectedRpId] = useState('');
  const [srmPendingContext, setSrmPendingContext] = useState(null);
  const srmPendingRef = useRef(null);
  const [protectionResultModal, setProtectionResultModal] = useState(null);

  const generation = useRef(0);
  const createPresetRef = useRef(null);
  const submitting = useRef(false);
  const operationLocked = useRef(false);
  function acceptOperation(value) {
    if (value && ['SUCCESS','FAILED'].includes(value.status) &&
        (operation?.operationId !== value.operationId || operation?.status !== value.status)) {
      // A catalog may have been read again while the asynchronous task ran.
      invalidateReadCache();
    }
    operationLocked.current = Boolean(srmPendingRef.current || (value && !['SUCCESS','FAILED'].includes(value.status)));
    setOperation(value);
  }
  function trackVrOperation(value, label, resourceId) {
    const id = value?.operationId || value?.id;
    if (!id) return;
    trackBackgroundOperation({
      id,
      provider: 'VR',
      label,
      resourceKey: `replication:${resourceId || value?.replicationId || value?.vmId || id}`
    });
  }
  function queueProtection(context, operationId) {
    if (!context || !operationId) return;
    const pending = { ...context, operationId, progress:{} };
    srmPendingRef.current = pending;
    setSrmPendingContext(pending);
    operationLocked.current = true;
  }
  async function reconcileSubmissionError(err) {
    const id=err.response?.data?.operationId;
    if (!id) return;
    try {
      const r=await api.get('/vr/management/operations/'+encodeURIComponent(id));
      trackVrOperation(r.data.data, 'Replication operation', r.data.data?.replicationId || r.data.data?.vmId);
    }
    catch { showToast('Task status unavailable. Do not resubmit.','error'); }
  }

  function showToast(message, type = 'success') {
    setToast({ message, type, id: Date.now() });
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useImperativeHandle(ref, () => ({
    openCreateWizard: (pairContext, preset = null) => {
      openModal('configure', pairContext, null, null, preset);
    },
    openActionModal: (action, rep, targetPairId) => {
      if (action === 'sync') {
        handleSync(rep, targetPairId);
        return;
      }
      openModal(action, null, rep, targetPairId);
    },
    openManageModal: (targetPairId) => {
      openModal('manage', null, null, targetPairId);
    }
  }));

  function safeError(prefix = 'VMware vSphere Replication management error') {
    setError(prefix);
  }

  function resetState() {
    setPairId('');
    setVms([]);
    setReps([]);
    setConfig(null);
    setForm(null);
    setInitialForm(null);
    setError('');
    setLoadingStage(null);
    setSelectedVmId('');
    if (typeof setSelectedVmIds === 'function') setSelectedVmIds([]);
    setVmPickerOpen(false);
    setActiveRep(null);
    setWizardStep(1);
    setReconfigStep(1);
    setStopMode('graceful');
    setRetainReplicaDisks(false);
    setSelectedPgId('');
    setSelectedRpId('');
    setProtectionResultModal(null);
  }

  async function handleSync(rep, targetPairId) {
    if (submitting.current || operationLocked.current) return;
    submitting.current=true;
    setSyncingId(rep.replicationId);
    try {
      let pairList = pairs;
      if (!pairList || pairList.length === 0) {
        try {
          const pr = await api.get('/vr/management/pairings');
          pairList = pr.data?.data || [];
          setPairs(pairList);
        } catch {}
      }

      const pId=replicationPairId(rep,pairList,targetPairId||pairId);

      const r = await api.post('/vr/management/actions/sync', {
        pairId: Number(pId || 0),
        replicationId: rep.replicationId,
        vmId: rep.vmId || rep.vmMoid,
        confirmed: true
      });
      showToast('Synchronization started.', 'success');
      setOpen(false);
      if (r.data?.data) {
        trackVrOperation(r.data.data, `Synchronize ${displayName(rep.vmName || rep.name, 'replication')}`, rep.replicationId);
      }
      onUpdated?.();
    } catch (err) {
      await reconcileSubmissionError(err);
      const safeMsg = err.response?.data?.error?.safeMessage
        || err.response?.data?.error?.message
        || err.response?.data?.message
        || 'Synchronization request failed.';
      showToast(`Unable to start synchronization. ${safeMsg}`, 'error');
    } finally {
      submitting.current=false;
      setSyncingId(null);
    }
  }

  async function submitPause() {
    if (busy || !form || submitting.current || operationLocked.current) return;
    submitting.current=true;
    setBusy(true);
    const pId = Number(form.pairId || pairId || 0);
    try {
      const r = await api.post('/vr/management/actions/pause', {
        pairId: pId,
        replicationId: form.replicationId,
        vmId: form.vmId,
        confirmed: true
      });
      setOpen(false);
      showToast('Pause submitted.', 'success');
      if (r.data?.data) {
        trackVrOperation(r.data.data, `Pause ${displayName(form.vmName || form.name, 'replication')}`, form.replicationId);
      }
      onUpdated?.();
    } catch (err) {
      await reconcileSubmissionError(err);
      const safeMsg = err.response?.data?.error?.safeMessage
        || err.response?.data?.error?.message
        || err.response?.data?.message
        || 'Pause request failed.';
      showToast(`Unable to pause replication. ${safeMsg}`, 'error');
    } finally {
      submitting.current=false;
      setBusy(false);
    }
  }

  async function submitResume() {
    if (busy || !form || submitting.current || operationLocked.current) return;
    submitting.current=true;
    setBusy(true);
    const pId = Number(form.pairId || pairId || 0);
    try {
      const r = await api.post('/vr/management/actions/resume', {
        pairId: pId,
        replicationId: form.replicationId,
        vmId: form.vmId,
        confirmed: true
      });
      setOpen(false);
      showToast('Resume submitted.', 'success');
      if (r.data?.data) {
        trackVrOperation(r.data.data, `Resume ${displayName(form.vmName || form.name, 'replication')}`, form.replicationId);
      }
      onUpdated?.();
    } catch (err) {
      await reconcileSubmissionError(err);
      const safeMsg = err.response?.data?.error?.safeMessage
        || err.response?.data?.error?.message
        || err.response?.data?.message
        || 'Resume request failed.';
      showToast(`Unable to resume replication. ${safeMsg}`, 'error');
    } finally {
      submitting.current=false;
      setBusy(false);
    }
  }

  async function submitRemove() {
    if (busy || !form || submitting.current || operationLocked.current) return;
    submitting.current=true;
    setBusy(true);
    const pId = Number(form.pairId || pairId || 0);
    try {
      const r = await api.post('/vr/management/actions/unconfigure', {
        pairId: pId,
        replicationId: form.replicationId,
        vmId: form.vmId,
        stopMode,
        retainReplicaDisks,
        confirmed: true
      });
      setOpen(false);
      showToast('Removal submitted.', 'success');
      if (r.data?.data) {
        trackVrOperation(r.data.data, `Remove ${displayName(form.vmName || form.name, 'replication')}`, form.replicationId);
      }
      onUpdated?.();
    } catch (err) {
      await reconcileSubmissionError(err);
      const code = err.response?.data?.error?.code;
      const safeMsg = err.response?.data?.error?.safeMessage
        || err.response?.data?.error?.message
        || err.response?.data?.message
        || 'Remove replication failed.';
      showToast(code === 'VR_OPERATION_IN_PROGRESS' ? safeMsg : `Unable to remove replication. ${safeMsg}`, 'error');
    } finally {
      submitting.current=false;
      setBusy(false);
    }
  }

  async function submitReconfigure() {
    if (busy || !form || !validSettings(config, form) || submitting.current || operationLocked.current || JSON.stringify(form) === JSON.stringify(initialForm)) return;
    submitting.current=true;
    setBusy(true);
    setError('');
    const pId = Number(form.pairId || pairId || 0);
    const payload = {
      pairId: pId,
      replicationId: form.replicationId,
      vmId: form.vmId,
      rpo: Number(form.rpo),
      networkCompression: Boolean(form.networkCompression),
      quiesce: Boolean(form.quiesce),
      mpit: Boolean(form.mpit),
      ...(form.mpit ? {mpitInstances:Number(form.mpitInstances),mpitDays:Number(form.mpitDays)} : {}),
      ...(config?.settings?.dataSetsExposed ? {dataSets:Boolean(form.dataSets)} : {}),
      autoReplicateNewDisks: Boolean(form.autoReplicateNewDisks),
      encryption: Boolean(form.encryption),
      disks: (form.disks || []).map(d => ({
        deviceKey: d.deviceKey,
        isVmHome: d.isVmHome,
        enabled: d.enabled,
        datastoreId: d.datastoreId,
        storagePolicyId: d.storagePolicyId || null
      })),
      confirmed: true
    };
    try {
      const r = await api.post('/vr/management/actions/reconfigure', payload);
      setOpen(false);
      showToast('Reconfiguration submitted.', 'success');
      if (r.data?.data) {
        trackVrOperation(r.data.data, `Reconfigure ${displayName(form.vmName || form.name, 'replication')}`, form.replicationId);
      }
      onUpdated?.();
    } catch (err) {
      await reconcileSubmissionError(err);
      const safeMsg = err.response?.data?.error?.safeMessage
        || err.response?.data?.error?.message
        || err.response?.data?.message
        || 'Reconfiguration failed.';
      showToast(`Unable to reconfigure replication. ${safeMsg}`, 'error');
    } finally {
      submitting.current=false;
      setBusy(false);
    }
  }

  function openModal(initialMode = 'configure', pairContext = null, targetRep = null, targetPairId = null, createPreset = null) {
    if (initialMode === 'sync') {
      if (targetRep) handleSync(targetRep, targetPairId);
      return;
    }
    setMode(initialMode);
    resetState();
    createPresetRef.current = initialMode === 'configure' && createPreset
      ? { ...createPreset, applied: false }
      : null;
    if (operation && ['SUCCESS', 'FAILED'].includes(operation.status) && !srmPendingRef.current) {
      setOperation(null);
    }
    setLockedPairContext(pairContext);
    setOpen(true);

    if (targetRep) {
      chooseAction(targetRep, initialMode, targetPairId);
    }
  }

  // Resolve the SRM direction by stable vCenter identities from the chosen VR pairing.
  useEffect(() => {
    if (!open || mode !== 'configure') return;
    const chosen=pairs.find(p=>String(p.id)===String(pairId));
    let active=true;
    setSrmPair(null);setSrmPgs([]);setSrmRps([]);setSelectedPgId('');setSelectedRpId('');
    if(!chosen)return;
    setSrmLoading(true);
    api.get('/srm/site-pairs').then(async r=>{
      const matches=(r.data.data||[]).filter(p=>p.local_vcenter_id===chosen.sourceVcenterId&&p.remote_vcenter_id===chosen.targetVcenterId);
      if(matches.length!==1)return;
      const result=await api.get('/srm/pairings/'+matches[0].id+'/options');
      if(active){setSrmPair(matches[0]);setSrmPgs(result.data.data.groups||[]);setSrmRps(result.data.data.plans||[]);}
    }).catch(()=>{if(active)setSrmPair(null);}).finally(()=>{if(active)setSrmLoading(false);});
    return()=>{active=false;};
  },[open,mode,pairId,pairs]);

  // Snapshot the selection at open. Changing the selected pair must not reload
  // the catalogue and reset the wizard; the directional context may reopen it.
  const pairingSelection = useRef(null);
  pairingSelection.current = {activeRep,mode,pairId};
  // Initial load of pairings when modal opens
  useEffect(() => {
    if (!open) return;
    const {activeRep,mode,pairId}=pairingSelection.current;
    let active = true;
    setBusy(true);
    setError('');

    api.get('/vr/management/pairings')
      .then(r => {
        if (!active) return;
        const list = r.data.data || [];
        setPairs(list);

        if (lockedPairContext) {
          const matched = list.find(p =>
            (lockedPairContext.pairId && String(p.id) === String(lockedPairContext.pairId)) ||
            (lockedPairContext.sourceVcenterId && lockedPairContext.targetVcenterId &&
             p.sourceVcenterId === lockedPairContext.sourceVcenterId && p.targetVcenterId === lockedPairContext.targetVcenterId) ||
            (lockedPairContext.sourceHost && lockedPairContext.targetHost &&
             endpointKey(p.sourceHost) === endpointKey(lockedPairContext.sourceHost) && endpointKey(p.targetHost) === endpointKey(lockedPairContext.targetHost)) ||
            (lockedPairContext.sourceVcenterId && !lockedPairContext.targetVcenterId &&
             String(p.sourceVcenterId) === String(lockedPairContext.sourceVcenterId)) ||
            (lockedPairContext.sourceHost && !lockedPairContext.targetHost &&
             endpointKey(p.sourceHost) === endpointKey(lockedPairContext.sourceHost))
          );
          if (matched) {
            selectPair(String(matched.id));
          } else {
            safeError('The selected pairing is no longer available. Select a verified source and target again.');
          }
        } else if (activeRep && mode !== 'configure') {
          const repPair = list.find(p =>
            (p.sourceVcenterId === activeRep.logicalSourceVcenterStableId && p.targetVcenterId === activeRep.logicalTargetVcenterStableId) ||
            (p.sourceHost === activeRep.logicalSourceVcenterHost && p.targetHost === activeRep.logicalTargetVcenterHost)
          );
          if (repPair) {
            setPairId(String(repPair.id));
          }
        } else if (list.length > 0 && !pairId) {
          selectPair(String(list[0].id));
        }
      })
      .catch(() => { if (active) safeError('Failed to load replication pairings'); })
      .finally(() => { if (active && mode !== 'reconfigure') setBusy(false); });

    return () => { active = false; };
  }, [open, lockedPairContext]);

  useEffect(() => {
    const preset = createPresetRef.current;
    if (!open || mode !== 'configure' || !pairId || !preset || preset.applied || vms.length === 0) return;
    const matchedVm = vms.find(vm => preset.vmId && String(vm.vmId) === String(preset.vmId))
      || vms.find(vm => preset.vmName && String(vm.vmName || vm.name || '').toLowerCase() === String(preset.vmName).toLowerCase());
    if (!matchedVm) {
      preset.applied = true;
      safeError('The selected virtual machine is not available for replication on this route.');
      return;
    }
    preset.applied = true;
    setSelectedVmIds([matchedVm.vmId]);
    selectVm(matchedVm.vmId).then(() => {
      setWizardStep(preset.startStep || 2);
    });
  }, [open, mode, pairId, vms]);

  const operationId=operation?.operationId,operationStatus=operation?.status;
  // Keep operation polling independent from the currently open form.
  useEffect(() => {
    if (!operationId || ['SUCCESS', 'FAILED', 'UNKNOWN'].includes(operationStatus)) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling || !active) return;
      polling = true;
      try {
        const r = await api.get(`/vr/management/operations/${operationId}`);
        if (!active) return;
        const currentOp = r.data.data;
        acceptOperation(currentOp);
        if (currentOp.status === 'FAILED') {
          const detail=typeof currentOp.error==='object'?currentOp.error:{};
          const code=detail.code||currentOp.errorCode||currentOp.failureCode;
          const message=detail.safeMessage||currentOp.safeMessage||'Replication operation failed.';
          showToast(code&&!message.includes(code)?`${message} (${code})`:message,'error');
          onUpdated?.();
        }
        if (currentOp.status === 'SUCCESS') {
          showToast(({pause:'Replication paused.',resume:'Replication resumed.',unconfigure:'Replication removed.',reconfigure:'Replication reconfigured.',sync:'Synchronization completed.'})[currentOp.operationType] || REPLICATION_CREATE_COMPLETED_MESSAGE);
          onUpdated?.();
        }
      } catch {
        if (active) showToast('Task status could not be refreshed. Do not resubmit.','error');
      } finally { polling = false; }
    };
    const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [operationId, operationStatus, onUpdated]);

  // A form reset must not discard the follow-up requested for an accepted task.
  async function applyProtection(context = srmPendingRef.current) {
    if (!context || srmRunning.current || context.operationId !== operationId ||
        operationStatus !== 'SUCCESS' || operation?.operationType !== 'configure' || context.vmId !== operation?.vmId) return;
    srmRunning.current = true;
    const progress = { ...context.progress };
    const savePending = (extra = {}) => {
      const pending = { ...context, progress:{...progress}, paused:false, ...extra };
      srmPendingRef.current = pending;
      setSrmPendingContext(pending);
    };
    const summary = (extra = {}) => ({
      vrSuccess:true, pgSuccess:Boolean(progress.pgSuccess), rpSuccess:Boolean(progress.rpSuccess),
      pgName:context.pgName, rpName:context.rpName, ...extra
    });
    savePending();
    setProtectionResultModal(summary({checking:true, message:'Checking SRM protection status…'}));
    let resumable = false;
    try {
      await completeReplicationProtection({
        context, progress,
        submit:(url, body) => submitSrm('POST', url, body),
        wait:waitSrmOperation,
        onProgress:() => {
          savePending();
          setProtectionResultModal(summary({checking:true, message:'Checking SRM protection status…'}));
        }
      });
      setProtectionResultModal(summary({message:'Protection group membership verified and inventory refreshed. Check the group protection status and configure VMs before running recovery.'}));
      if (typeof showToast === 'function') showToast('Replication protection completed.', 'success');
      onUpdated?.();
    } catch (error) {
      resumable = error.protectionOperationPending === true;
      const message = safeErrorMessage(error, resumable
        ? 'SRM verification is still pending. Resume the status check to continue tracking the accepted operation.'
        : 'SRM operation could not be verified. Check its status before submitting again.');
      if (resumable) savePending({paused:true, message});
      setProtectionResultModal(summary({resumable, message}));
      if (typeof showToast === 'function') showToast(message, 'error');
    } finally {
      srmRunning.current = false;
      if (!resumable) {
        srmPendingRef.current = null;
        setSrmPendingContext(null);
        operationLocked.current = false;
      }
    }
  }

  function resumeProtection() {
    if (srmPendingRef.current?.paused) applyProtection(srmPendingRef.current);
  }

  useEffect(() => {
    const context = srmPendingContext;
    if (!context || context.operationId !== operationId || operation?.operationType !== 'configure' || context.vmId !== operation?.vmId) return;
    if (operationStatus === 'FAILED') {
      srmPendingRef.current = null;
      setSrmPendingContext(null);
      operationLocked.current = false;
      return;
    }
    if (operationStatus !== 'SUCCESS' || srmStarted.current === operationId) return;
    srmStarted.current = operationId;
    applyProtection(context);
  }, [operationId, operationStatus, operation?.operationType, operation?.vmId, srmPendingContext, onUpdated]);

  async function selectPair(value, refresh = false) {
    const serial = ++generation.current;
    setPairId(value);
    setConfig(null);
    setForm(null);
    setVms([]);
    setReps([]);
    setSelectedVmId('');
    if (typeof setSelectedVmIds === 'function') setSelectedVmIds([]);
    setWizardStep(1);
    setError('');
    if (!value) {
      setBusy(false);
      setLoadingStage(null);
      return;
    }

    const vmsPath = `/vr/management/pairings/${value}/vms`;
    const replicationsPath = `/vr/management/pairings/${value}/replications`;
    setBusy(true);
    setLoadingStage('pair');
    try {
      const [v, r] = await Promise.all([
        api.get(vmsPath, {refresh}),
        // Creating replication only needs suitable VMs. A slow or unavailable
        // management list must not prevent opening the create wizard.
        mode === 'configure' ? Promise.resolve(null) : api.get(replicationsPath, {refresh})
      ]);
      if (serial === generation.current) {
        setVms(v.data.data || []);
        setReps(r?.data?.data || []);
      }
    } catch {
      if (serial === generation.current) safeError('Failed to retrieve inventory for the selected pairing');
    } finally {
      if (serial === generation.current) { setBusy(false); setLoadingStage(null); }
    }
  }

  async function selectVm(vmId, refresh = false) {
    const serial = ++generation.current;
    setConfig(null);
    setForm(null);
    setError('');
    setSelectedVmId(vmId);
    if (!vmId) {
      setBusy(false);
      setLoadingStage(null);
      return;
    }

    setBusy(true);
    setLoadingStage('vm');
    try {
      const r = await api.get(`/vr/management/pairings/${pairId}/configuration`, { params: { vmId }, refresh });
      if (serial !== generation.current) return;
      const c = r.data.data;
      setConfig(c);
      setForm({
        pairId: Number(pairId),
        vmId,
        rpo: c.rpo.min,
        networkCompression: c.capability?.network_compression_supported === true,
        quiesce: false,
        mpit: false,
        dataSets: c.settings?.dataSetsExposed === true,
        autoReplicateNewDisks: c.capability?.auto_replicate_new_disks_supported === true,
        encryption: c.capability?.lwd_encryption_supported === true,
        disks: (c.disks || []).map(d => ({
          deviceKey: d.device_key,
          isVmHome: d.is_vm_home,
          enabled: d.is_vm_home || d.supported_for_replication === true,
          datastoreId: '',
          storagePolicyId: null
        }))
      });
    } catch {
      if (serial === generation.current) safeError('Failed to load VM replication configuration');
    } finally {
      if (serial === generation.current) { setBusy(false); setLoadingStage(null); }
    }
  }

  async function toggleVmSelection(vmId) {
    const selected = selectedVmIds.includes(vmId);
    const next = selected
      ? selectedVmIds.filter(id => id !== vmId)
      : [...selectedVmIds, vmId];
    setSelectedVmIds(next);
    if (!selectedVmId && !selected && next.length === 1) {
      await selectVm(vmId);
      return;
    }
    if (selected && selectedVmId === vmId) {
      if (next.length > 0) await selectVm(next[0]);
      else await selectVm('');
    }
  }

  function retryAfterError() {
    // A failed submission has not changed the wizard choices. Reloading the
    // VM configuration would clear the selected datastores and settings while
    // leaving the user on Review.
    if (mode === 'configure' && form && config) {
      setError('');
      return;
    }
    if (selectedVmId) selectVm(selectedVmId, true);
    else selectPair(pairId, true);
  }

  async function chooseAction(rep, action, activePairId = pairId) {
    if (action === 'sync') {
      handleSync(rep, activePairId);
      return;
    }
    setActiveRep(rep);
    setMode(action);
    setConfig(null);
    if (operation && ['SUCCESS', 'FAILED'].includes(operation.status) && !srmPendingRef.current) {
      setOperation(null);
    }
    setError('');

    let pairList = pairs;
    if (!pairList || pairList.length === 0) {
      try {
        const pr = await api.get('/vr/management/pairings');
        pairList = pr.data?.data || [];
        setPairs(pairList);
      } catch {}
    }

    const repPairId=replicationPairId(rep,pairList,activePairId||pairId);

    if (repPairId) setPairId(String(repPairId));
    setForm({
      pairId: repPairId,
      replicationId: rep.replicationId,
      vmId: rep.vmId || rep.vmMoid,
      rpo: rep.rpo || rep.rpoMinutes
    });
    setStopMode('graceful');
    setRetainReplicaDisks(false);
    setReconfigStep(1);
    setInitialForm(null);

    if (action === 'reconfigure' && repPairId) {
      setBusy(true);
      const serial = ++generation.current;
      api.get(`/vr/management/pairings/${repPairId}/current-configuration`, { params: { replicationId: rep.replicationId } })
        .then(r => {
          if (serial !== generation.current) return;
          const c = r.data.data;
          setConfig(c);
          setError('');
          const currentDisks = (c.current?.disks || []).map(d => ({
            deviceKey: d.deviceKey,
            isVmHome: d.isVmHome,
            enabled: d.enabled,
            datastoreId: d.datastoreId || '',
            storagePolicyId: d.storagePolicyId || null
          }));
          const newForm = {
            pairId: repPairId,
            replicationId: rep.replicationId,
            vmId: c.current?.vmId || rep.vmId,
            rpo: c.current?.rpo,
            networkCompression: Boolean(c.current?.networkCompression),
            quiesce: Boolean(c.current?.quiesce),
            mpit: Boolean(c.current?.mpit),
            mpitInstances:c.current?.mpitInstances,
            mpitDays:c.current?.mpitDays,
            dataSets:c.current?.dataSets,
            autoReplicateNewDisks: Boolean(c.current?.autoReplicateNewDisks),
            encryption: Boolean(c.current?.encryption),
            disks: currentDisks
          };
          setForm(newForm);
          setInitialForm(JSON.parse(JSON.stringify(newForm)));
        })
        .catch(_err => {
          if (serial !== generation.current) return;
          safeError('Failed to load current replication configuration');
        })
        .finally(() => {
          if (serial === generation.current) setBusy(false);
        });
    }
  }

  const selectedPair = pairs.find(p => String(p.id) === String(pairId));
  const selectedVm = vms.find(v => v.vmId === form?.vmId);
  const selectedVms = vms.filter(v => selectedVmIds.includes(v.vmId));
  const bulkCreate = mode === 'configure' && selectedVmIds.length > 1;

  // Validation
  const isRpoValid = Boolean(
    config &&
    form &&
    Number.isInteger(Number(form.rpo)) &&
    Number(form.rpo) >= config.rpo.min &&
    Number(form.rpo) <= config.rpo.max
  );

  const isDatastoresValid = Boolean(
    form &&
    form.disks &&
    form.disks.length > 0 &&
    form.disks.every(d => !d.enabled || (d.datastoreId && d.datastoreId.length > 0))
  );

  const canProceedStep1 = Boolean(selectedVmIds.length > 0 && form?.vmId && config && !busy);
  const canProceedStep3 = isDatastoresValid;
  const canProceedStep4 = isRpoValid && isDatastoresValid && validSettings(config,form);
  const newPgNameError = srmMode === 'new' ? validateVmwareObjectName(newPgName) : null;

  async function confirm() {
    if (busy || !form || !canProceedStep4 || submitting.current || operationLocked.current) return;
    const selectedIds = typeof selectedVmIds !== 'undefined' && Array.isArray(selectedVmIds) ? selectedVmIds : [];
    const createVmIds = mode === 'configure'
      ? (selectedIds.length > 0 ? selectedIds : [form.vmId])
      : [form.vmId];
    if(mode==='configure'&&srmMode!=='none'&&(!srmPair||(srmMode==='existing'?!selectedPgId:Boolean(newPgNameError))))return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const protectionContext = mode === 'configure' && srmMode !== 'none' ? {
      mode: srmMode,
      pgId: selectedPgId,
      rpId: selectedRpId,
      newPgName,
      pgName: displayName(srmMode === 'new' ? newPgName : srmPgs.find(pg => String(pg.protectionGroupId || pg.id) === String(selectedPgId))?.name),
      rpName: selectedRpId ? displayName(srmRps.find(rp => String(rp.recoveryPlanId || rp.id) === String(selectedRpId))?.name) : null,
      pairId: srmPair?.id,
      vmId: form.vmId,
      vmIds: createVmIds
    } : null;
    const payload = {
      pairId: Number(form.pairId),
      vmId: form.vmId,
      rpo: Number(form.rpo),
      networkCompression: Boolean(form.networkCompression),
      quiesce: Boolean(form.quiesce),
      mpit: Boolean(form.mpit),
      ...(form.mpit ? {mpitInstances:Number(form.mpitInstances),mpitDays:Number(form.mpitDays)} : {}),
      ...(config?.settings?.dataSetsExposed ? {dataSets:Boolean(form.dataSets)} : {}),
      autoReplicateNewDisks: Boolean(form.autoReplicateNewDisks),
      encryption: Boolean(form.encryption),
      disks: (form.disks || []).map(d => ({
        deviceKey: d.deviceKey,
        isVmHome: d.isVmHome,
        enabled: d.enabled,
        datastoreId: d.datastoreId,
        storagePolicyId: d.storagePolicyId || null
      })),
      confirmed: true
    };

    if (mode !== 'configure') {
      payload.replicationId = form.replicationId;
    }

    try {
      const url = mode === 'configure' ? '/vr/replications' : `/vr/management/actions/${mode}`;
      if (mode === 'configure' && createVmIds.length > 1) {
        const buildPayloadForVm = async vmId => {
          if (vmId === form.vmId) return payload;
          const response = await api.get(`/vr/management/pairings/${form.pairId}/configuration`, { params: { vmId }, refresh: true });
          const vmConfig = response.data.data;
          const rpo = Number(form.rpo);
          if (!Number.isInteger(rpo) || rpo < vmConfig.rpo.min || rpo > vmConfig.rpo.max) {
            throw new Error(`RPO is outside the supported range for ${vms.find(vm => vm.vmId === vmId)?.vmName || vmId}.`);
          }
          if (form.mpit && vmConfig.settings?.mpitSupported !== true) {
            throw new Error(`Point-in-time instances are unavailable for ${vms.find(vm => vm.vmId === vmId)?.vmName || vmId}.`);
          }
          const templateFor = disk => form.disks.find(item => item.deviceKey === disk.device_key && item.isVmHome === disk.is_vm_home)
            || form.disks.find(item => item.isVmHome === disk.is_vm_home && item.enabled)
            || form.disks.find(item => item.enabled);
          const disks = (vmConfig.disks || []).map(disk => {
            const template = templateFor(disk);
            if (!template?.datastoreId) throw new Error(`Select a destination datastore before creating ${vms.find(vm => vm.vmId === vmId)?.vmName || vmId}.`);
            return {
              deviceKey: disk.device_key,
              isVmHome: disk.is_vm_home,
              enabled: disk.is_vm_home || disk.supported_for_replication === true,
              datastoreId: template.datastoreId,
              storagePolicyId: template.storagePolicyId || null
            };
          });
          return {
            pairId: Number(form.pairId), vmId, rpo,
            networkCompression: Boolean(form.networkCompression && vmConfig.capability?.network_compression_supported === true),
            quiesce: Boolean(form.quiesce && vmConfig.capability?.quiescing_supported === true),
            mpit: Boolean(form.mpit),
            ...(form.mpit ? {mpitInstances:Number(form.mpitInstances),mpitDays:Number(form.mpitDays)} : {}),
            ...(vmConfig.settings?.dataSetsExposed ? {dataSets:Boolean(form.dataSets)} : {}),
            autoReplicateNewDisks: Boolean(form.autoReplicateNewDisks && vmConfig.capability?.auto_replicate_new_disks_supported === true),
            encryption: Boolean(vmConfig.settings?.encryptionRequired || (form.encryption && vmConfig.capability?.lwd_encryption_supported === true)),
            disks,
            confirmed: true
          };
        };
        const submitted = await Promise.allSettled(createVmIds.map(async vmId => {
          const vmPayload = await buildPayloadForVm(vmId);
          const response = await api.post(url, vmPayload);
          return { vmId, operation: response.data.data };
        }));
        const accepted = [];
        for (const result of submitted) {
          if (result.status !== 'fulfilled') continue;
          accepted.push(result.value);
          const vm = vms.find(item => item.vmId === result.value.vmId);
          trackVrOperation(result.value.operation, `Create replication ${displayName(replicationVmName(vm), 'VM')}`, result.value.vmId);
        }
        const succeeded = accepted.length;
        const failed = submitted.length - succeeded;
        setOpen(false);
        showToast(failed
          ? `${succeeded} replication${succeeded === 1 ? '' : 's'} submitted; ${failed} could not be submitted.`
          : protectionContext
            ? `${succeeded} replications submitted. The Protection Group will be created automatically after all operations succeed.`
            : `${succeeded} replication configurations submitted. Initial synchronization must finish before replication is ready.`, failed ? 'error' : 'success');
        onUpdated?.();
        if (!failed && protectionContext) {
          const progress = {};
          const operationIds = accepted.map(item => item.operation?.operationId || item.operation?.id);
          void (async () => {
            try {
              await waitForReplicationOperations(operationIds, {
                read: async operationId => {
                  const response = await api.get(`/vr/management/operations/${encodeURIComponent(operationId)}`);
                  return response.data?.data;
                }
              });
              invalidateReadCache();
              setProtectionResultModal({
                vrSuccess:true, pgSuccess:false, rpSuccess:false,
                pgName:protectionContext.pgName, rpName:protectionContext.rpName,
                checking:true, message:'All replication configurations completed. Creating the Protection Group…'
              });
              await completeReplicationProtection({
                context:protectionContext,
                progress,
                submit:(url, body) => submitSrm('POST', url, body),
                wait:waitSrmOperation,
                onProgress:() => setProtectionResultModal({
                  vrSuccess:true, pgSuccess:Boolean(progress.pgSuccess), rpSuccess:Boolean(progress.rpSuccess),
                  pgName:protectionContext.pgName, rpName:protectionContext.rpName,
                  checking:true, message:'Checking SRM protection status…'
                })
              });
              setProtectionResultModal({
                vrSuccess:true, pgSuccess:true, rpSuccess:Boolean(progress.rpSuccess),
                pgName:protectionContext.pgName, rpName:protectionContext.rpName,
                message:protectionContext.mode === 'new'
                  ? `Protection Group created with ${createVmIds.length} virtual machines.`
                  : `${createVmIds.length} virtual machines were added to the selected Protection Group.`
              });
              showToast(protectionContext.mode === 'new'
                ? `Protection Group created with ${createVmIds.length} virtual machines.`
                : `${createVmIds.length} virtual machines added to the selected Protection Group.`, 'success');
              onUpdated?.();
            } catch (followupError) {
              setProtectionResultModal({
                vrSuccess:false, pgSuccess:Boolean(progress.pgSuccess), rpSuccess:Boolean(progress.rpSuccess),
                pgName:protectionContext.pgName, rpName:protectionContext.rpName,
                message:safeErrorMessage(followupError, 'The automatic Protection Group step could not be completed. Check Background operations before trying again.')
              });
              showToast(safeErrorMessage(followupError, 'The automatic Protection Group step could not be completed. Check Background operations before trying again.'), 'error');
              onUpdated?.();
            }
          })();
        }
        return;
      }
      const r = await api.post(url, payload);
      const op = r.data.data;
      if (protectionContext) {
        // SRM protection is a dependent second stage and must retain its
        // resumable context until the replication is visible to SRM.
        queueProtection(protectionContext, op.operationId);
        acceptOperation(op);
      } else {
        const verb = mode === 'configure' ? 'Create replication' : `${mode.charAt(0).toUpperCase()}${mode.slice(1)} replication`;
        trackVrOperation(op, `${verb} ${displayName(replicationVmName(selectedVm, form), 'VM')}`, form.replicationId || form.vmId);
        setOpen(false);
        showToast(mode === 'configure'
          ? 'Replication configuration submitted. Initial synchronization must finish before replication is ready.'
          : `${verb} submitted.`, 'success');
        onUpdated?.();
      }
    } catch (err) {
      const opId = err.response?.data?.operationId;
      if (opId) {
        if (protectionContext) queueProtection(protectionContext, opId);
        await reconcileSubmissionError(err);
        if (!protectionContext) setOpen(false);
      } else {
        const errorMsg = err.response?.data?.error?.safeMessage
          || err.response?.data?.safeMessage
          || err.response?.data?.error?.message
          || err.response?.data?.message
          || 'Operation submission failed';
        safeError(errorMsg);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!canWrite) return null;

  const ongoing = Boolean(srmPendingContext || (operation && !['SUCCESS', 'FAILED'].includes(operation.status)));
  const pendingProtectionNotice = srmPendingContext?.paused && (
    <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
      <span>{srmPendingContext.message}</span>
      <Button type="button" onClick={resumeProtection} className={buttonClass}>Resume status check</Button>
    </div>
  );

  return (
    <>
      {showLaunchers && <div className="flex items-center gap-2">
        <Button
          onClick={() => openModal('configure')}
          className="inline-flex items-center gap-2 rounded-full border border-indigo-300 bg-white px-3.5 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 transition-colors"
        >
          <Plus size={16} />
          New replication
        </Button>
        <Button
          onClick={() => openModal('manage')}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Settings size={16} />
          Replication Actions
        </Button>
      </div>}

      {!open && pendingProtectionNotice}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        >
          <section className={`relative w-full ${['pause', 'resume'].includes(mode) ? 'max-w-md' : mode === 'unconfigure' ? 'max-w-lg' : 'max-w-4xl'} max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200`}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
              <div className="flex items-center gap-3">
                {mode === 'resume' && <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 border border-indigo-100">
                  <Play size={20} />
                </div>}
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {mode === 'configure' ? 'Create replication' :
                     mode === 'reconfigure' ? 'Reconfigure replication' :
                     mode === 'pause' ? 'Pause' :
                     mode === 'resume' ? 'Resume' :
                     mode === 'unconfigure' ? 'Remove' :
                     'vSphere Replication management'}
                  </h2>
                </div>
              </div>
              <Button
                aria-label="Close"
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </Button>
            </div>

            {/* Error banner */}
            {pendingProtectionNotice}
            {error && (
              <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800">
                <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
                <span className="flex-1">{error}</span>
                {loadingStage === null && pairId && (
                  <Button type="button" className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold" onClick={retryAfterError}>Retry</Button>
                )}
              </div>
            )}
            {loadingStage && (
              <div role="status" className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                Loading...
              </div>
            )}

            {/* ================================================================= */}
            {/* CREATE REPLICATION WIZARD (mode === 'configure')                  */}
            {/* ================================================================= */}
            {mode === 'configure' && (
              <div>
                {/* 5-Step Stepper Header */}
                <nav aria-label="Wizard steps" className="mb-6">
                  <ol className="flex items-center justify-between border-b border-slate-200 pb-4">
                    {WIZARD_STEPS.map(s => {
                      const isActive = wizardStep === s.num;
                      const isDone = wizardStep > s.num;
                      return (
                        <li key={s.num} className="flex items-center gap-2">
                          <Button
                            variant={isActive || isDone ? 'vr-green' : 'secondary'}
                            type="button"
                            onClick={() => {
                              if (s.num < wizardStep || (s.num === 2 && canProceedStep1) || (s.num === 3 && canProceedStep1) || (s.num === 4 && canProceedStep1 && canProceedStep3) || (s.num === 5 && canProceedStep4)) {
                                setWizardStep(s.num);
                              }
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                              isActive
                                ? 'text-white ring-4 ring-[#8AC389]/20'
                                : isDone
                                ? 'text-white'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {isDone ? '✓' : s.num}
                          </Button>
                          <span className={`text-xs font-medium hidden sm:inline ${isActive ? 'text-[#6EAC6C] font-semibold' : isDone ? 'text-slate-800' : 'text-slate-500'}`}>
                            {s.label}
                          </span>
                          {s.num < 5 && <ArrowRight size={14} className="text-slate-300 mx-1 hidden sm:inline" />}
                        </li>
                      );
                    })}
                  </ol>
                </nav>

                {/* STEP 1: Virtual machines */}
                <div className={wizardStep === 1 ? 'space-y-4' : 'hidden'}>
                  {lockedPairContext ? (
                    <div className="sr-only">
                      <span>Replication route (auto-selected)</span>
                      <span>Verified route</span>
                      <span>{lockedPairContext.sourceHost || selectedPair?.sourceHost || 'Not available'}</span>
                      <span>{lockedPairContext.targetHost || selectedPair?.targetHost || 'Not available'}</span>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="vr-pairing-select" className="block text-xs font-bold tracking-wider text-slate-500 mb-1">
                        Source vCenter → Target vCenter
                      </label>
                      <select
                        id="vr-pairing-select"
                        aria-label="Source vCenter → Target vCenter"
                        className={inputClass}
                        value={pairId}
                        disabled={busy}
                        onChange={e => selectPair(e.target.value)}
                      >
                        <option value="">Select replication route</option>
                        {pairs.map(p => {
                          const src = p.sourceName ? `${p.sourceName}${p.sourceHost && p.sourceHost !== p.sourceName ? ` (${p.sourceHost})` : ''}` : (p.sourceHost || 'Source');
                          const tgt = p.targetName ? `${p.targetName}${p.targetHost && p.targetHost !== p.targetName ? ` (${p.targetHost})` : ''}` : (p.targetHost || 'Target');
                          return (
                            <option key={p.id} value={p.id}>
                              {src} → {tgt}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {pairId && (
                    <div
                      className="relative"
                      onBlur={event => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setVmPickerOpen(false);
                      }}
                    >
                      <button
                        type="button"
                        id="vr-vm-select"
                        aria-label="Suitable VM"
                        aria-haspopup="listbox"
                        aria-expanded={vmPickerOpen}
                        aria-controls="vr-vm-options"
                        className={`${inputClass} flex items-center justify-between gap-4 text-left`}
                        disabled={busy}
                        onClick={() => setVmPickerOpen(value => !value)}
                      >
                        {(() => {
                          const vm = vms.find(candidate => candidate.vmId === (selectedVmId || form?.vmId));
                          if (!vm) return <span className="text-slate-700">Select virtual machines</span>;
                          if (selectedVmIds.length > 1) return <span className="min-w-0 flex-1 truncate font-medium">{selectedVmIds.length} virtual machines selected</span>;
                          const power = getVmPowerStatePresentation(vm.powerState);
                          return (
                            <>
                              <span className="min-w-0 flex-1 truncate font-medium">{vm.vmName}</span>
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                <span className={`h-1.5 w-1.5 rounded-full ${power.label === 'Powered on' ? 'bg-[#8AC389]' : power.label === 'Powered off' ? 'bg-red-500' : 'bg-slate-400'}`} />
                                {power.label}
                              </span>
                            </>
                          );
                        })()}
                        <ChevronDown size={16} className={`shrink-0 text-slate-500 transition-transform ${vmPickerOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>

                      {vmPickerOpen && (
                        <div
                          id="vr-vm-options"
                          role="listbox"
                          aria-label="Suitable VM"
                          aria-multiselectable="true"
                          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
                        >
                          {vms.map(vm => {
                            const power = getVmPowerStatePresentation(vm.powerState);
                            const isSelected = selectedVmIds.includes(vm.vmId);
                            return (
                              <button
                                key={vm.vmId}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left text-sm transition-colors ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                onClick={() => {
                                  toggleVmSelection(vm.vmId);
                                }}
                              >
                                <span className="flex min-w-0 flex-1 items-center gap-2 truncate font-medium text-slate-900">
                                  <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${isSelected ? 'border-[#FE5E37] bg-[#FE5E37] text-white' : 'border-slate-300 bg-white'}`}>{isSelected ? '✓' : ''}</span>
                                  <span className="truncate">{vm.vmName}</span>
                                </span>
                                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                  <span className={`h-1.5 w-1.5 rounded-full ${power.label === 'Powered on' ? 'bg-[#8AC389]' : power.label === 'Powered off' ? 'bg-red-500' : 'bg-slate-400'}`} />
                                  {power.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}


                  <div className="flex justify-end pt-4 border-t border-slate-200">
                    <Button
                      type="button"
                      disabled={!canProceedStep1}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                      onClick={() => setWizardStep(2)}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                {/* STEP 2: Target site */}
                {config && (
                  <div className={wizardStep === 2 ? 'space-y-4' : 'hidden'}>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg bg-white p-4 border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-400">Source site</span>
                          <p className="text-base font-bold text-slate-900 mt-1">{config.sourceName || selectedPair?.sourceName}</p>
                        </div>

                        <div className="rounded-lg bg-white p-4 border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-400">Target site</span>
                          <p className="text-base font-bold text-slate-900 mt-1">{config.targetName || selectedPair?.targetName}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between pt-4 border-t border-slate-200">
                      <Button
                        type="button"
                        className={buttonClass}
                        onClick={() => setWizardStep(1)}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
                        onClick={() => setWizardStep(3)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                {/* STEP 3: Target datastore */}
                {config && form && (
                  <div className={wizardStep === 3 ? 'space-y-4' : 'hidden'}>
                    <div className="space-y-3">
                      {form.disks.map(disk => {
                        const src = config.disks.find(d => d.device_key === disk.deviceKey);
                        const label = disk.isVmHome ? 'VM configuration files' : (src?.label || `Disk ${disk.deviceKey}`);
                        const selectedDatastore = (config.datastores || []).find(ds => String(ds.id) === String(disk.datastoreId));
                        const capacity = Number(selectedDatastore?.capacity);
                        const freeSpace = Number(selectedDatastore?.free_space);
                        const hasCapacity = selectedDatastore && Number.isFinite(capacity) && Number.isFinite(freeSpace) && capacity > 0 && freeSpace >= 0 && freeSpace <= capacity;
                        const usedSpace = hasCapacity ? capacity - freeSpace : null;
                        const usedPercent = hasCapacity ? Math.round((usedSpace / capacity) * 100) : null;
                        const capacitySeverity = getCapacitySeverity(usedPercent);
                        const capacityColor = capacitySeverity === 'CRITICAL'
                          ? 'bg-[#FE5E37]'
                          : capacitySeverity === 'WARNING'
                            ? 'bg-[#F59E0B]'
                            : 'bg-[#8AC389]';
                        return (
                          <div key={disk.deviceKey} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
                                {label}
                                {disk.isVmHome && <span className="sr-only">VM home</span>}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label
                                  htmlFor={`ds-${disk.deviceKey}`}
                                  className="block text-xs font-semibold text-slate-600 mb-1"
                                >
                                  Destination datastore
                                </label>
                                <select
                                  id={`ds-${disk.deviceKey}`}
                                  aria-label="Destination datastore"
                                  className={inputClass}
                                  value={disk.datastoreId}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setForm(prev => ({
                                      ...prev,
                                      disks: prev.disks.map(d =>
                                        d.deviceKey === disk.deviceKey ? { ...d, datastoreId: val } : d
                                      )
                                    }));
                                  }}
                                >
                                  <option value="">Select datastore</option>
                                  {(config.datastores || []).map(ds => (
                                    <option key={ds.id} value={ds.id}>
                                      {ds.name}
                                    </option>
                                  ))}
                                </select>
                                {selectedDatastore && (
                                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                                      <span className="font-medium text-slate-600">Capacity</span>
                                      <span className="font-semibold text-slate-900">
                                        {hasCapacity ? `${usedPercent}% used` : 'Unavailable'}
                                      </span>
                                    </div>
                                    <div
                                      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
                                      role="progressbar"
                                      aria-label={`${selectedDatastore.name} used capacity`}
                                      aria-valuemin="0"
                                      aria-valuemax="100"
                                      aria-valuenow={usedPercent ?? undefined}
                                    >
                                      <div
                                        className={`h-full rounded-full transition-[width] duration-300 ${capacityColor}`}
                                        style={{ width: `${usedPercent ?? 0}%` }}
                                      />
                                    </div>
                                    {hasCapacity && (
                                      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-500">
                                        <span>{formatBytes(freeSpace)} free</span>
                                        <span>{formatBytes(capacity)} total</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div>
                                <label
                                  htmlFor={`policy-${disk.deviceKey}`}
                                  className="block text-xs font-semibold text-slate-600 mb-1"
                                >
                                  Storage policy (optional)
                                </label>
                                <select
                                  id={`policy-${disk.deviceKey}`}
                                  aria-label="Storage policy"
                                  className={inputClass}
                                  value={disk.storagePolicyId || ''}
                                  onChange={e => {
                                    const val = e.target.value || null;
                                    setForm(prev => ({
                                      ...prev,
                                      disks: prev.disks.map(d =>
                                        d.deviceKey === disk.deviceKey ? { ...d, storagePolicyId: val } : d
                                      )
                                    }));
                                  }}
                                >
                                  <option value="">Datastore default</option>
                                  {(config.policies || []).map(p => (
                                    <option key={p.storage_policy_id} value={p.storage_policy_id}>
                                      {p.storage_policy_name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {config.capability?.auto_replicate_new_disks_supported === true && (
                      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.autoReplicateNewDisks === true}
                          onChange={event => setForm(previous => ({ ...previous, autoReplicateNewDisks: event.target.checked }))}
                          className="mt-0.5 rounded text-[#8AC389] focus:ring-[#8AC389]"
                        />
                        <span>
                          <span className="block font-semibold">Auto-include new disks in replication</span>
                          <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                            เปิด Auto-include คือ เพิ่ม Hard Disk ใหม่เมื่อไร ระบบ Replicate ให้เอง
                          </span>
                        </span>
                      </label>
                    )}

                    <div className="flex justify-between pt-4 border-t border-slate-200">
                      <Button
                        type="button"
                        className={buttonClass}
                        onClick={() => setWizardStep(2)}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        disabled={!canProceedStep3}
                        className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                        onClick={() => setWizardStep(4)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                {/* STEP 4: Replication settings */}
                {config && form && (
                  <div className={wizardStep === 4 ? 'space-y-4' : 'hidden'}>
                    <ReplicationSettings config={config} form={form} onChange={setForm} id="create" showAutoReplicateNewDisks={false} />

                    <div className="flex justify-between pt-4 border-t border-slate-200">
                      <Button
                        type="button"
                        className={buttonClass}
                        onClick={() => setWizardStep(3)}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        disabled={!canProceedStep4}
                        className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                        onClick={() => setWizardStep(5)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                {config && form && <div className={wizardStep===5?'space-y-4':'hidden'}>
                  {srmLoading&&<p role="status">Loading...</p>}
                  {!srmLoading&&!srmPair&&<p className="text-sm text-amber-700">SRM options are unavailable for this direction. You can create replication without a protection group.</p>}
                      {/* SRM Protection Section */}
                      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
                        {/* 3 Radio options */}
                        <div className="space-y-3">
                          {/* 1. Add to existing protection group */}
                          <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                            srmMode === 'existing' ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-200' : 'border-slate-200'
                          }`}>
                            <input
                              type="radio"
                              name="srmProtectionChoice"
                              checked={srmMode === 'existing'}
                              onChange={() => setSrmMode('existing')}
                              className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300"
                            />
                            <div className="flex-1">
                              <span className="text-xs font-bold text-slate-800">Add to existing protection group</span>
                              {srmMode === 'existing' && (
                                <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <label htmlFor="srm-pg-select" className="block text-[11px] font-semibold text-slate-600 mb-1">Select protection group</label>
                                    <select
                                      id="srm-pg-select"
                                      aria-label="Protection group"
                                      className={inputClass}
                                      value={selectedPgId}
                                      onChange={e => {
                                        setSelectedPgId(e.target.value);
                                        if (!e.target.value) setSelectedRpId('');
                                      }}
                                    >
                                      <option value="">Select a protection group...</option>
                                      {srmPgs.map(pg => {
                                        const val = pg.protectionGroupId || pg.protection_group_id || pg.id;
                                        return (
                                          <option key={val} value={val}>
                                            {pg.name || 'Name unavailable'} ({pg.protectionStatus || pg.status || 'Unknown'})
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                  <div>
                                    <label htmlFor="srm-rp-select" className="block text-[11px] font-semibold text-slate-600 mb-1">Recovery plan (optional)</label>
                                    <select
                                      id="srm-rp-select"
                                      aria-label="Recovery plan"
                                      className={inputClass}
                                      value={selectedRpId}
                                      disabled={!selectedPgId}
                                      onChange={e => setSelectedRpId(e.target.value)}
                                    >
                                      <option value="">None</option>
                                      {srmRps.map(rp => {
                                        const val = rp.recoveryPlanId || rp.recovery_plan_id || rp.id;
                                        return (
                                          <option key={val} value={val}>{rp.name || 'Name unavailable'}</option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                </div>
                              )}
                            </div>
                          </label>

                          {/* 2. Add to new protection group */}
                          <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                            srmMode === 'new' ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-200' : 'border-slate-200'
                          }`}>
                            <input
                              type="radio"
                              name="srmProtectionChoice"
                              checked={srmMode === 'new'}
                              onChange={() => setSrmMode('new')}
                              className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300"
                            />
                            <div className="flex-1">
                              <span className="text-xs font-bold text-slate-800">Add to new protection group</span>
                              {srmMode === 'new' && (
                                <div className="mt-2.5 space-y-2.5">
                                  <input
                                    type="text"
                                    maxLength={80}
                                    value={newPgName}
                                    onChange={e => setNewPgName(e.target.value)}
                                    className={inputClass}
                                  />
                                  {newPgNameError && <p className="mt-1 text-[11px] text-red-600">{newPgNameError}</p>}
                                </div>
                              )}
                            </div>
                          </label>

                          {/* 3. Do not add to protection group now */}
                          <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                            srmMode === 'none' ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-200' : 'border-slate-200'
                          }`}>
                            <input
                              type="radio"
                              name="srmProtectionChoice"
                              checked={srmMode === 'none'}
                              onChange={() => {
                                setSrmMode('none');
                                setSelectedPgId('');
                                setSelectedRpId('');
                              }}
                              className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300"
                            />
                            <div>
                              <span className="text-xs font-bold text-slate-800">Do not add to protection group now</span>
                              <p className="text-[11px] text-slate-500 mt-0.5">Configure vSphere Replication only without adding the VM to Site Recovery Manager.</p>
                            </div>
                          </label>
                        </div>
                      </div>
                  <div className="flex justify-between border-t pt-4"><Button className={buttonClass} onClick={()=>setWizardStep(4)}>Back</Button><Button className={buttonClass} disabled={!canProceedStep4||(srmMode!=='none'&&(!srmPair||srmLoading||(srmMode==='existing'?!selectedPgId:Boolean(newPgNameError))))} onClick={()=>setWizardStep(6)}>Next</Button></div>
                </div>}
                {/* STEP 6: Ready to Complete */}
                {config && form && (
                  <div className={wizardStep === 6 ? 'space-y-4' : 'hidden'}>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                      <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2">
                        Review Replication Configuration
                      </h3>

                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div><span className="font-semibold text-slate-500">Protection group:</span><p>{srmMode === 'none' ? 'Do not add now' : srmMode === 'new' ? `Create: ${newPgName}` : srmPgs.find(pg => String(pg.id) === String(selectedPgId))?.name || 'Name unavailable'}</p></div>
                        <div>
                          <span className="font-semibold text-slate-500">Virtual machine{bulkCreate ? 's' : ''}:</span>
                          <p className="font-bold text-slate-800 text-sm mt-0.5">{bulkCreate ? selectedVms.map(vm => vm.vmName).join(', ') : selectedVm?.vmName || 'Unknown VM'}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">VM power state:</span>
                          <p className="font-medium text-slate-800 mt-0.5">{getVmPowerStatePresentation(selectedVm?.powerState).label}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Source site:</span>
                          <p className="font-medium text-slate-800 mt-0.5">{config.sourceName || selectedPair?.sourceName}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Target site:</span>
                          <p className="font-medium text-slate-800 mt-0.5">{config.targetName || selectedPair?.targetName}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">RPO:</span>
                          <p className="font-medium text-slate-800 mt-0.5">{form.rpo} minutes</p>
                        </div>
                        <div><span className="font-semibold text-slate-500">Point-in-time retention:</span><p>{form.mpit ? `${form.mpitInstances} instances per day for ${form.mpitDays} days` : 'Disabled'}</p></div>
                        {config.settings?.dataSetsExposed && <div><span className="font-semibold text-slate-500">DataSets replication:</span><p>{form.dataSets ? 'Enabled' : 'Disabled'}</p></div>}
                        {[['quiesce','Guest OS quiescing'],['networkCompression','Network compression'],['encryption','Network encryption'],['autoReplicateNewDisks','Auto-replicate new disks']].map(([key,label]) => <div key={key}><span className="font-semibold text-slate-500">{label}:</span><p>{form[key] ? 'Enabled' : 'Disabled'}</p></div>)}
                      </div>

                      <div className="overflow-x-auto">
                        <h4 className="mb-2 text-xs font-semibold text-slate-600">Target datastore assignments{bulkCreate ? ' (template for selected VMs)' : ''}</h4>
                        <table className="w-full text-left text-xs" aria-label="Target datastore assignments">
                          <thead className="border-b border-slate-200 text-slate-500">
                            <tr><th className="py-2 pr-3">VM files / disk</th><th className="py-2 pr-3">Target datastore</th><th className="py-2">Storage policy</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {getReplicationDatastoreReview(config, form).map(item => (
                              <tr key={item.key} className={item.enabled ? 'text-slate-800' : 'text-slate-500'}>
                                <td className="py-2 pr-3">{item.label}</td><td className="py-2 pr-3 font-semibold">{item.datastore}</td><td className="py-2">{item.policy}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {bulkCreate && <p className="mt-2 text-xs text-slate-500">Additional VMs use this VM home/disk destination template. Their supported disks are checked before each request is submitted.</p>}
                      </div>
                      <p className="text-xs leading-5 text-slate-600">Creating a replication configures it; it does not complete the initial synchronization. Check its status and reported issues after creation and wait for OK before continuing recovery operations.</p>
                    </div>

                    <div className="flex justify-between pt-4 border-t border-slate-200">
                      <Button
                        type="button"
                        disabled={busy}
                        className={buttonClass}
                        onClick={() => setWizardStep(5)}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        disabled={busy || ongoing || !canProceedStep4}
                        className="rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                        onClick={confirm}
                      >
                        {srmMode !== 'none' ? 'Create replication & apply SRM protection' : 'Confirm create replication'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ================================================================= */}
            {/* MANAGE REPLICATIONS MODE (mode === 'manage' or action mode)        */}
            {/* ================================================================= */}
            {/* ================================================================= */}
            {/* MANAGE REPLICATIONS MODE (mode === 'manage')                       */}
            {/* ================================================================= */}
            {mode === 'manage' && (
              <div className="space-y-4">
                {/* Pairing selector for Manage Mode */}
                <div>
                  <label htmlFor="vr-pairing-select" className="block text-xs font-bold tracking-wider text-slate-500 mb-1">
                    Source vCenter → Target vCenter
                  </label>
                  <select
                    id="vr-pairing-select"
                    aria-label="Source vCenter → Target vCenter"
                    className={inputClass}
                    value={pairId}
                    onChange={e => selectPair(e.target.value)}
                  >
                    <option value="">Select replication route</option>
                    {pairs.map(p => {
                      const src = p.sourceName ? `${p.sourceName}${p.sourceHost && p.sourceHost !== p.sourceName ? ` (${p.sourceHost})` : ''}` : (p.sourceHost || 'Source');
                      const tgt = p.targetName ? `${p.targetName}${p.targetHost && p.targetHost !== p.targetName ? ` (${p.targetHost})` : ''}` : (p.targetHost || 'Target');
                      return (
                        <option key={p.id} value={p.id}>
                          {src} → {tgt}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* List of manageable replications */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold tracking-wider text-slate-500">
                    Manageable Replications ({reps.length})
                  </h3>
                  {reps.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl text-slate-500 text-sm">
                      No manageable replications found for this pairing route.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reps.map(rep => {
                        const candidateVm = vms.find(v => v.vmId === rep.vmId);
                        const feedbackRep = { ...rep, vmPowerState: rep.vmPowerState || candidateVm?.powerState };
                        const feedback = getReplicationFeedback(feedbackRep);

                        return (
                          <div key={rep.replicationId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 text-sm">{rep.vmName}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    feedback.severity === 'success' ? 'bg-emerald-100 text-emerald-800' :
                                    feedback.severity === 'warning' ? 'bg-amber-100 text-amber-800' :
                                    feedback.severity === 'error' ? 'bg-rose-100 text-rose-800' :
                                    feedback.severity === 'info' ? 'bg-blue-100 text-blue-800' :
                                    'bg-slate-100 text-slate-700'
                                  }`}>
                                    {feedback.statusLabel}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                                  <span>RPO: {rep.rpo} mins</span>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {rep.actions?.includes('pause') && rep.status !== 'PAUSED' && (
                                  <Button
                                    type="button"
                                    onClick={() => chooseAction(rep, 'pause')}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors"
                                    title="Pause replication synchronization"
                                  >
                                    <Pause size={12} className="shrink-0" />
                                    <span>Pause</span>
                                  </Button>
                                )}
                                {rep.actions?.includes('resume') && rep.status === 'PAUSED' && (
                                  <Button
                                    type="button"
                                    onClick={() => chooseAction(rep, 'resume')}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                                    title="Resume replication synchronization"
                                  >
                                    <Play size={12} className="shrink-0" />
                                    <span>Resume</span>
                                  </Button>
                                )}
                                {rep.actions?.includes('sync') && (
                                  <Button
                                    type="button"
                                    disabled={syncingId === rep.replicationId}
                                    onClick={() => chooseAction(rep, 'sync')}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
                                    title="Trigger immediate VMware replication synchronization"
                                  >
                                    {syncingId === rep.replicationId ? 'Loading...' : <><RefreshCw size={12} className="shrink-0" /><span>Sync now</span></>}
                                  </Button>
                                )}
                                {rep.actions?.includes('reconfigure') && (
                                  <Button
                                    type="button"
                                    onClick={() => chooseAction(rep, 'reconfigure')}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-colors"
                                    title="Reconfigure replication settings"
                                  >
                                    <Sliders size={12} className="shrink-0" />
                                    <span>Reconfigure</span>
                                  </Button>
                                )}
                                {rep.actions?.includes('unconfigure') && isAdmin && (
                                  <Button
                                    type="button"
                                    onClick={() => chooseAction(rep, 'unconfigure')}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors"
                                    title="Remove and unconfigure replication from VMware appliance"
                                  >
                                    <Trash2 size={12} className="shrink-0" />
                                    <span>Remove replication</span>
                                    <span className="sr-only">Unconfigure replication</span>
                                  </Button>
                                )}
                              </div>
                            </div>

                            {feedback.hasDetails && <div className="mt-3"><ReplicationStatusNotice rep={feedbackRep} /></div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* PAUSE MODAL (Minimal VMware Standard)                             */}
            {/* ================================================================= */}
            {mode === 'pause' && (
              <div className="space-y-5 py-2">
                <p className="text-sm font-medium text-slate-800">
                  Pause selected replication(s)?
                </p>
                <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200">
                  <Button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-indigo-300 bg-white px-4 py-2 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                    onClick={submitPause}
                  >
                    PAUSE
                  </Button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* RESUME MODAL (Minimal VMware Standard)                            */}
            {/* ================================================================= */}
            {mode === 'resume' && (
              <div className="space-y-5 py-2">
                <p className="text-sm font-medium text-slate-800">
                  Resume selected replication(s)?
                </p>
                <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200">
                  <Button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    onClick={submitResume}
                  >
                    RESUME
                  </Button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* REMOVE MODAL (VMware Standard)                                    */}
            {/* ================================================================= */}
            {mode === 'unconfigure' && (
              <div className="space-y-4 py-2">
                <p className="text-sm font-semibold text-slate-900">
                  Permanently stop the replication of the selected virtual machine(s)?
                  <span className="sr-only">Remove replication?</span>
                </p>
                <div className="space-y-2.5 pt-2 border-t border-slate-100">
                  <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="vr-stop-mode"
                      value="graceful"
                      checked={stopMode === 'graceful'}
                      onChange={() => setStopMode('graceful')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    Gracefully stop replication(s)
                  </label>
                  <label className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="vr-stop-mode"
                      value="force"
                      checked={stopMode === 'force'}
                      onChange={() => setStopMode('force')}
                      className="mt-1 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">Force stop replication(s)</span>
                      <span className="thai-helper-text mt-1 block text-xs leading-relaxed text-slate-500">
                        หากเกิดปัญหาการเชื่อมต่อ สามารถเลือก Force stop เพื่อบังคับหยุดงานที่ DC ได้ แต่ DR ยังใช้งานได้ จะต้องเข้าไปที่หน้า SRM บน DR เพื่อสั่ง Force Stop งานเดียวกันนั้นด้วย ทั้งนี้ ถึงแม้จะหยุดงาน Replication ที่ต้นทางไปแล้ว แต่ <strong className="font-semibold text-slate-700">Replica files ที่ DR อาจยังอยู่</strong> สามารถเข้าไป DR แล้วใช้ข้อมูล Replica ล่าสุดนั้นในการ <strong className="font-semibold text-slate-700">Recover VM</strong> ได้
                      </span>
                    </span>
                  </label>
                </div>

                <div className="pt-2">
                  <label className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={retainReplicaDisks}
                      onChange={e => setRetainReplicaDisks(e.target.checked)}
                      className="mt-1 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">Retain replica disks</span>
                      <span className="thai-helper-text mt-1 block text-xs leading-relaxed text-slate-500">
                        เก็บไฟล์ VMDK สำเนาที่ Target Datastore เอาไว้
                      </span>
                    </span>
                    <span className="sr-only">Choose whether to retain replica disks.</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200">
                  <Button
                    type="button"
                    disabled={busy}
                    aria-label="Confirm remove replication"
                    className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition-colors"
                    onClick={submitRemove}
                  >
                    REMOVE
                  </Button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* RECONFIGURE REPLICATION WIZARD (mode === 'reconfigure')           */}
            {/* ================================================================= */}
            {mode === 'reconfigure' && config && form && (
              <div>
                {/* 3-Step Stepper Header */}
                <nav aria-label="Reconfigure steps" className="mb-6">
                  <ol className="flex items-center justify-between border-b border-slate-200 pb-4">
                    {RECONFIG_STEPS.map(s => {
                      const isActive = reconfigStep === s.num;
                      const isDone = reconfigStep > s.num;
                      return (
                        <li key={s.num} className="flex items-center gap-2">
                          <Button
                            type="button"
                            onClick={() => {
                              if (s.num < reconfigStep || (s.num === 2 && isDatastoresValid) || (s.num === 3 && isDatastoresValid && isRpoValid)) {
                                setReconfigStep(s.num);
                              }
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                              isActive
                                ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                                : isDone
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {isDone ? '✓' : s.num}
                          </Button>
                          <span className={`text-xs font-medium hidden sm:inline ${isActive ? 'text-indigo-600 font-semibold' : isDone ? 'text-slate-800' : 'text-slate-500'}`}>
                            {s.label}
                          </span>
                          {s.num < 3 && <ArrowRight size={14} className="text-slate-300 mx-1 hidden sm:inline" />}
                        </li>
                      );
                    })}
                  </ol>
                </nav>

                {/* STEP 1: Target datastore */}
                <div className={reconfigStep === 1 ? 'space-y-4' : 'hidden'}>
                  <div className="space-y-3">
                    {form.disks.map((disk, idx) => {
                      const src = config.disks?.find(d => d.device_key === disk.deviceKey && d.is_vm_home === disk.isVmHome);
                      const label = disk.isVmHome ? 'VM configuration files' : (src?.label || `Hard disk ${form.disks.slice(0,idx+1).filter(d=>!d.isVmHome).length}`);
                      const selectedDatastore = (config.datastores || []).find(ds => String(ds.id) === String(disk.datastoreId));
                      const capacity = Number(selectedDatastore?.capacity ?? selectedDatastore?.capacity_bytes ?? selectedDatastore?.capacityBytes);
                      const freeSpace = Number(selectedDatastore?.free_space ?? selectedDatastore?.free_space_bytes ?? selectedDatastore?.freeSpace);
                      const hasCapacity = selectedDatastore && Number.isFinite(capacity) && Number.isFinite(freeSpace) && capacity > 0 && freeSpace >= 0 && freeSpace <= capacity;
                      const usedSpace = hasCapacity ? capacity - freeSpace : null;
                      const usedPercent = hasCapacity ? Math.round((usedSpace / capacity) * 100) : null;
                      const capacitySeverity = getCapacitySeverity(usedPercent);
                      const capacityColor = capacitySeverity === 'CRITICAL'
                        ? 'bg-[#FE5E37]'
                        : capacitySeverity === 'WARNING'
                          ? 'bg-[#F59E0B]'
                          : 'bg-[#8AC389]';

                      return (
                        <div key={`${disk.deviceKey}-${disk.isVmHome}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
                              {label}
                              {disk.isVmHome && <span className="sr-only">VM home</span>}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label htmlFor={`reconfig-ds-${disk.deviceKey}-${disk.isVmHome}`} className="block text-xs font-semibold text-slate-600 mb-1">
                                Destination datastore
                              </label>
                              <select
                                id={`reconfig-ds-${disk.deviceKey}-${disk.isVmHome}`}
                                aria-label="Destination datastore"
                                className={inputClass}
                                value={disk.datastoreId || ''}
                                onChange={e => {
                                  const val = e.target.value;
                                  setForm(prev => ({
                                    ...prev,
                                    disks: prev.disks.map(d =>
                                      d.deviceKey === disk.deviceKey && d.isVmHome === disk.isVmHome
                                        ? { ...d, datastoreId: val }
                                        : d
                                    )
                                  }));
                                }}
                              >
                                <option value="">Select datastore</option>
                                {(config.datastores || []).map(ds => (
                                  <option key={ds.id} value={ds.id}>
                                    {ds.name}
                                  </option>
                                ))}
                              </select>
                              {selectedDatastore && (
                                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                                    <span className="font-medium text-slate-600">Capacity</span>
                                    <span className="font-semibold text-slate-900">
                                      {hasCapacity ? `${usedPercent}% used` : 'Unavailable'}
                                    </span>
                                  </div>
                                  <div
                                    className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
                                    role="progressbar"
                                    aria-label={`${selectedDatastore.name} used capacity`}
                                    aria-valuemin="0"
                                    aria-valuemax="100"
                                    aria-valuenow={usedPercent ?? undefined}
                                  >
                                    <div
                                      className={`h-full rounded-full transition-[width] duration-300 ${capacityColor}`}
                                      style={{ width: `${usedPercent ?? 0}%` }}
                                    />
                                  </div>
                                  {hasCapacity && (
                                    <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-500">
                                      <span>{formatBytes(freeSpace)} free</span>
                                      <span>{formatBytes(capacity)} total</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div>
                              <label htmlFor={`reconfig-pol-${disk.deviceKey}-${disk.isVmHome}`} className="block text-xs font-semibold text-slate-600 mb-1">
                                Storage policy (optional)
                              </label>
                              <select
                                id={`reconfig-pol-${disk.deviceKey}-${disk.isVmHome}`}
                                aria-label="Storage policy"
                                className={inputClass}
                                value={disk.storagePolicyId || ''}
                                onChange={e => {
                                  const val = e.target.value || null;
                                  setForm(prev => ({
                                    ...prev,
                                    disks: prev.disks.map(d =>
                                      d.deviceKey === disk.deviceKey && d.isVmHome === disk.isVmHome
                                        ? { ...d, storagePolicyId: val }
                                        : d
                                    )
                                  }));
                                }}
                              >
                                <option value="">Datastore default</option>
                                {(config.policies || []).map(p => (
                                  <option key={p.storage_policy_id} value={p.storage_policy_id}>
                                    {p.storage_policy_name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end pt-4 border-t border-slate-200">
                    <Button
                      type="button"
                      disabled={!isDatastoresValid}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                      onClick={() => setReconfigStep(2)}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                {/* STEP 2: Replication settings */}
                <div className={reconfigStep === 2 ? 'space-y-4' : 'hidden'}>
                  <ReplicationSettings config={config} form={form} onChange={setForm} id="reconfigure" />

                    <div className="flex justify-between pt-4 border-t border-slate-200">
                    <Button
                      type="button"
                      className={buttonClass}
                      onClick={() => setReconfigStep(1)}
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      disabled={!isRpoValid || !validSettings(config,form)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                      onClick={() => setReconfigStep(3)}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                {/* STEP 3: Review changes */}
                {(() => {
                  const changes = [];
                  if (initialForm && form && config) {
                    const retention = value => value.mpit ? `${value.mpitInstances} per day for ${value.mpitDays} days` : 'Disabled';
                    if (retention(initialForm) !== retention(form)) changes.push({field:'Point-in-time retention',oldVal:retention(initialForm),newVal:retention(form)});
                    if (Boolean(initialForm.dataSets) !== Boolean(form.dataSets)) changes.push({field:'DataSets replication',oldVal:initialForm.dataSets?'Enabled':'Disabled',newVal:form.dataSets?'Enabled':'Disabled'});
                    form.disks.forEach((d, idx) => {
                      const oldD = initialForm.disks?.find(od => od.deviceKey === d.deviceKey && od.isVmHome === d.isVmHome);
                      const src = config.disks?.find(cd => cd.device_key === d.deviceKey && cd.is_vm_home === d.isVmHome);
                      const diskLabel = d.isVmHome ? 'VM configuration files' : (src?.label || `Hard disk ${form.disks.slice(0,idx+1).filter(disk=>!disk.isVmHome).length}`);

                      if (oldD && oldD.datastoreId !== d.datastoreId) {
                        const oldDsName = config.datastores?.find(ds => ds.id === oldD.datastoreId)?.name || 'Unavailable';
                        const newDsName = config.datastores?.find(ds => ds.id === d.datastoreId)?.name || 'Unavailable';
                        changes.push({ field: `Target datastore (${diskLabel})`, oldVal: oldDsName, newVal: newDsName });
                      }

                      if (oldD && (oldD.storagePolicyId || null) !== (d.storagePolicyId || null)) {
                        const oldPol = config.policies?.find(p => p.storage_policy_id === oldD.storagePolicyId)?.storage_policy_name || 'Datastore default';
                        const newPol = config.policies?.find(p => p.storage_policy_id === d.storagePolicyId)?.storage_policy_name || 'Datastore default';
                        changes.push({ field: `Storage policy (${diskLabel})`, oldVal: oldPol, newVal: newPol });
                      }
                    });

                    if (Number(initialForm.rpo) !== Number(form.rpo)) {
                      changes.push({ field: 'RPO', oldVal: `${initialForm.rpo} minutes`, newVal: `${form.rpo} minutes` });
                    }
                    if (Boolean(initialForm.networkCompression) !== Boolean(form.networkCompression)) {
                      changes.push({ field: 'Network compression', oldVal: initialForm.networkCompression ? 'Enabled' : 'Disabled', newVal: form.networkCompression ? 'Enabled' : 'Disabled' });
                    }
                    if (Boolean(initialForm.quiesce) !== Boolean(form.quiesce)) {
                      changes.push({ field: 'Quiesce guest OS', oldVal: initialForm.quiesce ? 'Enabled' : 'Disabled', newVal: form.quiesce ? 'Enabled' : 'Disabled' });
                    }
                    if (Boolean(initialForm.encryption) !== Boolean(form.encryption)) {
                      changes.push({ field: 'Network encryption', oldVal: initialForm.encryption ? 'Enabled' : 'Disabled', newVal: form.encryption ? 'Enabled' : 'Disabled' });
                    }
                    if (Boolean(initialForm.autoReplicateNewDisks) !== Boolean(form.autoReplicateNewDisks)) {
                      changes.push({ field: 'Auto-replicate new disks', oldVal: initialForm.autoReplicateNewDisks ? 'Enabled' : 'Disabled', newVal: form.autoReplicateNewDisks ? 'Enabled' : 'Disabled' });
                    }
                  }

                  return (
                    <div className={reconfigStep === 3 ? 'space-y-4' : 'hidden'}>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2">
                          Review changes
                        </h3>

                        {changes.length === 0 ? (
                          <div className="p-6 text-center rounded-xl border border-dashed border-slate-200 bg-white text-slate-500 text-sm">
                            No changes detected. Modify at least one setting to reconfigure.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold tracking-wider text-slate-500">
                              Modified Settings ({changes.length})
                            </h4>
                            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                              {changes.map((c, i) => (
                                <div key={i} className="flex items-center justify-between p-3.5 text-xs">
                                  <span className="font-semibold text-slate-700">{c.field}</span>
                                  <div className="flex items-center gap-2 font-medium">
                                    <span className="text-slate-400 line-through">{c.oldVal}</span>
                                    <ArrowRight size={12} className="text-slate-400" />
                                    <span className="text-indigo-600 font-bold">{c.newVal}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-between pt-4 border-t border-slate-200">
                        <Button
                          type="button"
                          className={buttonClass}
                          onClick={() => setReconfigStep(2)}
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          disabled={busy || changes.length === 0 || !validSettings(config,form) || !isDatastoresValid}
                          className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-5 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-40"
                          onClick={submitReconfigure}
                        >
                          Confirm Reconfigure
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Loading indicator */}
            {busy && !loadingStage && (
              <p role="status" className="mt-4 flex items-center gap-2 text-xs text-slate-600 font-medium">
                Loading...
              </p>
            )}
          </section>
        </div>
      )}

      {/* Compact Floating Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 right-5 z-50 flex w-fit max-w-[calc(100vw-2.5rem)] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl transition-all sm:max-w-md"
        >
          {(toast.type === 'success' || toast.type === 'error') && <div className="shrink-0">
            {toast.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            )}
          </div>}
          <div className="flex-1 min-w-0">
            <p className={`break-words text-xs font-medium ${toast.type === 'error' ? 'text-rose-700' : 'text-slate-800'}`}>
              {toast.message}
            </p>
          </div>
          <Button
            onClick={() => setToast(null)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Dismiss toast"
          >
            <X size={16} />
          </Button>
        </div>
      )}
    </>
  );
});

export default VrManagement;
