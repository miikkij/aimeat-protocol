/**
 * @file public/views/profile/receivers/maker-receivers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The receivers an agent or an ecosystem app made, said where the owner removes it
 *   (developer ruling 3 of 2026-11-08): the agent's delete box (../agents/tab-agent-config.js) and the
 *   ecosystem app's disconnect dialog (../ecosystem-tab.js). A receiver is the owner's and keeps working
 *   when its maker is removed, so the box says how many there are and that they go on, and offers one
 *   press that pauses them all, with what each choice does on its own line. Nothing shows when the
 *   maker made none. The list is GET /v1/receivers, filtered by `created_by` and by `key_holders` (a
 *   receiver whose key the maker changed, so it holds the working key); the pause is the owner's
 *   own POST /v1/receivers/:name/pause, the same call the Receivers page makes. After the removal the
 *   owner gets the same as a notice (src/services/receivers/makers.ts).
 * @structure MakerReceivers({ maker, label })
 * @usage html`<${MakerReceivers} maker=${agent.gaii} label=${agent.name} />`
 * @version-history
 *   v1.1.0 — 2026-11-08 — Also the receivers whose key the maker changed (`key_holders`), on a line of
 *     their own (secaudit2026nov08b round 15, rotated-key-holder-not-surfaced).
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

/** Does `maker` hold a working key of `r`: it was answered the key when it changed it (`key_holders`). */
const holdsKey = (r, maker) => Array.isArray(r.key_holders) && r.key_holders.includes(maker);

/**
 * What the maker `maker` (a GAII or a GEAI) made, and the receivers whose key it changed and so holds,
 * and one press that pauses them; nothing when there are none.
 */
export function MakerReceivers({ maker, label }) {
  const [listed, setListed] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { paused: n } or { failed: true }

  useEffect(() => {
    let live = true;
    setResult(null);
    if (!maker) { setListed([]); return undefined; }
    api.list()
      .then((d) => { if (live) setListed((d.receivers || []).filter((r) => r.created_by === maker || holdsKey(r, maker))); })
      .catch((err) => { swallowed('maker-receivers: list', err); if (live) setListed([]); });
    return () => { live = false; };
  }, [maker]);

  if (!listed.length) return null;
  const made = listed.filter((r) => r.created_by === maker);
  const held = listed.filter((r) => r.created_by !== maker);
  // Only a working receiver is paused: the others are paused already, or write nothing yet.
  const pausable = listed.filter((r) => r.state === 'active');
  const names = (list) => list.map((r) => r.display_name || r.name).join(', ');

  async function pauseAll() {
    setBusy(true);
    const done = new Set();
    for (const r of pausable) {
      try { await api.pause(r.name); done.add(r.name); } catch (err) { swallowed('maker-receivers: pause', err); }
    }
    setListed((list) => list.map((r) => (done.has(r.name) ? { ...r, state: 'paused' } : r)));
    setResult(done.size === pausable.length ? { paused: done.size } : { failed: true });
    setBusy(false);
  }

  return html`
    <${Note} kind="aside" size="small">
      <${SubHeading}>${made.length
        ? tn('receivers.maker.kept', made.length, { maker: label })
        : tn('receivers.maker.keyKept', held.length, { maker: label })}<//>
      <div>${x('maker.why')}</div>
      ${made.length > 0 && html`<div>${names(made)}</div>`}
      ${made.length > 0 && held.length > 0 && html`<div>${tn('receivers.maker.keyKept', held.length, { maker: label })}</div>`}
      ${held.length > 0 && html`<div>${names(held)}</div>`}
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
