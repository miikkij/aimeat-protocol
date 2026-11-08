/**
 * @file public/views/profile/receivers/maker-receivers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The receivers an agent or an ecosystem app made, said where the owner removes it
 *   (developer ruling 3 of 2026-11-08): the agent's delete box (../agents/tab-agent-config.js) and the
 *   ecosystem app's disconnect dialog (../ecosystem-tab.js). A receiver is the owner's and keeps working
 *   when its maker is removed, so the box says how many there are and that they go on, and offers one
 *   press that pauses them all, with what each choice does on its own line. Nothing shows when the
 *   maker made none. The list is GET /v1/receivers, filtered by `created_by`; the pause is the owner's
 *   own POST /v1/receivers/:name/pause, the same call the Receivers page makes. After the removal the
 *   owner gets the same as a notice (src/services/receivers/makers.ts).
 * @structure MakerReceivers({ maker, label })
 * @usage html`<${MakerReceivers} maker=${agent.gaii} label=${agent.name} />`
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, maker-lifecycle-not-surfaced).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { tn } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { x, api } from './frame.js';

const html = htm.bind(h);

/** What the maker `maker` (a GAII or a GEAI) made, and one press that pauses it; nothing when it made none. */
export function MakerReceivers({ maker, label }) {
  const [made, setMade] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { paused: n } or { failed: true }

  useEffect(() => {
    let live = true;
    setResult(null);
    if (!maker) { setMade([]); return undefined; }
    api.list()
      .then((d) => { if (live) setMade((d.receivers || []).filter((r) => r.created_by === maker)); })
      .catch((err) => { swallowed('maker-receivers: list', err); if (live) setMade([]); });
    return () => { live = false; };
  }, [maker]);

  if (!made.length) return null;
  // Only a working receiver is paused: the others are paused already, or write nothing yet.
  const pausable = made.filter((r) => r.state === 'active');

  async function pauseAll() {
    setBusy(true);
    const done = new Set();
    for (const r of pausable) {
      try { await api.pause(r.name); done.add(r.name); } catch (err) { swallowed('maker-receivers: pause', err); }
    }
    setMade((list) => list.map((r) => (done.has(r.name) ? { ...r, state: 'paused' } : r)));
    setResult(done.size === pausable.length ? { paused: done.size } : { failed: true });
    setBusy(false);
  }

  return html`
    <${Note} kind="aside" size="small">
      <${SubHeading}>${tn('receivers.maker.kept', made.length, { maker: label })}<//>
      <div>${x('maker.why')}</div>
      <div>${made.map((r) => r.display_name || r.name).join(', ')}</div>
      ${result?.paused !== undefined && html`<${Note} kind="message">${tn('receivers.maker.paused', result.paused)}<//>`}
      ${result?.failed && html`<${Note} kind="message" error>${x('maker.pauseFailed')}<//>`}
      ${pausable.length > 0 && result?.paused === undefined && html`
        <div>${tn('receivers.maker.pauseWhat', pausable.length)}</div>
        <div>${tn('receivers.maker.keep', pausable.length)}</div>
        <${Actions}>
          <${Action} small disabled=${busy} busy=${busy} onClick=${pauseAll}>${tn('receivers.maker.pause', pausable.length)}<//>
          <${Action} small href="/v1/profile?tab=receivers">${x('maker.open')}<//>
        <//>`}
    <//>`;
}

export default MakerReceivers;
