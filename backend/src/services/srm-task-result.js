// Expose only a known safe diagnostic code, never the raw VMware error text.
// The error.message shape and signature are also used by PG/RP task responses.
function srmTaskResult(task) {
  return {
    id: task.id,
    status: task.status,

    failureCode:
      /^Unable to find a viable replica for VR replication group/
        .test(
          String(task.error?.message || '')
        )
        ? 'REPLICA_NOT_READY'
        : null
  };
}

module.exports = {
  srmTaskResult
};