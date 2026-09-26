/**
 * @file public/views/profile/companies/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Companies cover in the poster face (design canvas "AIMEAT Yritysten sivu",
 *   direction A): every company as a row whose condition is written out — are the invoice
 *   details filled in, whose server its mail leaves from, who may act in its name — and the
 *   register form. A row opens the company's own page (company.js). Pure render over the ctx bag.
 * @structure renderCover · secRows · secCreate
 * @usage import { renderCover } from './companies/cover.js';
 * @version-history
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-25 -- "Details n/m" when not all are filled in is the Status (attention), a unification: Jouni's decision "Status".
 *   v1.8.0 -- 2026-09-25 -- The company rows are the Listing (listing, listing-row and its head row, name, who and doors cells, the mark in a cell of its own), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-31 — Initial. Replaces one long card per company with a row and a page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, crumb, pageLinks, factsOf, kindWord, initials } from './frame.js';
import { Hint } from '/components/Hint.js';

export function renderCover(ctx) {
  const rows = ctx.companies.map((co) => ({ co, facts: factsOf(co), x: ctx.extras[co.id] || {} }));
  const incomplete = rows.filter((r) => r.facts.done < r.facts.total);
  const inv = rows.reduce((n, r) => n + (r.x.inv || 0), 0);
  const sent = rows.reduce((n, r) => n + (r.x.sent || 0), 0);
  const worst = rows.length ? rows.reduce((a, b) => (a.facts.done <= b.facts.done ? a : b)) : null;
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;

  const strip = html`
    <div class="og-strip">
      <div><b>${rows.length}</b><span>${c('stripCompanies')}</span><small>${rows.length ? rows.map((r) => r.co.name).join(' · ') : c('stripNone')}</small></div>
      <div>${worst ? html`<b class=${worst.facts.done < worst.facts.total ? 'og-coral' : ''}>${worst.facts.done}/${worst.facts.total}</b><span>${c('stripFacts')}</span><small>${worst.facts.missing.length ? c('stripFactsMissing', { list: worst.facts.missing.slice(0, 2).map(([w]) => t('profile.companies.field.' + w)).join(', ') }) : c('stripFactsDone')}</small>` : html`<b>·</b><span>${c('stripFacts')}</span><small>${c('stripNone')}</small>`}</div>
      <div><b>${inv}</b><span>${c('stripInvoices')}</span><small>${c('stripInvoicesSub')}</small></div>
      <div><b>${sent}</b><span>${c('stripSent')}</span><small>${c('stripSentSub')}</small></div>
    </div>`;

  return html`
    <div class="og og-co">
      ${crumb(null)}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${c('title')}</h1>
          <div class="poster-chips">
            ${chip(c('chipCompanies', { n: rows.length }))}
            ${incomplete.length ? chip(c('chipIncomplete', { name: incomplete[0].co.name }), 'poster-chip--coral') : rows.length ? chip(c('chipAllSet')) : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => scrollTo('co-create')}>${c('createDoor')}</button>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyPrompt('list')}>${c('promptToChat')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secRows(ctx, rows)}
          ${secCreate(ctx)}
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'co-rows', c('secRows'), rows.length], ['02', 'co-create', c('secCreate'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secRows(ctx, rows) {
  return html`
    <${PageSection} id="co-rows" num="01" title=${c('secRows')} count=${rows.length} first>
      ${!rows.length ? html`<p class="poster-quiet">${c('emptyRows')}</p>` : html`
        <div class="listing listing--cols listing--mark-name-kind-state-doors">
          <div class="listing-row listing-row--head"><div class="poster-label" aria-hidden="true"></div><div class="poster-label">${c('colCompany')}</div><div class="poster-label">${c('colFront')}</div><div class="poster-label">${c('colState')}</div><div class="poster-label"></div></div>
          ${rows.map(({ co, facts, x }) => html`
            <div class="listing-row" key=${co.id}>
              <div><div class="co-av poster-box poster-box--avatar poster-box--small" aria-hidden="true">${initials(co.name)}</div></div>
              <div class="listing-name">${co.name}<small>${co.address ? co.address.replace(/^https?:\/\//, '') : co.slug}</small></div>
              <div class="listing-who"><b>${kindWord(co.frontPage?.kind)}</b>${co.frontPage?.kind === 'redirect' && co.frontPage.target ? html`<small>${co.frontPage.target.replace(/^https?:\/\//, '')}</small>` : null}<small>${ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : ''}</small></div>
              <div class="listing-who">${facts.done < facts.total ? html`<span class="poster-status poster-status--attention">${c('factsShort', { n: `${facts.done}/${facts.total}` })}</span>` : html`<b>${c('factsDone')}</b>`}<small>${[x.smtpSet ? c('senderOwn') : c('senderShared'), co.organismId ? c('withOrganism') : c('noOrganism')].join(' · ')}</small></div>
              <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.open(co.id)}>${c('open')}</button></div>
            </div>`)}
        </div>`}
      <${Hint}>${c('rowsHint')}<//>
    <//>`;
}

function secCreate(ctx) {
  const slug = ctx.create.slug;
  const avail = ctx.create.availability;
  return html`
    <${PageSection} id="co-create" num="02" title=${c('secCreate')} count=${null}>
      <div class="co-create">
        <div class="co-field">
          <label>
            <span class="poster-label">${t('profile.companies.name')}</span>
            <input class="og-input" value=${ctx.create.name} placeholder=${c('createPlaceholder')} onInput=${(e) => ctx.setCreateName(e.target.value)} />
          </label>
          ${slug.length >= 2 ? html`<p class="co-preview">${c('addressPreview')}: <b>${avail?.address || slug}</b> · ${avail ? (avail.available ? c('free') : html`<span class="taken">${t('profile.companies.reason.' + avail.reason)}</span>`) : '…'}</p>` : null}
        </div>
        <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy || slug.length < 2 || avail?.available === false} onClick=${() => ctx.doCreate()}>${c('create')}</button>
      </div>
      <${Hint}>${c('createHint')}<//>
    <//>`;
}
