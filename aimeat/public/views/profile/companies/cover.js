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
 *   v1.11.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and rail as data; FigureStrip; List with the company's Lead mark; TextField; AddressPreview; Action; Layout): the page passes data and writes no class. Put back from main: "0 companies" is a dim tag (page group G8).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Lead, Name, Who, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { TextField } from '/components/TextField.js';
import { AddressPreview } from '/components/AddressPreview.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { c, crumb, pageLinks, factsOf, kindWord, initials } from './frame.js';
import { Hint } from '/components/Hint.js';

export function renderCover(ctx) {
  const rows = ctx.companies.map((co) => ({ co, facts: factsOf(co), x: ctx.extras[co.id] || {} }));
  const incomplete = rows.filter((r) => r.facts.done < r.facts.total);
  const inv = rows.reduce((n, r) => n + (r.x.inv || 0), 0);
  const sent = rows.reduce((n, r) => n + (r.x.sent || 0), 0);
  const worst = rows.length ? rows.reduce((a, b) => (a.facts.done <= b.facts.done ? a : b)) : null;

  const strip = html`<${FigureStrip} items=${[
    { key: 'companies', n: rows.length, label: c('stripCompanies'), sub: rows.length ? rows.map((r) => r.co.name).join(' · ') : c('stripNone') },
    worst
      ? { key: 'facts', n: `${worst.facts.done}/${worst.facts.total}`, tone: worst.facts.done < worst.facts.total ? 'notice' : undefined, label: c('stripFacts'),
        sub: worst.facts.missing.length ? c('stripFactsMissing', { list: worst.facts.missing.slice(0, 2).map(([w]) => t('profile.companies.field.' + w)).join(', ') }) : c('stripFactsDone') }
      : { key: 'facts', n: '·', label: c('stripFacts'), sub: c('stripNone') },
    { key: 'inv', n: inv, label: c('stripInvoices'), sub: c('stripInvoicesSub') },
    { key: 'sent', n: sent, label: c('stripSent'), sub: c('stripSentSub') },
  ]} />`;

  return html`
    <${SettingsPage} name="co"
      crumb=${crumb(null)}
      title=${c('title')}
      marks=${[
        // No company yet counts nothing: main's dim tag.
        { label: c('chipCompanies', { n: rows.length }), tone: rows.length ? undefined : 'dim' },
        incomplete.length ? { label: c('chipIncomplete', { name: incomplete[0].co.name }), tone: 'coral' } : rows.length ? { label: c('chipAllSet') } : null,
      ]}
      desc=${c('desc')}
      actions=${html`
        <${Loud} onClick=${() => scrollToSection('co-create')}>${c('createDoor')}<//>
        <${Actions}><${Action} small onClick=${() => ctx.copyPrompt('list')}>${c('promptToChat')}<//><//>`}
      strip=${strip}
      railTitle=${c('railTitle')}
      sections=${[
        { id: 'co-rows', num: '01', label: c('secRows'), count: rows.length },
        { id: 'co-create', num: '02', label: c('secCreate'), count: '' },
      ]}
      pagesLabel=${c('pages')}
      pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secRows(ctx, rows)}
      ${secCreate(ctx)}
    <//>`;
}

function secRows(ctx, rows) {
  const host = (u) => u.replace(/^https?:\/\//, '');
  return html`
    <${PageSection} id="co-rows" num="01" title=${c('secRows')} count=${rows.length} first>
      <${List} cols="mark-name-kind-state-doors" keepCols empty=${c('emptyRows')}
        head=${rows.length ? ['', c('colCompany'), c('colFront'), c('colState'), ''] : null}>
          ${rows.map(({ co, facts, x }) => html`
            <${Row} key=${co.id}>
              <${Lead} text=${initials(co.name)} />
              <${Name} meta=${co.address ? host(co.address) : co.slug}>${co.name}<//>
              <${Who} sub=${ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : ''}>
                <b>${kindWord(co.frontPage?.kind)}</b>${co.frontPage?.kind === 'redirect' && co.frontPage.target ? html`<small>${host(co.frontPage.target)}</small>` : null}
              <//>
              <${Who} sub=${[x.smtpSet ? c('senderOwn') : c('senderShared'), co.organismId ? c('withOrganism') : c('noOrganism')].join(' · ')}>
                ${facts.done < facts.total ? html`<${Mark} kind="status" tone="attention">${c('factsShort', { n: `${facts.done}/${facts.total}` })}<//>` : html`<b>${c('factsDone')}</b>`}
              <//>
              <${Doors}><${Action} small row onClick=${() => ctx.open(co.id)}>${c('open')}<//><//>
            <//>`)}
      <//>
      <${Hint}>${c('rowsHint')}<//>
    <//>`;
}

function secCreate(ctx) {
  const slug = ctx.create.slug;
  const avail = ctx.create.availability;
  return html`
    <${PageSection} id="co-create" num="02" title=${c('secCreate')} count=${null}>
      <${TextField} label=${t('profile.companies.name')} value=${ctx.create.name} placeholder=${c('createPlaceholder')} onInput=${(v) => ctx.setCreateName(v)}
        actions=${html`<${Loud} control disabled=${ctx.busy || slug.length < 2 || avail?.available === false} onClick=${() => ctx.doCreate()}>${c('create')}<//>`} />
      ${slug.length >= 2 ? html`<${AddressPreview} label=${c('addressPreview')} address=${avail?.address || slug}
        state=${!avail ? 'checking' : avail.available ? 'free' : 'taken'} free=${c('free')}
        taken=${avail && !avail.available ? t('profile.companies.reason.' + avail.reason) : ''} />` : null}
      <${Hint}>${c('createHint')}<//>
    <//>`;
}
