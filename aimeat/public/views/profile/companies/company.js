/**
 * @file public/views/profile/companies/company.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One company's own page in the poster face (design canvas "AIMEAT Yritysten sivu",
 *   direction A). Four sections and two folds: the registered details with what each gap costs,
 *   the front page the address serves, who may act in the company's name (the organism link, on
 *   the page for the first time), what has happened in its name (invoices and mail, with the
 *   doors to those pages), and behind folds the sending identity (SMTP) and the three chat
 *   prompts. Pure render over the ctx bag.
 * @structure renderCompany · secFacts · secFront · secActors · secEvents · smtpFold · chatFold
 * @usage import { renderCompany } from './companies/company.js';
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial. The organism link had lived only in the API until this page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, crumb, pageLinks, goTab, FIELDS, fieldLabel, factsOf, missingWord, kindWord } from './frame.js';

export function renderCompany(ctx) {
  const co = ctx.company;
  const facts = factsOf(co);
  const x = ctx.extras[co.id] || {};
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
  const host = co.address ? co.address.replace(/^https?:\/\//, '') : co.slug;

  const strip = html`
    <div class="og-strip">
      <div><b class=${facts.done < facts.total ? 'og-coral' : ''}>${facts.done}/${facts.total}</b><span>${c('stripFacts')}</span><small>${facts.missing.length ? c('stripFactsMissing', { list: facts.missing.slice(0, 2).map(([w]) => fieldLabel(w)).join(', ') }) : c('stripFactsDone')}</small></div>
      <div><b>${x.inv ?? 0}</b><span>${c('stripInvoices')}</span><small>${c('stripInvoicesSub')}</small></div>
      <div><b>${x.sent ?? 0}</b><span>${c('stripSentOne')}</span><small>${co.organismId ? c('stripSentOneSub') : c('stripSentNoBook')}</small></div>
      <div><b>${co.organismId ? c('actorsMany') : 1}</b><span>${c('stripActors')}</span><small>${co.organismId ? c('actorsOrganism', { name: ctx.organismName(co.organismId) }) : c('actorsYou')}</small></div>
    </div>`;

  return html`
    <div class="og og-co">
      ${crumb(co)}
      <div class="og-mast">
        <div class="og-mast-words">
          <span class="og-label">${c('companyWord')} · ${host}</span>
          <h1 class="og-title">${co.name}</h1>
          <div class="og-chips">
            ${facts.done < facts.total ? chip(c('factsShort', { n: `${facts.done}/${facts.total}` }), 'og-chip--coral') : chip(c('factsDone'))}
            ${chip(c('chipFront', { kind: kindWord(co.frontPage?.kind) }))}
            ${chip(ctx.smtp ? c('senderOwn') : c('senderShared'), 'og-chip--dim')}
            ${chip(co.organismId ? c('withOrganism') : c('noOrganism'), 'og-chip--dim')}
          </div>
        </div>
        <div class="og-mast-actions">
          ${co.address ? html`<a class="og-slab" href=${co.address} target="_blank" rel="noopener">${c('openAddress')}</a>` : null}
          <div class="og-doors">
            <button type="button" class="og-door" onClick=${() => ctx.copyPrompt('settings')}>${c('promptToChat')}</button>
            <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.removeCompany()}>${c('deleteCompany')}</button>
          </div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secFacts(ctx, co)}
          ${secFront(ctx, co)}
          ${secActors(ctx, co)}
          ${secEvents(ctx, co, x)}
          <${Fold} id="co-smtp" num="05" title=${t('profile.companies.smtpTitle')} sub=${ctx.smtp ? c('smtpOwnSub', { host: ctx.smtp.host }) : c('smtpSharedSub')} open=${ctx.folds.smtp} onToggle=${() => ctx.setFold('smtp', !ctx.folds.smtp)}>${smtpFold(ctx)}<//>
          <${Fold} id="co-chat" num="06" title=${c('chatTitle')} sub=${c('chatSub')} open=${ctx.folds.chat} onToggle=${() => ctx.setFold('chat', !ctx.folds.chat)}>${chatFold(ctx)}<//>
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'co-facts', c('secFacts'), `${facts.done}/${facts.total}`], ['02', 'co-front', c('secFront'), ''], ['03', 'co-actors', c('secActorsShort'), co.organismId ? c('actorsMany') : 1], ['04', 'co-events', c('secEventsShort'), (x.inv ?? 0) + (x.sent ?? 0)], ['05', 'co-smtp', t('profile.companies.smtpTitle'), ''], ['06', 'co-chat', c('chatTitle'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('title')}</span>
          <button type="button" class="og-rail-link" onClick=${() => ctx.back()}><i>←</i>${c('backToList')}<em></em></button>
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

/* ── 01 · the registered details ──────────────────────────────────────────── */

function secFacts(ctx, co) {
  const doors = ctx.editingFacts
    ? null
    : html`<button type="button" class="og-door" onClick=${() => ctx.startFacts()}>${c('fill')}</button>
           <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.copyPrompt('settings')}>${c('aiFill')}</button>`;
  return html`
    <${Section} id="co-facts" num="01" title=${c('secFacts')} count=${c('secFactsSub')} doors=${doors} first>
      ${ctx.editingFacts ? html`
        <div class="co-edit">
          ${FIELDS.map(([wire]) => html`
            <label key=${wire}><span>${fieldLabel(wire)}</span>
              <input class="og-input" value=${ctx.factValues[wire] ?? ''} onInput=${(e) => ctx.setFact(wire, e.target.value)} /></label>`)}
        </div>
        <div class="og-doors co-form-doors">
          <button type="button" class="og-slab" disabled=${ctx.busy} onClick=${() => ctx.saveFacts()}>${t('profile.companies.save')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.cancelFacts()}>${t('common.cancel')}</button>
        </div>`
      : html`
        <div class="co-facts">
          ${FIELDS.map(([wire, rec, tag]) => html`
            <div key=${wire}><span class="k">${fieldLabel(wire)}</span>${co[rec]
              ? html`<span class="v">${co[rec]}</span>`
              : html`<span class="v miss">${missingWord(tag)}</span>`}</div>`)}
        </div>`}
      <p class="co-hint">${c('factsHint')}</p>
    <//>`;
}

/* ── 02 · the front page ──────────────────────────────────────────────────── */

function secFront(ctx, co) {
  const f = ctx.front;
  const saved = co.frontPage || { kind: 'none', target: '' };
  const KINDS = ['none', 'app', 'portfolio', 'redirect'];
  const dirty = f.kind !== saved.kind || (f.kind !== 'portfolio' && (f.target || '') !== (saved.target || ''));
  return html`
    <${Section} id="co-front" num="02" title=${c('secFront')} count=${c('secFrontSub', { address: (co.address || '').replace(/^https?:\/\//, '') })}>
      <div class="co-choice" role="group" aria-label=${c('secFront')}>
        ${KINDS.map((k) => html`<button type="button" key=${k} class=${f.kind === k ? 'on' : ''} onClick=${() => ctx.setFrontState({ kind: k, target: k === saved.kind ? (saved.target || '') : '' })}>${kindWord(k)}</button>`)}
      </div>
      <div class="co-front-ctl">
        ${f.kind === 'app' ? html`
          <select class="og-input" value=${f.target} onChange=${(e) => ctx.setFrontState({ ...f, target: e.target.value })}>
            <option value="">${t('profile.companies.pickApp')}</option>
            ${ctx.apps.map((a) => html`<option key=${a.filename} value=${`${a.owner}/${a.filename}`}>${a.name || a.filename}</option>`)}
          </select>` : null}
        ${f.kind === 'redirect' ? html`
          <input class="og-input" value=${f.target} placeholder="https://…" onInput=${(e) => ctx.setFrontState({ ...f, target: e.target.value })} />` : null}
        ${f.kind !== 'portfolio' && dirty ? html`
          <button type="button" class="og-door" disabled=${ctx.busy || (f.kind !== 'none' && !f.target)} onClick=${() => ctx.saveFront()}>${t('profile.companies.setFront')}</button>` : null}
        ${f.kind === 'portfolio' ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.copyPrompt('portfolio')}>${c('buildPage')}</button>` : null}
        ${f.kind === 'app' ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.copyPrompt('app')}>${c('buildApp')}</button>` : null}
      </div>
      ${saved.kind === 'redirect' && saved.target ? html`
        <div class="co-kv"><div class="k">${c('redirectsTo')}</div><div class="v">${saved.target}<small>${ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : c('addressChecking')}</small></div></div>` : null}
      ${f.kind === 'portfolio' ? portfolioEditor(ctx) : null}
      <p class="co-hint">${c('frontHint')}</p>
    <//>`;
}

function portfolioEditor(ctx) {
  const st = ctx.portfolio;
  return html`
    <div class="co-kv">
      <div class="k">${c('pageWord')}</div>
      <div class="v">${st?.published ? c('pageLive', { kb: Math.max(1, Math.round((st.sizeBytes || 0) / 1024)) }) : c('pageNone')}</div>
    </div>
    <label class="co-hint co-file"><span class="og-door">${t('profile.companies.portfolioPickFile')}</span>
      <input type="file" accept="text/html,.html,.htm" onChange=${(e) => ctx.pickPortfolioFile(e)} /></label>
    <textarea class="og-input co-html" rows="6" spellcheck="false" value=${ctx.front.html} placeholder=${'<!doctype html>…'} onInput=${(e) => ctx.setFrontState({ ...ctx.front, html: e.target.value })}></textarea>
    <div class="og-doors co-form-doors">
      <button type="button" class="og-slab" disabled=${ctx.busy || !ctx.front.html.trim()} onClick=${() => ctx.publishPortfolio()}>${t('profile.companies.portfolioPublish')}</button>
      ${st?.published ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.removePortfolio()}>${t('profile.companies.portfolioRemove')}</button>` : null}
    </div>`;
}

/* ── 03 · who acts in its name ────────────────────────────────────────────── */

function secActors(ctx, co) {
  const doors = co.organismId
    ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.unlinkOrganism()}>${c('unlink')}</button>`
    : null;
  return html`
    <${Section} id="co-actors" num="03" title=${c('secActors')} count=${c('secActorsSub')} doors=${doors}>
      ${co.organismId ? html`
        <p>${c('actorsLinked', { name: ctx.organismName(co.organismId) })}</p>`
      : html`
        <p>${c('actorsNowYou')}</p>
        ${ctx.organisms.length ? html`
          <div class="co-front-ctl">
            <select class="og-input" value=${ctx.orgPick} onChange=${(e) => ctx.setOrgPick(e.target.value)}>
              <option value="">${c('pickOrganism')}</option>
              ${ctx.organisms.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}</option>`)}
            </select>
            <button type="button" class="og-door" disabled=${ctx.busy || !ctx.orgPick} onClick=${() => ctx.linkOrganism()}>${c('link')}</button>
          </div>` : html`<p class="co-hint">${c('noOrganisms')}</p>`}`}
      <p class="co-hint">${c('actorsHint')}</p>
    <//>`;
}

/* ── 04 · what has happened in its name ───────────────────────────────────── */

function secEvents(ctx, co, x) {
  const doors = html`<button type="button" class="og-door og-door--quiet" onClick=${() => goTab('pnl')}>${c('toPnl')}</button>`;
  return html`
    <${Section} id="co-events" num="04" title=${c('secEvents')} count=${c('secEventsSub')} doors=${doors}>
      <div class="co-kv">
        <div class="k">${c('invoicesK')}</div>
        <div class="v">${c('invoicesV', { n: x.inv ?? 0 })}<small>${c('invoicesSub')}</small></div>
        <div class="k">${c('mailK')}</div>
        <div class="v">${c('mailV', { n: x.sent ?? 0 })}<small>${co.organismId ? c('mailSub') : c('mailSubNoBook')}</small></div>
      </div>
    <//>`;
}

/* ── 05 · the sending identity ────────────────────────────────────────────── */

function smtpFold(ctx) {
  const f = ctx.smtpForm;
  const field = (key, label, extra = {}) => html`
    <label key=${key}><span>${label}</span>
      <input class="og-input" value=${f[key]} ...${extra} onInput=${(e) => ctx.setSmtpField(key, e.target.value)} /></label>`;
  return html`
    <p class="co-hint">${ctx.smtp ? c('smtpOwnHint', { host: ctx.smtp.host }) : c('smtpSharedHint')}</p>
    <div class="co-smtp">
      ${field('host', t('profile.companies.smtp.host'), { placeholder: 'smtp.example.com' })}
      ${field('port', t('profile.companies.smtp.port'), { inputmode: 'numeric' })}
      ${field('username', t('profile.companies.smtp.username'), { autocomplete: 'off' })}
      ${field('password', t('profile.companies.smtp.password'), { type: 'password', autocomplete: 'new-password', placeholder: ctx.smtp?.passwordSet ? t('profile.companies.smtp.passwordKept') : '' })}
      ${field('from_address', t('profile.companies.smtp.fromAddress'), { placeholder: 'laskutus@yritys.fi' })}
      ${field('from_name', t('profile.companies.smtp.fromName'))}
      ${field('reply_to', t('profile.companies.smtp.replyTo'))}
      <label class="co-check"><span>${t('profile.companies.smtp.secure')}</span>
        <input type="checkbox" checked=${f.secure} onChange=${(e) => ctx.setSmtpField('secure', e.target.checked)} /></label>
    </div>
    <div class="og-doors co-form-doors">
      <button type="button" class="og-slab" disabled=${ctx.busy || !f.host.trim() || !f.from_address.trim()} onClick=${() => ctx.saveSmtp()}>${t('profile.companies.smtpSave')}</button>
      ${ctx.smtp ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.removeSmtp()}>${t('profile.companies.smtpRemove')}</button>` : null}
    </div>`;
}

/* ── 06 · the company in a chat ───────────────────────────────────────────── */

function chatFold(ctx) {
  const road = (k, promptKind) => html`
    <div class="nt-road" key=${k}><span class="nt-road-k">${c('road.' + k + 'K')}</span><b>${c('road.' + k + 'T')}</b><p>${c('road.' + k + 'D')}</p>
      <button type="button" class="og-door" onClick=${() => ctx.copyPrompt(promptKind)}>${c('copyPrompt')}</button></div>`;
  return html`
    <div class="nt-roads">
      ${road('fill', 'settings')}
      ${road('page', 'portfolio')}
      ${road('app', 'app')}
    </div>
    <p class="co-hint">${c('chatHint')}</p>`;
}
