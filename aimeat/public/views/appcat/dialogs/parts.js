/**
 * @file public/views/appcat/dialogs/parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two small parts appcat's dialogs share: the status line a dialog says what it is doing
 *   in (the old page's `#…-status` lines: grey while it works, green when it is done, coral when it
 *   was refused), and a label that says "Copied" for a moment after a copy, as long as the old page
 *   kept it (1.4 s in the prompt builder, 1.5 s in the source and extension dialogs). A view gives
 *   data only, so the status line is the Note component in the kind its tone names.
 * @structure Status({ status }) · useFlash(ms) · closer(props)
 * @usage const [st, setSt] = useState(null); setSt({ text, tone: 'ok' }); html`<${Status} status=${st} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the status line is the old page's (Note kind="report": .85rem, its
 *     four colours, `keep` for the room it held while empty).
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2).
 */
import { h } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { closeDialog } from '/views/appcat/dialogs/host.js';

const html = htm.bind(h);

/**
 * The status line. `status` is null (nothing to say) or { text, tone } with tone 'busy' | 'ok' |
 * 'err' | 'refused' | '' (a plain line). `keep`: the line holds its room while it says nothing;
 * `always`: the line is there while it says nothing, with no room (only its 8px above).
 */
export function Status({ status, keep, always, chapter }) {
  const text = status && status.text ? status.text : '';
  if (!text && !keep && !always) return null;
  // The old page's status lines: .85rem, 8px under what is above them, grey while busy, green when
  // done, red when it failed, coral when the form refused; `keep` holds their room while empty;
  // `chapter` the detail's own status line (.82rem, 10px under; the source editor wore it).
  return html`<${Note} kind="report" chapter=${chapter} tone=${text ? status.tone || '' : ''} keep=${keep}>${text}<//>`;
}

/** [flashing, flash()]: flashing is true for `ms` after flash() is called. */
export function useFlash(ms) {
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash];
}

/** The dialog's way out: the host's `close` prop when it passes one, else closeDialog. */
export function closer(props) {
  return typeof props?.close === 'function' ? props.close : closeDialog;
}
