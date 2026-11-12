const executableActions = ['test', 'cleanup', 'migration', 'recovery', 'reprotect'];

// Status alone is not permission to run a recovery. Only a current, successful
// capability response may enable a command; the previous response is display-only.
export function recoveryActionAvailability({ info, previousActions = [], phase = 'loading', role, busy = false, locked = false, disabled = false }) {
  const writable = ['ADMIN', 'OPERATOR'].includes(role);
  const listed = Array.isArray(info?.actions) ? info.actions : [];
  const verified = phase === 'ready' && Array.isArray(info?.actions);
  const conflict = Object.values(info?.actionAvailability?.reasons || {}).includes('WRITE_CONFLICT');
  const running = locked || info?.isRunning === true;
  const available = verified && !busy && !running && !disabled && !conflict
    ? executableActions.filter(action => listed.includes(action)
      && writable
      && (!['migration', 'recovery', 'reprotect'].includes(action) || role === 'ADMIN')
      && (action === 'cleanup' || info?.preflight?.ready !== false))
    : [];
  const prior = !verified || running ? previousActions : [];
  const showCleanup = listed.includes('cleanup') || prior.includes('cleanup');
  const preflightUnavailable = info?.preflight?.ready === false
    && (info.preflight.blockers || []).some(blocker => blocker.code === 'RECOVERY_PREFLIGHT_UNAVAILABLE');
  let message = '';
  if (phase === 'loading') message = 'Checking available actions…';
  else if (phase === 'error') message = 'Action availability unavailable. Refresh before running a recovery.';
  else if (disabled || running || conflict) message = 'An operation is in progress. Actions will be checked again when it finishes.';
  else if (preflightUnavailable) message = 'Protection readiness is unavailable. Refresh actions before running a recovery.';
  else if (info?.preflight?.ready === false) message = 'Recovery plan is not ready. Review the readiness blockers.';
  else if (available.length === 0 && !busy) message = 'No recovery actions are available in the current state.';
  return {
    available,
    // Keep these controls in place while readiness is being checked. A disabled
    // control with an explanation must not look like a missing feature.
    showTest: writable,
    showRun: role === 'ADMIN',
    showCleanup,
    message,
    conflict,
    preflightUnavailable
  };
}
