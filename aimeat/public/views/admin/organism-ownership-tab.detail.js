/**
 * @file organism-ownership-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One organism, opened: who holds it, who is inside and which of them can sign in, and
 *   the field that puts an owner back. Split from the page itself so neither file carries the other's
 *   length, and because this panel is the only part that reads the second door
 *   (GET /v1/admin/organisms/:id/ownership).
 *
 *   THE NEW OWNER IS PICKED, NOT TYPED. The names are this node's own owners, each carrying why it
 *   cannot be chosen — already an owner, blocked in this organism, deactivated. The node refuses
 *   three of those after a press; here they are drawn quiet before one.
 * @structure OrganismDetail({ row, ownership, owners, busy, onClose, onAdd })
 * @usage imported by organism-ownership-tab.js
 * @version-history
 *   v1.2.0 — 2026-09-22 — Composed from the shared component set (Section, KeyValue, Table, Field,
 *     choice Actions for the picker): no class of its own, so a theme change reaches it.
 *   v1.1.0 — 2026-09-13 — Compose the shared poster detail heading.
 *   v1.0.0 — 2026-09-12 — Initial (the Organism ownership page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { dt } from './shared.js';
import { Section, Columns, Stack, Table, KeyValue, Field, Chip, Action, Text } from '/components/poster-parts.js';
import { candidates } from './organism-ownership-tab.model.js';

const O = (key, params) => t('admin.orgOwnership.' + key, params);
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** How many names the picker shows before it asks for more typing. */
const PICK = 6;

export default function OrganismDetail({ row, ownership, owners, busy, onClose, onAdd }) {
  const [typed, setTyped] = useState('');

  const all = useMemo(() => candidates(owners, ownership), [owners, ownership]);
  const q = typed.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? all.filter(c => c.name.toLowerCase().includes(q)) : all).slice(0, PICK),
    [all, q]);
  const chosen = shown.find(c => c.state === 'ok' && c.name.toLowerCase() === q)
    || (q ? shown.find(c => c.state === 'ok') : null);

  const holding = ownership?.owners || [];
  const members = ownership?.members || [];
  const reach = (ghii) => {
    const o = (owners || []).find(x => x.name === ghii);
    return !!o && !o.disabled_at;
  };
  const canSignIn = members.filter(m => reach(m.ghii)).length;

  const why = (c) => {
    if (c.state === 'already') return O('stateAlready');
    if (c.state === 'blocked') return O('stateBlocked');
    if (c.state === 'off') return O('stateOff');
    if (!c.member) return O('stateStranger');
    const m = members.find(x => x.ghii === c.name);
    return O('stateMember', { role: m?.role || 'member' });
  };

  /** A value with its quiet reason under it. */
  const said = (value, note) => html`<${Stack} density="compact"><span>${value}</span>${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}<//>`;

  return html`
    <${Section} title=${row.name} count="03"
      actions=${html`<${Action} onClick=${onClose}>${O('close')}<//>`}>
      <${Stack}>
        <${Text} kind="mono" tone="muted">${row.id}<//>

        <${Stack}>
          <${Stack} density="compact">
            <${Text} kind="heading" size="small">${O('whoHolds')}<//>
            <div>
              <${KeyValue} label=${O('heldBy')} value=${said(html`<${Stack} direction="wrap" density="compact">
                ${row.ownerStates.map(o => html`<${Chip} key=${o.name} tone=${o.state === 'ok' ? 'plain' : 'coral'}>${o.name}<//>`)}<//>`,
    row.stuck ? O('stripStuckSub') : null)} />
              <${KeyValue} label=${O('madeBy')} value=${said(row.createdBy || '—', O('madeByWhy'))} />
              <${KeyValue} label=${O('created')} value=${said(day(row.createdAt), O('changed', { date: day(ownership?.updated_at) }))} />
              <${KeyValue} label=${O('inside')} value=${said(
    members.length === 1 ? O('insideOne') : O('insidePeople', { count: members.length }),
    canSignIn ? O('insideWhy', { count: canSignIn }) : O('insideWhyNone'))} />
            </div>
          <//>

          <${Stack} density="compact">
            <${Text} kind="heading" size="small">${O('whoInside')}<//>
            ${members.length === 0
    ? html`<${Text} kind="caption" tone="muted">${O('noMembers')}<//>`
    : html`<${Table} density="compact" collapse=${560} label=${O('whoInside')}
              headers=${[O('member'), O('role'), O('canSignIn'), O('joined')]}
              rows=${members.map(m => [
    html`<${Stack} direction="wrap" density="compact">
      ${reach(m.ghii) ? html`<strong>${m.ghii}</strong>` : html`<${Text} tone="muted">${m.ghii}<//>`}
      ${holding.includes(m.ghii) ? html`<${Chip} tone="coral">${O('owner')}<//>` : null}<//>`,
    html`<${Text} kind="mono">${m.role}<//>`,
    html`<${Text} kind="mono" tone=${reach(m.ghii) ? 'plain' : 'danger'}>${reach(m.ghii) ? O('yes') : O('no')}<//>`,
    html`<${Text} kind="mono" tone="muted" title=${dt(m.joined_at)}>${day(m.joined_at)}<//>`,
  ])} />`}
            <${Text} kind="caption" tone="muted">${O('adminNote')}<//>
          <//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="heading" size="small">${O('putBack')}<//>
          <${Field} type="search" label=${O('whoTakes')} value=${typed} placeholder=${O('pickPlaceholder')}
            onInput=${e => setTyped(e.target.value)} />
          ${shown.length === 0
    ? html`<${Text} tone="danger">${O('noCandidate')}<//>`
    : html`<${Columns} layout="thirds" collapse=${640} density="compact">
              ${shown.map(c => html`
                <${Action} key=${c.name} kind="choice" title=${c.name} selected=${!!chosen && c.name === chosen.name}
                  disabled=${c.state !== 'ok'} onClick=${() => setTyped(c.name)}>${why(c)}<//>`)}
            <//>`}
          <${Stack} direction="wrap" align="center">
            <${Action} kind="primary" disabled=${busy || !chosen} onClick=${() => chosen && onAdd(chosen.name)}>
              ${chosen ? O('makeOwner', { name: chosen.name }) : O('add')}
            <//>
            <${Text} kind="caption" tone="muted">${holding.length === 1
    ? O('keepsOne', { names: holding.join(', ') })
    : O('keeps', { names: holding.join(', ') })}<//>
          <//>
          <${Text} kind="caption" tone="muted">${O('pickNote')}<//>
        <//>
      <//>
    <//>`;
}
