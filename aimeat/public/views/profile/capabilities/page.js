/**
 * @file public/views/profile/capabilities/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Capabilities page in the poster face: the agent's view of this node. The mast and
 *   the strip; four shelves as rows grouped by provider (extension actions, app tools, agent offers,
 *   hand-added and other), each with a filter row and a search; the hand-added form when the policy
 *   allows it; and the section with the rule an AI gets and the facts of a call (who may call, trust,
 *   what is counted). What opens under a row is rows.js. The page explains itself the designed way
 *   (.claude/rules/page-guidance.md): the page's start (PageStart "capabilities") and the title's
 *   question mark (concept.node_capability). Pure render over the ctx bag.
 * @structure renderPage · shelf · secOther · secAgent
 * @usage import { renderPage } from './capabilities/page.js';
 * @version-history
 *   v1.23.0 -- 2026-11-27 -- The filter row is drawn only over a shelf of more than ten (Filters total).
 *   v1.22.0 -- 2026-11-27 -- Usability pass. The strip says what an agent finds here and how much of it
 *     it can call, what is the person's own, what the operator rejected of theirs (notice tone, only
 *     then) and the calls, with hideZeros; the head's tags, which repeated it, go. A shelf is drawn
 *     only when it holds something; with nothing at all the first shelf's one line says what fills the
 *     page. A rejected entry of the person's own is first on its shelf. "Hand-added and other" is a
 *     fold that says whether adding by hand is open here until something is in it, and "Calls, trust
 *     and the rule for your AI" (formerly a clause as a heading) is a fold that says how calls are
 *     counted. Numbered after the filter; the rail only with two or more sections. Nothing was removed.
 *   v1.21.0 -- 2026-11-08 -- The hand-added form's Webhook address and "Visible to agents" open their
 *     explanations (help capabilities.webhook, capabilities.public). The line beside the Add button
 *     (capspage.formHint) goes: the webhook's explanation says what it said, and FormActions loses
 *     `apart`, which only spread that line from the button.
 *   v1.20.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "capabilities" in the start slot and the title's question mark concept.node_capability.
 *     Section 05 loses its lead paragraph (capspage.aiIntro) and the "Two catalogues" row
 *     (capspage.aiTwoK, aiTwoBody), which explained the concept; the concept says it now, and the
 *     section keeps the rule to copy and the facts of a call.
 *   v1.19.1 -- 2026-10-16 -- The policy line no longer names who may publish: the node enforced no such setting (QA audit D8-05).
 *   v1.19.0 -- 2026-09-26 -- On the component kit (page group G7): the frame is the SettingsPage (crumb, head with its tags as data, the loud copy, the rail's sections and sibling pages), the strip the FigureStrip, a shelf's filters, search line, rows and more line the List, the hand-added form the FoldRow over the Fields, the rule an AI gets the Box, the facts the Facts. The vouches tag counts nothing yet in the dim tone again (main's og-chip--dim). The page writes no class.
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
import { PageSection } from '/components/PageSection.js';
import { Section } from '/components/Section.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { x, crumb, pageLinks, agentRule, openTab } from './frame.js';
import { providerRow, loadingRow } from './rows.js';
import { shownToAgents } from './publish.js';
import { Hint } from '/components/Hint.js';
import { Note } from '/components/Note.js';
import { Label } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { List, Filters, Filter, SearchLine, More } from '/components/List.js';
import { FoldRow } from '/components/Folds.js';
import { Space } from '/components/Layout.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { PageStart } from '/components/PageStart.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
const head = (key) => [x('col.' + key), x('colGives'), x('colAgent'), ''];
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
  const canCreate = ctx.policy && ctx.policy.publishing !== 'disabled';
  // What needs the person: an entry of their own the operator rejected, which no agent finds.
  const rejected = own.filter((g) => g.status === 'rejected').length;
  const hidden = own.filter((g) => !shownToAgents(g)).length;

  // The figures, from the registry the page already read: everything an agent finds here and how
  // much of it runs here, what is the person's own, what of theirs was rejected (only then), and the
  // calls. With nothing in the registry the strip is not drawn (hideZeros: the first figure counts all).
  const strip = !groups ? html`<${FigureStrip} loading=${3} />` : html`<${FigureStrip} hideZeros items=${[
    { key: 'all', n: members(all), label: x('stripAll'), sub: x('stripAllSub', { n: callable }) },
    { key: 'own', n: own.length, label: x('stripOwn'), sub: own.length ? (hidden ? x('stripOwnHidden', { n: hidden }) : x('stripOwnShown')) : x('chipNone') },
    rejected ? { key: 'rejected', n: rejected, tone: 'notice', label: x('stripRejected'), sub: x('stripRejectedSub') } : null,
    { key: 'calls', n: calls, label: x('stripCalls'), sub: ctx.policy?.call_counting ? x('countAll') : x('countRegistry') },
  ]} />`;

  const actions = html`
    <${Loud} copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))}>${x('copyRule')}<//>
    <${Actions}><${Action} small onClick=${() => openTab('extensions')}>${t('profile.tabs.extensions')}<//><//>`;

  // What is drawn: a shelf only when it holds something, and with nothing at all the extension shelf
  // with the page's one line; "Hand-added and other" and the rule for one's AI always, as a fold
  // until the first holds something. Numbered after the filter, so a missing shelf leaves no gap.
  const empty = !!groups && all.length === 0;
  const drawn = [
    !groups || ext.length || empty ? { id: 'cp-ext', label: x('secExt'), count: groups ? ext.length : '' } : null,
    app.length ? { id: 'cp-app', label: x('secApp'), count: app.length } : null,
    agent.length ? { id: 'cp-agent', label: x('secAgent'), count: agent.length } : null,
    { id: 'cp-other', label: x('secOther'), count: groups ? other.length : '' },
    { id: 'cp-ai', label: x('secAi') },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(drawn.map((s) => [s.id, s.num]));
  const firstId = drawn[0]?.id;

  // The start: the first thing is a search the person's AI makes, which this page cannot see, so it
  // stays open until the person folds it.
  const start = html`<${PageStart} id="capabilities" />`;
  return html`
    <${SettingsPage} name="caps" crumb=${crumb()} title=${t('capabilities.tabLabel')} help="concept.node_capability" sub=${x('titleSub')}
      desc=${none ? x('descEmpty') : x('desc')} actions=${actions} start=${start} strip=${strip}
      railTitle=${x('railTitle')} sections=${drawn.length > 1 ? drawn : undefined} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${numOf['cp-ext'] ? shelf(ctx, 'ext', numOf['cp-ext'], x('secExt'), groups ? x('secExtSub', { actions: members(ext), ext: ext.length }) : null, ext, firstId === 'cp-ext') : null}
      ${numOf['cp-app'] ? shelf(ctx, 'app', numOf['cp-app'], x('secApp'), x('secAppSub', { tools: members(app), apps: app.length }), app, firstId === 'cp-app') : null}
      ${numOf['cp-agent'] ? shelf(ctx, 'agent', numOf['cp-agent'], x('secAgent'), x('secAgentSub', { offers: members(agent), agents: agent.length }), agent, firstId === 'cp-agent') : null}
      ${secOther(ctx, numOf['cp-other'], other, canCreate)}
      ${secAgent(ctx, numOf['cp-ai'], all, calls, vouches)}
    <//>`;
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
  // An entry of the person's own that the operator rejected comes first, then their own, then the most called.
  const rejectedOwn = (g) => (g.own && g.status === 'rejected' ? 1 : 0);
  rows = rows.slice().sort((a, b) => (rejectedOwn(b) - rejectedOwn(a)) || (b.own - a.own) || (b.calls - a.calls) || a.name.localeCompare(b.name));
  const shown = rows.slice(0, ctx.shown[key]);
  const set = (patch) => ctx.setFilter(key, patch);
  const tog = (field, value) => set({ [field]: F[field] === value ? '' : value });
  const ids = { ext: 'cp-ext', app: 'cp-app', agent: 'cp-agent' };
  // A shelf is drawn empty only when the whole registry is: its one line says what fills the page.
  return html`
    <${PageSection} id=${ids[key]} num=${num} title=${title} count=${sub} first=${first}>
      ${!ctx.groups ? loadingRow() : !list.length ? html`<${Note} kind="quiet">${x('emptyAll')}<//>` : html`
        <${Filters} total=${list.length}>
          ${facet(!F.who && !F.use && !F.priced && !F.vouched, x('facetAll'), list.length, () => set({ who: '', use: '', priced: false, vouched: false }), 'all')}
          ${facet(F.who === 'own', x('facetOwn'), count((g) => g.own), () => tog('who', 'own'), 'own')}
          ${facet(F.who === 'others', x('facetOthers'), count((g) => !g.own), () => tog('who', 'others'), 'others')}
          ${facet(F.use === 'called', x('facetCalled'), count((g) => g.calls > 0), () => tog('use', 'called'), 'called')}
          ${facet(F.use === 'never', x('facetNever'), count((g) => g.calls === 0), () => tog('use', 'never'), 'never')}
          ${count((g) => g.priced) ? facet(!!F.priced, x('facetPriced'), count((g) => g.priced), () => set({ priced: !F.priced }), 'priced') : null}
          ${count((g) => g.vouches > 0) ? facet(!!F.vouched, x('facetVouched'), count((g) => g.vouches > 0), () => set({ vouched: !F.vouched }), 'vouched') : null}
        <//>
        <${SearchLine} value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} note=${x('searchOrder')} />
        <${List} cols="name-desc-call-doors" head=${head(key)} empty=${x('noMatch')}>
          ${shown.map((g) => providerRow(ctx, g))}
        <//>
        <${More} note=${x('shownOf', { shown: shown.length, total: rows.length })}
          label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
          onMore=${shown.length < rows.length ? () => ctx.setShown(key, ctx.shown[key] + PAGE) : null} />
        <${Hint}>${x('hint.' + key)}<//>`}
    <//>`;
}

/* ── Hand-added and other: manual webhooks, ecosystem apps, the old action list; the form ──────── */

/**
 * Open once something is in it; until then a fold whose row says whether adding by hand is open here.
 * The policy facts and the form are the same in both.
 */
function secOther(ctx, num, other, canCreate) {
  const f = ctx.form;
  const fold = !!ctx.groups && other.length === 0;
  const props = fold
    ? { fold: true, sub: ctx.policy ? (canCreate ? x('stripOtherOn') : x('stripOtherOff')) : '', open: ctx.otherOpen, onToggle: ctx.toggleOtherOpen }
    : { count: ctx.groups ? x('secOtherSub', { n: other.length }) : null };
  return html`
    <${Section} id="cp-other" num=${num} title=${x('secOther')} ...${props}>
      ${!ctx.groups ? loadingRow() : html`
        ${other.length ? html`<${List} cols="name-desc-call-doors" head=${head('other')}>
          ${other.map((g) => providerRow(ctx, g))}
        <//>` : null}
        <${Facts} wide rows=${[
          { k: x('manualK'), v: x('manualBody'), sub: canCreate ? x('manualOn') : x('manualOff', { policy: x('policy.' + (ctx.policy?.publishing || 'disabled')) }) },
          { k: x('policyK'), v: x('policyBody', { publishing: x('policy.' + (ctx.policy?.publishing || 'disabled')), webhooks: x('webhooks.' + (ctx.policy?.webhooks || 'disabled')) }), sub: x('policySub') },
        ]} />
        ${canCreate ? html`
          <${Space} above="large">
            <${FoldRow} kind="toggle" name=${x('addManual')} right=${x('addManualSub')} open=${!!f.open} onClick=${() => ctx.setForm({ open: !f.open })} />
          <//>
          ${f.open ? html`
            <${Space} above="large">
              <${Fields} cols=${2}>
                <${TextField} label=${x('formName')} value=${f.name} onInput=${(name) => ctx.setForm({ name })} />
                <${TextField} label=${x('formWebhook')} help="capabilities.webhook" placeholder="https://" value=${f.webhookUrl} onInput=${(webhookUrl) => ctx.setForm({ webhookUrl })} />
                <${TextArea} wide label=${x('formSummary')} rows=${2} value=${f.summary} onInput=${(summary) => ctx.setForm({ summary })} />
                <${TextField} label=${x('formTags')} value=${f.tags} onInput=${(tags) => ctx.setForm({ tags })} />
                <${Check} help="capabilities.public" checked=${f.visibility === 'public'} onChange=${(on) => ctx.setForm({ visibility: on ? 'public' : 'private' })}>${x('formPublic')}<//>
              <//>
              <${FormActions}>
                <${Action} small disabled=${ctx.busy === 'create' || !f.name.trim()} onClick=${() => ctx.createManual()}>${x('formCreate')}<//>
              <//>
            <//>` : null}` : null}`}
    <//>`;
}

/* ── How an agent finds and calls ─────────────────────────────────────────────────────────────── */

/** Calls, trust and the rule for one's AI: a fold whose row says how calls are counted here. */
function secAgent(ctx, num, all, calls, vouches) {
  return html`
    <${Section} fold id="cp-ai" num=${num} title=${x('secAi')} sub=${ctx.policy ? (ctx.policy.call_counting ? x('countAll') : x('countRegistry')) : ''}
      open=${ctx.aiOpen} onToggle=${ctx.toggleAiOpen}>
      <${Box} doors=${html`<${Action} small copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')}>${x('copyRule')}<//>`}>
        <${Label} block>${x('ruleLabel')}<//>
        <${Note} kind="lead">${x('ruleBody', { base: ctx.nodeUrl })}<//>
      <//>
      <${Facts} wide rows=${[
        { k: x('aiWhoK'), v: x('aiWhoBody') },
        { k: x('aiTrustK'), v: x('aiTrustBody'), sub: vouches ? x('aiTrustSub', { n: vouches }) : x('aiTrustNone') },
        { k: x('aiCallsK'), v: ctx.policy?.call_counting ? x('aiCallsOn', { n: calls }) : x('aiCallsOff', { n: calls }) },
      ]} />
    <//>`;
}
