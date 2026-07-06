/**
 * @file Toast.js
 * @description Canonical toast hook — floating auto-dismissing notification pill
 *   rendered bottom-center. Styling lives in theme.css (.toast + .toast-success/
 *   -error/-info/-warn, tokens --toast-*).
 * @usage const { showToast, ToastContainer } = useToast();
 *   showToast(msg) / showToast(msg, true) / showToast(msg, 'error'|'info'|'warning')
 *   then render <${ToastContainer} /> at the view root (NOT inside any element
 *   with transform/filter — those trap the fixed-position pill).
 * @version-history
 *   v1.1.0 — 2026-07-06 — Accept string kinds: call sites across the codebase pass
 *     'success'/'error'/'info'/'warning' as the second arg, which as a truthy value
 *     made every toast (including successes) render red. normalizeToastType() is
 *     exported and shared with the profile shell's toast pathway.
 *   v1.0.0 — prior — boolean isError only.
 */
import { h } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

/**
 * Normalize a showToast "kind" argument (legacy boolean isError OR a string
 * type) to one of the theme.css toast variants.
 * @param {boolean|string|undefined} kind
 * @returns {'success'|'error'|'info'|'warn'}
 */
export function normalizeToastType(kind) {
  if (kind === true || kind === 'error') return 'error';
  if (kind === 'warning' || kind === 'warn') return 'warn';
  if (kind === 'info') return 'info';
  return 'success';
}

/**
 * useToast — hook that provides showToast() + a ToastContainer component.
 * @returns {{ showToast: (msg: string, kind?: boolean|string) => void, ToastContainer: Function }}
 */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((msg, kind = false) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, type: normalizeToastType(kind) });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  function ToastContainer() {
    if (!toast) return null;
    return html`<div class="toast toast-${toast.type}">${toast.msg}</div>`;
  }

  return { showToast, ToastContainer };
}
