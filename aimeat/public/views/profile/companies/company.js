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
 * @structure renderCompany · secFacts · secFront · portfolioEditor · secActors · secEvents · smtpFold · chatFold
 * @usage import { renderCompany } from './companies/company.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail, the strip is a plain
 *     NumeralBand, the details are label-over-value pairs in three columns, the forms are Fields,
 *     the front page choice is a radio group of tabs, a road is a box; no class of its own. The
 *     forms' save buttons are underlined words, so the mast keeps the one slab.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-31 — Initial. The organism link had lived only in the API until this page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Columns, Stack, Chip, Action, Field, Text, NumeralBand, KeyValue, Surface } from '/components/poster-parts.js';
import { c, crumb, pageLinks, goTab, FIELDS, fieldLabel, factsOf, missingWord, kindWord } from './frame.js';

export function renderCompany(ctx) {
  const co = ctx.company;
  const facts = factsOf(co);
  const x = ctx.extras[co.id] || {};
  const host = co.address ? co.address.replace(/^https?:\/\//, '') : co.slug;

  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripFacts'), value: `${facts.done}/${facts.total}`, tone: facts.done < facts.total ? 'coral' : undefined,
      note: facts.missing.length ? c('stripFactsMissing', { list: facts.missing.slice(0, 2).map(([w]) => fieldLabel(w)).join(', ') }) : c('stripFactsDone') },
    { label: c('stripInvoices'), value: x.inv ?? 0, note: c('stripInvoicesSub') },
    { label: c('stripSentOne'), value: x.sent ?? 0, note: co.organismId ? c('stripSentOneSub') : c('stripSentNoBook') },
    { label: c('stripActors'), value: co.organismId ? c('actorsMany') : 1, note: co.organismId ? c('actorsOrganism', { name: ctx.organismName(co.organismId) }) : c('actorsYou') },
  ]} />`;
  const entries = [['co-facts', c('secFacts'), `${facts.done}/${facts.total}`], ['co-front', c('secFront')], ['co-actors', c('secActorsShort'), co.organismId ? c('actorsMany') : 1],
    ['co-events', c('secEventsShort'), (x.inv ?? 0) + (x.sent ?? 0)], ['co-smtp', t('profile.companies.smtpTitle')], ['co-chat', c('chatTitle')]]
    .map(([id, label, count]) => ({ id, href: '#' + id, label, count }));

  return html`<${Page} title=${co.name} crumbs=${crumb(co, () => ctx.back())}
    identity=${html`<${Stack} density="compact">
      <${Text} kind="label">${c('companyWord')} · ${host}<//>
      <${Stack} direction="wrap" density="compact">
        ${facts.done < facts.total ? html`<${Chip} tone="coral">${c('factsShort', { n: `${facts.done}/${facts.total}` })}<//>` : html`<${Chip}>${c('factsDone')}<//>`}
        <${Chip}>${c('chipFront', { kind: kindWord(co.frontPage?.kind) })}<//>
        <${Chip} tone="muted">${ctx.smtp ? c('senderOwn') : c('senderShared')}<//>
        <${Chip} tone="muted">${co.organismId ? c('withOrganism') : c('noOrganism')}<//>
      <//>
    <//>`}
    actions=${html`${co.address ? html`<${Action} kind="primary" href=${co.address} target="_blank">${c('openAddress')}<//>` : null}
      <${Action} onClick=${() => ctx.copyPrompt('settings')}>${c('promptToChat')}<//>
      <${Action} tone="danger" disabled=${ctx.busy} onClick=${() => ctx.removeCompany()}>${c('deleteCompany')}<//>`}
    rail=${html`<${Rail} kind="index" title=${c('railTitle')} entries=${entries}><${Stack}>
      <${Stack} density="compact">
        <${Text} kind="label">${c('title')}<//>
        <${Action} kind="text" onClick=${() => ctx.back()}>← ${c('backToList')}<//>
      <//>
      ${pageLinks()}
    <//><//>`}>
    ${strip}
    ${secFacts(ctx, co)}
    ${secFront(ctx, co)}
    ${secActors(ctx, co)}
    ${secEvents(ctx, co, x)}
    <${Fold} id="co-smtp" number="05" title=${t('profile.companies.smtpTitle')} sub=${ctx.smtp ? c('smtpOwnSub', { host: ctx.smtp.host }) : c('smtpSharedSub')} open=${ctx.folds.smtp} onToggle=${() => ctx.setFold('smtp', !ctx.folds.smtp)}>${smtpFold(ctx)}<//>
    <${Fold} id="co-chat" number="06" title=${c('chatTitle')} sub=${c('chatSub')} open=${ctx.folds.chat} onToggle=${() => ctx.setFold('chat', !ctx.folds.chat)}>${chatFold(ctx)}<//>
    <${ctx.ConfirmUI} />
  <//>`;
}

/* ── 01 · the registered details ──────────────────────────────────────────── */

function secFacts(ctx, co) {
  const doors = ctx.editingFacts
    ? null
    : html`<${Action} onClick=${() => ctx.startFacts()}>${c('fill')}<//>
           <${Action} kind="text" onClick=${() => ctx.copyPrompt('settings')}>${c('aiFill')}<//>`;
  return html`
    <${Section} id="co-facts" title=${c('secFacts')} count=${c('secFactsSub')} actions=${doors} density="compact">
      <${Stack}>
        ${ctx.editingFacts ? html`
          <${Columns} collapse=${560}>
            ${FIELDS.map(([wire]) => html`<${Field} key=${wire} label=${fieldLabel(wire)} value=${ctx.factValues[wire] ?? ''} onInput=${(e) => ctx.setFact(wire, e.target.value)} />`)}
          <//>
          <${Stack} direction="wrap" align="center">
            <${Action} disabled=${ctx.busy} onClick=${() => ctx.saveFacts()}>${t('profile.companies.save')}<//>
            <${Action} kind="text" onClick=${() => ctx.cancelFacts()}>${t('common.cancel')}<//>
          <//>`
        : html`
          <${Columns} layout="thirds" collapse=${560}>
            ${FIELDS.map(([wire, rec, tag]) => html`<${Stack} key=${wire} density="compact">
              <${Text} kind="label">${fieldLabel(wire)}<//>
              ${co[rec] ? html`<${Text}><strong>${co[rec]}</strong><//>` : html`<${Text} tone="muted">${missingWord(tag)}<//>`}
            <//>`)}
          <//>`}
        <${Text} kind="caption" tone="muted">${c('factsHint')}<//>
      <//>
    <//>`;
}

/* ── 02 · the front page ──────────────────────────────────────────────────── */

function secFront(ctx, co) {
  const f = ctx.front;
  const saved = co.frontPage || { kind: 'none', target: '' };
  const KINDS = ['none', 'app', 'portfolio', 'redirect'];
  const dirty = f.kind !== saved.kind || (f.kind !== 'portfolio' && (f.target || '') !== (saved.target || ''));
  return html`
    <${Section} id="co-front" title=${c('secFront')} count=${c('secFrontSub', { address: (co.address || '').replace(/^https?:\/\//, '') })} density="compact">
      <${Stack}>
        <${Stack} direction="wrap" density="compact" role="radiogroup" label=${c('secFront')}>
          ${KINDS.map((k) => html`<${Action} key=${k} kind="tab" semantics="radio" selected=${f.kind === k} onClick=${() => ctx.setFrontState({ kind: k, target: k === saved.kind ? (saved.target || '') : '' })}>${kindWord(k)}<//>`)}
        <//>
        <${Stack} direction="wrap" align="end">
          ${f.kind === 'app' ? html`<${Field} type="select" ariaLabel=${kindWord('app')} value=${f.target} onChange=${(e) => ctx.setFrontState({ ...f, target: e.target.value })}
            options=${[{ value: '', label: t('profile.companies.pickApp') }, ...ctx.apps.map((a) => ({ value: `${a.owner}/${a.filename}`, label: a.name || a.filename }))]} />` : null}
          ${f.kind === 'redirect' ? html`<${Field} type="url" ariaLabel=${kindWord('redirect')} value=${f.target} placeholder="https://…" onInput=${(e) => ctx.setFrontState({ ...f, target: e.target.value })} />` : null}
          ${f.kind !== 'portfolio' && dirty ? html`<${Action} disabled=${ctx.busy || (f.kind !== 'none' && !f.target)} onClick=${() => ctx.saveFront()}>${t('profile.companies.setFront')}<//>` : null}
          ${f.kind === 'portfolio' ? html`<${Action} kind="text" onClick=${() => ctx.copyPrompt('portfolio')}>${c('buildPage')}<//>` : null}
          ${f.kind === 'app' ? html`<${Action} kind="text" onClick=${() => ctx.copyPrompt('app')}>${c('buildApp')}<//>` : null}
        <//>
        ${saved.kind === 'redirect' && saved.target ? html`<${KeyValue} label=${c('redirectsTo')} value=${html`<${Stack} density="compact">
          <${Text}>${saved.target}<//>
          <${Text} kind="mono" tone="muted">${ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : c('addressChecking')}<//>
        <//>`} />` : null}
        ${f.kind === 'portfolio' ? portfolioEditor(ctx) : null}
        <${Text} kind="caption" tone="muted">${c('frontHint')}<//>
      <//>
    <//>`;
}

function portfolioEditor(ctx) {
  const st = ctx.portfolio;
  // The file picker: an underlined word that opens the hidden native input beside it (the set has
  // no file field; see the report's MISSING PART).
  const pick = (e) => e.currentTarget.parentElement.querySelector('input[type="file"]')?.click();
  return html`
    <${KeyValue} label=${c('pageWord')} value=${st?.published ? c('pageLive', { kb: Math.max(1, Math.round((st.sizeBytes || 0) / 1024)) }) : c('pageNone')} />
    <${Stack} direction="wrap">
      <${Action} onClick=${pick}>${t('profile.companies.portfolioPickFile')}<//>
      <input type="file" hidden accept="text/html,.html,.htm" onChange=${(e) => ctx.pickPortfolioFile(e)} />
    <//>
    <${Field} type="textarea" rows=${6} spellCheck=${false} ariaLabel=${c('pageWord')} value=${ctx.front.html} placeholder=${'<!doctype html>…'} onInput=${(e) => ctx.setFrontState({ ...ctx.front, html: e.target.value })} />
    <${Stack} direction="wrap" align="center">
      <${Action} disabled=${ctx.busy || !ctx.front.html.trim()} onClick=${() => ctx.publishPortfolio()}>${t('profile.companies.portfolioPublish')}<//>
      ${st?.published ? html`<${Action} kind="text" tone="danger" disabled=${ctx.busy} onClick=${() => ctx.removePortfolio()}>${t('profile.companies.portfolioRemove')}<//>` : null}
    <//>`;
}

/* ── 03 · who acts in its name ────────────────────────────────────────────── */

function secActors(ctx, co) {
  const doors = co.organismId
    ? html`<${Action} tone="danger" disabled=${ctx.busy} onClick=${() => ctx.unlinkOrganism()}>${c('unlink')}<//>`
    : null;
  return html`
    <${Section} id="co-actors" title=${c('secActors')} count=${c('secActorsSub')} actions=${doors} density="compact">
      <${Stack}>
        ${co.organismId ? html`<${Text}>${c('actorsLinked', { name: ctx.organismName(co.organismId) })}<//>`
        : html`
          <${Text}>${c('actorsNowYou')}<//>
          ${ctx.organisms.length ? html`
            <${Stack} direction="wrap" align="end">
              <${Field} type="select" ariaLabel=${c('pickOrganism')} value=${ctx.orgPick} onChange=${(e) => ctx.setOrgPick(e.target.value)}
                options=${[{ value: '', label: c('pickOrganism') }, ...ctx.organisms.map((o) => ({ value: o.id, label: o.name }))]} />
              <${Action} disabled=${ctx.busy || !ctx.orgPick} onClick=${() => ctx.linkOrganism()}>${c('link')}<//>
            <//>` : html`<${Text} kind="caption" tone="muted">${c('noOrganisms')}<//>`}`}
        <${Text} kind="caption" tone="muted">${c('actorsHint')}<//>
      <//>
    <//>`;
}

/* ── 04 · what has happened in its name ───────────────────────────────────── */

function secEvents(ctx, co, x) {
  const doors = html`<${Action} onClick=${() => goTab('pnl')}>${c('toPnl')}<//>`;
  const value = (main, sub) => html`<${Stack} density="compact"><${Text}>${main}<//><${Text} kind="mono" tone="muted">${sub}<//><//>`;
  return html`
    <${Section} id="co-events" title=${c('secEvents')} count=${c('secEventsSub')} actions=${doors} density="compact">
      <${KeyValue} label=${c('invoicesK')} value=${value(c('invoicesV', { n: x.inv ?? 0 }), c('invoicesSub'))} />
      <${KeyValue} label=${c('mailK')} value=${value(c('mailV', { n: x.sent ?? 0 }), co.organismId ? c('mailSub') : c('mailSubNoBook'))} />
    <//>`;
}

/* ── 05 · the sending identity ────────────────────────────────────────────── */

function smtpFold(ctx) {
  const f = ctx.smtpForm;
  const field = (key, label, extra = {}) => html`<${Field} key=${key} label=${label} value=${f[key]} ...${extra} onInput=${(e) => ctx.setSmtpField(key, e.target.value)} />`;
  return html`
    <${Text} kind="caption" tone="muted">${ctx.smtp ? c('smtpOwnHint', { host: ctx.smtp.host }) : c('smtpSharedHint')}<//>
    <${Columns} collapse=${560}>
      ${field('host', t('profile.companies.smtp.host'), { placeholder: 'smtp.example.com' })}
      ${field('port', t('profile.companies.smtp.port'), { inputMode: 'numeric' })}
      ${field('username', t('profile.companies.smtp.username'), { autoComplete: 'off' })}
      ${field('password', t('profile.companies.smtp.password'), { type: 'password', autoComplete: 'new-password', placeholder: ctx.smtp?.passwordSet ? t('profile.companies.smtp.passwordKept') : '' })}
      ${field('from_address', t('profile.companies.smtp.fromAddress'), { placeholder: 'laskutus@yritys.fi' })}
      ${field('from_name', t('profile.companies.smtp.fromName'))}
      ${field('reply_to', t('profile.companies.smtp.replyTo'))}
      <${Field} type="checkbox" label=${t('profile.companies.smtp.secure')} value=${f.secure} onChange=${(e) => ctx.setSmtpField('secure', e.target.checked)} />
    <//>
    <${Stack} direction="wrap" align="center">
      <${Action} disabled=${ctx.busy || !f.host.trim() || !f.from_address.trim()} onClick=${() => ctx.saveSmtp()}>${t('profile.companies.smtpSave')}<//>
      ${ctx.smtp ? html`<${Action} kind="text" tone="danger" disabled=${ctx.busy} onClick=${() => ctx.removeSmtp()}>${t('profile.companies.smtpRemove')}<//>` : null}
    <//>`;
}

/* ── 06 · the company in a chat ───────────────────────────────────────────── */

function chatFold(ctx) {
  const road = (k, promptKind) => html`
    <${Surface} key=${k} kind="box" density="compact">
      <${Stack} density="compact">
        <${Text} kind="label">${c('road.' + k + 'K')}<//>
        <${Text}><strong>${c('road.' + k + 'T')}</strong><//>
        <${Text} kind="caption" tone="muted">${c('road.' + k + 'D')}<//>
        <${Stack} direction="wrap"><${Action} onClick=${() => ctx.copyPrompt(promptKind)}>${c('copyPrompt')}<//><//>
      <//>
    <//>`;
  return html`
    <${Columns} layout="thirds" collapse=${560}>
      ${road('fill', 'settings')}
      ${road('page', 'portfolio')}
      ${road('app', 'app')}
    <//>
    <${Text} kind="caption" tone="muted">${c('chatHint')}<//>`;
}
