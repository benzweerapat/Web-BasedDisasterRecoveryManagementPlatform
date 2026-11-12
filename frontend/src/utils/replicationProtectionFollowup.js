const terminalStates = new Set(['FAILED', 'RECONCILIATION_BLOCKED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED']);

async function waitAcceptedOperation(operationId, wait) {
  try {
    return await wait(operationId);
  } catch (error) {
    // A timeout or unavailable status does not mean the accepted write failed.
    // Only polling this same operation is safe to retry.
    error.protectionOperationPending = !terminalStates.has(error.operationState);
    throw error;
  }
}

export async function completeReplicationProtection({ context, progress, submit, wait, onProgress = () => {} }) {
  const memberIds = Array.isArray(context.vmIds) && context.vmIds.length
    ? [...new Set(context.vmIds.filter(Boolean))]
    : [context.vmId];

  if (context.mode === 'existing' && memberIds.length > 1 && !progress.pgSuccess) {
    progress.memberOperationIds ||= {};
    progress.memberSuccess ||= {};
    for (const vmId of memberIds) {
      if (progress.memberSuccess[vmId]) continue;
      if (!progress.memberOperationIds[vmId]) {
        const operation = await submit('/srm/protection-groups/' + encodeURIComponent(context.pgId) + '/members', {
          pairId:Number(context.pairId), action:'add', vmId, confirmed:true
        });
        progress.memberOperationIds[vmId] = operation.operationId;
        onProgress();
      }
      await waitAcceptedOperation(progress.memberOperationIds[vmId], wait);
      progress.memberSuccess[vmId] = true;
      onProgress();
    }
    progress.pgSuccess = true;
    progress.pgId = context.pgId;
    onProgress();
  }

  if (!progress.pgSuccess || (context.rpId && !progress.pgId)) {
    if (!progress.pgOperationId) {
      const operation = context.mode === 'new'
        ? await submit('/srm/protection-groups', {pairId:Number(context.pairId), name:context.newPgName.trim(), memberIds, confirmed:true})
        : await submit('/srm/protection-groups/' + encodeURIComponent(context.pgId) + '/members', {pairId:Number(context.pairId), action:'add', vmId:context.vmId, confirmed:true});
      progress.pgOperationId = operation.operationId;
      onProgress();
    }
    const result = await waitAcceptedOperation(progress.pgOperationId, wait);
    progress.pgSuccess = true;
    progress.pgId = context.mode === 'new' ? result.resolvedId : context.pgId;
    onProgress();
  }

  if (context.rpId && !progress.rpSuccess) {
    if (!progress.pgId) {
      throw Object.assign(new Error('Protection group identity needs reconciliation.'), {
        safeMessage:'Protection group membership was verified, but its identity is still unavailable. Resume the status check before adding it to the recovery plan.',
        protectionOperationPending:true
      });
    }
    if (!progress.rpOperationId) {
      const operation = await submit('/srm/recovery-plans/' + encodeURIComponent(context.rpId) + '/protection-groups', {
        pairId:Number(context.pairId), action:'add', protectionGroupId:progress.pgId, confirmed:true
      });
      progress.rpOperationId = operation.operationId;
      onProgress();
    }
    await waitAcceptedOperation(progress.rpOperationId, wait);
    progress.rpSuccess = true;
    onProgress();
  }
}

export async function waitForReplicationOperations(operationIds, {
  read,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 180,
  intervalMs = 3000,
  onStatus = () => {}
} = {}) {
  const ids = [...new Set((operationIds || []).filter(Boolean))];
  if (!ids.length) throw new Error('No replication operations were accepted.');
  if (typeof read !== 'function') throw new Error('Replication status reader is unavailable.');

  return Promise.all(ids.map(async operationId => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const operation = await read(operationId);
        onStatus(operationId, operation);
        if (operation?.status === 'SUCCESS') return operation;
        if (operation?.status === 'FAILED') {
          const detail = typeof operation.error === 'object' ? operation.error : {};
          const message = detail.safeMessage || operation.safeMessage || operation.errorMessage || 'Replication operation failed.';
          throw Object.assign(new Error(message), {safeMessage:message, operationState:'FAILED'});
        }
      } catch (error) {
        if (error?.operationState === 'FAILED') throw error;
        onStatus(operationId, null);
      }
      await sleep(intervalMs);
    }
    throw Object.assign(new Error('Replication operation is still pending.'), {
      safeMessage:'Replication is still running. The Protection Group has not been created yet; check Background operations before trying again.'
    });
  }));
}
