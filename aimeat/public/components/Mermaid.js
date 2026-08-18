/**
 * @file Mermaid.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renders a Mermaid diagram from its source text. Lazy-loads the vendored single-file
 *   Mermaid build (public/lib/mermaid/, MIT) only when a chart is first shown — it's ~3MB, so it
 *   must never be in the initial bundle. securityLevel:'strict' (no click handlers, sanitised). On
 *   any load/parse error it falls back to showing the raw source in a <pre> so nothing is lost.
 * @structure Mermaid({ chart }) — chart is the Mermaid source string.
 * @usage import { Mermaid } from '/components/Mermaid.js';  html`<${Mermaid} chart=${src} />`
 * @version-history
 *   v1.1.0 — 2026-07-02 — suppressErrorRendering: mermaid v11 otherwise injects its "Syntax error
 *     in text" bomb SVG into <body> on parse failure even though render() rejects; the component's
 *     own raw-source fallback already covers the error UX.
 *   v1.0.0 — 2026-06-08 — Initial: lazy-loaded vendored Mermaid renderer for organism/workspace charts.
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

let _promise = null;
let _seq = 0;

function loadMermaid() {
  if (typeof window !== 'undefined' && window.mermaid) return Promise.resolve(window.mermaid);
  if (_promise) return _promise;
  _promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/lib/mermaid/mermaid.min.js' + (window.__B || '');
    s.onload = () => {
      try {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', flowchart: { htmlLabels: false }, suppressErrorRendering: true });
        resolve(window.mermaid);
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error('failed to load mermaid'));
    document.head.appendChild(s);
  });
  return _promise;
}

/** Mermaid — render a diagram from source text (lazy-loads the renderer). */
export function Mermaid({ chart }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    if (!chart) return undefined;
    loadMermaid().then(async (m) => {
      if (cancelled || !ref.current) return;
      try {
        const { svg } = await m.render('mmd-' + (_seq++), chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) { if (!cancelled) setErr((e && e.message) || 'diagram error'); }
    }).catch(() => { if (!cancelled) setErr('renderer'); });
    return () => { cancelled = true; };
  }, [chart]);

  if (err) return html`<pre class="mmd-fallback">${chart}</pre>`;
  return html`<div class="mmd" ref=${ref}></div>`;
}
