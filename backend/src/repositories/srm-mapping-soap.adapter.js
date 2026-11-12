const {
  pool
} = require('../../db');

const {
  randomUUID
} = require('crypto');

const audit =
  require('../services/audit.service');

const {
  fingerprint,
  terminal,
  SafetyError
} = require('../services/srm-write-engine');

const decode = r => r && {
  id: r.task_id,
  state: r.status,
  startedAt: r.start_time,
  intent: r.operation_context,
  data: r.saga_data || {},

  user: {
    id: r.saga_data?.userId,
    username: r.username,
    role: r.requested_role
  },

  requestId: r.request_id
};

const safe = op => ({
  operationId: op.id,
  state: op.state,
  startedAt: op.startedAt,

  lastUpdated:
    op.data.lastUpdated ||
    op.startedAt,

  requestedBy:
    op.user?.username ||
    null,

  operation:
    op.intent.action,

  planName:
    op.data.planName ||
    op.intent.confirmName ||
    null,

  cancelState:
    op.data.cancelState ||
    null,

  vmwareStatus:
    op.data.vmwareStatus ||
    null,

  taskId:
    op.data.taskId ||
    null,

  finalOutcome:
    op.data.finalOutcome ||
    null,

  upstreamCode:
    /^SRM_HTTP_\d{3}$/.test(
      String(
        op.data.upstreamCode ||
        ''
      )
    )
      ? op.data.upstreamCode
      : null,

  refreshStatus:
    [
      'SYNCED',
      'RETRYING',
      'DEGRADED'
    ].includes(
      op.data.refreshStatus
    )
      ? op.data.refreshStatus
      : null,

  observedPlanStatus:
    typeof op.data.observedPlanStatus ===
    'string'
      ? op.data.observedPlanStatus
      : null,

  reconciliationOutcome:
    typeof op.data.reconciliationOutcome ===
    'string'
      ? op.data.reconciliationOutcome
      : null,

  // A reconciled success is authoritative. Preserve historical failure details
  // in the journal, but never present a successful operation as failed.
  error:
    [
      'SUCCESS',
      'ROLLBACK_SUCCESS'
    ].includes(op.state)
      ? null
      : (
        op.data.error ||
        null
      ),

  resolvedId:
    op.data.resolvedId ||
    null
});