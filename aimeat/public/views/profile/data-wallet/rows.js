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
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { x, n, whoOf, roleOf, roleWord, grantWords, grantsWord, groupWords, targetWords, targetOf, wsName, dateWord, timeWord, spanWord, restWords } from './frame.js';

const doorWord = (open) => (open ? x('close') : x('open'));

/* ── 01: one target ───────────────────────────────────────────────────────────────────────────── */

export function targetRow(ctx, row) {
  const open = ctx.openTarget === row.id;
  return html`
    <div class=${`dw-row ${open ? 'is-open' : ''}`} key=${row.id}>
      <div class="dw-nm"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleTarget(row.id)}>${row.title}</button><small>${row.sub}</small></div>
      <div class="dw-w">${row.words}</div>
      <div class="dw-when">${row.since ? `${dateWord(row.since)} →` : ''}<br /><span>${grantsWord(row.grants.length)}</span></div>
      <div class="dw-go"><button type="button" class="og-door" onClick=${() => ctx.toggleTarget(row.id)}>${doorWord(open)}</button></div>
      ${open ? targetOpen(ctx, row) : null}
    </div>`;
}

function grantLine(ctx, c, showTarget) {
  const g = grantWords(c, ctx.names);
  const by = c.metadata?.grantedBy;
  return html`
    ${showTarget ? html`<div><b>${targetWords(c.data_pattern, ctx.names).title}</b><small>${targetWords(c.data_pattern, ctx.names).sub}</small></div>` : null}
    <div>${g.who.name} · ${roleWord(g.role)}${c.purpose && g.role === 'read' && c.purpose !== 'general' ? html`<small>${c.purpose}</small>` : null}${c.scope === 'federation' ? html`<small>${x('scope.federation')}</small>` : null}${c.expires ? html`<small>${x('untilDate', { date: dateWord(c.expires) })}</small>` : null}</div>
    <div>${dateWord(c.granted_at)}</div>
    <div>${by ? (by === ctx.session?.owner ? x('you') : by) : html`<span class="is-dim">${x('notRecorded')}</span>`}</div>
    <div class="dw-gr"><button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === c.id} onClick=${() => ctx.revoke(c)}>${ctx.busy === c.id ? x('revoking') : x('revoke')}</button></div>`;
}

function targetOpen(ctx, row) {
  const lead = row.kind === 'org' ? x('target.leadOrg', { org: row.title, n: row.grants.length, ws: row.workspaces.filter((w) => w.id).length }) : x('target.leadKey', { key: row.pattern, n: row.grants.length });
  const copy = row.grants.map((c) => `${targetWords(c.data_pattern, ctx.names).title} · ${targetWords(c.data_pattern, ctx.names).sub}\t${whoOf(c.recipient, ctx.names).name}\t${roleWord(roleOf(c))}\t${c.granted_at}\t${c.id}`).join('\n');
  return html`
    <div class="dw-open">
      <p class="dw-lead">${lead} ${x('target.roles')}</p>
      ${row.kind === 'org' ? html`
        <div class="dw-grants">
          <div class="dw-gh">${x('col.workspace')}</div><div class="dw-gh">${x('col.whoWhat')}</div><div class="dw-gh">${x('col.since')}</div><div class="dw-gh">${x('col.gaveBy')}</div><div class="dw-gh"></div>
          ${row.workspaces.map((w) => w.grants.map((c, i) => html`
            ${i === 0 ? html`<div><b>${w.name}</b></div>` : html`<div></div>`}
            ${grantLine(ctx, c, false)}`))}
        </div>` : html`
        <div class="dw-grants" style="grid-template-columns: minmax(0, 1.4fr) 7rem 8rem auto;">
          <div class="dw-gh">${x('col.whoWhat')}</div><div class="dw-gh">${x('col.since')}</div><div class="dw-gh">${x('col.gaveBy')}</div><div class="dw-gh"></div>
          ${row.grants.map((c) => grantLine(ctx, c, false))}
        </div>`}
      ${row.revoked.length ? html`
        <span class="og-label">${x('target.revokedHere', { n: row.revoked.length })}</span>
        <div class="dw-para" style="margin: 0;">${row.revoked.slice(0, 5).map((c) => html`<div key=${c.id}>${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}${row.kind === 'org' ? ` · ${targetWords(c.data_pattern, ctx.names).sub}` : ''} · ${spanWord(c.granted_at, c.revoked_at)}</div>`)}${row.revoked.length > 5 ? html`<div>${x('andMore', { n: row.revoked.length - 5 })}</div>` : null}</div>` : null}
      <div class="og-doors">
        ${row.kind === 'org' ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openOrganisms()}>${x('target.openOrganism', { org: row.title })}</button>` : null}
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.prefillGrant({ orgId: row.organism_id, wsId: row.workspaces[0]?.id || '', key: row.kind === 'key' ? row.pattern : '' })}>${x('target.grantMore')}</button>
        <${CopyButton} className="og-door og-door--quiet" text=${copy} label=${x('copyList')} />
      </div>
    </div>`;
}

/* ── 01: one person, when the list is turned by people ───────────────────────────────────────── */

export function personRow(ctx, p) {
  const open = ctx.openTarget === p.id;
  return html`
    <div class=${`dw-row ${open ? 'is-open' : ''} ${ctx.personFocus === p.name ? 'is-focus' : ''}`} key=${p.id}>
      <div class="dw-nm"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleTarget(p.id)}>${p.name}</button><small>${x('whoKind.' + p.kind)}</small></div>
      <div class="dw-w">${p.words}</div>
      <div class="dw-when">${p.since ? `${dateWord(p.since)} →` : ''}<br /><span>${grantsWord(p.grants.length)}</span></div>
      <div class="dw-go"><button type="button" class="og-door" onClick=${() => ctx.toggleTarget(p.id)}>${doorWord(open)}</button></div>
      ${open ? html`
        <div class="dw-open">
          <div class="dw-grants">
            <div class="dw-gh">${x('col.target')}</div><div class="dw-gh">${x('col.whoWhat')}</div><div class="dw-gh">${x('col.since')}</div><div class="dw-gh">${x('col.gaveBy')}</div><div class="dw-gh"></div>
            ${p.grants.map((c) => grantLine(ctx, c, true))}
          </div>
        </div>` : null}
    </div>`;
}

/* ── 01: one revoked permission ──────────────────────────────────────────────────────────────── */

export function revokedRow(ctx, c) {
  const tw = targetWords(c.data_pattern, ctx.names);
  return html`
    <div class="dw-row" key=${c.id}>
      <div class="dw-nm">${tw.title}<small>${tw.sub}</small></div>
      <div class="dw-w">${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}</div>
      <div class="dw-when">${spanWord(c.granted_at, c.revoked_at)}<br /><span>${x(c.status === 'expired' ? 'status.expired' : 'status.revoked')}</span></div>
      <div class="dw-go"></div>
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
    <div class=${`dw-row ${open ? 'is-open' : ''}`} key=${id}>
      <div class="dw-nm"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleGroup(id)}>${w.who.name}</button>${w.who.sub ? html`<small>${w.who.sub}</small>` : null}</div>
      <div class="dw-w">${w.what}${w.sub ? html`<small>${w.sub}</small>` : null}</div>
      <div class=${`dw-n ${denied ? 'is-low' : 'is-good'}`}>${n(g.count)}<small>${x('outcome.' + w.outcome)}</small></div>
      <div class="dw-when">${spanWord(g.first, g.last)}</div>
      <div class="dw-go"><button type="button" class="og-door" onClick=${() => ctx.toggleGroup(id)}>${doorWord(open)}</button></div>
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
    <div class="dw-open">
      <p class="dw-lead">${lead}</p>
      ${g.keys?.length ? html`
        <div class="dw-grants dw-grants--keys">
          <div class="dw-gh">${x('col.key')}</div><div class="dw-gh">${x('col.what')}</div>
          ${g.keys.map((k) => { const kn = keyName(k); return html`<div key=${k}><b>${kn.name}</b>${kn.sub ? html`<small>${kn.sub}</small>` : null}</div><div>${tg.rest ? restWords(tg.rest) : ''}</div>`; })}
        </div>
        ${g.key_count > g.keys.length ? html`<p class="dw-hint">${x('andMoreKeys', { n: g.key_count - g.keys.length })}</p>` : null}` : null}
      ${rows ? html`
        <span class="og-label">${x('group.rows', { n: n(rows.total) })}</span>
        <div class="dw-grants dw-grants--rows">
          <div class="dw-gh">${x('col.when')}</div><div class="dw-gh">${x('col.key')}</div><div class="dw-gh">${x('col.outcome')}</div>
          ${rows.entries.map((e) => html`<div key=${e.id}>${dateWord(e.timestamp)} ${timeWord(e.timestamp)}</div><div><code>${e.memory_key}</code></div><div>${x(e.allowed ? 'outcome.allowed' : 'outcome.denied')}</div>`)}
        </div>
        ${rows.entries.length < rows.total ? html`<div class="dw-more"><button type="button" class="og-door og-door--quiet" disabled=${rows.loading} onClick=${() => ctx.loadGroupRows(g, id, true)}>${rows.loading ? x('loading') : x('group.moreRows', { n: n(rows.total - rows.entries.length) })}</button></div>` : null}` : null}
      <div class="og-doors">
        ${person && w.outcome === 'denied' ? html`<button type="button" class="og-door" onClick=${() => ctx.prefillGrant({ who: g.accessor_gaii, orgId: tg.organism_id || '', wsId: tg.kind === 'ws' ? targetOf(g.keys?.[0] || '').workspace_id || '' : '', key: tg.kind === 'key' ? tg.key : '' })}>${x('group.grantTo', { who: w.who.name })}</button>` : null}
        ${person ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.showPerson(w.who.name)}>${x('group.seePermissions', { who: w.who.name })}</button>` : null}
        ${!rows ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.loadGroupRows(g, id, false)}>${x('group.showRows')}</button>` : null}
      </div>
    </div>`;
}

/* ── 02: one grant or revoke event ───────────────────────────────────────────────────────────── */

export function eventRow(ctx, ev) {
  const byYou = !ev.by || ev.by === ctx.session?.owner;
  const text = x(`event.${ev.kind}.${ev.role}`, { who: ev.who.name, target: `${ev.target.title} · ${ev.target.sub}` });
  return html`
    <div class="dw-row" key=${`${ev.kind}|${ev.consent.id}`}>
      <div class="dw-nm">${byYou ? x('you') : ev.by}</div>
      <div class="dw-w">${text}</div>
      <div class="dw-n is-good">1<small>${x('outcome.' + ev.kind)}</small></div>
      <div class="dw-when">${dateWord(ev.at)} ${timeWord(ev.at)}</div>
      <div class="dw-go"></div>
    </div>`;
}
