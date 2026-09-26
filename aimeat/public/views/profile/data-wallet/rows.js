/**
 * @file public/views/profile/data-wallet/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the Data Wallet page: one target (an organism with its workspaces, or a
 *   key area) with who reaches it, and what opens under it (every grant with its role, since when,
 *   who gave it, a revoke door; the revoked ones of the same target); one person with what they
 *   reach; one revoked permission; one group of the trail (who tried what, how many times, when) and
 *   what opens under it (the keys with their names, the rows page by page, a door to grant, a door
 *   to the person's permissions); one grant or revoke event read off a permission's timestamps.
 * @structure targetRow · targetOpen · personRow · revokedRow · groupRow · groupOpen · eventRow
 * @usage import { targetRow, groupRow, eventRow } from './rows.js';
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-25 -- "And N more keys" under an opened group's keys is the Hint (components/Hint.js), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A target, a person, a revoked permission, a trail group and an event are the Listing, and so are the grants and the keys inside an opened row (listing-row and its name, words, who and doors cells, the open panel), a unification: the look most tabs use. The access rows of a group, time first, stay a log.
 *   v1.7.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose detail frames from poster.css.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { Hint } from '/components/Hint.js';
import { x, n, whoOf, roleOf, roleWord, grantWords, grantsWord, groupWords, targetWords, targetOf, wsName, dateWord, timeWord, spanWord, restWords } from './frame.js';

const doorWord = (open) => (open ? x('close') : x('open'));

/* ── 01: one target ───────────────────────────────────────────────────────────────────────────── */

export function targetRow(ctx, row) {
  const open = ctx.openTarget === row.id;
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${row.id}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleTarget(row.id)}>${row.title}</button><small>${row.sub}</small></div>
      <div class="listing-desc">${row.words}</div>
      <div class="poster-time"><span>${row.since ? `${dateWord(row.since)} →` : ''}<br /><span>${grantsWord(row.grants.length)}</span></span></div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleTarget(row.id)}>${doorWord(open)}</button></div>
      ${open ? targetOpen(ctx, row) : null}
    </div>`;
}

/** One grant as a row of the Listing; `lead` is the first cell (the workspace or the target), or null. */
function grantLine(ctx, c, lead) {
  const g = grantWords(c, ctx.names);
  const by = c.metadata?.grantedBy;
  return html`
    <div class="listing-row" key=${c.id}>
      ${lead}
      <div class="listing-who">${g.who.name} · ${roleWord(g.role)}${c.purpose && g.role === 'read' && c.purpose !== 'general' ? html`<small>${c.purpose}</small>` : null}${c.scope === 'federation' ? html`<small>${x('scope.federation')}</small>` : null}${c.expires ? html`<small>${x('untilDate', { date: dateWord(c.expires) })}</small>` : null}</div>
      <div class="poster-time">${dateWord(c.granted_at)}</div>
      <div>${by ? (by === ctx.session?.owner ? x('you') : by) : html`<span class="is-dim">${x('notRecorded')}</span>`}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--danger poster-action--lower" disabled=${ctx.busy === c.id} onClick=${() => ctx.revoke(c)}>${ctx.busy === c.id ? x('revoking') : x('revoke')}</button></div>
    </div>`;
}

/** The target of a grant as the name cell of its row. */
function targetCell(ctx, c) {
  const tw = targetWords(c.data_pattern, ctx.names);
  return html`<div class="listing-name"><b>${tw.title}</b><small>${tw.sub}</small></div>`;
}

function targetOpen(ctx, row) {
  const lead = row.kind === 'org' ? x('target.leadOrg', { org: row.title, n: row.grants.length, ws: row.workspaces.filter((w) => w.id).length }) : x('target.leadKey', { key: row.pattern, n: row.grants.length });
  const copy = row.grants.map((c) => `${targetWords(c.data_pattern, ctx.names).title} · ${targetWords(c.data_pattern, ctx.names).sub}\t${whoOf(c.recipient, ctx.names).name}\t${roleWord(roleOf(c))}\t${c.granted_at}\t${c.id}`).join('\n');
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${lead} ${x('target.roles')}</p>
      ${row.kind === 'org' ? html`
        <div class="listing listing--name-who-when-by-doors dw-sub">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.workspace')}</div><div class="poster-label">${x('col.whoWhat')}</div><div class="poster-label">${x('col.since')}</div><div class="poster-label">${x('col.gaveBy')}</div><div class="poster-label"></div></div>
          ${row.workspaces.map((w) => w.grants.map((c, i) => grantLine(ctx, c, i === 0 ? html`<div class="listing-name"><b>${w.name}</b></div>` : html`<div></div>`)))}
        </div>` : html`
        <div class="listing listing--who-when-by-doors dw-sub">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.whoWhat')}</div><div class="poster-label">${x('col.since')}</div><div class="poster-label">${x('col.gaveBy')}</div><div class="poster-label"></div></div>
          ${row.grants.map((c) => grantLine(ctx, c, null))}
        </div>`}
      ${row.revoked.length ? html`
        <span class="poster-label">${x('target.revokedHere', { n: row.revoked.length })}</span>
        <div class="dw-para dw-revoked">${row.revoked.slice(0, 5).map((c) => html`<div key=${c.id}>${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}${row.kind === 'org' ? ` · ${targetWords(c.data_pattern, ctx.names).sub}` : ''} · ${spanWord(c.granted_at, c.revoked_at)}</div>`)}${row.revoked.length > 5 ? html`<div>${x('andMore', { n: row.revoked.length - 5 })}</div>` : null}</div>` : null}
      <div class="og-doors listing-open-doors">
        ${row.kind === 'org' ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openOrganisms()}>${x('target.openOrganism', { org: row.title })}</button>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.prefillGrant({ orgId: row.organism_id, wsId: row.workspaces[0]?.id || '', key: row.kind === 'key' ? row.pattern : '' })}>${x('target.grantMore')}</button>
        <${CopyButton} className="poster-action poster-action--small poster-action--lower" text=${copy} label=${x('copyList')} />
      </div>
    </div>`;
}

/* ── 01: one person, when the list is turned by people ───────────────────────────────────────── */

export function personRow(ctx, p) {
  const open = ctx.openTarget === p.id;
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''} ${ctx.personFocus === p.name ? 'is-focus' : ''}`} key=${p.id}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleTarget(p.id)}>${p.name}</button><small>${x('whoKind.' + p.kind)}</small></div>
      <div class="listing-desc">${p.words}</div>
      <div class="poster-time"><span>${p.since ? `${dateWord(p.since)} →` : ''}<br /><span>${grantsWord(p.grants.length)}</span></span></div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleTarget(p.id)}>${doorWord(open)}</button></div>
      ${open ? html`
        <div class="listing-open poster-box poster-box--raised">
          <div class="listing listing--name-who-when-by-doors dw-sub">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('col.target')}</div><div class="poster-label">${x('col.whoWhat')}</div><div class="poster-label">${x('col.since')}</div><div class="poster-label">${x('col.gaveBy')}</div><div class="poster-label"></div></div>
            ${p.grants.map((c) => grantLine(ctx, c, targetCell(ctx, c)))}
          </div>
        </div>` : null}
    </div>`;
}

/* ── 01: one revoked permission ──────────────────────────────────────────────────────────────── */

export function revokedRow(ctx, c) {
  const tw = targetWords(c.data_pattern, ctx.names);
  return html`
    <div class="listing-row" key=${c.id}>
      <div class="listing-name">${tw.title}<small>${tw.sub}</small></div>
      <div class="listing-desc">${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}</div>
      <div class="poster-time"><span>${spanWord(c.granted_at, c.revoked_at)}<br /><span>${x(c.status === 'expired' ? 'status.expired' : 'status.revoked')}</span></span></div>
      <div class="listing-doors"></div>
    </div>`;
}

/* ── 02: one group of the trail ──────────────────────────────────────────────────────────────── */

export const groupId = (g) => `${g.accessor_gaii}|${g.target?.kind}|${g.target?.organism_id || g.target?.key || ''}|${g.target?.rest || ''}|${g.action}|${g.allowed ? 1 : 0}`;

export function groupRow(ctx, g) {
  const id = groupId(g);
  const open = ctx.openGroup === id;
  const w = groupWords(g, ctx.names);
  const denied = w.outcome === 'denied';
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${id}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleGroup(id)}>${w.who.name}</button>${w.who.sub ? html`<small>${w.who.sub}</small>` : null}</div>
      <div class="listing-desc dw-w">${w.what}${w.sub ? html`<small>${w.sub}</small>` : null}</div>
      <div class=${`dw-n poster-stat-number poster-stat-number--small ${denied ? 'is-low' : 'is-good'}`}>${n(g.count)}<small>${x('outcome.' + w.outcome)}</small></div>
      <div class="poster-time">${spanWord(g.first, g.last)}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleGroup(id)}>${doorWord(open)}</button></div>
      ${open ? groupOpen(ctx, g, id, w) : null}
    </div>`;
}

function groupOpen(ctx, g, id, w) {
  const tg = g.target || {};
  const rows = ctx.groupRows[id];
  const person = w.who.name && !['anonymous', 'shared#'].some((p) => String(g.accessor_gaii).startsWith(p));
  const lead = w.outcome === 'denied'
    ? x('group.leadDenied', { who: w.who.name, n: n(g.count), what: w.what, span: spanWord(g.first, g.last) }) + (tg.kind === 'ws' ? ' ' + x('group.whyManifest') : ' ' + x('group.held'))
    : x('group.leadOther', { who: w.who.name, n: n(g.count), what: w.what, span: spanWord(g.first, g.last), outcome: x('outcome.' + w.outcome) });
  const keyName = (key) => {
    const t = targetOf(key);
    if (t.kind === 'ws') return { name: wsName(ctx.names, t.organism_id, t.workspace_id), sub: key };
    return { name: key, sub: '' };
  };
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${lead}</p>
      ${g.keys?.length ? html`
        <div class="listing listing--name-what dw-sub">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.key')}</div><div class="poster-label">${x('col.what')}</div></div>
          ${g.keys.map((k) => { const kn = keyName(k); return html`<div class="listing-row" key=${k}><div class="listing-name"><b>${kn.name}</b>${kn.sub ? html`<small>${kn.sub}</small>` : null}</div><div>${tg.rest ? restWords(tg.rest) : ''}</div></div>`; })}
        </div>
        ${g.key_count > g.keys.length ? html`<${Hint}>${x('andMoreKeys', { n: g.key_count - g.keys.length })}<//>` : null}` : null}
      ${rows ? html`
        <span class="poster-label">${x('group.rows', { n: n(rows.total) })}</span>
        <div class="dw-grants dw-grants--rows">
          <div class="dw-gh poster-label">${x('col.when')}</div><div class="dw-gh poster-label">${x('col.key')}</div><div class="dw-gh poster-label">${x('col.outcome')}</div>
          ${rows.entries.map((e) => html`<div class="poster-time" key=${e.id}>${dateWord(e.timestamp)} ${timeWord(e.timestamp)}</div><div><code class="code-inline">${e.memory_key}</code></div><div>${x(e.allowed ? 'outcome.allowed' : 'outcome.denied')}</div>`)}
        </div>
        ${rows.entries.length < rows.total ? html`<div class="dw-more"><button type="button" class="poster-action poster-action--more" disabled=${rows.loading} onClick=${() => ctx.loadGroupRows(g, id, true)}>${rows.loading ? x('loading') : x('group.moreRows', { n: n(rows.total - rows.entries.length) })}</button></div>` : null}` : null}
      <div class="og-doors listing-open-doors">
        ${person && w.outcome === 'denied' ? html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.prefillGrant({ who: g.accessor_gaii, orgId: tg.organism_id || '', wsId: tg.kind === 'ws' ? targetOf(g.keys?.[0] || '').workspace_id || '' : '', key: tg.kind === 'key' ? tg.key : '' })}>${x('group.grantTo', { who: w.who.name })}</button>` : null}
        ${person ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.showPerson(w.who.name)}>${x('group.seePermissions', { who: w.who.name })}</button>` : null}
        ${!rows ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.loadGroupRows(g, id, false)}>${x('group.showRows')}</button>` : null}
      </div>
    </div>`;
}

/* ── 02: one grant or revoke event ───────────────────────────────────────────────────────────── */

export function eventRow(ctx, ev) {
  const byYou = !ev.by || ev.by === ctx.session?.owner;
  const text = x(`event.${ev.kind}.${ev.role}`, { who: ev.who.name, target: `${ev.target.title} · ${ev.target.sub}` });
  return html`
    <div class="listing-row" key=${`${ev.kind}|${ev.consent.id}`}>
      <div class="listing-name">${byYou ? x('you') : ev.by}</div>
      <div class="listing-desc">${text}</div>
      <div class="dw-n is-good poster-stat-number poster-stat-number--small">1<small>${x('outcome.' + ev.kind)}</small></div>
      <div class="poster-time">${dateWord(ev.at)} ${timeWord(ev.at)}</div>
      <div class="listing-doors"></div>
    </div>`;
}
