import { useEffect } from 'preact/hooks';

/**
 * useViewCSS — loads a view-specific CSS file on mount, removes on unmount.
 * @param {string} cssPath — path relative to root, e.g. '/css/views/portal.css'
 */
export function useViewCSS(cssPath) {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssPath;
    document.head.appendChild(link);
    return () => link.remove();
  }, [cssPath]);
}
