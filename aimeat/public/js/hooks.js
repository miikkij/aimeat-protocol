/**
 * AIMEAT Shared Hooks
 * Reusable Preact hooks for common data-fetching and UI patterns.
 */
import { useState, useEffect } from 'preact/hooks';
import { api } from '/js/api.js';

/**
 * Fetch data from an AIMEAT API endpoint with automatic loading/error state.
 *
 * @param {string} endpoint - The /v1/* path to fetch
 * @param {object} [options]
 * @param {Array}   [options.deps=[]]   - Extra useEffect dependencies (e.g. [agentId])
 * @param {boolean} [options.skip=false] - Skip the fetch (e.g. when auth not ready)
 * @param {string}  [options.method='GET'] - HTTP method
 * @param {object}  [options.body]      - Request body for POST/PUT
 * @returns {{ data: any, error: string|null, loading: boolean, reload: function }}
 *
 * @example
 * const { data, error, loading, reload } = useApiCall('/v1/memory/profile');
 * if (loading) return html`<div class="loading-spinner"></div>`;
 * if (error)   return html`<div class="alert alert-error">${error}</div>`;
 * return html`<div>${data.value}</div>`;
 */
export function useApiCall(endpoint, options = {}) {
  const { deps = [], skip = false, method = 'GET', body } = options;
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (skip) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api(endpoint, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(r => {
      if (cancelled) return;
      if (r.ok) {
        setData(r.data ?? r);
        setError(null);
      } else {
        setError(r.error?.message ?? String(r.error ?? 'Request failed'));
        setData(null);
      }
    }).catch(() => {
      if (!cancelled) setError('Network error — please try again');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  // deps are intentionally dynamic (endpoint/method/reloadKey + caller-supplied deps)
  }, [endpoint, method, reloadKey, ...deps]);

  /** Call reload() to re-trigger the fetch (e.g. after a mutation). */
  function reload() { setReloadKey(k => k + 1); }

  return { data, error, loading, reload };
}
