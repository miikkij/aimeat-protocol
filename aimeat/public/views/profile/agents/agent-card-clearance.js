/**
 * @file agent-card-clearance.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent card's "May read at most" line (plan doc-mvdipuyqraas, L2.4): the highest
 *   classification this agent may read, in words ("May read at most: Internal", or "no limit"), and
 *   behind Change a pick of the owner's classifications. Shown only while classification is on for
 *   the owner's content (GET /v1/classification/policy?level=owner, `active`), because with it off
 *   the limit does nothing.
 *
 *   The pick saves with PATCH /v1/agents/:name/clearance. The owner on this page is signed in
 *   themselves, so raising the limit or removing it is allowed here; an agent may only lower it
 *   (services/agent-clearance.ts), which the hint under the pick says.
 * @structure ClearanceLine({ agent, showToast })
 * @usage html`<${ClearanceLine} agent=${agent} showToast=${showToast} />`
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L2.4).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { readPolicy, labelName, labelById } from '/js/services/classification.js';
import { CardLine } from '/components/OpenCard.js';
import { HelpLabel } from '/components/HelpTip.js';
import { Select } from '/components/Select.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Stack } from '/components/Layout.js';

const c = (key, vars) => t('profile.agents.clearance.' + key, vars);

/** The owner's classification view: whether it is on, and its active labels from the lowest. */
function usePolicy() {
  const [view, setView] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => readPolicy('owner')
      .then(v => { if (live) setView(v); })
      .catch(err => { swallowed('agent-card: classification policy', err); if (live) setView(null); });
    load();
    window.addEventListener('aimeat-live-update', load);
    return () => { live = false; window.removeEventListener('aimeat-live-update', load); };
  }, []);
  return view;
}

export function ClearanceLine({ agent, showToast }) {
  const view = usePolicy();
  const [clearance, setClearance] = useState(agent.clearance ?? null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(agent.clearance ?? '');
  const [saving, setSaving] = useState(false);
  // The value also changes from the owner's AI and from another agent; follow the list.
  useEffect(() => { setClearance(agent.clearance ?? null); }, [agent.clearance]);

  if (!view?.active) return null;
  const policy = view.effective;
  const labels = (policy?.labels ?? []).filter(l => l.status !== 'retired').sort((a, b) => a.rank - b.rank);
  const current = clearance ? labelById(policy, clearance) : null;
  const words = clearance ? (current ? labelName(current) : clearance) : c('none');

  const toggle = () => { if (!open) setPick(clearance ?? ''); setOpen(v => !v); };

  async function save() {
    const next = pick === '' ? null : pick;
    if (saving || next === clearance) { setOpen(false); return; }
    setSaving(true);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agent.name)}/clearance`, { clearance: next });
      setClearance(next);
      setOpen(false);
      showToast?.(next === null ? c('cleared') : c('saved', { label: labelName(labelById(policy, next)) || next }), 'success');
    } catch (err) {
      swallowed('agent-card: clearance', err);
      showToast?.(err?.message || c('failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <${CardLine} label=${html`<${HelpLabel} term="agent.clearance" label=${c('label')}>${c('label')}<//>`} below=${open && html`
      <${Stack} gap="medium">
        <${Select} label=${c('choose')} hint=${c('hint')} value=${pick} disabled=${saving} onChange=${setPick}
          options=${[...labels.map(l => [l.id, labelName(l)]), ['', c('noLimit')]]} />
        <${Actions}>
          <${Loud} control disabled=${saving} onClick=${save}>${c('save')}<//>
        <//>
      <//>`}>
      <span>${words}</span>
      <${Action} small soft onClick=${toggle}>${open ? c('close') : c('change')} →<//>
    <//>
  `;
}
