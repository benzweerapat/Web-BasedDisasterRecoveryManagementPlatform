// Allowlisted public diagnostics. Never derive public text from an upstream body/message.
const definitions = Object.freeze({
  SRM_HTTP_400: [400, 'SRM rejected the recovery plan configuration. Refresh the plan and verify that the Protection Group is ready and belongs to the selected protected site.'],
  SRM_HTTP_429: [503, 'SRM is limiting requests. Wait before refreshing or starting another operation.'],
  SRM_SESSION_BUSY: [503, 'SRM session capacity is busy. Wait for the current request to finish.'],
  SRM_SESSION_CLEANUP_FAILED: [503, 'SRM session cleanup was not confirmed. New sessions are blocked until cleanup succeeds.'],
  SRM_SESSION_LOGIN_UNCERTAIN: [503, 'SRM login outcome is unknown. Automatic login retries have been stopped.'],
  TRANSPORT_ERROR: [502, 'VMware could not be reached. No successful operation is confirmed.'],
  TIMEOUT: [504, 'The VMware request timed out. Check saved progress before retrying.'],
  AUTH_REQUIRED: [401, 'Please sign in again.'],
  UPSTREAM_AUTH_FAILED: [502, 'VMware authentication failed after the permitted session refresh.'],
  UPSTREAM_FORBIDDEN: [502, 'VMware denied this request with the configured connection permissions.'],
  FORBIDDEN: [403, 'You do not have permission to perform this action.'],
  VALIDATION_ERROR: [400, 'Check the request fields and confirmation.'],
  INVALID_STATE: [409, 'The current object or pairing state does not allow this operation. Refresh before retrying.'],
  RECOVERY_PREFLIGHT_FAILED: [409, 'The recovery plan is not ready. Resolve the reported protection group or virtual machine blockers before running it.'],
  WRITE_CONFLICT: [409, 'Another operation or a changed request conflicts with this write. Refresh saved progress.'],
  SRM_OPERATION_FAILED: [502, 'Site Recovery Manager rejected the operation.'],
  VMWARE_OPERATION_FAILED: [502, 'VMware could not complete the operation.'],
  DATABASE_ERROR: [503, 'Application data is temporarily unavailable. No successful operation is confirmed.'],
  CONTRACT_ERROR: [502, 'VMware returned a response that does not match the supported API contract.'],
  UNKNOWN_UPSTREAM_ERROR: [502, 'The upstream request could not be confirmed. Check saved progress.'],
  INTERNAL_ERROR: [500, 'The application could not complete the request.'],
  NOT_FOUND: [404, 'The requested application resource was not found.']
});
function classifyOperationError(error = {}, { upstream = false } = {}) {
  const code = String(error.code || '');
  const status = Number(error.response?.status || error.httpStatus || error.statusCode || error.status || code.match(/(?:SRM|VR)_HTTP_(\d{3})$/)?.[1]);
  let type;
  if (error.origin === 'DATABASE') type = 'DATABASE_ERROR';
  else if (definitions[code]) type = code;
  else if (/^(08\w{3}|22\w{3}|23\w{3}|40\w{3}|42\w{3}|53\w{3}|57\w{3})$/.test(code)) type = 'DATABASE_ERROR';
  else if (['ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) type = 'TIMEOUT';
  else if (['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) type = 'TRANSPORT_ERROR';
  else if (status === 401) type = upstream || /^SRM_|^VR_/.test(code) ? 'UPSTREAM_AUTH_FAILED' : 'AUTH_REQUIRED';
  else if (status === 403) type = upstream || /^SRM_|^VR_/.test(code) ? 'UPSTREAM_FORBIDDEN' : 'FORBIDDEN';
  else if (/CONTRACT|PAGINATION|TRUNCATED|PARTIAL_RESPONSE/.test(code)) type = 'CONTRACT_ERROR';
  else if (/CONFLICT|CONCURRENT|IDEMPOTENCY|WRITE_IN_PROGRESS|OPERATION_BUSY/.test(code)) type = 'WRITE_CONFLICT';
  else if (/INVALID_|CONFIRMATION_REQUIRED|UNSUPPORTED_RECOVERY_ACTION/.test(code) || status === 400 || status === 422) type = 'VALIDATION_ERROR';
  else if (/STATE|SCOPE|DIRECTION|PAIR_|IDENTITY_CHANGED|OBJECT_NOT_FOUND|UNAVAILABLE|REFERENCED|NOT_REPLICATED|ALREADY_IN_OTHER|NOT_HBR|MAPPING_CHANGED|DEPENDENT_CONFIGURATION/.test(code)) type = 'INVALID_STATE';
  else if (/SRM_AUTH|SESSION_REJECTED|SESSION_EXPIRED/.test(code)) type = 'UPSTREAM_AUTH_FAILED';
  else if (/^SRM_HTTP_/.test(code)) type = 'SRM_OPERATION_FAILED';
  else if (/TASK_FAILED|VMWARE_OPERATION|^VR_HTTP_/.test(code)) type = 'VMWARE_OPERATION_FAILED';
  else if (status === 404 && !upstream) type = 'NOT_FOUND';
  else type = upstream || /UNCERTAIN/.test(code) ? 'UNKNOWN_UPSTREAM_ERROR' : 'INTERNAL_ERROR';
  const [httpStatus, safeMessage] = definitions[type];
  return { type, code: type, httpStatus, safeMessage };
}
function operationError(code) { return Object.assign(new Error(code), { code }); }
module.exports = { classifyOperationError, operationError, definitions };
