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
 *   v1.15.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and three-group rail as data; FigureStrip; Facts with the missing details grey; Fields, TextField, TextArea, Select, Check, Choice, FileDrop; Roads; Note; Action; Layout): the page passes data and writes no class. Put back from main: who sends and who acts are dim tags (page group G8).
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-25 -- "No organisms yet" is the quiet sentence (.poster-quiet), a unification: Jouni's decision "Empty line"; the file picker's label loses the hint class it only used for its place.
 *   v1.12.0 -- 2026-09-25 -- What the front page shows (none, an app, the portfolio, a redirect) is a choice: the Tab (.poster-tab, the chosen one .is-on), a unification: Jouni's decision "Choice".
 *   v1.11.0 -- 2026-09-25 -- The registered details, the front page's address and page, and the events are the Facts (css/components/facts.css), a unification: the look most tabs use; the details' three ruled columns of tiles become two columns, the name on the left.
 *   v1.10.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
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
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-31 — Initial. The organism link had lived only in the API until this page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { railSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Roads, Road } from '/components/Roads.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';
import { FileDrop } from '/components/FileDrop.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Row as Line } from '/components/Layout.js';
import { c, crumb, pageLinks, goTab, FIELDS, fieldLabel, factsOf, missingWord, kindWord } from './frame.js';
import { Hint } from '/components/Hint.js';

export function renderCompany(ctx) {
  const co = ctx.company;
  const facts = factsOf(co);
  const x = ctx.extras[co.id] || {};
  const host = co.address ? co.address.replace(/^https?:\/\//, '') : co.slug;
  const sections = [
    { id: 'co-facts', num: '01', label: c('secFacts'), count: `${facts.done}/${facts.total}` },
    { id: 'co-front', num: '02', label: c('secFront'), count: '' },
    { id: 'co-actors', num: '03', label: c('secActorsShort'), count: co.organismId ? c('actorsMany') : 1 },
    { id: 'co-events', num: '04', label: c('secEventsShort'), count: (x.inv ?? 0) + (x.sent ?? 0) },
    { id: 'co-smtp', num: '05', label: t('profile.companies.smtpTitle'), count: '' },
    { id: 'co-chat', num: '06', label: c('chatTitle'), count: '' },
  ];

  const strip = html`<${FigureStrip} items=${[
    { key: 'facts', n: `${facts.done}/${facts.total}`, tone: facts.done < facts.total ? 'notice' : undefined, label: c('stripFacts'),
      sub: facts.missing.length ? c('stripFactsMissing', { list: facts.missing.slice(0, 2).map(([w]) => fieldLabel(w)).join(', ') }) : c('stripFactsDone') },
    { key: 'inv', n: x.inv ?? 0, label: c('stripInvoices'), sub: c('stripInvoicesSub') },
    { key: 'sent', n: x.sent ?? 0, label: c('stripSentOne'), sub: co.organismId ? c('stripSentOneSub') : c('stripSentNoBook') },
    { key: 'actors', n: co.organismId ? c('actorsMany') : 1, label: c('stripActors'), sub: co.organismId ? c('actorsOrganism', { name: ctx.organismName(co.organismId) }) : c('actorsYou') },
  ]} />`;

  return html`
    <${SettingsPage} name="co"
      crumb=${crumb(co)}
      label=${`${c('companyWord')} · ${host}`}
      title=${co.name}
      marks=${[
        facts.done < facts.total ? { label: c('factsShort', { n: `${facts.done}/${facts.total}` }), tone: 'coral' } : { label: c('factsDone') },
        { label: c('chipFront', { kind: kindWord(co.frontPage?.kind) }) },
        // Who sends and who acts count nothing yet: main's dim tags.
        { label: ctx.smtp ? c('senderOwn') : c('senderShared'), tone: 'dim' },
        { label: co.organismId ? c('withOrganism') : c('noOrganism'), tone: 'dim' },
      ]}
      actions=${html`
        ${co.address ? html`<${Loud} href=${co.address} newTab>${c('openAddress')}<//>` : null}
        <${Actions}>
          <${Action} small onClick=${() => ctx.copyPrompt('settings')}>${c('promptToChat')}<//>
          <${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.removeCompany()}>${c('deleteCompany')}<//>
        <//>`}
      strip=${strip}
      rail=${{ title: c('railTitle'), groups: [
        { label: c('railTitle'), items: sections.map(railSection) },
        { label: c('title'), items: [{ back: true, key: 'back', label: c('backToList'), onClick: () => ctx.back() }] },
        { label: c('pages'), items: pageLinks() },
      ] }}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secFacts(ctx, co)}
      ${secFront(ctx, co)}
      ${secActors(ctx, co)}
      ${secEvents(ctx, co, x)}
      <${FoldSection} id="co-smtp" num="05" title=${t('profile.companies.smtpTitle')} sub=${ctx.smtp ? c('smtpOwnSub', { host: ctx.smtp.host }) : c('smtpSharedSub')} open=${ctx.folds.smtp} onToggle=${() => ctx.setFold('smtp', !ctx.folds.smtp)}>${smtpFold(ctx)}<//>
      <${FoldSection} id="co-chat" num="06" title=${c('chatTitle')} sub=${c('chatSub')} open=${ctx.folds.chat} onToggle=${() => ctx.setFold('chat', !ctx.folds.chat)}>${chatFold(ctx)}<//>
    <//>`;
}

/* ── 01 · the registered details ──────────────────────────────────────────── */

function secFacts(ctx, co) {
  const doors = ctx.editingFacts
    ? null
    : html`<${Action} small onClick=${() => ctx.startFacts()}>${c('fill')}<//>
           <${Action} small soft onClick=${() => ctx.copyPrompt('settings')}>${c('aiFill')}<//>`;
  return html`
    <${PageSection} id="co-facts" num="01" title=${c('secFacts')} count=${c('secFactsSub')} doors=${doors} first>
      ${ctx.editingFacts ? html`
        <${Fields} cols=${2}>
          ${FIELDS.map(([wire]) => html`
            <${TextField} key=${wire} label=${fieldLabel(wire)} value=${ctx.factValues[wire] ?? ''} onInput=${(v) => ctx.setFact(wire, v)} />`)}
        <//>
        <${FormActions}>
          <${Loud} control disabled=${ctx.busy} onClick=${() => ctx.saveFacts()}>${t('profile.companies.save')}<//>
          <${Action} small soft onClick=${() => ctx.cancelFacts()}>${t('common.cancel')}<//>
        <//>`
      : html`
        <${Facts} rows=${FIELDS.map(([wire, rec, tag]) => ({ key: wire, k: fieldLabel(wire), v: co[rec] || missingWord(tag), missing: !co[rec] }))} />`}
      <${Hint}>${c('factsHint')}<//>
    <//>`;
}

/* ── 02 · the front page ──────────────────────────────────────────────────── */

function secFront(ctx, co) {
  const f = ctx.front;
  const saved = co.frontPage || { kind: 'none', target: '' };
  const KINDS = ['none', 'app', 'portfolio', 'redirect'];
  const dirty = f.kind !== saved.kind || (f.kind !== 'portfolio' && (f.target || '') !== (saved.target || ''));
  return html`
    <${PageSection} id="co-front" num="02" title=${c('secFront')} count=${c('secFrontSub', { address: (co.address || '').replace(/^https?:\/\//, '') })}>
      <${Choice} ariaLabel=${c('secFront')} value=${f.kind}
        options=${KINDS.map((k) => [k, kindWord(k)])}
        onChange=${(k) => ctx.setFrontState({ kind: k, target: k === saved.kind ? (saved.target || '') : '' })} />
      <${Line} gap="medium" wrap above="medium">
        ${f.kind === 'app' ? html`
          <${Select} value=${f.target} placeholder=${t('profile.companies.pickApp')} onChange=${(v) => ctx.setFrontState({ ...f, target: v })}
            options=${ctx.apps.map((a) => ({ value: `${a.owner}/${a.filename}`, label: a.name || a.filename }))} />` : null}
        ${f.kind === 'redirect' ? html`
          <${TextField} value=${f.target} placeholder="https://…" onInput=${(v) => ctx.setFrontState({ ...f, target: v })} />` : null}
        ${f.kind !== 'portfolio' && dirty ? html`
          <${Action} small disabled=${ctx.busy || (f.kind !== 'none' && !f.target)} onClick=${() => ctx.saveFront()}>${t('profile.companies.setFront')}<//>` : null}
        ${f.kind === 'portfolio' ? html`<${Action} small soft onClick=${() => ctx.copyPrompt('portfolio')}>${c('buildPage')}<//>` : null}
        ${f.kind === 'app' ? html`<${Action} small soft onClick=${() => ctx.copyPrompt('app')}>${c('buildApp')}<//>` : null}
      <//>
      ${saved.kind === 'redirect' && saved.target ? html`
        <${Facts} rows=${[{ k: c('redirectsTo'), v: saved.target, sub: ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : c('addressChecking') }]} />` : null}
      ${f.kind === 'portfolio' ? portfolioEditor(ctx) : null}
      <${Hint}>${c('frontHint')}<//>
    <//>`;
}

function portfolioEditor(ctx) {
  const st = ctx.portfolio;
  return html`
    <${Facts} rows=${[{ k: c('pageWord'), v: st?.published ? c('pageLive', { kb: Math.max(1, Math.round((st.sizeBytes || 0) / 1024)) }) : c('pageNone') }]} />
    <${FileDrop} button=${t('profile.companies.portfolioPickFile')} accept="text/html,.html,.htm" onChange=${(e) => ctx.pickPortfolioFile(e)} />
    <${TextArea} rows=${6} spellCheck=${false} value=${ctx.front.html} placeholder=${'<!doctype html>…'} onInput=${(v) => ctx.setFrontState({ ...ctx.front, html: v })} />
    <${FormActions}>
      <${Loud} control disabled=${ctx.busy || !ctx.front.html.trim()} onClick=${() => ctx.publishPortfolio()}>${t('profile.companies.portfolioPublish')}<//>
      ${st?.published ? html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.removePortfolio()}>${t('profile.companies.portfolioRemove')}<//>` : null}
    <//>`;
}

/* ── 03 · who acts in its name ────────────────────────────────────────────── */

function secActors(ctx, co) {
  const doors = co.organismId
    ? html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.unlinkOrganism()}>${c('unlink')}<//>`
    : null;
  return html`
    <${PageSection} id="co-actors" num="03" title=${c('secActors')} count=${c('secActorsSub')} doors=${doors}>
      ${co.organismId ? html`
        <p>${c('actorsLinked', { name: ctx.organismName(co.organismId) })}</p>`
      : html`
        <p>${c('actorsNowYou')}</p>
        ${ctx.organisms.length ? html`
          <${Line} gap="medium" wrap above="medium">
            <${Select} value=${ctx.orgPick} placeholder=${c('pickOrganism')} onChange=${(v) => ctx.setOrgPick(v)}
              options=${ctx.organisms.map((o) => ({ value: o.id, label: o.name }))} />
            <${Action} small disabled=${ctx.busy || !ctx.orgPick} onClick=${() => ctx.linkOrganism()}>${c('link')}<//>
          <//>` : html`<${Note} kind="quiet">${c('noOrganisms')}<//>`}`}
      <${Hint}>${c('actorsHint')}<//>
    <//>`;
}

/* ── 04 · what has happened in its name ───────────────────────────────────── */

function secEvents(ctx, co, x) {
  const doors = html`<${Action} small soft onClick=${() => goTab('pnl')}>${c('toPnl')}<//>`;
  return html`
    <${PageSection} id="co-events" num="04" title=${c('secEvents')} count=${c('secEventsSub')} doors=${doors}>
      <${Facts} rows=${[
        { k: c('invoicesK'), v: c('invoicesV', { n: x.inv ?? 0 }), sub: c('invoicesSub') },
        { k: c('mailK'), v: c('mailV', { n: x.sent ?? 0 }), sub: co.organismId ? c('mailSub') : c('mailSubNoBook') },
      ]} />
    <//>`;
}

/* ── 05 · the sending identity ────────────────────────────────────────────── */

function smtpFold(ctx) {
  const f = ctx.smtpForm;
  const field = (key, label, extra = {}) => html`
    <${TextField} key=${key} label=${label} value=${f[key]} ...${extra} onInput=${(v) => ctx.setSmtpField(key, v)} />`;
  return html`
    <${Hint}>${ctx.smtp ? c('smtpOwnHint', { host: ctx.smtp.host }) : c('smtpSharedHint')}<//>
    <${Fields} cols=${2}>
      ${field('host', t('profile.companies.smtp.host'), { placeholder: 'smtp.example.com' })}
      ${field('port', t('profile.companies.smtp.port'), { inputMode: 'numeric' })}
      ${field('username', t('profile.companies.smtp.username'), { autoComplete: 'off' })}
      ${field('password', t('profile.companies.smtp.password'), { type: 'password', autoComplete: 'new-password', placeholder: ctx.smtp?.passwordSet ? t('profile.companies.smtp.passwordKept') : '' })}
      ${field('from_address', t('profile.companies.smtp.fromAddress'), { placeholder: 'laskutus@yritys.fi' })}
      ${field('from_name', t('profile.companies.smtp.fromName'))}
      ${field('reply_to', t('profile.companies.smtp.replyTo'))}
      <${Check} checked=${f.secure} onChange=${(on) => ctx.setSmtpField('secure', on)}>${t('profile.companies.smtp.secure')}<//>
    <//>
    <${FormActions}>
      <${Loud} control disabled=${ctx.busy || !f.host.trim() || !f.from_address.trim()} onClick=${() => ctx.saveSmtp()}>${t('profile.companies.smtpSave')}<//>
      ${ctx.smtp ? html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.removeSmtp()}>${t('profile.companies.smtpRemove')}<//>` : null}
    <//>`;
}

/* ── 06 · the company in a chat ───────────────────────────────────────────── */

function chatFold(ctx) {
  const road = (k, promptKind) => html`
    <${Road} key=${k} kicker=${c('road.' + k + 'K')} name=${c('road.' + k + 'T')} text=${c('road.' + k + 'D')}
      doors=${html`<${Action} small onClick=${() => ctx.copyPrompt(promptKind)}>${c('copyPrompt')}<//>`} />`;
  return html`
    <${Roads} cols="three">
      ${road('fill', 'settings')}
      ${road('page', 'portfolio')}
      ${road('app', 'app')}
    <//>
    <${Hint}>${c('chatHint')}<//>`;
}
