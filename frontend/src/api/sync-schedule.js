import api, { setCsrfToken, invalidateReadCache } from './apiClient';
import { SYNC_ALL_ENDPOINT } from '../utils/sync-all';

let state = { running: false, manualRunning: false, lastAt: null, status: null, seconds: 0, nextAt: null, error: null };
const listeners = new Set();
let timer = null;
let scheduledInFlight = null;
let manualActive = 0;
// A manual button gets its own lock. This keeps a pending request from an
// unmounted page from blocking a different page's button.
const manualInFlight = new WeakMap();

const emit = patch => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};

function schedule() {
  clearTimeout(timer);
  // Automatic synchronization is owned by the backend.
}

export function setSyncInterval(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400 || (seconds > 0 && seconds < 60)) {
    throw Error('Use 0 or 60–86400 seconds');
  }
  return api.put('/sync/schedule',{seconds}).then(response=>emit(response.data.data));
}

export function runSync(request) {
  const existing = request ? manualInFlight.get(request) : scheduledInFlight;
  if (existing) return existing;

  clearTimeout(timer);
  if (request) {
    manualActive += 1;
    emit({ manualRunning: true, error: null, nextAt: null });
  } else {
    emit({ running: true, error: null, nextAt: null });
  }

  const task = (async () => {
    try {
      // The application obtains the CSRF token during bootstrap. Automatic
      // runs refresh it first so a long-open tab can keep syncing safely.
      if (!request) {
        const token = await api.get('/security/csrf-token');
        setCsrfToken(token.data.csrfToken);
      }
      const response = await (request ? request() : api.post(SYNC_ALL_ENDPOINT, {}));
      const result = response?.data?.data || response?.data || {};
      emit({
        lastAt: result.completedAt || new Date().toISOString(),
        status: result.overallStatus || result.status || 'COMPLETED'
      });
      return response;
    } catch (error) {
      emit({
        lastAt: new Date().toISOString(),
        status: 'FAILED',
        error: error?.response?.data?.error?.safeMessage || 'Sync failed'
      });
      throw error;
    } finally {
      if (request) {
        if (manualInFlight.get(request) === task) manualInFlight.delete(request);
        manualActive = Math.max(0, manualActive - 1);
        if (!manualActive) emit({ manualRunning: false });
      } else if (scheduledInFlight === task) {
        scheduledInFlight = null;
      }
      if (!request) emit({ running: false });
      if (!manualActive) schedule();
    }
  })();

  if (request) manualInFlight.set(request, task);
  else scheduledInFlight = task;
  return task;
}

export const getSyncState = () => state;

export function subscribeSync(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let scheduleRead=null;
export function refreshSyncSchedule(){
 if(scheduleRead)return scheduleRead;
 scheduleRead=api.get('/sync/schedule',{refresh:true}).then(r=>{const next=r.data.data;const changed=next.lastAt&&next.lastAt!==state.lastAt;emit({...next,...(!next.lastAt?{lastAt:state.lastAt,status:state.status}:{})});if(changed)invalidateReadCache();return state;}).finally(()=>{scheduleRead=null;});
 return scheduleRead;
}