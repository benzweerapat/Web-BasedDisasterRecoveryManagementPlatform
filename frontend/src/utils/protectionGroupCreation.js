// Keep accepted operations and the verified group while the optional plan step
// is retried. A polling timeout is not evidence that a write failed.
const failedStates = new Set(['FAILED', 'ROLLBACK_SUCCESS']);

async function waitForStage(progress, field, wait, onProgress) {
  try {
    return await wait(progress[field]);
  } catch (error) {
    if (failedStates.has(error.operationState)) {
      delete progress[field];
      onProgress();
    }
    throw error;
  }
}

export async function completeProtectionGroupCreation({
  progress, groupPayload, recovery, submit, wait, onProgress = () => {}
}) {
  if (!progress.groupId) {
    if (!progress.groupOperationId) {
      const operation = await submit('/srm/protection-groups', groupPayload);
      progress.groupOperationId = operation.operationId;
      onProgress();
    }
    const group = await waitForStage(progress, 'groupOperationId', wait, onProgress);
    if (!group.resolvedId) throw new Error('Created group identity needs reconciliation.');
    progress.groupId = group.resolvedId;
    onProgress();
  }

  if (recovery.option === 'none') return progress.groupId;
  if (!progress.recoveryOperationId) {
    const operation = recovery.option === 'existing'
      ? await submit(`/srm/recovery-plans/${encodeURIComponent(recovery.planId)}/protection-groups`, {
        pairId: groupPayload.pairId, action: 'add', protectionGroupId: progress.groupId, confirmed: true
      })
      : await submit('/srm/recovery-plans', {
        pairId: groupPayload.pairId, name: recovery.name.trim(), memberIds: [progress.groupId], confirmed: true
      });
    progress.recoveryOperationId = operation.operationId;
    onProgress();
  }
  await waitForStage(progress, 'recoveryOperationId', wait, onProgress);
  return progress.groupId;
}

export function toggleVisibleVmSelection(selected, visibleVms) {
  const visibleIds = visibleVms.map(vm => vm.id);
  if (!visibleIds.length) return new Set(selected);
  const remove = visibleIds.every(id => selected.has(id));
  const next = new Set(selected);
  visibleIds.forEach(id => remove ? next.delete(id) : next.add(id));
  return next;
}
