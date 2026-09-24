/**
 * @file public/views/admin/themes-draft.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles' preview plumbing: a theme being edited is a draft, and the node turns
 *   a draft into its stylesheet and its warnings (POST /v1/themes/preview) without saving anything.
 *   The stylesheet goes to the preview frames on one same-origin channel, each set of frames under
 *   its own key ("with" this component's CSS, "without" it), and a frame that opens late asks for it.
 *   The frames are the lab's preview page for one component (design-lab/frame.js) and the real
 *   pages (spa.html's look script, `?look-draft=`). Both measure what they draw and send back what
 *   fails: a control hidden or covered, words under 11 px, contrast, a control under 40 px on a
 *   phone. Nothing here styles anything.
 * @structure PREVIEW_CHANNEL · useDraftSheets(drafts) · useFrameChecks(prefix) · componentFrame ·
 *   pageFrame · newFindings
 * @usage const out = useDraftSheets({ with: draft, without: bare });  out.with?.warnings
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S5-S7).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

export const PREVIEW_CHANNEL = 'aimeat-theme-preview';

/** The fields of a theme a draft carries to the node. */
const draftBody = (theme) => ({ name: theme.name, styles: theme.styles, componentCss: theme.componentCss || {}, css: theme.css || null });

/**
 * Turn each keyed draft into its stylesheet and warnings after each pause in editing, and send the
 * stylesheets to the frames. Returns { [key]: { stylesheet, warnings, refused } | undefined, error }.
 * @param {Record<string, any>} drafts
 */
export function useDraftSheets(drafts) {
  const [out, setOut] = useState(/** @type {Record<string, any>} */ ({}));
  const latest = useRef(/** @type {Record<string, string>} */ ({}));
  const channel = useMemo(() => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PREVIEW_CHANNEL)), []);
  useEffect(() => {
    if (!channel) return undefined;
    channel.onmessage = (ev) => {
      const d = ev?.data || {};
      if (d.type !== 'ready') return;
      const css = latest.current[d.key];
      if (typeof css === 'string') channel.postMessage({ type: 'draft', key: d.key, css });
    };
    return () => channel.close();
  }, [channel]);

  const key = JSON.stringify(Object.fromEntries(Object.entries(drafts).map(([k, v]) => [k, v ? draftBody(v) : null])));
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const next = /** @type {Record<string, any>} */ ({});
      for (const [k, theme] of Object.entries(draftsRef.current)) {
        if (!theme) continue;
        try {
          const r = await apiPost('/v1/themes/preview', { theme: draftBody(theme) });
          next[k] = r.data;
          latest.current[k] = r.data.stylesheet;
          channel?.postMessage({ type: 'draft', key: k, css: r.data.stylesheet });
        } catch (e) {
          next.error = e.message || String(e);
        }
      }
      if (alive) setOut(next);
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, channel]);
  return out;
}

/**
 * The findings the frames measured, by frame key (`fk`), for the frames whose key starts with
 * `prefix`. A frame sends them again whenever what it draws changes.
 * @param {string} prefix
 */
export function useFrameChecks(prefix) {
  const [checks, setChecks] = useState(/** @type {Record<string, any[]>} */ ({}));
  useEffect(() => {
    const onMessage = (/** @type {MessageEvent} */ e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data || {};
      if (d.type !== 'theme-checks' || typeof d.fk !== 'string' || !d.fk.startsWith(prefix) || !Array.isArray(d.findings)) return;
      setChecks((c) => ({ ...c, [d.fk]: d.findings }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [prefix]);
  return checks;
}

/** What a frame found with the CSS that it did not find without it: what the CSS itself caused. */
export function newFindings(withCss = [], withoutCss = []) {
  const seen = new Set(withoutCss.map((f) => `${f.code}|${f.what}`));
  return withCss.filter((f) => !seen.has(`${f.code}|${f.what}`));
}

const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/**
 * One component, drawn by the lab's preview page, wearing a keyed draft in one style and mode.
 * @param {{ id: string, v?: number, mode: string, key: string, style?: string, fk?: string }} p
 */
export const componentFrame = ({ id, v, mode, key, style, fk }) =>
  `/v1/design-lab/frame?${q({ id, v, theme: mode, preview: key, style, fk })}`;

/**
 * A real page of AIMEAT's own interface wearing a keyed draft in one style and mode (S7).
 * @param {string} path
 * @param {{ mode: string, key: string, style?: string, fk?: string }} p
 */
export const pageFrame = (path, { mode, key, style, fk }) => `${path}?${q({ 'look-draft': key, style, mode, fk })}`;

/**
 * A saved theme in one style and mode on the lab's preview page (the lab's picker, R16).
 * @param {{ id: string, v?: number, mode: string, look?: string, style?: string }} p
 */
export const savedFrame = ({ id, v, mode, look, style }) => `/v1/design-lab/frame?${q({ id, v, theme: mode, look, style })}`;

/** Log and keep going: a preview that fails is shown as a missing preview, never as a broken view. */
export const previewFailed = (e) => swallowed('themes: preview', e);
