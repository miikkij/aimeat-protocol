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
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail, the strip is a plain
 *     NumeralBand, the companies are a Table, the register form a Field; no class of its own. The
 *     form's Register is an underlined word, so the mast keeps the one slab.
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-31 — Initial. Replaces one long card per company with a row and a page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, Chip, Action, Field, Text, NumeralBand, Table, scrollToId } from '/components/poster-parts.js';
import { c, crumb, pageLinks, factsOf, kindWord, initials } from './frame.js';

const bare = (url) => url.replace(/^https?:\/\//, '');

export function renderCover(ctx) {
  const rows = ctx.companies.map((co) => ({ co, facts: factsOf(co), x: ctx.extras[co.id] || {} }));
  const incomplete = rows.filter((r) => r.facts.done < r.facts.total);
  const inv = rows.reduce((n, r) => n + (r.x.inv || 0), 0);
  const sent = rows.reduce((n, r) => n + (r.x.sent || 0), 0);
  const worst = rows.length ? rows.reduce((a, b) => (a.facts.done <= b.facts.done ? a : b)) : null;

  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripCompanies'), value: rows.length, note: rows.length ? rows.map((r) => r.co.name).join(' · ') : c('stripNone') },
    worst
      ? { label: c('stripFacts'), value: `${worst.facts.done}/${worst.facts.total}`, tone: worst.facts.done < worst.facts.total ? 'coral' : undefined,
        note: worst.facts.missing.length ? c('stripFactsMissing', { list: worst.facts.missing.slice(0, 2).map(([w]) => t('profile.companies.field.' + w)).join(', ') }) : c('stripFactsDone') }
      : { label: c('stripFacts'), value: '·', note: c('stripNone') },
    { label: c('stripInvoices'), value: inv, note: c('stripInvoicesSub') },
    { label: c('stripSent'), value: sent, note: c('stripSentSub') },
  ]} />`;
  const entries = [['co-rows', c('secRows'), rows.length], ['co-create', c('secCreate')]].map(([id, label, count]) => ({ id, href: '#' + id, label, count }));

  return html`<${Page} title=${c('title')} crumbs=${crumb(null)}
    identity=${html`<${Stack} direction="wrap" density="compact">
      <${Chip} tone=${rows.length ? 'plain' : 'muted'}>${c('chipCompanies', { n: rows.length })}<//>
      ${incomplete.length ? html`<${Chip} tone="coral">${c('chipIncomplete', { name: incomplete[0].co.name })}<//>` : rows.length ? html`<${Chip}>${c('chipAllSet')}<//>` : null}
    <//>`}
    actions=${html`<${Action} kind="primary" onClick=${() => scrollToId('co-create')}>${c('createDoor')}<//>
      <${Action} onClick=${() => ctx.copyPrompt('list')}>${c('promptToChat')}<//>`}
    rail=${html`<${Rail} kind="index" title=${c('railTitle')} entries=${entries}>${pageLinks()}<//>`}>
    <${Text} kind="lead" tone="muted">${c('desc')}<//>
    ${strip}
    ${secRows(ctx, rows)}
    ${secCreate(ctx)}
    <${ctx.ConfirmUI} />
  <//>`;
}

function secRows(ctx, rows) {
  return html`
    <${Section} id="co-rows" title=${c('secRows')} count=${rows.length} density="compact">
      <${Stack}>
        ${!rows.length ? html`<${Text} tone="muted">${c('emptyRows')}<//>` : html`
          <${Table} collapse=${600} density="compact" label=${c('secRows')} headers=${['', c('colCompany'), c('colFront'), c('colState'), '']}
            rows=${rows.map(({ co, facts, x }) => [
              html`<${Chip}>${initials(co.name)}<//>`,
              html`<${Stack} density="compact"><${Text}><strong>${co.name}</strong><//><${Text} kind="mono" tone="muted">${co.address ? bare(co.address) : co.slug}<//><//>`,
              html`<${Stack} density="compact"><${Text}><strong>${kindWord(co.frontPage?.kind)}</strong><//>
                ${co.frontPage?.kind === 'redirect' && co.frontPage.target ? html`<${Text} kind="mono" tone="muted">${bare(co.frontPage.target)}<//>` : null}
                ${ctx.addr[co.id] === true || ctx.addr[co.id] === false ? html`<${Text} kind="mono" tone="muted">${ctx.addr[co.id] ? c('addressOk') : c('addressDown')}<//>` : null}<//>`,
              html`<${Stack} density="compact">${facts.done < facts.total ? html`<${Text} tone="coral"><strong>${c('factsShort', { n: `${facts.done}/${facts.total}` })}</strong><//>` : html`<${Text}><strong>${c('factsDone')}</strong><//>`}
                <${Text} kind="mono" tone="muted">${[x.smtpSet ? c('senderOwn') : c('senderShared'), co.organismId ? c('withOrganism') : c('noOrganism')].join(' · ')}<//><//>`,
              html`<${Action} onClick=${() => ctx.open(co.id)}>${c('open')}<//>`,
            ])} />`}
        <${Text} kind="caption" tone="muted">${c('rowsHint')}<//>
      <//>
    <//>`;
}

function secCreate(ctx) {
  const slug = ctx.create.slug;
  const avail = ctx.create.availability;
  return html`
    <${Section} id="co-create" title=${c('secCreate')} density="compact">
      <${Stack}>
        <${Field} label=${t('profile.companies.name')} value=${ctx.create.name} placeholder=${c('createPlaceholder')} onInput=${(e) => ctx.setCreateName(e.target.value)} />
        ${slug.length >= 2 ? html`<${Text} kind="mono" tone="muted">${c('addressPreview')}: <strong>${avail?.address || slug}</strong> · ${avail
          ? (avail.available ? c('free') : html`<${Text} kind="mono" tone="danger">${t('profile.companies.reason.' + avail.reason)}<//>`) : '…'}<//>` : null}
        <${Stack} direction="wrap">
          <${Action} disabled=${ctx.busy || slug.length < 2 || avail?.available === false} onClick=${() => ctx.doCreate()}>${c('create')}<//>
        <//>
        <${Text} kind="caption" tone="muted">${c('createHint')}<//>
      <//>
    <//>`;
}
