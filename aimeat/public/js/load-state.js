/**
 * @file public/js/load-state.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An error is not an empty result. The one shared way for a page to tell three outcomes
 *   of a load apart (loading, failed, loaded), the one way to draw "could not load" with a Retry,
 *   and the guard for a write that needs a record it could not read.
 *
 *   The rule (docs/pitfalls.md section 84, the browser half). A load that fails leaves the page's data
 *   as it was (null before the first load) and marks the load failed; it never sets an empty list,
 *   because the page then draws "you have none" over data that still exists. A read that forgives a
 *   failure (answers [], {} or null) is for DRAWING only. A write that saves a whole record reads it
 *   with the strict read first (the services name it `…Strict`), so a failed read stops the write;
 *   or the page refuses to save a record it did not load.
 *
 * @structure
 *   - loadPhase({ loaded, error }): 'loading' | 'failed' | 'loaded' (pure)
 *   - useLoadState(): { loaded, error, phase, failed, ok(), fail(err), reset() } for a page's own loader
 *   - LoadFailed({ onRetry, text, hint }): the existing ErrorNote with a Retry button
 *   - readForWrite(read, words): runs a strict read for a write; a failure throws NOT_LOADED with words
 *     a person can act on, the original error as `cause`
 *   - isNotLoaded(err): true for the error readForWrite throws
 * @usage
 *   const load = useLoadState();
 *   try { setItems(await listItems()); load.ok(); } catch (err) { swallowed('x', err); load.fail(err); }
 *   if (load.failed) return html`<${LoadFailed} onRetry=${reload} />`;
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: three-outcome load state, the could-not-load note and the strict-read
 *     guard for writes (QA audit F6-05, E7-04, F6-01, F6-04).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { ErrorNote, ErrorNoteFallback } from '/components/ErrorNote.js';

const html = htm.bind(h);

/**
 * The outcome of a load. A load that once succeeded stays 'loaded' when a later reload fails: the
 * data on the page is real, only older. Before the first success, an error is 'failed'.
 * @param {{ loaded?: boolean, error?: unknown }} state
 * @returns {'loading'|'failed'|'loaded'}
 */
export function loadPhase({ loaded, error }) {
  if (loaded) return 'loaded';
  return error ? 'failed' : 'loading';
}

/**
 * Load-state bookkeeping for a page whose loader sets its own data. `ok`, `fail` and `reset` are
 * stable across renders, so a loader in a useCallback with [] deps may call them.
 * @param {boolean} [initiallyLoaded=false] true when the page starts from data a caller already loaded
 */
export function useLoadState(initiallyLoaded = false) {
  const [state, setState] = useState({ loaded: !!initiallyLoaded, error: /** @type {unknown} */ (null) });
  const actions = useMemo(() => ({
    ok: () => setState({ loaded: true, error: null }),
    /** @param {unknown} err */
    fail: (err) => setState((s) => ({ loaded: s.loaded, error: err || new Error('Load failed') })),
    reset: () => setState({ loaded: false, error: null }),
  }), []);
  const phase = loadPhase(state);
  return { ...state, phase, failed: phase === 'failed', ...actions };
}

/**
 * "This could not be loaded", in the existing error frame, with a Retry button when onRetry is given.
 * @param {{ onRetry?: () => any, text?: any, hint?: any }} props
 */
export function LoadFailed({ onRetry, text, hint }) {
  return html`
    <${ErrorNote} text=${text || t('common.loadFailed')} hint=${hint}>
      ${onRetry ? html`<${ErrorNoteFallback} onClick=${() => onRetry()}>${t('common.retry')}<//>` : null}
    <//>`;
}

/**
 * Run the strict read a write depends on. A failure throws an error with code NOT_LOADED whose
 * message says nothing was saved (or `words`), so the caller's ordinary error toast says the right
 * thing; the original error is kept as `cause`.
 * @template T
 * @param {() => Promise<T>} read
 * @param {string} [words]
 * @returns {Promise<T>}
 */
export async function readForWrite(read, words) {
  try {
    return await read();
  } catch (err) {
    const e = /** @type {Error & { code?: string }} */ (new Error(words || t('common.notLoadedNotSaved'), { cause: err }));
    e.code = 'NOT_LOADED';
    throw e;
  }
}

/** @param {unknown} err */
export function isNotLoaded(err) {
  return !!err && typeof err === 'object' && /** @type {{ code?: string }} */ (err).code === 'NOT_LOADED';
}
