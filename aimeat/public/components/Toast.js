import { h } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

/**
 * useToast — hook that provides showToast() + a ToastContainer component.
 * @returns {{ showToast: (msg: string, isError?: boolean) => void, ToastContainer: Function }}
 */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((msg, isError = false) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, isError });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  function ToastContainer() {
    if (!toast) return null;
    return html`<div class="toast ${toast.isError ? 'toast-error' : 'toast-success'}">${toast.msg}</div>`;
  }

  return { showToast, ToastContainer };
}
