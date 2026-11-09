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
 * @structure targetRow · targetOpen · personRow · foldedRow · revokedRow · bucketRow · bucketOpen ·
 *   groupRow · groupOpen · eventRow
 * @usage import { targetRow, bucketRow, eventRow } from './rows.js';
 * @version-history
 *   v1.13.0 — 2026-11-09 — Grouped by who: a person's row says how many places and in which role;
 *     the agents that reach one place each are one row (foldedRow); the trail is one row per day
 *     (bucketRow: today, yesterday, earlier) whose groups load when it opens, and a group's id and
 *     rows stay inside its day.
 *   v1.12.0 — 2026-09-26 — On the component kit (page group G7): every row, cell, opened panel, the
 *     grants and keys inside it and the access log are the List (components/List.js: Row, Name, Desc,
 *     Who, Num, When, Cell, Doors, Panel, More; the marked person is the selected Row); the counts
 *     are the Figure (components/Figure.js); the doors the Action; the row labels the Label; the
 *     revoked lines of a target a small List. The page writes no class.
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
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors, Panel, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Figure } from '/components/Figure.js';
import { LoadingLine } from '../shared.js';
import { x, n, whoOf, roleOf, roleWord, grantWords, grantsWord, groupWords, targetWords, targetOf, wsName, dateWord, timeWord, spanWord, restWords, accessorWords } from './frame.js';

const doorWord = (open) => (open ? x('close') : x('open'));
/** Lines under one another in a cell's small line. */
const lines = (parts) => {
  const on = parts.filter(Boolean);
  return on.length ? on.map((p, i) => html`${i ? html`<br />` : null}${p}`) : undefined;
};
/** The since-cell of a target or a person: the first date with its arrow, then how many grants. */
const sinceWords = (since, count) => html`${since ? `${dateWord(since)} →` : ''}<br />${grantsWord(count)}`;
/** The open / close door at a row's end. */
const toggleDoor = (open, onClick) => html`<${Doors}><${Action} small row onClick=${onClick}>${doorWord(open)}<//><//>`;

/* ── 01: one target ───────────────────────────────────────────────────────────────────────────── */

export function targetRow(ctx, row) {
  const open = ctx.openTarget === row.id;
  const toggle = () => ctx.toggleTarget(row.id);
  return html`
    <${Row} key=${row.id} open=${open}>
      <${Name} onOpen=${toggle} meta=${row.sub}>${row.title}<//>
      <${Desc}>${row.words}<//>
      <${When}>${sinceWords(row.since, row.grants.length)}<//>
      ${toggleDoor(open, toggle)}
      ${open ? targetOpen(ctx, row) : null}
    <//>`;
}

/** One grant as a row of the List; `lead` is the first cell (the workspace or the target), or null. */
function grantLine(ctx, c, lead) {
  const g = grantWords(c, ctx.names);
  const by = c.metadata?.grantedBy;
  const sub = lines([
    c.purpose && g.role === 'read' && c.purpose !== 'general' ? c.purpose : null,
    c.scope === 'federation' ? x('scope.federation') : null,
    c.expires ? x('untilDate', { date: dateWord(c.expires) }) : null,
  ]);
  return html`
    <${Row} key=${c.id}>
      ${lead}
      <${Who} sub=${sub}>${g.who.name} · ${roleWord(g.role)}<//>
      <${When}>${dateWord(c.granted_at)}<//>
      <${Cell} dim=${!by}>${by ? (by === ctx.session?.owner ? x('you') : by) : x('notRecorded')}<//>
      <${Doors}><${Action} small row soft tone="danger" disabled=${ctx.busy === c.id} onClick=${() => ctx.revoke(c)}>${ctx.busy === c.id ? x('revoking') : x('revoke')}<//><//>
    <//>`;
}

/** The target of a grant as the name cell of its row. */
function targetCell(ctx, c) {
  const tw = targetWords(c.data_pattern, ctx.names);
  return html`<${Name} meta=${tw.sub}>${tw.title}<//>`;
}

function targetOpen(ctx, row) {
  const lead = row.kind === 'org' ? x('target.leadOrg', { org: row.title, n: row.grants.length, ws: row.workspaces.filter((w) => w.id).length }) : x('target.leadKey', { key: row.pattern, n: row.grants.length });
  const copy = row.grants.map((c) => `${targetWords(c.data_pattern, ctx.names).title} · ${targetWords(c.data_pattern, ctx.names).sub}\t${whoOf(c.recipient, ctx.names).name}\t${roleWord(roleOf(c))}\t${c.granted_at}\t${c.id}`).join('\n');
  const revoked = row.revoked.slice(0, 5).map((c) => ({ key: c.id, words: `${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}${row.kind === 'org' ? ` · ${targetWords(c.data_pattern, ctx.names).sub}` : ''} · ${spanWord(c.granted_at, c.revoked_at)}` }));
  if (row.revoked.length > 5) revoked.push({ key: 'more', words: x('andMore', { n: row.revoked.length - 5 }) });
  const doors = html`
    ${row.kind === 'org' ? html`<${Action} small soft onClick=${() => ctx.openOrganisms()}>${x('target.openOrganism', { org: row.title })}<//>` : null}
    <${Action} small soft onClick=${() => ctx.prefillGrant({ orgId: row.organism_id, wsId: row.workspaces[0]?.id || '', key: row.kind === 'key' ? row.pattern : '' })}>${x('target.grantMore')}<//>
    <${Action} small soft copy=${copy}>${x('copyList')}<//>`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${lead} ${x('target.roles')}<//>
      ${row.kind === 'org' ? html`
        <${List} cols="name-who-when-by-doors" dense apart head=${[x('col.workspace'), x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}>
          ${row.workspaces.map((w) => w.grants.map((c, i) => grantLine(ctx, c, i === 0 ? html`<${Name}>${w.name}<//>` : html`<${Cell} />`)))}
        <//>` : html`
        <${List} cols="who-when-by-doors" dense apart head=${[x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}>
          ${row.grants.map((c) => grantLine(ctx, c, null))}
        <//>`}
      ${row.revoked.length ? html`
        <${Label} block>${x('target.revokedHere', { n: row.revoked.length })}<//>
        <${List} cols="name" small rows=${revoked} render=${(r) => html`<${Row} key=${r.key}><${Cell}>${r.words}<//><//>`} />` : null}
    <//>`;
}

/* ── 01: one person, when the list is turned by people ───────────────────────────────────────── */

export function personRow(ctx, p) {
  const open = ctx.openTarget === p.id;
  const toggle = () => ctx.toggleTarget(p.id);
  return html`
    <${Row} key=${p.id} open=${open} selected=${ctx.personFocus === p.name}>
      <${Name} onOpen=${toggle} meta=${x('whoKind.' + p.kind)}>${p.name}<//>
      <${Desc} sub=${p.words}>${`${p.places === 1 ? x('placeOne') : x('placesN', { n: p.places })} · ${p.roles.map(roleWord).join(' / ')}`}<//>
      <${When}>${sinceWords(p.since, p.grants.length)}<//>
      ${toggleDoor(open, toggle)}
      ${open ? html`
        <${Panel}>
          <${List} cols="name-who-when-by-doors" dense apart head=${[x('col.target'), x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}>
            ${p.grants.map((c) => grantLine(ctx, c, targetCell(ctx, c)))}
          <//>
        <//>` : null}
    <//>`;
}

/** The agents that reach one place each, as one row; opened, each agent's place with its revoke. */
export function foldedRow(ctx, list) {
  const id = 'p|folded';
  const open = ctx.openTarget === id;
  const toggle = () => ctx.toggleTarget(id);
  const grants = list.flatMap((p) => p.grants);
  const since = grants.reduce((m, c) => (!m || c.granted_at < m ? c.granted_at : m), null);
  const names = list.slice(0, 3).map((p) => whoShort(ctx, p.grants[0]?.recipient)).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
  return html`
    <${Row} key=${id} open=${open}>
      <${Name} onOpen=${toggle} meta=${x('whoKind.agent')}>${x('folded.title', { n: list.length })}<//>
      <${Desc} sub=${names}>${x('folded.sub')}<//>
      <${When}>${sinceWords(since, grants.length)}<//>
      ${toggleDoor(open, toggle)}
      ${open ? html`
        <${Panel}>
          <${List} cols="name-who-when-by-doors" dense apart head=${[x('col.target'), x('col.whoWhat'), x('col.since'), x('col.gaveBy'), '']}>
            ${grants.map((c) => grantLine(ctx, c, targetCell(ctx, c)))}
          <//>
        <//>` : null}
    <//>`;
}

/* ── 01: one revoked permission ──────────────────────────────────────────────────────────────── */

export function revokedRow(ctx, c) {
  const tw = targetWords(c.data_pattern, ctx.names);
  return html`
    <${Row} key=${c.id}>
      <${Name} meta=${tw.sub}>${tw.title}<//>
      <${Desc}>${whoOf(c.recipient, ctx.names).name} · ${roleWord(roleOf(c))}<//>
      <${When}>${spanWord(c.granted_at, c.revoked_at)}<br />${x(c.status === 'expired' ? 'status.expired' : 'status.revoked')}<//>
      <${Doors} />
    <//>`;
}

/* ── 03: one day of the trail ────────────────────────────────────────────────────────────────── */

/**
 * An accessor in one short phrase: the person; an agent of the reader's own by its name alone, and
 * another person's agent with its owner.
 */
const whoShort = (ctx, gaii) => {
  const s = String(gaii || '').replace(/^ghii:/, '');
  const hash = s.indexOf('#');
  if (hash <= 0) return accessorWords(gaii).name;
  const agent = s.slice(0, hash);
  const owner = s.slice(hash + 1).split('@')[0];
  return owner === ctx.session?.owner ? agent : x('who.agentOf', { name: agent, owner });
};
const WHO_SHOWN = 3;

/** Today, yesterday or earlier: who tried how often, the refusals, and the owner's own changes in it. */
export function bucketRow(ctx, b, events) {
  const open = ctx.openBucket === b.id;
  const toggle = () => ctx.toggleBucket(b);
  const top = b.who.slice(0, WHO_SHOWN);
  const words = top.map((w) => `${whoShort(ctx, w.accessor_gaii)} ${n(w.count)}`);
  const otherWho = b.accessor_total - top.length;
  if (otherWho > 0) words.push(x('bucket.others', { who: otherWho, n: n(b.count - top.reduce((s, w) => s + w.count, 0)) }));
  const times = [b.first, b.last, ...events.map((e) => e.at)].filter(Boolean).map((t) => new Date(t).toISOString()).sort();
  const figure = b.count
    ? { n: n(b.count), tone: b.denied ? 'notice' : 'fine', sub: b.denied ? x('bucket.refused', { n: n(b.denied) }) : x('outcome.allowed') }
    : { n: String(events.length), tone: 'fine', sub: x('bucket.changes') };
  return html`
    <${Row} key=${b.id} open=${open}>
      <${Name} onOpen=${toggle} meta=${b.id !== 'earlier' ? dateWord(b.from) : b.day_count === 1 ? x('bucket.dayOne') : x('bucket.days', { n: b.day_count })}>${x('bucket.' + b.id)}<//>
      <${Desc} sub=${events.length ? x('bucket.events', { n: events.length }) : undefined}>${words.join(' · ') || x('bucket.onlyChanges')}<//>
      <${Num}><${Figure} small end tone=${figure.tone} n=${figure.n} sub=${figure.sub} /><//>
      <${When}>${times.length ? spanWord(times[0], times[times.length - 1]) : ''}<//>
      ${toggleDoor(open, toggle)}
      ${open ? bucketOpen(ctx, b, events) : null}
    <//>`;
}

/** An opened day: the owner's own changes first, then the groups biggest first, a page at a time. */
function bucketOpen(ctx, b, events) {
  const st = ctx.bucketGroups[b.id];
  const groups = st?.groups || [];
  return html`
    <${Panel}>
      ${!st || (st.loading && !groups.length) ? html`<${LoadingLine} />` : st.failed ? html`<${Note} kind="quiet">${x('loadFailed')}<//>` : null}
      ${events.length || groups.length ? html`
        <${List} cols="name-desc-count-when-doors" dense apart head=${[x('col.who'), x('col.what'), { label: x('col.times'), num: true }, x('col.when'), '']}>
          ${events.map((e) => eventRow(ctx, e))}
          ${groups.map((g) => groupRow(ctx, g, b))}
        <//>` : null}
      ${st && groups.length < st.total ? html`<${More} disabled=${st.loading} label=${st.loading ? x('loading') : x('moreRows', { n: st.total - groups.length })}
        onMore=${() => ctx.loadBucketGroups(b, true)} />` : null}
    <//>`;
}

/* ── 03: one group of the trail ──────────────────────────────────────────────────────────────── */

export const groupId = (g) => `${g.accessor_gaii}|${g.target?.kind}|${g.target?.organism_id || g.target?.key || ''}|${g.target?.rest || ''}|${g.action}|${g.allowed ? 1 : 0}`;

/** One group; `bucket` is the day it was read in, so its id and its rows stay inside that day. */
export function groupRow(ctx, g, bucket) {
  const id = `${bucket?.id || ''}|${groupId(g)}`;
  const open = ctx.openGroup === id;
  const w = groupWords(g, ctx.names);
  const denied = w.outcome === 'denied';
  const toggle = () => ctx.toggleGroup(id);
  return html`
    <${Row} key=${id} open=${open}>
      <${Name} onOpen=${toggle} meta=${w.who.sub || undefined}>${w.who.name}<//>
      <${Desc} sub=${w.sub || undefined}>${w.what}<//>
      <${Num}><${Figure} small end tone=${denied ? 'notice' : 'fine'} n=${n(g.count)} sub=${x('outcome.' + w.outcome)} /><//>
      <${When}>${spanWord(g.first, g.last)}<//>
      ${toggleDoor(open, toggle)}
      ${open ? groupOpen(ctx, g, id, w, bucket) : null}
    <//>`;
}

function groupOpen(ctx, g, id, w, bucket) {
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
  const doors = html`
    ${person && w.outcome === 'denied' ? html`<${Action} small onClick=${() => ctx.prefillGrant({ who: g.accessor_gaii, orgId: tg.organism_id || '', wsId: tg.kind === 'ws' ? targetOf(g.keys?.[0] || '').workspace_id || '' : '', key: tg.kind === 'key' ? tg.key : '' })}>${x('group.grantTo', { who: w.who.name })}<//>` : null}
    ${person ? html`<${Action} small soft onClick=${() => ctx.showPerson(w.who.name)}>${x('group.seePermissions', { who: w.who.name })}<//>` : null}
    ${!rows ? html`<${Action} small soft onClick=${() => ctx.loadGroupRows(g, id, false, bucket)}>${x('group.showRows')}<//>` : null}`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${lead}<//>
      ${g.keys?.length ? html`
        <${List} cols="name-what" dense apart head=${[x('col.key'), x('col.what')]}>
          ${g.keys.map((k) => { const kn = keyName(k); return html`<${Row} key=${k}><${Name} meta=${kn.sub || undefined}>${kn.name}<//><${Cell}>${tg.rest ? restWords(tg.rest) : ''}<//><//>`; })}
        <//>
        ${g.key_count > g.keys.length ? html`<${Note} kind="hint">${x('andMoreKeys', { n: g.key_count - g.keys.length })}<//>` : null}` : null}
      ${rows ? html`
        <${Label} block>${x('group.rows', { n: n(rows.total) })}<//>
        <${List} cols="when-name-state" dense head=${[x('col.when'), x('col.key'), x('col.outcome')]}>
          ${rows.entries.map((e) => html`<${Row} key=${e.id}><${When}>${dateWord(e.timestamp)} ${timeWord(e.timestamp)}<//><${Cell}><${Code}>${e.memory_key}<//><//><${Cell}>${x(e.allowed ? 'outcome.allowed' : 'outcome.denied')}<//><//>`)}
        <//>
        ${rows.entries.length < rows.total ? html`<${More} disabled=${rows.loading} label=${rows.loading ? x('loading') : x('group.moreRows', { n: n(rows.total - rows.entries.length) })}
          onMore=${() => ctx.loadGroupRows(g, id, true, bucket)} />` : null}` : null}
    <//>`;
}

/* ── 03: one grant or revoke event ───────────────────────────────────────────────────────────── */

export function eventRow(ctx, ev) {
  const byYou = !ev.by || ev.by === ctx.session?.owner;
  const text = x(`event.${ev.kind}.${ev.role}`, { who: ev.who.name, target: `${ev.target.title} · ${ev.target.sub}` });
  return html`
    <${Row} key=${`${ev.kind}|${ev.consent.id}`}>
      <${Name}>${byYou ? x('you') : ev.by}<//>
      <${Desc}>${text}<//>
      <${Num}><${Figure} small end tone="fine" n="1" sub=${x('outcome.' + ev.kind)} /><//>
      <${When}>${dateWord(ev.at)} ${timeWord(ev.at)}<//>
      <${Doors} />
    <//>`;
}
