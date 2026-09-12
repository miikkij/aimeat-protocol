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
 *   v1.0.0 — 2026-09-12 — Initial (the Organism ownership page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt } from './shared.js';
import { candidates } from './organism-ownership-tab.model.js';

const O = (key, params) => t('admin.orgOwnership.' + key, params);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');

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
    <section class="og-sec adm-oo-detail">
      <div class="og-sec-h">
        <h2>${row.name}<small>03</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${O('close')}</button>
        </div>
      </div>
      <p class="adm-oo-id">${row.id}</p>

      <div class="adm-oo-two">
        <div>
          <div class="adm-oo-sub">${O('whoHolds')}</div>
          <dl class="adm-oo-kv">
            <dt>${O('heldBy')}</dt>
            <dd>
              ${row.ownerStates.map(o => html`
                <span class="adm-oo-chip ${o.state === 'ok' ? '' : 'adm-oo-chip--bad'}">${o.name}</span>`)}
              ${row.stuck && html`<em>${O('stripStuckSub')}</em>`}
            </dd>
            <dt>${O('madeBy')}</dt>
            <dd>${row.createdBy || '—'}<em>${O('madeByWhy')}</em></dd>
            <dt>${O('created')}</dt>
            <dd>${day(row.createdAt)}<em>${O('changed', { date: day(ownership?.updated_at) })}</em></dd>
            <dt>${O('inside')}</dt>
            <dd>${members.length === 1 ? O('insideOne') : O('insidePeople', { count: members.length })}
              <em>${canSignIn ? O('insideWhy', { count: canSignIn }) : O('insideWhyNone')}</em></dd>
          </dl>
        </div>

        <div>
          <div class="adm-oo-sub">${O('whoInside')}</div>
          <div class="adm-oo-tr adm-oo-tr--head">
            <div>${O('member')}</div>
            <div>${O('role')}</div>
            <div>${O('canSignIn')}</div>
            <div>${O('joined')}</div>
          </div>
          ${members.length === 0
    ? html`<p class="adm-oo-note">${O('noMembers')}</p>`
    : members.map(m => html`
            <div class="adm-oo-tr ${reach(m.ghii) ? '' : 'is-off'}">
              <div><b>${m.ghii}</b>${holding.includes(m.ghii)
    ? html` <span class="adm-oo-chip adm-oo-chip--bad">${O('owner')}</span>` : null}</div>
              <div class="adm-oo-role">${m.role}</div>
              <div class="adm-oo-can ${reach(m.ghii) ? '' : 'no'}">${reach(m.ghii) ? O('yes') : O('no')}</div>
              <div class="adm-oo-day" title=${dt(m.joined_at)}>${day(m.joined_at)}</div>
            </div>`)}
          <p class="adm-oo-note">${O('adminNote')}</p>
        </div>
      </div>

      <div class="adm-oo-put">
        <div class="adm-oo-sub">${O('putBack')}</div>
        <div class="adm-oo-lbl">${O('whoTakes')}</div>
        <input type="search" class="adm-oo-input" value=${typed} placeholder=${O('pickPlaceholder')}
          onInput=${e => setTyped(e.target.value)} />
        ${shown.length === 0
    ? html`<p class="adm-oo-note adm-oo-note--bad">${O('noCandidate')}</p>`
    : html`<div class="adm-oo-pick">
            ${shown.map(c => html`
              <button type="button" class="adm-oo-pick-row ${c.state === 'ok' ? '' : 'is-no'} ${chosen && c.name === chosen.name ? 'is-on' : ''}"
                disabled=${c.state !== 'ok'} onClick=${() => setTyped(c.name)}>
                <b>${c.name}</b><em>${why(c)}</em>
              </button>`)}
          </div>`}
        <div class="adm-oo-acts">
          <button class="adm-btn" disabled=${busy || !chosen} onClick=${() => chosen && onAdd(chosen.name)}>
            ${chosen ? O('makeOwner', { name: chosen.name }) : O('add')}
          </button>
          <p>${holding.length === 1
    ? O('keepsOne', { names: holding.join(', ') })
    : O('keeps', { names: holding.join(', ') })}</p>
        </div>
        <p class="adm-oo-note">${O('pickNote')}</p>
      </div>
    </section>`;
}
