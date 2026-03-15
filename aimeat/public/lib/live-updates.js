/**
 * SSE Live Updates — singleton connection with reference counting and debounced callbacks.
 * Opens an EventSource to /v1/events using a single-use ticket obtained via authenticated POST.
 */

let es = null;
let listeners = new Set();
let debounceTimer = null;
let refCount = 0;
let jwtGetter = null;
let reconnectTimer = null;
let reconnectDelay = 5000;
const MAX_RECONNECT_DELAY = 120000;

export async function connect(getJwt) {
  refCount++;
  if (es) return;

  jwtGetter = getJwt;
  await _open();
}

async function _open() {
  const jwt = jwtGetter?.();
  if (!jwt) return;

  try {
    const resp = await fetch('/v1/events/ticket', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}` },
    });
    if (!resp.ok) return;
    const body = await resp.json();
    const ticket = body.data.ticket;

    es = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);

    es.onopen = () => {
      reconnectDelay = 5000; // reset on successful connection
    };

    es.onmessage = () => {
      reconnectDelay = 5000; // reset on successful message
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        listeners.forEach(fn => fn());
      }, 2000);
    };

    es.onerror = () => {
      if (es) { es.close(); es = null; }
      clearTimeout(reconnectTimer);
      if (refCount > 0 && jwtGetter) {
        reconnectTimer = setTimeout(() => {
          if (refCount > 0) _open();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      }
    };
  } catch {
    // Network error fetching ticket — retry with backoff
    clearTimeout(reconnectTimer);
    if (refCount > 0) {
      reconnectTimer = setTimeout(() => {
        if (refCount > 0) _open();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }
  }
}

export function disconnect() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    if (es) { es.close(); es = null; }
    clearTimeout(debounceTimer);
    clearTimeout(reconnectTimer);
    reconnectDelay = 5000;
    jwtGetter = null;
  }
}

export function onUpdate(callback) {
  listeners.add(callback);
}

export function offUpdate(callback) {
  listeners.delete(callback);
}
