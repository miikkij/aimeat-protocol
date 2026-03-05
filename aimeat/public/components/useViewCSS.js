import { useState, useEffect } from 'preact/hooks';

/**
 * useViewCSS — lazily loads a view-specific CSS file.
 * Returns true once the stylesheet is applied so components can delay
 * their first paint until the CSS is ready (prevents FOUC).
 *
 * CSS is intentionally NOT removed on unmount — it stays cached so that
 * navigating back to the same view is instant with no re-flash.
 *
 * @param {string} cssPath — path relative to root, e.g. '/css/views/portal.css'
 * @returns {boolean} ready — true when the stylesheet has loaded
 */
export function useViewCSS(cssPath) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Already in <head> from a previous visit — mark ready immediately
    if (document.querySelector(`link[data-view-css="${cssPath}"]`)) {
      setReady(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssPath;
    link.dataset.viewCss = cssPath;
    link.onload  = () => setReady(true);
    link.onerror = () => setReady(true); // show content even if CSS fails to load
    document.head.appendChild(link);
    // No cleanup — leave the <link> so return visits are instant
  }, [cssPath]);

  return ready;
}
