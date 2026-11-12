import apiClient, { getCsrfToken, setCsrfToken, invalidateReadCache } from '../api/apiClient';

/**
 * Stream Sync all execution via Server-Sent Events over HTTP POST.
 * Automatically invalidates local cache and dispatches 'inventory-cache-invalidated'
 * as each connection completes, enabling progressive real-time UI updates.
 */
export async function streamSyncAll({ onProgress, signal } = {}) {
  let token = getCsrfToken();
  if (!token) {
    try {
      const csrfRes = await apiClient.get('/security/csrf-token');
      token = csrfRes.data?.csrfToken;
      if (token) setCsrfToken(token);
    } catch (_) {}
  }

  const send = () => fetch('/api/sync/all?stream=true', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...(token ? { 'X-CSRF-Token': token } : {})
    },
    credentials: 'include',
    signal
  });

  let response = await send();
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => ({}));
    if ([body.type, body.code, body.error?.code].includes('CSRF_ERROR')) {
      const csrf = await apiClient.get('/security/csrf-token', { refresh: true });
      token = csrf.data?.csrfToken;
      if (token) {
        setCsrfToken(token);
        response = await send();
      }
    }
  }

  if (!response.ok) {
    let errorBody = {};
    try {
      errorBody = await response.json();
    } catch (_) {}
    const err = new Error(errorBody?.error?.safeMessage || errorBody?.message || 'Unable to start synchronization');
    err.response = {
      status: response.status,
      data: errorBody
    };
    throw err;
  }

  if (!response.body) throw new Error('Synchronization response was empty. Refresh status before retrying.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResult = null;

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      let eventType = 'message';
      let dataText = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataText = line.slice(6).trim();
        }
      }

      if (!dataText) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(dataText);
      } catch (_) {
        continue;
      }

      if (eventType === 'progress') {
        if (typeof onProgress === 'function') {
          onProgress(parsed);
        }
        // As each connection completes and writes to disk, trigger immediate read cache invalidation!
        if (parsed?.type === 'CONNECTION_COMPLETED') {
          invalidateReadCache();
        }
      } else if (eventType === 'complete') {
        finalResult = parsed?.data || parsed;
        invalidateReadCache();
      } else if (eventType === 'error') {
        const err = new Error(parsed?.safeMessage || 'Synchronization failed');
        err.response = {
          status: parsed?.httpStatus || 500,
          data: { error: parsed }
        };
        throw err;
      }
    }
  }

  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!finalResult) {
    const error = new Error('Synchronization connection ended before completion. Refresh status before retrying.');
    error.response = { status: 502, data: { error: { code: 'SYNC_STREAM_INCOMPLETE', safeMessage: error.message } } };
    throw error;
  }

  return {
    data: {
      success: true,
      data: finalResult
    }
  };
}
