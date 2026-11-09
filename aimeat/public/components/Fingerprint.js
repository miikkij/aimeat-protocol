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
 *   EXPANDABLE. With `expandable` it shows the compact row (seal, kind, the barcode with its marks),
 *   the overview a page needs; pressing it, or Enter or Space on it, opens the whole fingerprint in
 *   place (the panel: the trust bar, the lines and the three quadrant views), and "Show less" folds
 *   it back (the developer's call, 2026-11-09: "kompakti riittää ... jos sitä klikkaa se voisi avata
 *   sen isomman näkymän").
 *
 *   First used by the Contexts page; the developer approved its look on 2026-11-09.
 *
 *   IT RENDERS; IT DOES NOT FETCH the profile. When the drawing cannot load, the component says so in
 *   one quiet line.
 * @structure Fingerprint({ profile, sections, title, view, expandable }) · loadDrawing()
 * @usage html`<${Fingerprint} profile=${facts.profile} sections=${profileSections} title=${name} expandable />`
 * @version-history
 *   v1.0.0 — 2026-11-09 — The developer approved the look; no longer a draft.
 *   v0.2.0 — 2026-11-09 — `expandable`: the compact row opens the whole fingerprint in place.
 *   v0.1.0 — 2026-11-09 — Draft (the Contexts page).
 */
import { h } from 'preact';
import htm from 'htm';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';

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

export function Fingerprint({ profile, sections = null, title = '', view = 'panel', expandable = false }) {
  const host = useRef(null);
  const drawn = useRef(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const shown = expandable ? (open ? 'panel' : 'row') : view;

  useEffect(() => {
    let live = true;
    loadDrawing().then((atelier) => {
      if (!live || !host.current) return;
      const data = { profile, sections, title };
      if (drawn.current) drawn.current.set({ data, view: shown });
      else drawn.current = atelier.fingerprint({ target: host.current, view: shown, data });
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [profile, sections, title, shown]);

  useEffect(() => () => { drawn.current?.destroy?.(); drawn.current = null; }, []);

  if (failed) return html`<${Note} kind="quiet">${t('fingerprint.failed')}<//>`;
  // ONE host element in every state: the drawing lives in it, and set() switches its view in place.
  const opens = expandable && !open;
  const press = (e) => { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } };
  return html`
    <div class=${opens ? 'node-fp node-fp--opens' : 'node-fp'} ref=${host}
      role=${opens ? 'button' : undefined} tabindex=${opens ? '0' : undefined}
      aria-label=${opens ? t('fingerprint.open') : undefined} title=${opens ? t('fingerprint.open') : undefined}
      onClick=${opens ? press : undefined} onKeyDown=${opens ? press : undefined}></div>
    ${expandable && open
      ? html`<${Actions}><${Action} small control onClick=${() => setOpen(false)}>${t('fingerprint.close')}<//><//>`
      : null}`;
}
