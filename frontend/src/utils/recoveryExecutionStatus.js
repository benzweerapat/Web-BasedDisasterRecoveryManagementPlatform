const terminalStates = new Set(['SUCCESS','FAILED','RECONCILIATION_BLOCKED','ROLLBACK_SUCCESS','ROLLBACK_FAILED']);

const inProgressStatus = {
  test:'TEST_IN_PROGRESS',
  cleanup:'CLEANUP_IN_PROGRESS',
  migration:'MIGRATION_IN_PROGRESS',
  recovery:'RECOVERY_IN_PROGRESS',
  reprotect:'REPROTECT_IN_PROGRESS'
};

export function recoveryExecutionStatus(operation) {
  if (!operation || terminalStates.has(operation.state)) return null;
  return inProgressStatus[String(operation.operation || '').toLowerCase()] || 'IN_PROGRESS';
}
