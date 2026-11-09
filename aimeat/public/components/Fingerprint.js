/**
 * @file public/components/Fingerprint.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fingerprint of a text on the node's own screens: the same drawing every app and
 *   Pages show (the atelier library's fingerprint component, src/static/sdk-libs/atelier/fingerprint.js),
 *   so one profile reads the same everywhere. A page passes the profile and its sections; this loads
 *   the drawing once (the atelier script and its fingerprint stylesheet, on first use only), and
 *   css/components/fingerprint.css maps the kit's --ak-* tokens to the node's theme tokens, so the
 *   drawing takes the node's ink, lines and fonts in both themes.
 *
 *   DRAFT (2026-11-09): first used by the Contexts page, waiting for the developer's look before it
 *   goes to main.
 *
 *   IT RENDERS; IT DOES NOT FETCH the profile. When the drawing cannot load, the component says so in
 *   one quiet line.
 * @structure Fingerprint({ profile, sections, title, view }) · loadDrawing()
 * @usage html`<${Fingerprint} profile=${facts.profile} sections=${profileSections} title=${name} />`
 * @version-history
 *   v0.1.0 — 2026-11-09 — Draft (the Contexts page).
 */
import { h } from 'preact';
import htm from 'htm';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

let loading = null;
/** The atelier drawing and its stylesheet, added to the page once. Resolves to the atelier namespace. */
function loadDrawing() {
  if (window.AIMEAT?.atelier?.fingerprint) return Promise.resolve(window.AIMEAT.atelier);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-fingerprint-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/lib/aimeat-atelier/fingerprint.css';
      link.dataset.fingerprintCss = '1';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = '/v1/libs/aimeat-atelier.js';
    s.onload = () => (window.AIMEAT?.atelier?.fingerprint ? resolve(window.AIMEAT.atelier) : reject(new Error('no fingerprint')));
    s.onerror = () => reject(new Error('the drawing did not load'));
    document.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

export function Fingerprint({ profile, sections = null, title = '', view = 'panel' }) {
  const host = useRef(null);
  const drawn = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadDrawing().then((atelier) => {
      if (!live || !host.current) return;
      const data = { profile, sections, title };
      if (drawn.current) drawn.current.set({ data });
      else drawn.current = atelier.fingerprint({ target: host.current, view, data });
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [profile, sections, title, view]);

  useEffect(() => () => { drawn.current?.destroy?.(); drawn.current = null; }, []);

  if (failed) return html`<${Note} kind="quiet">${t('fingerprint.failed')}<//>`;
  return html`<div class="node-fp" ref=${host}></div>`;
}
