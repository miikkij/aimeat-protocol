/**
 * @file public/views/profile/capabilities/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Capabilities page in the poster face: the agent's view of this node. The mast and
 *   the strip; four shelves as rows grouped by provider (extension actions, app tools, agent offers,
 *   hand-added and other), each with a filter row and a search; the hand-added form when the policy
 *   allows it; and the section that says how an agent finds and calls. What opens under a row is
 *   rows.js. Pure render over the ctx bag.
 * @structure renderPage · shelf · secOther · secAgent
 * @usage import { renderPage } from './capabilities/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, a plain NumeralBand strip,
 *     Toolbar filters for the facets, Field for the search and the hand-added form, Fold for the
 *     form, a Surface box for the agent's rule and KeyValue for the policy; no own CSS. The
 *     shelves' column heads are gone: each row says what it is.
 *   v1.2.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Stack, Columns, NumeralBand, Toolbar, Field, KeyValue, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { x, crumb, pageLinks, agentRule, openTab } from './frame.js';
import { providerRow, loadingRow } from './rows.js';

const PAGE = 20;
/** A facet: a filter tab with its count. */
const facet = (id, on, label, n, onClick) => ({ id, selected: on, label: `${label} ${n}`, onClick });
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
/** A KeyValue whose value is a body and a quieter note under it. */
const kv = (label, body, note) => html`<${KeyValue} label=${label}>
  <${Stack} density="compact"><span>${body}</span>${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}<//>
<//>`;

export function renderPage(ctx) {
  const groups = ctx.groups;   // null while loading
  const all = groups || [];
  const ext = all.filter((g) => g.shelf === 'ext');
  const app = all.filter((g) => g.shelf === 'app');
  const agent = all.filter((g) => g.shelf === 'agent');
  const other = all.filter((g) => g.shelf === 'other');
  const members = (list) => list.reduce((s, g) => s + g.members.length, 0);
  const callable = all.reduce((s, g) => s + g.members.filter((m) => m.callable).length, 0);
  const calls = all.reduce((s, g) => s + g.calls, 0);
  const vouches = all.reduce((s, g) => s + g.vouches, 0);
  const own = all.filter((g) => g.own);
  const none = groups && own.length === 0;
  const canCreate = ctx.policy && ctx.policy.publishing !== 'disabled';

  const strip = html`<${NumeralBand} tone="plain" items=${[
    { label: x('stripActions'), value: groups ? members(ext) : '…', note: groups ? x('stripActionsSub', { ext: ext.length, own: ext.filter((g) => g.own).length, others: ext.filter((g) => !g.own).length }) : '' },
    { label: x('stripTools'), value: groups ? members(app) : '…', note: groups ? (app.length ? x('stripToolsSub', { apps: app.length }) : x('stripToolsNone')) : '' },
    { label: x('stripOffers'), value: groups ? members(agent) : '…', note: groups ? (agent.length ? x('stripOffersSub', { agents: agent.length }) : x('stripOffersNone')) : '' },
    { label: x('stripOther'), value: groups ? other.length : '…', note: ctx.policy ? (canCreate ? x('stripOtherOn') : x('stripOtherOff')) : '' },
  ]} />`;

  const identity = html`<${Stack} density="compact">
    <${Text} kind="label">${x('titleSub')}<//>
    ${groups ? html`<${Stack} direction="wrap" density="compact">
      <${Chip} tone="sun">${x('chipCallable', { n: callable })}<//>
      <${Chip}>${x('chipProviders', { n: all.length })}<//>
      <${Chip}>${x('chipCalls', { n: calls })}<//>
      <${Chip} tone=${vouches ? 'plain' : 'muted'}>${x('chipVouches', { n: vouches })}<//>
      ${none ? html`<${Chip} tone="coral">${x('chipNone')}<//>` : null}
    <//>` : null}
  <//>`;
  const actions = html`<${CopyAction} kind="primary" text=${agentRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
    <${Action} onClick=${() => openTab('extensions')}>${t('profile.tabs.extensions')}<//>`;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#cp-ext', label: x('secExt'), count: groups ? ext.length : undefined },
    { href: '#cp-app', label: x('secApp'), count: groups ? app.length : undefined },
    { href: '#cp-agent', label: x('secAgent'), count: groups ? agent.length : undefined },
    { href: '#cp-other', label: x('secOther'), count: groups ? other.length : undefined },
    { href: '#cp-ai', label: x('secAi') },
  ]}>${pageLinks()}<//>`;

  return html`<${Page} width="wide" title=${t('capabilities.tabLabel')} crumbs=${crumb()} identity=${identity} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${none ? x('descEmpty') : x('desc')}<//>
      ${strip}
      ${shelf(ctx, 'ext', x('secExt'), groups ? x('secExtSub', { actions: members(ext), ext: ext.length }) : null, ext)}
      ${shelf(ctx, 'app', x('secApp'), groups ? x('secAppSub', { tools: members(app), apps: app.length }) : null, app)}
      ${shelf(ctx, 'agent', x('secAgent'), groups ? x('secAgentSub', { offers: members(agent), agents: agent.length }) : null, agent)}
      ${secOther(ctx, other, canCreate)}
      ${secAgent(ctx, calls, vouches)}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, title, sub, list) {
  const F = ctx.filters[key];
  const q = (ctx.queries[key] || '').trim().toLowerCase();
  const count = (f) => list.filter(f).length;
  let rows = list;
  if (F.who === 'own') rows = rows.filter((g) => g.own);
  if (F.who === 'others') rows = rows.filter((g) => !g.own);
  if (F.use === 'called') rows = rows.filter((g) => g.calls > 0);
  if (F.use === 'never') rows = rows.filter((g) => g.calls === 0);
  if (F.priced) rows = rows.filter((g) => g.priced);
  if (F.vouched) rows = rows.filter((g) => g.vouches > 0);
  if (q) rows = rows.filter((g) => matches(q, g.name, g.summary, g.members.map((m) => m.member + ' ' + (m.summary || '')).join(' ')));
  rows = rows.slice().sort((a, b) => (b.own - a.own) || (b.calls - a.calls) || a.name.localeCompare(b.name));
  const shown = rows.slice(0, ctx.shown[key]);
  const set = (patch) => ctx.setFilter(key, patch);
  const tog = (field, value) => set({ [field]: F[field] === value ? '' : value });
  const ids = { ext: 'cp-ext', app: 'cp-app', agent: 'cp-agent' };
  const empty = key === 'ext' ? x('emptyExt') : key === 'app' ? x('emptyApp') : x('emptyAgent');
  return html`
    <${Section} id=${ids[key]} title=${title} count=${sub}>
      ${!ctx.groups ? loadingRow() : !list.length ? html`<${Text} tone="muted">${empty}<//>` : html`
        <${Stack}>
          <${Toolbar} filters=${[
            facet('all', !F.who && !F.use && !F.priced && !F.vouched, x('facetAll'), list.length, () => set({ who: '', use: '', priced: false, vouched: false })),
            facet('own', F.who === 'own', x('facetOwn'), count((g) => g.own), () => tog('who', 'own')),
            facet('others', F.who === 'others', x('facetOthers'), count((g) => !g.own), () => tog('who', 'others')),
            facet('called', F.use === 'called', x('facetCalled'), count((g) => g.calls > 0), () => tog('use', 'called')),
            facet('never', F.use === 'never', x('facetNever'), count((g) => g.calls === 0), () => tog('use', 'never')),
            ...(count((g) => g.priced) ? [facet('priced', !!F.priced, x('facetPriced'), count((g) => g.priced), () => set({ priced: !F.priced }))] : []),
            ...(count((g) => g.vouches > 0) ? [facet('vouched', !!F.vouched, x('facetVouched'), count((g) => g.vouches > 0), () => set({ vouched: !F.vouched }))] : []),
          ]} />
          <${Stack} density="compact">
            <${Field} type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} ariaLabel=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} />
            <${Text} kind="caption" tone="muted">${x('searchOrder')}<//>
          <//>
          ${!rows.length ? html`<${Text} tone="muted">${x('noMatch')}<//>` : html`
            <${Stack} density="compact">${shown.map((g) => providerRow(ctx, g))}<//>`}
          <${Stack} direction="horizontal" align="between">
            ${shown.length < rows.length ? html`<${Action} onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}<//>` : html`<span></span>`}
            <${Text} kind="mono" tone="muted">${x('shownOf', { shown: shown.length, total: rows.length })}<//>
          <//>
          <${Text} kind="caption" tone="muted">${x('hint.' + key)}<//>
        <//>`}
    <//>`;
}

/* ── Hand-added and other: manual webhooks, ecosystem apps, the old action list; the form ──────── */

function secOther(ctx, other, canCreate) {
  const f = ctx.form;
  return html`
    <${Section} id="cp-other" title=${x('secOther')} count=${ctx.groups ? x('secOtherSub', { n: other.length }) : null}>
      ${!ctx.groups ? loadingRow() : html`
        <${Stack}>
          ${other.length ? html`<${Stack} density="compact">${other.map((g) => providerRow(ctx, g))}<//>` : html`<${Text} tone="muted">${x('emptyOther')}<//>`}
          <div>
            ${kv(x('manualK'), x('manualBody'), canCreate ? x('manualOn') : x('manualOff', { policy: x('policy.' + (ctx.policy?.publishing || 'disabled')) }))}
            ${kv(x('policyK'), x('policyBody', { publishing: x('policy.' + (ctx.policy?.publishing || 'disabled')), publishers: x('publishers.' + (ctx.policy?.publishers || 'all_users')), webhooks: x('webhooks.' + (ctx.policy?.webhooks || 'disabled')) }), x('policySub'))}
          </div>
          ${canCreate ? html`
            <${Fold} title=${x('addManual')} sub=${x('addManualSub')} open=${f.open} onToggle=${() => ctx.setForm({ open: !f.open })}>
              <${Stack}>
                <${Columns} collapse=${640}>
                  <${Field} label=${x('formName')} value=${f.name} onInput=${(e) => ctx.setForm({ name: e.target.value })} />
                  <${Field} label=${x('formWebhook')} placeholder="https://" value=${f.webhookUrl} onInput=${(e) => ctx.setForm({ webhookUrl: e.target.value })} />
                <//>
                <${Field} type="textarea" label=${x('formSummary')} rows=${2} value=${f.summary} onInput=${(e) => ctx.setForm({ summary: e.target.value })} />
                <${Columns} collapse=${640}>
                  <${Field} label=${x('formTags')} value=${f.tags} onInput=${(e) => ctx.setForm({ tags: e.target.value })} />
                  <${Field} type="checkbox" label=${x('formPublic')} value=${f.visibility === 'public'} onChange=${(e) => ctx.setForm({ visibility: e.target.checked ? 'public' : 'private' })} />
                <//>
                <${Stack} direction="horizontal" align="between">
                  <${Text} kind="caption" tone="muted">${x('formHint')}<//>
                  <${Action} disabled=${ctx.busy === 'create' || !f.name.trim()} onClick=${() => ctx.createManual()}>${x('formCreate')}<//>
                <//>
              <//>
            <//>` : null}
        <//>`}
    <//>`;
}

/* ── How an agent finds and calls ─────────────────────────────────────────────────────────────── */

function secAgent(ctx, calls, vouches) {
  return html`
    <${Section} id="cp-ai" title=${x('secAi')}>
      <${Stack}>
        <${Text}>${x('aiIntro')}<//>
        <${Surface} kind="box">
          <${Stack} density="compact">
            <${Text} kind="label">${x('ruleLabel')}<//>
            <${Text}>${x('ruleBody', { base: ctx.nodeUrl })}<//>
            <${Stack} direction="horizontal" align="start"><${CopyAction} text=${agentRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} /><//>
          <//>
        <//>
        <div>
          ${kv(x('aiWhoK'), x('aiWhoBody'))}
          ${kv(x('aiTrustK'), x('aiTrustBody'), vouches ? x('aiTrustSub', { n: vouches }) : x('aiTrustNone'))}
          ${kv(x('aiCallsK'), ctx.policy?.call_counting ? x('aiCallsOn', { n: calls }) : x('aiCallsOff', { n: calls }))}
          ${kv(x('aiTwoK'), x('aiTwoBody'))}
        </div>
      <//>
    <//>`;
}
