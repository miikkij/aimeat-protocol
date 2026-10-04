/**
 * @file public/views/profile/packages/sheet.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package's "what you get" sheet on its opened row, and the settings its install asks
 *   (guided journey P3). The sheet is the server's (GET /v1/packages/:group `sheet`,
 *   services/package-sheet.ts), so the page and the person's AI read the same thing: what it gives,
 *   what to ask their AI, what data its apps keep and where it goes, which agents come with it, what
 *   runs on its own and which guides their AI gets. Composed from Note and Facts; writes no class.
 * @structure sheetBlock(ctx, o) · asksBlock(ctx, o, key) · appApprovalBlock(ctx, o, key, own) · missingAsks
 * @usage ${sheetBlock(ctx, o)} … ${asksBlock(ctx, o, key)}
 * @version-history
 *   v1.2.0 — 2026-10-04 — appApprovalBlock: what the apps ask for, and the check that approves them
 *     at install for someone else's package (`grant_apps`); the owner's own package only says so.
 *   v1.1.0 — 2026-10-02 — The tools the apps offer to agents, as the package carries them (no prices).
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { t } from '/js/i18n.js';
import { areaLine } from '/js/consent-vocab.js';
import { x } from './frame.js';

const html = htm.bind(h);
const lines = (items) => html`${items.map((s, i) => html`<div key=${i}>${s}</div>`)}`;

/** What the package gives, in the facts a person decides on. Null until the sheet has been read. */
export function sheetBlock(ctx, o) {
  const s = ctx.sheets?.[o.group];
  if (s === undefined || s === false) return null;
  if (s === null) return html`<${Note} kind="meta">${x('sheetLoading')}<//>`;
  const data = [
    ...(s.data ?? []).map((d) => `${d.app}: ${d.what || x('sheetDataNoWhat')}${d.leaves?.length ? ' ' + x('sheetDataLeaves', { list: d.leaves.map((l) => l.to).join('; ') }) : ''}`),
    ...(s.dataUnmapped ?? []).map((app) => x('sheetDataUnmapped', { app })),
  ];
  const rows = [
    s.prompts?.length && { k: x('sheetAskK'), v: lines(s.prompts), sub: x('sheetAskSub') },
    data.length && { k: x('sheetDataK'), v: lines(data) },
    s.agents?.length && { k: x('sheetAgentsK'), v: lines(s.agents.map((a) => `${a.name} (${a.app})${a.purpose ? ': ' + a.purpose : ''}`)), sub: x('sheetAgentsSub') },
    s.tools?.length && { k: x('sheetToolsK'), v: lines(s.tools.map((t) => `${t.name} (${t.app})${t.description ? ': ' + t.description : ''}`)), sub: x('sheetToolsSub') },
    s.runsOnItsOwn?.length && { k: x('sheetRunsK'), v: lines(s.runsOnItsOwn.map((r) => `${r.component}: ${r.what}${r.when ? ` (${r.when})` : ''}`)), sub: x('sheetRunsSub') },
    s.guides?.length && { k: x('sheetGuidesK'), v: s.guides.join(', '), sub: x('sheetGuidesSub') },
  ].filter(Boolean);
  return html`
    ${s.outcome ? html`<${Note} kind="lead">${s.outcome}<//>` : null}
    ${rows.length ? html`<${Facts} rows=${rows} />` : null}`;
}

/** The settings the install asks, as fields; what is typed goes with the install as `config`. */
export function asksBlock(ctx, o, key) {
  const s = ctx.sheets?.[o.group];
  const asks = s && s.asks ? s.asks : [];
  if (!asks.length) return null;
  const values = ctx.installConfig?.[key] || {};
  // The part's name goes in front only when more than one part asks, so one app's fields read plainly.
  const many = new Set(asks.map((a) => a.componentId)).size > 1;
  return { k: x('sheetAsksK'), sub: x('sheetAsksSub'), v: html`${asks.map((a) => html`
    <${TextField} key=${a.componentId + '.' + a.field} secret=${a.secret}
      label=${`${many ? a.component + ': ' : ''}${a.title || a.field}${a.required ? ' *' : ''}`}
      hint=${a.description || (a.default ? x('sheetAsksDefault', { value: a.default }) : '')}
      value=${(values[a.componentId] || {})[a.field] ?? ''}
      placeholder=${a.default || ''}
      onInput=${(v) => ctx.setConfigValue(key, a.componentId, a.field, v)} />`)}` };
}

/**
 * What the package's apps ask for, and the owner's choice about it (Jouni, 2026-10-04: installing it
 * is approving it; for someone else's package the person sees what the apps need and chooses). Your
 * own package's apps are approved at install, so it only says so. Someone else's: a check, off by
 * default; ticked, the install approves the apps (`grant_apps`), otherwise each app asks on its
 * first visit. Null when the package has no apps or the sheet has not been read.
 */
export function appApprovalBlock(ctx, o, key, own) {
  const access = ctx.sheets?.[o.group]?.appAccess ?? [];
  if (!access.length) return null;
  const list = lines(access.map((a) => `${a.app}: ${areaLine(a.scopes, t) || a.scopes.join(', ')}`));
  if (own) return { k: x('appsApproveK'), v: list, sub: x('appsApproveOwn') };
  return { k: x('appsApproveK'), v: html`${list}
    <${Check} checked=${!!ctx.grantApps?.[key]} onChange=${(on) => ctx.setGrantApps(key, on)} hint=${x('appsApproveHint')}>${x('appsApproveCheck')}<//>` };
}

/** The required settings still empty, by their title: the install is not sent until they are filled. */
export function missingAsks(ctx, o, key) {
  const asks = ctx.sheets?.[o.group]?.asks ?? [];
  const values = ctx.installConfig?.[key] || {};
  return asks.filter((a) => a.required && !String((values[a.componentId] || {})[a.field] ?? '').trim())
    .map((a) => a.title || a.field);
}
