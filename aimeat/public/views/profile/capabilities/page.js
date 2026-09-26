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
 *   v1.19.0 -- 2026-09-26 -- On the component kit (page group G7): the frame is the SettingsPage (crumb, head with its tags as data, the loud copy, the rail's sections and sibling pages), the strip the FigureStrip, a shelf's filters, search line, rows and more line the List, the hand-added form the FoldRow over the Fields, the rule an AI gets the Box, the facts the Facts. The vouches tag counts nothing yet in the dim tone again (main's og-chip--dim). The page writes no class.
 *   v1.18.0 -- 2026-09-26 -- "Public" beside its check box is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-25 -- A filter's count is the Count (.poster-count, tally), a unification: Jouni's decision "Count".
 *   v1.14.0 -- 2026-09-25 -- The line under the list (show more, how many shown) is the More line (.more-line, css/components/more-line.css), a library part by a move.
 *   v1.13.0 -- 2026-09-25 -- The hand-added facts and the AI section facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-25 -- The row that opens the manual form is the folded row (og-fold og-fold--toggle, its arrow at the right), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- The shelves are the Listing (listing, listing-row, its head row), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { x, crumb, pageLinks, agentRule, openTab } from './frame.js';
import { providerRow, loadingRow } from './rows.js';
import { Hint } from '/components/Hint.js';
import { Note } from '/components/Note.js';
import { Label } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { List, Filters, Filter, SearchLine, More } from '/components/List.js';
import { FoldRow } from '/components/Folds.js';
import { Space } from '/components/Layout.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Check } from '/components/Check.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
const head = (key) => [x('col.' + key), x('colGives'), x('colAgent'), ''];
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

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

  const strip = html`<${FigureStrip} items=${[
    { n: groups ? members(ext) : '…', label: x('stripActions'), sub: groups ? x('stripActionsSub', { ext: ext.length, own: ext.filter((g) => g.own).length, others: ext.filter((g) => !g.own).length }) : '' },
    { n: groups ? members(app) : '…', label: x('stripTools'), sub: groups ? (app.length ? x('stripToolsSub', { apps: app.length }) : x('stripToolsNone')) : '' },
    { n: groups ? members(agent) : '…', label: x('stripOffers'), sub: groups ? (agent.length ? x('stripOffersSub', { agents: agent.length }) : x('stripOffersNone')) : '' },
    { n: groups ? other.length : '…', label: x('stripOther'), sub: ctx.policy ? (canCreate ? x('stripOtherOn') : x('stripOtherOff')) : '' },
  ]} />`;

  const marks = groups ? [
    { label: x('chipCallable', { n: callable }), tone: 'sun' },
    { label: x('chipProviders', { n: all.length }) },
    { label: x('chipCalls', { n: calls }) },
    { label: x('chipVouches', { n: vouches }), tone: vouches ? undefined : 'dim' },
    none ? { label: x('chipNone'), tone: 'coral' } : null,
  ] : [];
  const actions = html`
    <${Loud} copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))}>${x('copyRule')}<//>
    <${Actions}><${Action} small onClick=${() => openTab('extensions')}>${t('profile.tabs.extensions')}<//><//>`;
  const sections = [
    { id: 'cp-ext', num: '01', label: x('secExt'), count: groups ? ext.length : '' },
    { id: 'cp-app', num: '02', label: x('secApp'), count: groups ? app.length : '' },
    { id: 'cp-agent', num: '03', label: x('secAgent'), count: groups ? agent.length : '' },
    { id: 'cp-other', num: '04', label: x('secOther'), count: groups ? other.length : '' },
    { id: 'cp-ai', num: '05', label: x('secAi') },
  ];

  return html`
    <${SettingsPage} name="caps" crumb=${crumb()} title=${t('capabilities.tabLabel')} sub=${x('titleSub')} marks=${marks}
      desc=${none ? x('descEmpty') : x('desc')} actions=${actions} strip=${strip}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${shelf(ctx, 'ext', '01', x('secExt'), groups ? x('secExtSub', { actions: members(ext), ext: ext.length }) : null, ext, true)}
      ${shelf(ctx, 'app', '02', x('secApp'), groups ? x('secAppSub', { tools: members(app), apps: app.length }) : null, app, false)}
      ${shelf(ctx, 'agent', '03', x('secAgent'), groups ? x('secAgentSub', { offers: members(agent), agents: agent.length }) : null, agent, false)}
      ${secOther(ctx, '04', other, canCreate)}
      ${secAgent(ctx, '05', all, calls, vouches)}
    <//>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, num, title, sub, list, first) {
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
    <${PageSection} id=${ids[key]} num=${num} title=${title} count=${sub} first=${first}>
      ${!ctx.groups ? loadingRow() : !list.length ? html`<${Note} kind="quiet">${empty}<//>` : html`
        <${Filters}>
          ${facet(!F.who && !F.use && !F.priced && !F.vouched, x('facetAll'), list.length, () => set({ who: '', use: '', priced: false, vouched: false }), 'all')}
          ${facet(F.who === 'own', x('facetOwn'), count((g) => g.own), () => tog('who', 'own'), 'own')}
          ${facet(F.who === 'others', x('facetOthers'), count((g) => !g.own), () => tog('who', 'others'), 'others')}
          ${facet(F.use === 'called', x('facetCalled'), count((g) => g.calls > 0), () => tog('use', 'called'), 'called')}
          ${facet(F.use === 'never', x('facetNever'), count((g) => g.calls === 0), () => tog('use', 'never'), 'never')}
          ${count((g) => g.priced) ? facet(!!F.priced, x('facetPriced'), count((g) => g.priced), () => set({ priced: !F.priced }), 'priced') : null}
          ${count((g) => g.vouches > 0) ? facet(!!F.vouched, x('facetVouched'), count((g) => g.vouches > 0), () => set({ vouched: !F.vouched }), 'vouched') : null}
        <//>
        <${SearchLine} value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} note=${x('searchOrder')} />
        <${List} cols="name-desc-call-doors" head=${head(key)} empty=${x('noMatch')}>
          ${shown.map((g) => providerRow(ctx, g))}
        <//>
        <${More} note=${x('shownOf', { shown: shown.length, total: rows.length })}
          label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
          onMore=${shown.length < rows.length ? () => ctx.setShown(key, ctx.shown[key] + PAGE) : null} />
        <${Hint}>${x('hint.' + key)}<//>`}
    <//>`;
}

/* ── Hand-added and other: manual webhooks, ecosystem apps, the old action list; the form ──────── */

function secOther(ctx, num, other, canCreate) {
  const f = ctx.form;
  return html`
    <${PageSection} id="cp-other" num=${num} title=${x('secOther')} count=${ctx.groups ? x('secOtherSub', { n: other.length }) : null}>
      ${!ctx.groups ? loadingRow() : html`
        <${List} cols="name-desc-call-doors" head=${head('other')} empty=${x('emptyOther')}>
          ${other.map((g) => providerRow(ctx, g))}
        <//>
        <${Facts} wide rows=${[
          { k: x('manualK'), v: x('manualBody'), sub: canCreate ? x('manualOn') : x('manualOff', { policy: x('policy.' + (ctx.policy?.publishing || 'disabled')) }) },
          { k: x('policyK'), v: x('policyBody', { publishing: x('policy.' + (ctx.policy?.publishing || 'disabled')), publishers: x('publishers.' + (ctx.policy?.publishers || 'all_users')), webhooks: x('webhooks.' + (ctx.policy?.webhooks || 'disabled')) }), sub: x('policySub') },
        ]} />
        ${canCreate ? html`
          <${Space} above="large">
            <${FoldRow} kind="toggle" name=${x('addManual')} right=${x('addManualSub')} open=${!!f.open} onClick=${() => ctx.setForm({ open: !f.open })} />
          <//>
          ${f.open ? html`
            <${Space} above="large">
              <${Fields} cols=${2}>
                <${TextField} label=${x('formName')} value=${f.name} onInput=${(name) => ctx.setForm({ name })} />
                <${TextField} label=${x('formWebhook')} placeholder="https://" value=${f.webhookUrl} onInput=${(webhookUrl) => ctx.setForm({ webhookUrl })} />
                <${TextArea} wide label=${x('formSummary')} rows=${2} value=${f.summary} onInput=${(summary) => ctx.setForm({ summary })} />
                <${TextField} label=${x('formTags')} value=${f.tags} onInput=${(tags) => ctx.setForm({ tags })} />
                <${Check} checked=${f.visibility === 'public'} onChange=${(on) => ctx.setForm({ visibility: on ? 'public' : 'private' })}>${x('formPublic')}<//>
              <//>
              <${FormActions} apart>
                <${Note} inline>${x('formHint')}<//>
                <${Action} small disabled=${ctx.busy === 'create' || !f.name.trim()} onClick=${() => ctx.createManual()}>${x('formCreate')}<//>
              <//>
            <//>` : null}` : null}`}
    <//>`;
}

/* ── How an agent finds and calls ─────────────────────────────────────────────────────────────── */

function secAgent(ctx, num, all, calls, vouches) {
  return html`
    <${PageSection} id="cp-ai" num=${num} title=${x('secAi')} count=${null}>
      <${Note} kind="lead">${x('aiIntro')}<//>
      <${Box} doors=${html`<${Action} small copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')}>${x('copyRule')}<//>`}>
        <${Label} block>${x('ruleLabel')}<//>
        <${Note} kind="lead">${x('ruleBody', { base: ctx.nodeUrl })}<//>
      <//>
      <${Facts} wide rows=${[
        { k: x('aiWhoK'), v: x('aiWhoBody') },
        { k: x('aiTrustK'), v: x('aiTrustBody'), sub: vouches ? x('aiTrustSub', { n: vouches }) : x('aiTrustNone') },
        { k: x('aiCallsK'), v: ctx.policy?.call_counting ? x('aiCallsOn', { n: calls }) : x('aiCallsOff', { n: calls }) },
        { k: x('aiTwoK'), v: x('aiTwoBody') },
      ]} />
    <//>`;
}
