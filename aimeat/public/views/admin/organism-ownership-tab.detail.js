/**
 * @file organism-ownership-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One organism, opened: who holds it, who is inside and which of them can sign in, and
 *   the field that puts an owner back. Split from the page itself so neither file carries the other's
 *   length, and because this panel is the only part that reads the second door
 *   (GET /v1/admin/organisms/:id/ownership). Every part is a library component; the page passes
 *   data and writes no class.
 *
 *   THE NEW OWNER IS PICKED, NOT TYPED. The names are this node's own owners, each carrying why it
 *   cannot be chosen — already an owner, blocked in this organism, deactivated. The node refuses
 *   three of those after a press; here they are drawn quiet before one.
 * @structure OrganismDetail({ row, ownership, owners, busy, onClose, onAdd })
 * @usage imported by organism-ownership-tab.js
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: Section, SubHeading, Facts, the List (the people
 *     inside, and the candidates as a pick list in a Box), TextField, Loud, Note, Split.
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
import { Section } from '/components/Section.js';
import { SubHeading } from '/components/SubHeading.js';
import { Facts } from '/components/Facts.js';
import { List, Row as Item, Name, Cell, When } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { CardGrid } from '/components/Card.js';
import { Tinted } from '/components/Figure.js';
import { TextField } from '/components/TextField.js';
import { Split, Stack, Row as Line } from '/components/Layout.js';
import { candidates } from './organism-ownership-tab.model.js';

const O = (key, params) => t('admin.orgOwnership.' + key, params);
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** The owners as tags: an owner who cannot act is the thing this page is about, so it is coral. */
export function ownerMarks(ownerStates) {
  return ownerStates.map(o => html`<${Mark} key=${o.name} tone=${o.state === 'ok' ? undefined : 'coral'}>${o.name}<//>`);
}

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

  return html`
    <${Section} num="03" title=${row.name}
      doors=${html`<${Action} small soft onClick=${onClose}>${O('close')}<//>`}>
      <${Note} kind="meta" mono>${row.id}<//>

      <${CardGrid} cols="sections">
        <${Stack}>
          <${SubHeading}>${O('whoHolds')}<//>
          <${Facts} rows=${[
    { k: O('heldBy'), v: html`<${Marks}>${ownerMarks(row.ownerStates)}<//>`, sub: row.stuck ? O('stripStuckSub') : undefined },
    { k: O('madeBy'), v: row.createdBy || '—', sub: O('madeByWhy') },
    { k: O('created'), v: day(row.createdAt), sub: O('changed', { date: day(ownership?.updated_at) }) },
    { k: O('inside'), v: members.length === 1 ? O('insideOne') : O('insidePeople', { count: members.length }),
      sub: canSignIn ? O('insideWhy', { count: canSignIn }) : O('insideWhyNone') },
  ]} />
        <//>

        <${Stack}>
          <${SubHeading}>${O('whoInside')}<//>
          <${List} cols="name-kind-state-when" keepCols dense empty=${O('noMembers')}
            head=${[O('member'), O('role'), O('canSignIn'), O('joined')]}>
            ${members.map(m => html`
              <${Item} key=${m.ghii} faded=${!reach(m.ghii)}>
                <${Name} tag=${holding.includes(m.ghii) ? html`<${Mark} tone="coral">${O('owner')}<//>` : null}>${m.ghii}<//>
                <${Cell} meta>${m.role}<//>
                <${Cell} meta>${reach(m.ghii) ? O('yes') : html`<${Tinted} tone="notice">${O('no')}<//>`}<//>
                <${When} title=${dt(m.joined_at)}>${day(m.joined_at)}<//>
              <//>`)}
          <//>
          <${Note} kind="hint">${O('adminNote')}<//>
        <//>
      <//>

      <${Split} heavy above="large">
        <${Stack} gap="medium">
          <${SubHeading}>${O('putBack')}<//>
          <${TextField} search label=${O('whoTakes')} value=${typed} placeholder=${O('pickPlaceholder')}
            onInput=${(v) => setTyped(v)} />
          <${Box}>
            <${List} cols="name-state" keepCols dense
              empty=${html`<${Note} kind="hint"><${Tinted} tone="notice">${O('noCandidate')}<//><//>`}>
              ${shown.map(c => html`
                <${Item} key=${c.name} hover=${c.state === 'ok'} faded=${c.state !== 'ok'} selected=${!!chosen && c.name === chosen.name}>
                  ${c.state === 'ok'
    ? html`<${Name} onOpen=${() => setTyped(c.name)}>${c.name}<//>`
    : html`<${Name}>${c.name}<//>`}
                  <${Cell} meta>${c.state === 'ok' ? why(c) : html`<${Tinted} tone="notice">${why(c)}<//>`}<//>
                <//>`)}
            <//>
          <//>
          <${Line} wrap gap="large">
            <${Loud} disabled=${busy || !chosen} onClick=${() => chosen && onAdd(chosen.name)}>
              ${chosen ? O('makeOwner', { name: chosen.name }) : O('add')}
            <//>
            <${Note} kind="hint" inline>${holding.length === 1
    ? O('keepsOne', { names: holding.join(', ') })
    : O('keeps', { names: holding.join(', ') })}<//>
          <//>
          <${Note} kind="hint">${O('pickNote')}<//>
        <//>
      <//>
    <//>`;
}
