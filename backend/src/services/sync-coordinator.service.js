// Admission control for VMware synchronization runs.
//
// Several runs may be active at the same time as long as they do not touch
// the same data. Each run claims a set of resources; a resource is a scope
// (vcenter / vr / srm) and either one connection id or the whole scope ('*').
// Two runs conflict when they share a scope and either claims the whole scope
// or both claim the same connection. CONFIGURATION_CHANGE (and any unknown
// kind) is exclusive: it waits for nothing and nothing runs beside it.
const ALL = '*';

const KIND_SCOPES = Object.freeze({
  SYNC_ALL: ['vcenter', 'vr', 'srm'],
  VCENTER_SYNC: ['vcenter'],
  VR_SYNC: ['vr'],
  SRM_SYNC: ['srm']
});

function claimsFor(kind, connectionId) {
  const scopes = KIND_SCOPES[kind];
  if (!scopes) return null; // exclusive
  const target = connectionId == null || kind === 'SYNC_ALL' ? ALL : String(connectionId);
  return scopes.map(scope => ({ scope, target }));
}

function claimsConflict(a, b) {
  if (!a || !b) return true;
  return a.some(left => b.some(right =>
    left.scope === right.scope &&
    (left.target === ALL || right.target === ALL || left.target === right.target)
  ));
}

function inProgressError() {
  const error = new Error(
    'VMware data synchronization is already running'
  );

  error.code = 'SYNC_IN_PROGRESS';
  error.type = 'SYNC_IN_PROGRESS';
  error.statusCode = 409;

  error.safeMessage =
    'Synchronization is already in progress. Please wait for the current operation to finish.';

  return error;
}

function safeRun(run) {
  return {
    kind: run.kind,
    requestId: run.requestId,
    connectionId: run.connectionId,
    startedAt: run.startedAt.toISOString()
  };
}

class SyncCoordinatorService {
  constructor() {
    this.activeRuns = new Map();
  }

  acquire({
    kind = 'VMWARE_SYNC',
    requestId = null,
    connectionId = null
  } = {}) {
    const claims = claimsFor(kind, connectionId);

    for (const run of this.activeRuns.values()) {
      if (claimsConflict(claims, run.claims)) throw inProgressError();
    }

    const token = Symbol(
      'vmware-sync-coordinator'
    );

    this.activeRuns.set(token, {
      token,
      kind,
      requestId,
      connectionId,
      claims,
      startedAt: new Date()
    });

    return token;
  }

  release(token) {
    return this.activeRuns.delete(token);
  }

  isRunning() {
    return this.activeRuns.size > 0;
  }

  hasKind(kind) {
    for (const run of this.activeRuns.values()) {
      if (run.kind === kind) return true;
    }
    return false;
  }

  getSafeState() {
    if (!this.activeRuns.size) {
      return {
        status: 'IDLE',
        runs: []
      };
    }

    const runs = [...this.activeRuns.values()];
    // Report an exclusive run first so callers that only read the top-level
    // kind still see a configuration change.
    const primary = runs.find(run => !run.claims) || runs[0];

    return {
      status: 'RUNNING',
      ...safeRun(primary),
      runs: runs.map(safeRun)
    };
  }
}

const coordinator =
  new SyncCoordinatorService();

coordinator.SyncCoordinatorService =
  SyncCoordinatorService;

module.exports = coordinator;
