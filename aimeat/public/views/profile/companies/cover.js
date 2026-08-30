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
 *   v1.0.0 — 2026-08-31 — Initial. Replaces one long card per company with a row and a page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, crumb, pageLinks, factsOf, kindWord, initials } from './frame.js';

export function renderCover(ctx) {
  const rows = ctx.companies.map((co) => ({ co, facts: factsOf(co), x: ctx.extras[co.id] || {} }));
  const incomplete = rows.filter((r) => r.facts.done < r.facts.total);
  const inv = rows.reduce((n, r) => n + (r.x.inv || 0), 0);
  const sent = rows.reduce((n, r) => n + (r.x.sent || 0), 0);
  const worst = rows.length ? rows.reduce((a, b) => (a.facts.done <= b.facts.done ? a : b)) : null;
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

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
          <h1 class="og-title">${c('title')}</h1>
          <div class="og-chips">
            ${chip(c('chipCompanies', { n: rows.length }), rows.length ? '' : 'og-chip--dim')}
            ${incomplete.length ? chip(c('chipIncomplete', { name: incomplete[0].co.name }), 'og-chip--coral') : rows.length ? chip(c('chipAllSet')) : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => scrollTo('co-create')}>${c('createDoor')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copyPrompt('list')}>${c('promptToChat')}</button></div>
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
    <${Section} id="co-rows" num="01" title=${c('secRows')} count=${rows.length} first>
      ${!rows.length ? html`<p class="og-empty">${c('emptyRows')}</p>` : html`
        <div class="co-rows">
          <div class="co-head" aria-hidden="true"></div><div class="co-head">${c('colCompany')}</div><div class="co-head">${c('colFront')}</div><div class="co-head">${c('colState')}</div><div class="co-head"></div>
          ${rows.map(({ co, facts, x }) => html`
            <div class="co-av" key=${'a' + co.id} aria-hidden="true">${initials(co.name)}</div>
            <div class="co-nm" key=${'n' + co.id}>${co.name}<small>${co.address ? co.address.replace(/^https?:\/\//, '') : co.slug}</small></div>
            <div class="co-w" key=${'f' + co.id}><b>${kindWord(co.frontPage?.kind)}</b>${co.frontPage?.kind === 'redirect' && co.frontPage.target ? html`<small>${co.frontPage.target.replace(/^https?:\/\//, '')}</small>` : null}<small>${ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : ''}</small></div>
            <div class="co-w" key=${'s' + co.id}>${facts.done < facts.total ? html`<span class="co-warn">${c('factsShort', { n: `${facts.done}/${facts.total}` })}</span>` : html`<b>${c('factsDone')}</b>`}<small>${[x.smtpSet ? c('senderOwn') : c('senderShared'), co.organismId ? c('withOrganism') : c('noOrganism')].join(' · ')}</small></div>
            <div class="co-ctl" key=${'d' + co.id}><button type="button" class="og-door" onClick=${() => ctx.open(co.id)}>${c('open')}</button></div>`)}
        </div>`}
      <p class="co-hint">${c('rowsHint')}</p>
    <//>`;
}

function secCreate(ctx) {
  const slug = ctx.create.slug;
  const avail = ctx.create.availability;
  return html`
    <${Section} id="co-create" num="02" title=${c('secCreate')} count=${null}>
      <div class="co-create">
        <div class="co-field">
          <label>
            <span class="og-label">${t('profile.companies.name')}</span>
            <input class="og-input" value=${ctx.create.name} placeholder=${c('createPlaceholder')} onInput=${(e) => ctx.setCreateName(e.target.value)} />
          </label>
          ${slug.length >= 2 ? html`<p class="co-preview">${c('addressPreview')}: <b>${avail?.address || slug}</b> · ${avail ? (avail.available ? c('free') : html`<span class="taken">${t('profile.companies.reason.' + avail.reason)}</span>`) : '…'}</p>` : null}
        </div>
        <button type="button" class="og-slab" disabled=${ctx.busy || slug.length < 2 || avail?.available === false} onClick=${() => ctx.doCreate()}>${c('create')}</button>
      </div>
      <p class="co-hint">${c('createHint')}</p>
    <//>`;
}
