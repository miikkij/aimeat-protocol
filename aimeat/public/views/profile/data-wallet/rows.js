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
 * @structure targetRow · targetOpen · grantCells · personRow · revokedRow · groupRow · groupOpen ·
 *   eventRow · msgLine
 * @usage import { targetRow, groupRow, eventRow } from './rows.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: every row is a ListRow (the words it says
 *     in its body, the opened record under it), the grants, keys and trail rows inside an opened
 *     record are Tables with their column heads; no own classes.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose detail frames from poster.css.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Stack, ListRow, Table, Surface, Text, Action, CopyAction } from '/components/poster-parts.js';
import { x, n, whoOf, roleOf, roleWord, grantWords, grantsWord, groupWords, targetWords, targetOf, wsName, dateWord, timeWord, spanWord, restWords } from './frame.js';

const doorWord = (open) => (open ? x('close') : x('open'));

/** A form's message: coral when it refuses, green when it went through. */
export const msgLine = (m) => (m ? html`<${Text} kind="caption" tone=${m.error ? 'coral' : 'success'}>${m.text}<//>` : null);

/** Since when, and how many permissions: the right-hand value of a target or a person. */
const sinceValue = (since, count) => html`<${Stack} density="compact" align="end">
  <${Text} kind="mono">${since ? `${dateWord(since)} →` : ''}<//>
  <${Text} kind="caption" tone="muted">${grantsWord(count)}<//>
<//>`;

/** A count set as a small number with its outcome under it. */
const countValue = (count, outcome, tone) => html`<${Stack} density="compact" align="end">
  <${Text} kind="number" size="small" tone=${tone}>${count}<//>
  <${Text} kind="caption" tone="muted">${x('outcome.' + outcome)}<//>
<//>`;

/* ── 01: one target ───────────────────────────────────────────────────────────────────────────── */

export function targetRow(ctx, row) {
  const open = ctx.openTarget === row.id;
  return html`
    <${ListRow} key=${row.id} name=${row.title} detail=${row.sub} onOpen=${() => ctx.toggleTarget(row.id)}
      value=${sinceValue(row.since, row.grants.length)}
      actions=${html`<${Action} kind="text" expanded=${open} onClick=${() => ctx.toggleTarget(row.id)}>${doorWord(open)}<//>`}>
      <${Text} kind="caption">${row.words}<//>
      ${open ? targetOpen(ctx, row) : null}
    <//>`;
}

/** One grant as table cells: (target,) who and what, since, who gave it, the revoke door. */
function grantCells(ctx, c, showTarget) {
  const g = grantWords(c, ctx.names);
  const by = c.metadata?.grantedBy;
  const tw = showTarget ? targetWords(c.data_pattern, ctx.names) : null;
  return [
    ...(showTarget ? [html`<${Stack} density="compact"><${Text}><strong>${tw.title}</strong><//><${Text} kind="mono" tone="muted">${tw.sub}<//><//>`] : []),
    html`<${Stack} density="compact">
      <${Text}>${g.who.name} · ${roleWord(g.role)}<//>
      ${c.purpose && g.role === 'read' && c.purpose !== 'general' ? html`<${Text} kind="mono" tone="muted">${c.purpose}<//>` : null}
      ${c.scope === 'federation' ? html`<${Text} kind="mono" tone="muted">${x('scope.federation')}<//>` : null}
      ${c.expires ? html`<${Text} kind="mono" tone="muted">${x('untilDate', { date: dateWord(c.expires) })}<//>` : null}
    <//>`,
    dateWord(c.granted_at),
    by ? (by === ctx.session?.owner ? x('you') : by) : html`<${Text} tone="muted">${x('notRecorded')}<//>`,
    html`<${Action} kind="text" tone="danger" disabled=${ctx.busy === c.id} onClick=${() => ctx.revoke(c)}>${ctx.busy === c.id ? x('revoking') : x('revoke')}<//>`,
  ];
}

function targetOpen(ctx, row) {
  const lead = row.kind === 'org' ? x('target.leadOrg', { org: row.title, n: row.grants.length, ws: row.workspaces.filter((w) => w.id).length }) : x('target.leadKey', { key: row.pattern, n: row.grants.length });
  const copy = row.grants.map((c) => `${targetWords(c.data_pattern, ctx.names).title} · ${targetWords(c.data_pattern, ctx.names).sub}\t${whoOf(c.recipient, ctx.names).name}\t${roleWord(roleOf(c))}\t${c.granted_at}\t${c.id}`).join('\n');
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text}>${lead} ${x('target.roles')}<//>
      ${row.kind === 'org'
        ? html`<${Table} density="compact" collapse="640" label=${row.title}
            headers=${[x('col.workspace'), x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}
            rows=${row.workspaces.flatMap((w) => w.grants.map((c, i) => [i === 0 ? html`<${Text}><strong>${w.name}</strong><//>` : '', ...grantCells(ctx, c, false)]))} />`
        : html`<${Table} density="compact" collapse="640" label=${row.title}
            headers=${[x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}
            rows=${row.grants.map((c) => grantCells(ctx, c, false))} />`}
      ${row.revoked.length ? html`<${Stack} density="compact">
        <${Text} kind="label">${x('target.revokedHere', { n: row.revoked.length })}<//>
        ${row.revoked.slice(0, 5).map((c) => html`<${Text} key=${c.id} tone="muted">${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}${row.kind === 'org' ? ` · ${targetWords(c.data_pattern, ctx.names).sub}` : ''} · ${spanWord(c.granted_at, c.revoked_at)}<//>`)}
        ${row.revoked.length > 5 ? html`<${Text} tone="muted">${x('andMore', { n: row.revoked.length - 5 })}<//>` : null}
      <//>` : null}
      <${Stack} direction="wrap" density="compact">
        ${row.kind === 'org' ? html`<${Action} kind="text" onClick=${() => ctx.openOrganisms()}>${x('target.openOrganism', { org: row.title })}<//>` : null}
        <${Action} kind="text" onClick=${() => ctx.prefillGrant({ orgId: row.organism_id, wsId: row.workspaces[0]?.id || '', key: row.kind === 'key' ? row.pattern : '' })}>${x('target.grantMore')}<//>
        <${CopyAction} kind="text" text=${copy} label=${x('copyList')} />
      <//>
    <//><//>`;
}

/* ── 01: one person, when the list is turned by people ───────────────────────────────────────── */

export function personRow(ctx, p) {
  const open = ctx.openTarget === p.id;
  return html`
    <${ListRow} key=${p.id} name=${p.name} detail=${x('whoKind.' + p.kind)} onOpen=${() => ctx.toggleTarget(p.id)} selected=${!open && ctx.personFocus === p.name}
      value=${sinceValue(p.since, p.grants.length)}
      actions=${html`<${Action} kind="text" expanded=${open} onClick=${() => ctx.toggleTarget(p.id)}>${doorWord(open)}<//>`}>
      <${Text} kind="caption">${p.words}<//>
      ${open ? html`<${Surface} kind="record">
        <${Table} density="compact" collapse="640" label=${p.name}
          headers=${[x('col.target'), x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}
          rows=${p.grants.map((c) => grantCells(ctx, c, true))} />
      <//>` : null}
    <//>`;
}

/* ── 01: one revoked permission ──────────────────────────────────────────────────────────────── */

export function revokedRow(ctx, c) {
  const tw = targetWords(c.data_pattern, ctx.names);
  return html`
    <${ListRow} key=${c.id} muted name=${tw.title} detail=${tw.sub}
      value=${html`<${Stack} density="compact" align="end">
        <${Text} kind="mono">${spanWord(c.granted_at, c.revoked_at)}<//>
        <${Text} kind="caption" tone="muted">${x(c.status === 'expired' ? 'status.expired' : 'status.revoked')}<//>
      <//>`}>
      <${Text} kind="caption">${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}<//>
    <//>`;
}

/* ── 02: one group of the trail ──────────────────────────────────────────────────────────────── */

export const groupId = (g) => `${g.accessor_gaii}|${g.target?.kind}|${g.target?.organism_id || g.target?.key || ''}|${g.target?.rest || ''}|${g.action}|${g.allowed ? 1 : 0}`;

export function groupRow(ctx, g) {
  const id = groupId(g);
  const open = ctx.openGroup === id;
  const w = groupWords(g, ctx.names);
  const denied = w.outcome === 'denied';
  return html`
    <${ListRow} key=${id} name=${w.who.name} onOpen=${() => ctx.toggleGroup(id)}
      detail=${[w.who.sub, spanWord(g.first, g.last)].filter(Boolean).join(' · ')}
      value=${countValue(n(g.count), w.outcome, denied ? 'coral' : 'success')}
      actions=${html`<${Action} kind="text" expanded=${open} onClick=${() => ctx.toggleGroup(id)}>${doorWord(open)}<//>`}>
      <${Text} kind="caption">${w.what}${w.sub ? ` · ${w.sub}` : ''}<//>
      ${open ? groupOpen(ctx, g, id, w) : null}
    <//>`;
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
    <${Surface} kind="record"><${Stack}>
      <${Text}>${lead}<//>
      ${g.keys?.length ? html`
        <${Table} density="compact" collapse="560" label=${x('col.key')} headers=${[x('col.key'), x('col.what')]}
          rows=${g.keys.map((k) => { const kn = keyName(k); return [html`<${Stack} density="compact"><${Text}><strong>${kn.name}</strong><//>${kn.sub ? html`<${Text} kind="mono" tone="muted">${kn.sub}<//>` : null}<//>`, tg.rest ? restWords(tg.rest) : '']; })} />
        ${g.key_count > g.keys.length ? html`<${Text} kind="caption" tone="muted">${x('andMoreKeys', { n: g.key_count - g.keys.length })}<//>` : null}` : null}
      ${rows ? html`
        <${Text} kind="label">${x('group.rows', { n: n(rows.total) })}<//>
        <${Table} density="compact" collapse="560" label=${x('group.rows', { n: n(rows.total) })} headers=${[x('col.when'), x('col.key'), x('col.outcome')]}
          rows=${rows.entries.map((e) => [`${dateWord(e.timestamp)} ${timeWord(e.timestamp)}`, html`<${Text} kind="mono">${e.memory_key}<//>`, x(e.allowed ? 'outcome.allowed' : 'outcome.denied')])} />
        ${rows.entries.length < rows.total ? html`<${Stack} direction="horizontal" align="start">
          <${Action} disabled=${rows.loading} onClick=${() => ctx.loadGroupRows(g, id, true)}>${rows.loading ? x('loading') : x('group.moreRows', { n: n(rows.total - rows.entries.length) })}<//>
        <//>` : null}` : null}
      <${Stack} direction="wrap" density="compact">
        ${person && w.outcome === 'denied' ? html`<${Action} onClick=${() => ctx.prefillGrant({ who: g.accessor_gaii, orgId: tg.organism_id || '', wsId: tg.kind === 'ws' ? targetOf(g.keys?.[0] || '').workspace_id || '' : '', key: tg.kind === 'key' ? tg.key : '' })}>${x('group.grantTo', { who: w.who.name })}<//>` : null}
        ${person ? html`<${Action} kind="text" onClick=${() => ctx.showPerson(w.who.name)}>${x('group.seePermissions', { who: w.who.name })}<//>` : null}
        ${!rows ? html`<${Action} kind="text" onClick=${() => ctx.loadGroupRows(g, id, false)}>${x('group.showRows')}<//>` : null}
      <//>
    <//><//>`;
}

/* ── 02: one grant or revoke event ───────────────────────────────────────────────────────────── */

export function eventRow(ctx, ev) {
  const byYou = !ev.by || ev.by === ctx.session?.owner;
  const text = x(`event.${ev.kind}.${ev.role}`, { who: ev.who.name, target: `${ev.target.title} · ${ev.target.sub}` });
  return html`
    <${ListRow} key=${`${ev.kind}|${ev.consent.id}`} name=${byYou ? x('you') : ev.by} detail=${`${dateWord(ev.at)} ${timeWord(ev.at)}`}
      value=${countValue('1', ev.kind, 'success')}>
      <${Text} kind="caption">${text}<//>
    <//>`;
}
