/**
 * @file agent-refusal-grant.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The answer to what your AIMEAT refused an agent: every permission its refusals
 *   needed, listed at once and ticked, so the owner gives all of them, some of them, or none.
 *
 *   WHY A LIST. The full access dialog opens at its top and leaves the owner to find the one row a
 *   refusal needed among forty. Jouni, 2026-09-30: show the needed permissions directly as a list,
 *   not one at a time; the owner accepts, picks some and accepts, or declines.
 *
 *   WHAT THE BUTTONS DO.
 *   - "Give the selected": adds the ticked permissions to what the agent holds
 *     (PATCH /v1/agents/:name/scopes), and declines the ones left unticked, so after this dialog every
 *     refusal it listed is answered and none is left on the card.
 *   - "Decline all": gives nothing (POST /v1/agents/:name/refusals/decline). The refusals leave the
 *     card; the agent is still told its run was refused.
 *   - "Edit all permissions": the full dialog, for anything beyond these.
 *   A refusal where any one permission would have done lists them all and ticks the first.
 * @structure RefusalGrantModal({ agent, showToast, onClose, onEditAll }) · neededPermissions(refusals)
 * @usage html`<${RefusalGrantModal} agent=${agent} showToast=${showToast} onClose=${close} onEditAll=${openFull} />`
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Modal } from '/components/Modal.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { List, Row as ListRow, Name, Cell } from '/components/List.js';
import { Split } from '/components/Layout.js';
import { scopeSentence } from '../access/frame.js';

const html = htm.bind(h);

/**
 * One row per permission the refusals needed, in the order they were refused, with the calls it
 * would have allowed. `ticked` is the starting choice: every permission of an ordinary refusal, and
 * the first of a refusal where any one would do.
 */
export function neededPermissions(refusals) {
  const rows = new Map();
  for (const r of Array.isArray(refusals) ? refusals : []) {
    (r.needed || []).forEach((scope, i) => {
      const row = rows.get(scope) ?? { scope, calls: [], ticked: false };
      if (!row.calls.includes(r.call)) row.calls.push(r.call);
      if (!r.any_of || i === 0) row.ticked = true;
      rows.set(scope, row);
    });
  }
  return [...rows.values()];
}

export function RefusalGrantModal({ agent, showToast, onClose, onEditAll }) {
  const rows = neededPermissions(agent.refusals);
  const [picked, setPicked] = useState(() => new Set(rows.filter((r) => r.ticked).map((r) => r.scope)));
  const [busy, setBusy] = useState(false);
  const toast = (key, error = false) => showToast?.(t(key), error);

  function toggle(scope) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }

  const reload = () => window.dispatchEvent(new Event('aimeat-live-update'));
  const decline = (needed) => apiPost(`/v1/agents/${encodeURIComponent(agent.name)}/refusals/decline`, needed ? { needed } : {});

  async function giveSelected() {
    setBusy(true);
    try {
      const held = agent.default_scopes ?? ['*'];
      const grant = [...picked].filter((s) => !held.includes(s));
      if (grant.length) {
        const resp = await api(`/v1/agents/${encodeURIComponent(agent.name)}/scopes`, {
          method: 'PATCH', body: JSON.stringify({ scopes: [...held, ...grant] }),
        });
        if (resp?.ok === false) { showToast?.(resp?.error?.message || t('profile.agents.refusals.grantError'), true); setBusy(false); return; }
      }
      const left = rows.map((r) => r.scope).filter((s) => !picked.has(s));
      if (left.length) await decline(left);
      toast(left.length ? 'profile.agents.refusals.grantedSome' : 'profile.agents.refusals.granted');
      reload();
      onClose();
    } catch (err) {
      swallowed('agent-refusal-grant: give', err);
      toast('profile.agents.refusals.grantError', true);
      setBusy(false);
    }
  }

  async function declineAll() {
    setBusy(true);
    try {
      const resp = await decline();
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('profile.agents.refusals.grantError'), true); setBusy(false); return; }
      toast('profile.agents.refusals.declined');
      reload();
      onClose();
    } catch (err) {
      swallowed('agent-refusal-grant: decline', err);
      toast('profile.agents.refusals.grantError', true);
      setBusy(false);
    }
  }

  return html`
    <${Modal} open=${true} onClose=${onClose} size="md"
      title=${t('profile.agents.refusals.dialogTitle', { name: agent.display_name || agent.name })}
      footer=${html`
        <${Action} onClick=${onClose}>${t('profile.agents.scopeUi.cancel')}<//>
        <${Action} onClick=${declineAll} disabled=${busy}>${t('profile.agents.refusals.declineAll')}<//>
        <${Loud} control onClick=${giveSelected} disabled=${busy || picked.size === 0}>
          ${t('profile.agents.refusals.giveSelected', { n: picked.size })}
        <//>`}>
      <${Note}>${t('profile.agents.refusals.dialogLead')}<//>
      <${List} cols="check-name-desc" keepCols dense>
        ${rows.map((r) => html`
          <${ListRow} key=${r.scope} picked=${picked.has(r.scope)} pickLabel=${scopeSentence(r.scope)} onPick=${() => toggle(r.scope)}>
            <${Name}>${scopeSentence(r.scope)}<//>
            <${Cell} line>
              <${Code}>${r.scope}<//>
              <${Note} kind="meta" inline>${r.calls.map((c) => String(c).replace(' ', ' ')).join(' · ')}<//>
            <//>
          <//>`)}
      <//>
      <${Split} heavy above="large">
        <${Note}>${t('profile.agents.refusals.dialogAfter')}<//>
        ${onEditAll ? html`<${Action} small soft onClick=${() => { onClose(); onEditAll(agent); }}>${t('profile.agents.refusals.editAll')} →<//>` : null}
      <//>
    <//>`;
}
