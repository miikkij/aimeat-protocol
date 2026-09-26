/**
 * @file public/views/profile/access/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the Access page: one key (an app's grant or a token) with who holds it,
 *   what it may do in words, when it was last used and a door; what opens under an app's key (each
 *   right on its own line behind a "take away" door, the base package said once, the spending
 *   ceiling where the app may buy, the doors to open the app and to revoke the key); the open
 *   sessions by device and by agent; the servers allowed to verify the person's identity; and one
 *   secret from the vault — its name, the spelling an extension writes into a header, what names it
 *   today, and the write-only field that replaces its value.
 * @structure keyRow · keyOpen · secretRow · sessionsBlock · federationBlock
 * @usage import { keyRow, secretRow, sessionsBlock, federationBlock } from './rows.js';
 * @version-history
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The rights of an opened key are the Listing too (a right, its words, its door), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- A key's row and a secret's row are the Listing (listing-row and its name, words, who and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-17 -- A secret row says the one address its value may go to, or that the first
 *     call that uses it sets that address.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-13 -- Compose access detail frames and extract inline layout.
 *   v1.1.0 — 2026-09-06 — secretRow: the vault's rows for section 04. It shows the name and never
 *     the value, because the value cannot be read back from the server either.
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { x, n, dateWord, timeWord, rightGroups } from './frame.js';
import { Hint } from '/components/Hint.js';

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
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${row.id}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleKey(row.id)}>${row.name}</button><small class=${row.subLow ? 'is-warn' : ''}>${dotted(row.sub)}</small></div>
      <div class="listing-desc">${row.level?.low ? html`<b>${words}</b>` : words}${row.base ? html` · ${x('baseTag')}` : null}${row.canSpend ? html` · <b>${row.spendCap == null ? x('spendNoLimitShort') : x('spendCapShort', { cap: n(row.spendCap) })}</b>` : null}</div>
      <div class=${`poster-time ${row.lastLow ? 'is-low' : ''}`}><span>${last}${row.lastLow && row.idle != null ? html`<br /><span>${x('unusedDays', { n: row.idle })}</span>` : null}</span></div>
      <div class="listing-doors">
        ${row.kind === 'app' ? html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleKey(row.id)}>${doorWord(open)}</button>` : null}
        <button type="button" class=${`poster-action poster-action--small poster-action--row${row.level?.low ? ' poster-action--danger' : ''}`} disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${ctx.busy === row.id ? x('revoking') : x('revoke')}</button>
      </div>
      ${open && row.kind === 'app' ? keyOpen(ctx, row) : null}
    </div>`;
}

function keyOpen(ctx, row) {
  const groups = rightGroups(row.scopes, ctx.basePackage);
  const minutes = Math.max(1, Math.round((ctx.ov?.access_ttl_seconds || 900) / 60));
  const canTake = (g) => groups.length > 1 || g.scopes.length < row.scopes.length;
  return html`
    <div class="listing-open poster-box poster-box--raised ac-open">
      <p class="og-lead">${x('open.lead', { name: row.name })} ${x('open.applies', { min: minutes })}</p>
      <div class="listing listing--label-words-doors ac-rights">
        ${groups.map((g) => html`<div class="listing-row" key=${g.id}>
          <div class=${`ac-rk poster-label ${g.base ? 'is-dim' : ''}`}>${g.label}</div>
          <div class=${`ac-rw ${g.base ? 'is-dim' : ''}`}><span>${g.text}${g.base ? html`<br /><small class="is-dim">${x('open.baseSub', { n: ctx.baseHolders })}</small>` : null}</span></div>
          <div class="listing-doors">${canTake(g) ? html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${ctx.busy === row.id} onClick=${() => ctx.takeAway(row, g)}>${x('open.takeAway')}</button>` : html`<span class="poster-hint">${x('open.lastRight')}</span>`}</div>
        </div>`)}
      </div>
      ${row.canSpend ? html`
        <span class="poster-label">${x('spend.title')}</span>
        <p class="poster-hint ac-spend-summary">${row.spendCap == null ? x('spend.noLimit') : x('spend.used', { spent: n(row.spent), cap: n(row.spendCap) })}</p>
        <div class="ac-spend">
          <input class="og-input" type="number" min="0" step="1" inputmode="numeric" placeholder=${x('spend.placeholder')} value=${ctx.spendDraft[row.id] ?? ''} onInput=${(e) => ctx.setSpendDraft(row.id, e.target.value)} />
          <button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === row.id} onClick=${() => ctx.setSpendCap(row, ctx.spendDraft[row.id])}>${x('spend.set')}</button>
          ${row.spent > 0 ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === row.id} onClick=${() => ctx.setSpendCap(row, null, true)}>${x('spend.reset')}</button>` : null}
        </div>` : null}
      <div class="og-doors">
        <button type="button" class="poster-action poster-action--small poster-action--danger" disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${x('open.revokeAll')}</button>
        ${row.grant?.app_origin ? html`<a class="poster-action poster-action--small poster-action--lower" href=${row.grant.app_origin} target="_blank" rel="noopener">${x('open.openApp')}</a>` : null}
        <span class="poster-hint">${x('open.revokeHint')}</span>
      </div>
    </div>`;
}

/* ── 04: one secret ─────────────────────────────────────────────────────────────────────────── */

/**
 * One row of the vault. The sub-line is the spelling an extension writes into a header, because
 * that is the only thing a person needs to carry away from here; the value is not on this row, in
 * this file or in the answer the page read.
 * The address line under "used by" says where the value may go: a vault secret is bound to the host
 * of the first call that uses it, and every other host is refused.
 * @param {any} ctx @param {{ name: string, setAt?: string, updatedAt?: string, usedBy?: string[], hosts?: string[] }} row
 */
export function secretRow(ctx, row) {
  const open = ctx.replaceName === row.name;
  const busy = ctx.busy === 'secret:' + row.name;
  const used = Array.isArray(row.usedBy) ? row.usedBy : [];
  const hosts = Array.isArray(row.hosts) ? row.hosts : [];
  const replaced = row.updatedAt && row.updatedAt !== row.setAt ? row.updatedAt : null;
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${row.name}>
      <div class="listing-name"><b>${row.name}</b><small>${'{{secret:' + row.name + '}}'}</small></div>
      <div class="listing-who">
        <span>${used.length ? used.join(', ') : html`<span class="is-dim">${x('secrets.usedByNone')}</span>`}</span>
        <small>${hosts.length ? secretHostLine(hosts) : x('secrets.notBound')}</small>
      </div>
      <div class="poster-time"><span>${dateWord(row.setAt)}<br /><span>${replaced ? x('secrets.colReplaced') + ' ' + dateWord(replaced) : x('secrets.neverReplaced')}</span></span></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.openReplace(row.name)}>${open ? x('close') : x('secrets.replace')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--row poster-action--danger" disabled=${busy} onClick=${() => ctx.deleteSecret(row)}>${x('secrets.delete')}</button>
      </div>
      ${open ? secretReplace(ctx, row, busy) : null}
    </div>`;
}

/**
 * "Sent only to <host>". A host may break after a dot and nowhere else: broken at its hyphen it
 * reads as two addresses, and cut short with an ellipsis it hides the one thing the line is for.
 * The sentence is split around a marker so the translation decides where the host goes.
 */
function secretHostLine(hosts) {
  const marker = ' ';
  const [before, after = ''] = x('secrets.goesTo', { host: marker }).split(marker);
  // The last two labels stay together, so a line never ends up holding only "com".
  const host = (h) => {
    const parts = h.split('.');
    const labels = parts.length > 1 ? [...parts.slice(0, -2), parts.slice(-2).join('.')] : parts;
    return labels.map((part, i) =>
      html`<span class="ac-shost-h">${part}${i < labels.length - 1 ? '.' : ''}</span>${i < labels.length - 1 ? html`<wbr />` : null}`);
  };
  return html`${before}${hosts.map((h, i) => html`${i ? ', ' : ''}${host(h)}`)}${after}`;
}

/** The one field that writes a value, on the row it belongs to. It is never filled from the server. */
function secretReplace(ctx, row, busy) {
  return html`
    <div class="listing-open poster-box poster-box--raised ac-open">
      <span class="poster-label">${x('secrets.replaceTitle', { name: row.name })}</span>
      <p class="og-lead">${x('secrets.replaceHint')}</p>
      <div class="ac-swrite">
        <input class="og-input" type="password" autocomplete="new-password" spellcheck="false" placeholder=${x('secrets.valuePlaceholder')} value=${ctx.replaceValue} onInput=${(e) => ctx.setReplaceValue(e.target.value)} />
        <button type="button" class="poster-action poster-action--small" disabled=${busy || !ctx.replaceValue} onClick=${() => ctx.writeSecret(row.name, ctx.replaceValue, true)}>${busy ? x('secrets.saving') : x('secrets.replaceSave')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openReplace(row.name)}>${x('cancel')}</button>
      </div>
      ${ctx.secretMsg ? html`<small class=${`form-message ${ctx.secretMsg.error ? 'form-message--error' : ''}`}>${ctx.secretMsg.text}</small>` : null}
      <${Hint}>${x('secrets.valueHint')}<//>
    </div>`;
}

/* ── 01: the open sessions ──────────────────────────────────────────────────────────────────── */

export function sessionsBlock(ctx) {
  const s = ctx.ov.sign_in.sessions;
  const devices = s.mine.by_device;
  const agents = s.agents;
  return html`
    <div class="ac-devices">
      <div class="ac-dh poster-label">${x('col.device')}</div><div class="ac-dh poster-label ac-dn">${x('col.sessions')}</div><div class="ac-dh poster-label">${x('col.lastUsed')}</div>
      ${devices.map((d) => html`
        <div key=${'d' + (d.label || '')}><b>${d.label || x('deviceUnknown')}</b>${s.mine.current && (s.mine.current.device_label ?? null) === d.label ? html`<small>${x('thisDeviceAmong')}</small>` : null}</div>
        <div class="ac-dn poster-stat-number poster-stat-number--small" key=${'n' + (d.label || '')}>${n(d.count)}</div>
        <div key=${'l' + (d.label || '')}>${d.last_used_at ? `${dateWord(d.last_used_at)} ${timeWord(d.last_used_at)}` : ''}</div>`)}
      ${agents.total ? html`
        <div><b>${x('agentsRow', { n: agents.distinct })}</b><small>${agents.by_agent.slice(0, 6).map((a) => a.name).join(', ')}${agents.by_agent.length > 6 ? ` +${agents.by_agent.length - 6}` : ''}</small></div>
        <div class="ac-dn poster-stat-number poster-stat-number--small">${n(agents.total)}</div>
        <div>${agents.by_agent[0]?.last_used_at ? `${dateWord(agents.by_agent[0].last_used_at)} ${timeWord(agents.by_agent[0].last_used_at)}` : ''}</div>` : null}
    </div>`;
}

/* ── 01: the servers that may verify this identity ─────────────────────────────────────────── */

export function federationBlock(ctx) {
  const fed = ctx.fed;
  return html`
    ${fed.nodes.length ? html`<div class="listing listing--cols listing--name-desc-doors ac-fed-nodes">${fed.nodes.map((c) => html`
      <div class="listing-row" key=${c.id}><div class="listing-name">${c.recipient.replace('node:', '')}</div><div class="listing-desc">${dateWord(c.granted_at)}</div><div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${fed.all || ctx.busy === c.id} onClick=${() => ctx.removeFedNode(c)}>${x('fed.remove')}</button></div></div>`)}</div>` : null}
    <div class="ac-fed">
      <input class="og-input" type="text" placeholder=${x('fed.addPlaceholder')} disabled=${fed.all} value=${ctx.fedInput} onInput=${(e) => ctx.setFedInput(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ctx.addFedNode()} />
      <button type="button" class="poster-action poster-action--small" disabled=${fed.all || ctx.busy === 'fed' || !ctx.fedInput.trim()} onClick=${() => ctx.addFedNode()}>${x('fed.add')}</button>
      <span class="poster-hint">${fed.all ? x('fed.allHint') : x('fed.listHint')}</span>
    </div>`;
}
