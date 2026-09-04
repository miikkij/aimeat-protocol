/**
 * @file public/views/profile/access/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the Access page: one key (an app's grant or a token) with who holds it,
 *   what it may do in words, when it was last used and a door; what opens under an app's key (each
 *   right on its own line behind a "take away" door, the base package said once, the spending
 *   ceiling where the app may buy, the doors to open the app and to revoke the key); the open
 *   sessions by device and by agent; the servers allowed to verify the person's identity.
 * @structure keyRow · keyOpen · sessionsBlock · federationBlock
 * @usage import { keyRow, sessionsBlock, federationBlock } from './rows.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { x, n, dateWord, timeWord, rightGroups } from './frame.js';

const doorWord = (open) => (open ? x('close') : x('open'));

/* A host name in the narrow "who" column breaks at its dots (nuotta.apps. / aimeat.io) rather than
   wherever the column runs out: a soft break after each dot is taken before the emergency break
   that overflow-wrap would make mid-word. */
const dotted = (s) => s.split(' · ').map((part, i) => html`${i ? ' · ' : ''}${part.includes('.') ? part.split('.').map((seg, j) => (j ? html`.<wbr />${seg}` : seg)) : part}`);

/* ── 02: one key ─────────────────────────────────────────────────────────────────────────────── */

export function keyRow(ctx, row) {
  const open = ctx.openKey === row.id;
  const last = row.last ? html`${dateWord(row.last)}<br />${timeWord(row.last)}` : html`<span>${x('neverUsed')}</span>`;
  const words = row.words.length ? row.words.join(', ') : x('nothing');
  return html`
    <div class=${`ac-key ${open ? 'is-open' : ''}`} key=${row.id}>
      <div class="ac-knm"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleKey(row.id)}>${row.name}</button><small class=${row.subLow ? 'is-low' : ''}>${dotted(row.sub)}</small></div>
      <div class="ac-kw">${row.level?.low ? html`<b>${words}</b>` : words}${row.base ? html` · ${x('baseTag')}` : null}${row.canSpend ? html` · <b>${row.spendCap == null ? x('spendNoLimitShort') : x('spendCapShort', { cap: n(row.spendCap) })}</b>` : null}</div>
      <div class=${`ac-kwhen ${row.lastLow ? 'is-low' : ''}`}>${last}${row.lastLow && row.idle != null ? html`<br /><span>${x('unusedDays', { n: row.idle })}</span>` : null}</div>
      <div class="ac-kgo">
        ${row.kind === 'app' ? html`<button type="button" class="og-door" onClick=${() => ctx.toggleKey(row.id)}>${doorWord(open)}</button>` : null}
        <button type="button" class=${`og-door ${row.level?.low ? 'og-door--danger' : ''}`} disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${ctx.busy === row.id ? x('revoking') : x('revoke')}</button>
      </div>
      ${open && row.kind === 'app' ? keyOpen(ctx, row) : null}
    </div>`;
}

function keyOpen(ctx, row) {
  const groups = rightGroups(row.scopes, ctx.basePackage);
  const minutes = Math.max(1, Math.round((ctx.ov?.access_ttl_seconds || 900) / 60));
  const canTake = (g) => groups.length > 1 || g.scopes.length < row.scopes.length;
  return html`
    <div class="ac-open">
      <p class="ac-lead">${x('open.lead', { name: row.name })} ${x('open.applies', { min: minutes })}</p>
      <div class="ac-rights">
        ${groups.map((g) => html`
          <div class=${`ac-rk ${g.base ? 'is-dim' : ''}`} key=${'k' + g.id}>${g.label}</div>
          <div class=${`ac-rw ${g.base ? 'is-dim' : ''}`} key=${'w' + g.id}>${g.text}${g.base ? html`<br /><small class="is-dim">${x('open.baseSub', { n: ctx.baseHolders })}</small>` : null}</div>
          <div class="ac-rgo" key=${'g' + g.id}>${canTake(g) ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === row.id} onClick=${() => ctx.takeAway(row, g)}>${x('open.takeAway')}</button>` : html`<span class="ac-hint">${x('open.lastRight')}</span>`}</div>`)}
      </div>
      ${row.canSpend ? html`
        <span class="og-label">${x('spend.title')}</span>
        <p class="ac-para" style="margin: 0;">${row.spendCap == null ? x('spend.noLimit') : x('spend.used', { spent: n(row.spent), cap: n(row.spendCap) })}</p>
        <div class="ac-spend">
          <input class="og-input" type="number" min="0" step="1" inputmode="numeric" placeholder=${x('spend.placeholder')} value=${ctx.spendDraft[row.id] ?? ''} onInput=${(e) => ctx.setSpendDraft(row.id, e.target.value)} />
          <button type="button" class="og-door" disabled=${ctx.busy === row.id} onClick=${() => ctx.setSpendCap(row, ctx.spendDraft[row.id])}>${x('spend.set')}</button>
          ${row.spent > 0 ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === row.id} onClick=${() => ctx.setSpendCap(row, null, true)}>${x('spend.reset')}</button>` : null}
        </div>` : null}
      <div class="og-doors">
        <button type="button" class="og-door og-door--danger" disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${x('open.revokeAll')}</button>
        ${row.grant?.app_origin ? html`<a class="og-door og-door--quiet" href=${row.grant.app_origin} target="_blank" rel="noopener">${x('open.openApp')}</a>` : null}
        <span class="ac-hint">${x('open.revokeHint')}</span>
      </div>
    </div>`;
}

/* ── 01: the open sessions ──────────────────────────────────────────────────────────────────── */

export function sessionsBlock(ctx) {
  const s = ctx.ov.sign_in.sessions;
  const devices = s.mine.by_device;
  const agents = s.agents;
  return html`
    <div class="ac-devices">
      <div class="ac-dh">${x('col.device')}</div><div class="ac-dh ac-dn">${x('col.sessions')}</div><div class="ac-dh">${x('col.lastUsed')}</div>
      ${devices.map((d) => html`
        <div key=${'d' + (d.label || '')}><b>${d.label || x('deviceUnknown')}</b>${s.mine.current && (s.mine.current.device_label ?? null) === d.label ? html`<small>${x('thisDeviceAmong')}</small>` : null}</div>
        <div class="ac-dn" key=${'n' + (d.label || '')}>${n(d.count)}</div>
        <div key=${'l' + (d.label || '')}>${d.last_used_at ? `${dateWord(d.last_used_at)} ${timeWord(d.last_used_at)}` : ''}</div>`)}
      ${agents.total ? html`
        <div><b>${x('agentsRow', { n: agents.distinct })}</b><small>${agents.by_agent.slice(0, 6).map((a) => a.name).join(', ')}${agents.by_agent.length > 6 ? ` +${agents.by_agent.length - 6}` : ''}</small></div>
        <div class="ac-dn">${n(agents.total)}</div>
        <div>${agents.by_agent[0]?.last_used_at ? `${dateWord(agents.by_agent[0].last_used_at)} ${timeWord(agents.by_agent[0].last_used_at)}` : ''}</div>` : null}
    </div>`;
}

/* ── 01: the servers that may verify this identity ─────────────────────────────────────────── */

export function federationBlock(ctx) {
  const fed = ctx.fed;
  return html`
    ${fed.nodes.map((c) => html`
      <div class="ac-fed-node" key=${c.id}><span>${c.recipient.replace('node:', '')}</span><span class="is-dim">${dateWord(c.granted_at)}</span><button type="button" class="og-door og-door--quiet" disabled=${fed.all || ctx.busy === c.id} onClick=${() => ctx.removeFedNode(c)}>${x('fed.remove')}</button></div>`)}
    <div class="ac-fed">
      <input class="og-input" type="text" placeholder=${x('fed.addPlaceholder')} disabled=${fed.all} value=${ctx.fedInput} onInput=${(e) => ctx.setFedInput(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ctx.addFedNode()} />
      <button type="button" class="og-door" disabled=${fed.all || ctx.busy === 'fed' || !ctx.fedInput.trim()} onClick=${() => ctx.addFedNode()}>${x('fed.add')}</button>
      <span class="ac-hint" style="margin: 0;">${fed.all ? x('fed.allHint') : x('fed.listHint')}</span>
    </div>`;
}
