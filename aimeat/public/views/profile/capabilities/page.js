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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, crumb, pageLinks, agentRule, openTab } from './frame.js';
import { providerRow, loadingRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`cp-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
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
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
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
          <h1 class="og-title">${t('capabilities.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="og-chips">
            ${groups ? chip(x('chipCallable', { n: callable }), 'og-chip--sun') : null}
            ${groups ? chip(x('chipProviders', { n: all.length })) : null}
            ${groups ? chip(x('chipCalls', { n: calls })) : null}
            ${groups ? chip(x('chipVouches', { n: vouches }), vouches ? '' : 'og-chip--dim') : null}
            ${none ? chip(x('chipNone'), 'og-chip--coral') : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty') : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${agentRule(ctx.nodeUrl)} className="og-slab" label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => openTab('extensions')}>${t('profile.tabs.extensions')}</button></div>
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
    <${Section} id=${ids[key]} num=${num} title=${title} count=${sub} first=${first}>
      ${!ctx.groups ? loadingRow() : !list.length ? html`<p class="cp-empty">${empty}</p>` : html`
        <div class="cp-facets">
          ${facet(!F.who && !F.use && !F.priced && !F.vouched, x('facetAll'), list.length, () => set({ who: '', use: '', priced: false, vouched: false }), 'all')}
          ${facet(F.who === 'own', x('facetOwn'), count((g) => g.own), () => tog('who', 'own'), 'own')}
          ${facet(F.who === 'others', x('facetOthers'), count((g) => !g.own), () => tog('who', 'others'), 'others')}
          ${facet(F.use === 'called', x('facetCalled'), count((g) => g.calls > 0), () => tog('use', 'called'), 'called')}
          ${facet(F.use === 'never', x('facetNever'), count((g) => g.calls === 0), () => tog('use', 'never'), 'never')}
          ${count((g) => g.priced) ? facet(!!F.priced, x('facetPriced'), count((g) => g.priced), () => set({ priced: !F.priced }), 'priced') : null}
          ${count((g) => g.vouches > 0) ? facet(!!F.vouched, x('facetVouched'), count((g) => g.vouches > 0), () => set({ vouched: !F.vouched }), 'vouched') : null}
        </div>
        <div class="cp-search"><input class="og-input" type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} aria-label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="cp-empty">${x('noMatch')}</p>` : html`
          <div class="cp-pl">
            <div class="cp-p cp-p--head"><div>${x('col.' + key)}</div><div>${x('colGives')}</div><div>${x('colAgent')}</div><div></div></div>
            ${shown.map((g) => providerRow(ctx, g))}
          </div>`}
        <div class="cp-more">
          ${shown.length < rows.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <p class="cp-hint">${x('hint.' + key)}</p>`}
    <//>`;
}

/* ── Hand-added and other: manual webhooks, ecosystem apps, the old action list; the form ──────── */

function secOther(ctx, num, other, canCreate) {
  const f = ctx.form;
  return html`
    <${Section} id="cp-other" num=${num} title=${x('secOther')} count=${ctx.groups ? x('secOtherSub', { n: other.length }) : null}>
      ${!ctx.groups ? loadingRow() : html`
        ${other.length ? html`<div class="cp-pl">
          <div class="cp-p cp-p--head"><div>${x('col.other')}</div><div>${x('colGives')}</div><div>${x('colAgent')}</div><div></div></div>
          ${other.map((g) => providerRow(ctx, g))}
        </div>` : html`<p class="cp-empty">${x('emptyOther')}</p>`}
        <div class="cp-kv cp-kv--wide">
          <div class="cp-k">${x('manualK')}</div><div class="cp-v">${x('manualBody')}<small>${canCreate ? x('manualOn') : x('manualOff', { policy: x('policy.' + (ctx.policy?.publishing || 'disabled')) })}</small></div>
          <div class="cp-k">${x('policyK')}</div><div class="cp-v">${x('policyBody', { publishing: x('policy.' + (ctx.policy?.publishing || 'disabled')), publishers: x('publishers.' + (ctx.policy?.publishers || 'all_users')), webhooks: x('webhooks.' + (ctx.policy?.webhooks || 'disabled')) })}<small>${x('policySub')}</small></div>
        </div>
        ${canCreate ? html`
          <button type="button" class="cp-fold" aria-expanded=${f.open ? 'true' : 'false'} onClick=${() => ctx.setForm({ open: !f.open })}><i>${f.open ? '↓' : '→'}</i>${x('addManual')}<span class="cp-fold-r">${x('addManualSub')}</span></button>
          ${f.open ? html`
            <div class="cp-form">
              <label class="cp-field"><span class="og-label">${x('formName')}</span><input class="og-input" value=${f.name} onInput=${(e) => ctx.setForm({ name: e.target.value })} /></label>
              <label class="cp-field"><span class="og-label">${x('formWebhook')}</span><input class="og-input" placeholder="https://" value=${f.webhookUrl} onInput=${(e) => ctx.setForm({ webhookUrl: e.target.value })} /></label>
              <label class="cp-field cp-field--wide"><span class="og-label">${x('formSummary')}</span><textarea class="og-textarea" rows="2" value=${f.summary} onInput=${(e) => ctx.setForm({ summary: e.target.value })}></textarea></label>
              <label class="cp-field"><span class="og-label">${x('formTags')}</span><input class="og-input" value=${f.tags} onInput=${(e) => ctx.setForm({ tags: e.target.value })} /></label>
              <label class="cp-field cp-check"><input type="checkbox" checked=${f.visibility === 'public'} onChange=${(e) => ctx.setForm({ visibility: e.target.checked ? 'public' : 'private' })} /> ${x('formPublic')}</label>
              <div class="cp-field--wide cp-form-doors"><span class="cp-hint">${x('formHint')}</span><button type="button" class="og-door" disabled=${ctx.busy === 'create' || !f.name.trim()} onClick=${() => ctx.createManual()}>${x('formCreate')}</button></div>
            </div>` : null}` : null}`}
    <//>`;
}

/* ── How an agent finds and calls ─────────────────────────────────────────────────────────────── */

function secAgent(ctx, num, all, calls, vouches) {
  return html`
    <${Section} id="cp-ai" num=${num} title=${x('secAi')} count=${null}>
      <p class="cp-para">${x('aiIntro')}</p>
      <div class="cp-rule">
        <span class="og-label">${x('ruleLabel')}</span>
        <p class="cp-para">${x('ruleBody', { base: ctx.nodeUrl })}</p>
        <div class="og-doors"><${CopyButton} text=${agentRule(ctx.nodeUrl)} className="og-door" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="cp-kv cp-kv--wide">
        <div class="cp-k">${x('aiWhoK')}</div><div class="cp-v">${x('aiWhoBody')}</div>
        <div class="cp-k">${x('aiTrustK')}</div><div class="cp-v">${x('aiTrustBody')}<small>${vouches ? x('aiTrustSub', { n: vouches }) : x('aiTrustNone')}</small></div>
        <div class="cp-k">${x('aiCallsK')}</div><div class="cp-v">${ctx.policy?.call_counting ? x('aiCallsOn', { n: calls }) : x('aiCallsOff', { n: calls })}</div>
        <div class="cp-k">${x('aiTwoK')}</div><div class="cp-v">${x('aiTwoBody')}</div>
      </div>
    <//>`;
}
