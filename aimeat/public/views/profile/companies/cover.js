/**
 * @file public/views/profile/companies/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Companies cover in the poster face (design canvas "AIMEAT Yritysten sivu",
 *   direction A): every company as a row whose condition is written out — are the invoice
 *   details filled in, whose server its mail leaves from, who may act in its name — and the
 *   register form. A row opens the company's own page (company.js). The cover explains itself the
 *   designed way (.claude/rules/page-guidance.md): the page's start (PageStart "companies") and the
 *   title's question mark (concept.company). Pure render over the ctx bag.
 * @structure renderCover · secRows · secCreate
 * @usage import { renderCover } from './companies/cover.js';
 * @version-history
 *   v1.14.1 -- 2026-11-27 -- The front-page app is named by its manifest name; the row showed its file name.
 *   v1.14.0 -- 2026-11-27 -- A company row says what is inside before it is opened: its description
 *     under the name, the app its address serves by title (or the redirect's host), and who works in
 *     its name (the linked shared place by its name and member count, or only you) with the invoices
 *     of this year and the messages sent. All from what the page already reads. The row no longer
 *     says whose server the mail leaves from; the company's own page says it in its head and in the
 *     sending identity row.
 *   v1.13.0 -- 2026-11-27 -- Usability pass on the person's three situations. The strip takes hideZeros
 *     (no band of zeros before the first company) and holds its place while the list loads; a company
 *     whose address does not answer or whose invoice details are missing comes first in the list, its
 *     name in the attention colour when the address does not answer. "Register a company" (co-create)
 *     is a fold row, open while there is no company; its Register button is the page's one Loud, and
 *     the head's way to the form is an ordinary action. The head marks repeated the strip and are gone;
 *     the hint under the list is drawn once there is a company. The empty line says the one way to get
 *     a company here. No control was removed.
 *   v1.12.0 -- 2026-11-08 -- The cover explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "companies" in the start slot (folded once a company exists; its button goes to the
 *     register form) and the title's question mark concept.company.
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
import { t, tn } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
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
import { PageStart } from '/components/PageStart.js';

/**
 * The list order: a company whose address does not answer or whose invoice details are missing needs
 * the person, so it comes first (the invoice gap before a plain gap), then the rest.
 */
const rankOf = (r, addr) => (addr[r.co.id] === false || r.facts.blocksInvoice ? 0 : r.facts.done < r.facts.total ? 1 : 2);

export function renderCover(ctx) {
  // Stable: within a rank the server's order stays.
  const rows = ctx.companies.map((co, i) => ({ co, i, facts: factsOf(co), x: ctx.extras[co.id] || {} }))
    .sort((a, b) => (rankOf(a, ctx.addr) - rankOf(b, ctx.addr)) || (a.i - b.i));
  const inv = rows.reduce((n, r) => n + (r.x.inv || 0), 0);
  const sent = rows.reduce((n, r) => n + (r.x.sent || 0), 0);
  const worst = rows.length ? rows.reduce((a, b) => (a.facts.done <= b.facts.done ? a : b)) : null;

  // hideZeros: with no company the strip is not drawn, and the list's one line says what fills it.
  const strip = !ctx.loaded ? html`<${FigureStrip} loading=${4} />` : html`<${FigureStrip} hideZeros items=${[
    { key: 'companies', n: rows.length, label: c('stripCompanies'), sub: rows.length ? rows.map((r) => r.co.name).join(' · ') : c('stripNone') },
    worst
      ? { key: 'facts', n: `${worst.facts.done}/${worst.facts.total}`, tone: worst.facts.done < worst.facts.total ? 'notice' : undefined, label: c('stripFacts'),
        sub: worst.facts.missing.length ? c('stripFactsMissing', { list: worst.facts.missing.slice(0, 2).map(([w]) => t('profile.companies.field.' + w)).join(', ') }) : c('stripFactsDone') }
      : { key: 'facts', n: '·', label: c('stripFacts'), sub: c('stripNone') },
    { key: 'inv', n: inv, label: c('stripInvoices'), sub: c('stripInvoicesSub') },
    { key: 'sent', n: sent, label: c('stripSent'), sub: c('stripSentSub') },
  ]} />`;

  // The register form opens in place: it is open while there is no company, a row after that.
  const createOpen = ctx.folds.create ?? !rows.length;
  const openCreate = () => { ctx.setFold('create', true); scrollToSection('co-create'); };
  // Its button goes to the register form.
  const start = html`<${PageStart} id="companies" done=${ctx.loaded ? rows.length > 0 : null}
    action=${{ onClick: openCreate }} />`;
  // The head's marks repeated the strip (how many, whose details are unfinished) and are gone. The
  // one loud action is the form's own Register; the head's way to the form is an ordinary action,
  // since a company is registered once and a person mostly comes to open one.
  return html`
    <${SettingsPage} name="co"
      crumb=${crumb(null)}
      title=${c('title')}
      help="concept.company"
      start=${start}
      desc=${c('desc')}
      actions=${html`
        <${Actions}>
          <${Action} small onClick=${openCreate}>${c('createDoor')}<//>
          <${Action} small onClick=${() => ctx.copyPrompt('list')}>${c('promptToChat')}<//>
        <//>`}
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
      ${secCreate(ctx, createOpen)}
    <//>`;
}

/**
 * What the company's address serves, by name: the app by its title (from the apps the page already
 * read), the redirect by its host. A kind with nothing to name says only the kind.
 */
function frontOf(ctx, co, host) {
  const kind = co.frontPage?.kind || 'none';
  const target = co.frontPage?.target || '';
  if (kind === 'app' && target) {
    const app = (ctx.apps || []).find((a) => `${a.owner}/${a.filename}` === target);
    // The app's own name is in its manifest; the file name is only the fallback.
    return app ? (app.manifest?.name || app.manifest?.title || app.name || app.filename) : '';
  }
  if (kind === 'redirect' && target) return host(target);
  return '';
}

/**
 * Who works in the company's name and what has happened in it, in one short line: the linked shared
 * place by its name with its member count (from the organisms the page already read; never its id),
 * or only you; then the invoices of this year and the messages sent, when there are any.
 */
function whoWorks(ctx, co, x) {
  const place = co.organismId ? (ctx.organisms || []).find((o) => o.id === co.organismId) : null;
  const who = !co.organismId ? c('actorsYou')
    : place ? tn('companypage.rowPlace', Number(place.member_count) || 0, { name: place.name })
      : c('rowPlaceUnknown');
  const books = [
    x.inv ? tn('companypage.rowInvoices', x.inv) : null,
    x.sent ? tn('companypage.rowSent', x.sent) : null,
  ].filter(Boolean).join(', ');
  return books ? `${who} · ${books}` : who;
}

/**
 * A company row says what is inside before it is opened: its purpose (the description), what its
 * address serves by name, whether its details are complete, and who works in its name with what has
 * happened there. Everything comes from what the page already read; no read per row.
 */
function secRows(ctx, rows) {
  const host = (u) => u.replace(/^https?:\/\//, '');
  return html`
    <${PageSection} id="co-rows" num="01" title=${c('secRows')} count=${rows.length} first>
      <${List} cols="mark-name-kind-state-doors" keepCols empty=${c('emptyRows')} loading=${ctx.loaded ? false : t('common.loading')}
        head=${rows.length ? ['', c('colCompany'), c('colFront'), c('colState'), ''] : null}>
          ${rows.map(({ co, facts, x }) => {
            const front = frontOf(ctx, co, host);
            return html`
            <${Row} key=${co.id}>
              <${Lead} text=${initials(co.name)} />
              <${Name} attention=${ctx.addr[co.id] === false} meta=${co.address ? host(co.address) : co.slug} desc=${co.description || null}>${co.name}<//>
              <${Who} clip sub=${ctx.addr[co.id] === true ? c('addressOk') : ctx.addr[co.id] === false ? c('addressDown') : ''}>
                <b>${kindWord(co.frontPage?.kind)}</b>${front ? html`<small>${front}</small>` : null}
              <//>
              <${Who} clip sub=${whoWorks(ctx, co, x)}>
                ${facts.done < facts.total ? html`<${Mark} kind="status" tone="attention">${c('factsShort', { n: `${facts.done}/${facts.total}` })}<//>` : html`<b>${c('factsDone')}</b>`}
              <//>
              <${Doors}><${Action} small row onClick=${() => ctx.open(co.id)}>${c('open')}<//><//>
            <//>`;
          })}
      <//>
      ${rows.length ? html`<${Hint}>${c('rowsHint')}<//>` : null}
    <//>`;
}

/**
 * The register form as one row that opens in place: open while there is no company (it is how one
 * begins), a row after that, since a company is registered once.
 */
function secCreate(ctx, open) {
  const slug = ctx.create.slug;
  const avail = ctx.create.availability;
  return html`
    <${FoldSection} id="co-create" num="02" title=${c('secCreate')} sub=${c('createSub')} open=${open} onToggle=${() => ctx.setFold('create', !open)}>
      <${TextField} label=${t('profile.companies.name')} value=${ctx.create.name} placeholder=${c('createPlaceholder')} onInput=${(v) => ctx.setCreateName(v)}
        actions=${html`<${Loud} control disabled=${ctx.busy || slug.length < 2 || avail?.available === false} onClick=${() => ctx.doCreate()}>${c('create')}<//>`} />
      ${slug.length >= 2 ? html`<${AddressPreview} label=${c('addressPreview')} address=${avail?.address || slug}
        state=${!avail ? 'checking' : avail.available ? 'free' : 'taken'} free=${c('free')}
        taken=${avail && !avail.available ? t('profile.companies.reason.' + avail.reason) : ''} />` : null}
      <${Hint}>${c('createHint')}<//>
    <//>`;
}
