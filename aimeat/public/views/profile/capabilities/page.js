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
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, crumb, pageLinks, agentRule, openTab } from './frame.js';
import { providerRow, loadingRow } from './rows.js';
import { Hint } from '/components/Hint.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--filter ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<span class="poster-count poster-count--tally">${n}</span></button>`;
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
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
  const canCreate = ctx.policy && ctx.policy.publishing !== 'disabled';

  const strip = html`
    <div class="og-strip">
      <div><b>${groups ? members(ext) : '…'}</b><span>${x('stripActions')}</span><small>${groups ? x('stripActionsSub', { ext: ext.length, own: ext.filter((g) => g.own).length, others: ext.filter((g) => !g.own).length }) : ''}</small></div>
      <div><b>${groups ? members(app) : '…'}</b><span>${x('stripTools')}</span><small>${groups ? (app.length ? x('stripToolsSub', { apps: app.length }) : x('stripToolsNone')) : ''}</small></div>
      <div><b>${groups ? members(agent) : '…'}</b><span>${x('stripOffers')}</span><small>${groups ? (agent.length ? x('stripOffersSub', { agents: agent.length }) : x('stripOffersNone')) : ''}</small></div>
      <div><b>${groups ? other.length : '…'}</b><span>${x('stripOther')}</span><small>${ctx.policy ? (canCreate ? x('stripOtherOn') : x('stripOtherOff')) : ''}</small></div>
    </div>`;

  return html`
    <div class="og og-caps">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('capabilities.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="poster-chips">
            ${groups ? chip(x('chipCallable', { n: callable }), 'poster-chip--sun') : null}
            ${groups ? chip(x('chipProviders', { n: all.length })) : null}
            ${groups ? chip(x('chipCalls', { n: calls })) : null}
            ${groups ? chip(x('chipVouches', { n: vouches })) : null}
            ${none ? chip(x('chipNone'), 'poster-chip--coral') : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty') : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${agentRule(ctx.nodeUrl)} className="poster-slab" label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => openTab('extensions')}>${t('profile.tabs.extensions')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${shelf(ctx, 'ext', '01', x('secExt'), groups ? x('secExtSub', { actions: members(ext), ext: ext.length }) : null, ext, true)}
          ${shelf(ctx, 'app', '02', x('secApp'), groups ? x('secAppSub', { tools: members(app), apps: app.length }) : null, app, false)}
          ${shelf(ctx, 'agent', '03', x('secAgent'), groups ? x('secAgentSub', { offers: members(agent), agents: agent.length }) : null, agent, false)}
          ${secOther(ctx, '04', other, canCreate)}
          ${secAgent(ctx, '05', all, calls, vouches)}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${[['01', 'cp-ext', x('secExt'), groups ? ext.length : ''], ['02', 'cp-app', x('secApp'), groups ? app.length : ''], ['03', 'cp-agent', x('secAgent'), groups ? agent.length : ''], ['04', 'cp-other', x('secOther'), groups ? other.length : ''], ['05', 'cp-ai', x('secAi'), '']].map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
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
      ${!ctx.groups ? loadingRow() : !list.length ? html`<p class="poster-quiet cp-empty">${empty}</p>` : html`
        <div class="cp-facets">
          ${facet(!F.who && !F.use && !F.priced && !F.vouched, x('facetAll'), list.length, () => set({ who: '', use: '', priced: false, vouched: false }), 'all')}
          ${facet(F.who === 'own', x('facetOwn'), count((g) => g.own), () => tog('who', 'own'), 'own')}
          ${facet(F.who === 'others', x('facetOthers'), count((g) => !g.own), () => tog('who', 'others'), 'others')}
          ${facet(F.use === 'called', x('facetCalled'), count((g) => g.calls > 0), () => tog('use', 'called'), 'called')}
          ${facet(F.use === 'never', x('facetNever'), count((g) => g.calls === 0), () => tog('use', 'never'), 'never')}
          ${count((g) => g.priced) ? facet(!!F.priced, x('facetPriced'), count((g) => g.priced), () => set({ priced: !F.priced }), 'priced') : null}
          ${count((g) => g.vouches > 0) ? facet(!!F.vouched, x('facetVouched'), count((g) => g.vouches > 0), () => set({ vouched: !F.vouched }), 'vouched') : null}
        </div>
        <div class="search-line"><input class="og-input" type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} aria-label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="poster-quiet cp-empty">${x('noMatch')}</p>` : html`
          <div class="listing listing--name-desc-call-doors">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('col.' + key)}</div><div class="poster-label">${x('colGives')}</div><div class="poster-label">${x('colAgent')}</div><div class="poster-label"></div></div>
            ${shown.map((g) => providerRow(ctx, g))}
          </div>`}
        <div class="more-line">
          ${shown.length < rows.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <${Hint}>${x('hint.' + key)}<//>`}
    <//>`;
}

/* ── Hand-added and other: manual webhooks, ecosystem apps, the old action list; the form ──────── */

function secOther(ctx, num, other, canCreate) {
  const f = ctx.form;
  return html`
    <${PageSection} id="cp-other" num=${num} title=${x('secOther')} count=${ctx.groups ? x('secOtherSub', { n: other.length }) : null}>
      ${!ctx.groups ? loadingRow() : html`
        ${other.length ? html`<div class="listing listing--name-desc-call-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.other')}</div><div class="poster-label">${x('colGives')}</div><div class="poster-label">${x('colAgent')}</div><div class="poster-label"></div></div>
          ${other.map((g) => providerRow(ctx, g))}
        </div>` : html`<p class="poster-quiet cp-empty">${x('emptyOther')}</p>`}
        <div class="facts facts--wide">
          <div class="facts-k poster-label">${x('manualK')}</div><div class="facts-v">${x('manualBody')}<small>${canCreate ? x('manualOn') : x('manualOff', { policy: x('policy.' + (ctx.policy?.publishing || 'disabled')) })}</small></div>
          <div class="facts-k poster-label">${x('policyK')}</div><div class="facts-v">${x('policyBody', { publishing: x('policy.' + (ctx.policy?.publishing || 'disabled')), publishers: x('publishers.' + (ctx.policy?.publishers || 'all_users')), webhooks: x('webhooks.' + (ctx.policy?.webhooks || 'disabled')) })}<small>${x('policySub')}</small></div>
        </div>
        ${canCreate ? html`
          <button type="button" class="og-fold og-fold--toggle cp-fold" aria-expanded=${f.open ? 'true' : 'false'} onClick=${() => ctx.setForm({ open: !f.open })}><span>${x('addManual')}</span><span class="og-fold-r">${x('addManualSub')}</span><span class="og-fold-arrow">${f.open ? '↓' : '→'}</span></button>
          ${f.open ? html`
            <div class="cp-form">
              <label class="cp-field"><span class="poster-label">${x('formName')}</span><input class="og-input" value=${f.name} onInput=${(e) => ctx.setForm({ name: e.target.value })} /></label>
              <label class="cp-field"><span class="poster-label">${x('formWebhook')}</span><input class="og-input" placeholder="https://" value=${f.webhookUrl} onInput=${(e) => ctx.setForm({ webhookUrl: e.target.value })} /></label>
              <label class="cp-field cp-field--wide"><span class="poster-label">${x('formSummary')}</span><textarea class="og-textarea" rows="2" value=${f.summary} onInput=${(e) => ctx.setForm({ summary: e.target.value })}></textarea></label>
              <label class="cp-field"><span class="poster-label">${x('formTags')}</span><input class="og-input" value=${f.tags} onInput=${(e) => ctx.setForm({ tags: e.target.value })} /></label>
              <label class="cp-field cp-check check-line"><input type="checkbox" checked=${f.visibility === 'public'} onChange=${(e) => ctx.setForm({ visibility: e.target.checked ? 'public' : 'private' })} /> ${x('formPublic')}</label>
              <div class="cp-field--wide cp-form-doors"><span class="poster-hint">${x('formHint')}</span><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'create' || !f.name.trim()} onClick=${() => ctx.createManual()}>${x('formCreate')}</button></div>
            </div>` : null}` : null}`}
    <//>`;
}

/* ── How an agent finds and calls ─────────────────────────────────────────────────────────────── */

function secAgent(ctx, num, all, calls, vouches) {
  return html`
    <${PageSection} id="cp-ai" num=${num} title=${x('secAi')} count=${null}>
      <p class="og-lead">${x('aiIntro')}</p>
      <div class="cp-rule poster-box">
        <span class="poster-label">${x('ruleLabel')}</span>
        <p class="og-lead">${x('ruleBody', { base: ctx.nodeUrl })}</p>
        <div class="og-doors"><${CopyButton} text=${agentRule(ctx.nodeUrl)} className="poster-action poster-action--small" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="facts facts--wide">
        <div class="facts-k poster-label">${x('aiWhoK')}</div><div class="facts-v">${x('aiWhoBody')}</div>
        <div class="facts-k poster-label">${x('aiTrustK')}</div><div class="facts-v">${x('aiTrustBody')}<small>${vouches ? x('aiTrustSub', { n: vouches }) : x('aiTrustNone')}</small></div>
        <div class="facts-k poster-label">${x('aiCallsK')}</div><div class="facts-v">${ctx.policy?.call_counting ? x('aiCallsOn', { n: calls }) : x('aiCallsOff', { n: calls })}</div>
        <div class="facts-k poster-label">${x('aiTwoK')}</div><div class="facts-v">${x('aiTwoBody')}</div>
      </div>
    <//>`;
}
