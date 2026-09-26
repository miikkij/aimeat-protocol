/**
 * @file public/views/profile/offers/offer-page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One offer as its own page under the Offers crumb: the agent and the offer's cost,
 *   speed, trust and effects as chips; a strip with the latest delivery, the run count, how a
 *   request travels (a queue the agent drains, a prompt you carry, or a schedule fired now) and
 *   whether it is for sale; then what you ask (the ask, the example, the request field and the
 *   button), what to know before asking (effects, requirements, prerequisites, data handling),
 *   what you get back (format, location, a sample), this offer's deliveries, and the selling
 *   editor as a fold. The rail names offers for the same need and the same agent's others.
 * @structure renderOffer · SellingEditor · askWord
 * @usage import { renderOffer } from './offer-page.js';
 * @version-history
 *   v1.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 — 2026-09-26 — An offer's agent is the Tag (.poster-chip; the sun tone on its own page), a unification: Jouni's decision Tag.
 *   v1.10.0 — 2026-09-25 — A prerequisite's state and a muted sender are the Status (a unification: Jouni's decision "Status").
 *   v1.9.0 — 2026-09-25 — The example and what to know before asking are the Facts (facts facts--wide, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.8.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 — 2026-08-30 — Initial.
 *   v1.0.1 — 2026-09-13 — The money hint reads the price through microsFromInput, the same parser the
 *     save uses; its own first-comma replace left the hint off for "1,500.00".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtMoney, microsFromInput } from '/js/utils.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { dispatchMode } from '/js/services/offers.js';
import { runsOf } from './model.js';
import { c, word, agentMark, getWord, statusWord, deliveryRows, rel, renderPage } from './frame.js';

const needLabel = (k) => t('profile.offers.need.' + k) || k;
const conseqWord = (type) => t('profile.offers.consequence.' + type) || type;

/** How a request travels for this offer, in words: the button label and the explanation. */
export function askWord(it) {
  if (it.offer?.availability?.scheduleBorn) return { btn: t('profile.offers.runNow').replace(/^[^\p{L}]+/u, ''), mode: c('modeSchedule'), sub: c('modeScheduleSub') };
  if (dispatchMode(it.entry) === 'task') return { btn: c('ask'), mode: c('modeTask'), sub: c('modeTaskSub') };
  return { btn: t('profile.offers.copyPrompt').replace(/^[^\p{L}]+/u, ''), mode: c('modePrompt'), sub: c('modePromptSub') };
}

/** Visibility and price, saved with setOfferBilling. Its state is its own; the page around it is a render function. */
function SellingEditor({ it, ctx }) {
  const o = it.offer;
  const [vis, setVis] = useState(o.visibility || 'private');
  const [morsels, setMorsels] = useState(o.price?.morsels ?? 0);
  const [moneyAmt, setMoneyAmt] = useState(o.priceMoney ? fmtMoney(o.priceMoney.amount) : '');
  const [moneyCur, setMoneyCur] = useState(o.priceMoney?.currency ?? 'EUR');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const price = Number(morsels) > 0 ? { morsels: Number(morsels), unit: 'per-call' } : null;
    const amt = microsFromInput(moneyAmt);
    await ctx.saveBilling(it, { price, priceMoney: amt ? { amount: amt, currency: moneyCur } : null, visibility: vis });
    setSaving(false);
  };
  const money = microsFromInput(moneyAmt) !== null;
  return html`
    <div class="op-sell">
      <label class="op-field"><span class="poster-label">${c('colVisibility')}</span>
        <select class="select-field" value=${vis} onChange=${(e) => setVis(e.target.value)}>
          ${['private', 'unlisted', 'public'].map(v => html`<option value=${v} key=${v}>${t('profile.offers.visibility.' + v)}</option>`)}
        </select></label>
      <label class="op-field"><span class="poster-label">${t('profile.offers.morsels')} / ${t('profile.offers.perCall')}</span><input class="og-input" type="number" min="0" value=${morsels} onInput=${(e) => setMorsels(e.target.value)} /></label>
      <label class="op-field"><span class="poster-label">${c('colPrice')}</span><input class="og-input" type="text" inputmode="decimal" value=${moneyAmt} placeholder="0.00" onInput=${(e) => setMoneyAmt(e.target.value)} /></label>
      <label class="op-field op-field--cur"><span class="poster-label">EUR / USD</span><select class="select-field" value=${moneyCur} onChange=${(e) => setMoneyCur(e.target.value)}><option value="EUR">EUR</option><option value="USD">USD</option></select></label>
      <div class="op-sell-actions"><button type="button" class="poster-slab poster-slab--control" disabled=${saving} onClick=${save}>${t('profile.offers.saveBilling')}</button></div>
      ${money ? html`<p class="poster-hint op-sell-hint">${t('profile.offers.moneyHint')}</p>` : null}
      ${vis !== 'private' && Number(morsels) > 0 ? html`<p class="poster-hint op-sell-hint">${t('profile.offers.billHint').replace('{n}', morsels)}</p>` : null}
      ${vis !== 'private' && !o.callable ? html`<p class="poster-hint op-sell-hint op-st--err">${t('profile.offers.notCallableHint')}</p>` : null}
    </div>`;
}

export function renderOffer(ctx, it) {
  const m = ctx.model;
  const o = it.offer;
  const runs = runsOf(m, it);
  const last = runs[0] || null;
  const aw = askWord(it);
  const consequences = o.consequences || [];
  const gated = consequences.some(x => x.persistent || x.requiresApproval || ['external-send', 'mutates-host', 'publishes-public'].includes(x.type));
  const prereq = o.prereq || null;
  const blocked = !!prereq?.blocked;
  const blockedReasons = (prereq?.items || []).filter(i => i.hard && !i.ok).map(i => i.label);
  const reqs = o.requirements || [];
  const hasBefore = consequences.length || reqs.length || (prereq && prereq.items?.length) || o.dataHandling;
  const sameNeed = m.askable.filter(x => x.key !== it.key && x.need === it.need).slice(0, 4);
  const sameAgent = m.items.filter(x => x.key !== it.key && x.agent === it.agent);
  const forSale = m.selling.includes(it);
  const input = ctx.askInput[it.key] || '';
  const result = ctx.askResult[it.key] || null;

  const chips = html`
    ${agentMark(it, 'poster-chip--sun')}
    ${o.latency ? html`<span class="poster-chip">${word('latency', o.latency)}</span>` : null}
    ${o.cost ? html`<span class="poster-chip">${word('cost', o.cost)}</span>` : null}
    ${o.verification ? html`<span class="poster-chip">${word('verification', o.verification)}</span>` : null}
    ${o.dataHandling ? html`<span class="poster-chip">${word('dataHandling', o.dataHandling)}</span>` : null}
    ${o.deliverable?.format ? html`<span class="poster-chip">${word('format', o.deliverable.format)}</span>` : null}
    ${consequences.map((x, i) => html`<span class="poster-chip poster-chip--coral" key=${i}>${conseqWord(x.type)}</span>`)}`;
  const doors = html`
    <button type="button" class="poster-slab" onClick=${() => scrollTo('op-what')}>${c('ask')}</button>
    <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('agents')}>${c('agentPage')}</button>
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setSellFoldOpen(v => !v)}>${c('sell')}</button>`;
  const strip = html`
    <div class="og-strip">
      <div>${last ? html`<b class=${`og-strip-coral op-st-${last.status === 'done' ? 'ok' : 'err'}`}>${statusWord(last.status)}</b><span>${c('stripLatest')}</span><small>${rel(last.updated_at)} · ${last.title || ''}</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${t('profile.offers.noRunsYet')}</small>`}</div>
      <div><b>${runs.length}</b><span>${c('stripRuns')}</span><small>${runs.length ? c('stripRatedOf', { n: runs.filter(d => d.rating).length }) : ''}</small></div>
      <div><b class="og-strip-coral">${aw.mode}</b><span>${c('stripMode')}</span><small>${aw.sub}</small></div>
      <div><b>${forSale ? (o.price?.morsels || (o.priceMoney ? fmtMoney(o.priceMoney.amount) : '·')) : '·'}</b><span>${c('sell')}</span><small>${forSale ? `${t('profile.offers.visibility.' + o.visibility)}${o.priceMoney ? ` · ${o.priceMoney.currency}` : ''}` : c('sellPrivate')}</small></div>
    </div>`;
  const rail = html`
    ${sameNeed.length ? html`<hr /><span class="og-rail-label">${c('railSameNeed', { g: needLabel(it.need) })}</span>
      ${sameNeed.map(x => html`<button type="button" class="og-rail-link" key=${x.key} onClick=${() => ctx.pickView({ kind: 'offer', key: x.key })}><i>→</i>${x.offer.title}<em>${x.agent}</em></button>`)}` : null}
    ${sameAgent.length ? html`<hr /><span class="og-rail-label">${c('railSameAgent', { a: it.agent })}</span>
      ${sameAgent.map(x => html`<button type="button" class="og-rail-link" key=${x.key} onClick=${() => ctx.pickView({ kind: 'offer', key: x.key })}><i>→</i>${x.offer.title}</button>`)}` : null}`;

  return renderPage(ctx, {
    id: 'offer', crumbs: [o.title], title: o.title, chips, doors, strip, rail,
    children: html`
      <${PageSection} id="op-what" num="01" title=${c('secWhat')} first=${true}>
        <p class="op-ask">${o.ask}</p>
        ${o.example ? html`<div class="facts facts--wide"><div class="facts-k poster-label">${t('profile.offers.example')}</div><div class="facts-v">${o.example}</div></div>` : null}
        <textarea class="og-textarea op-request" rows="3" placeholder=${t('profile.offers.requestPlaceholder')} value=${input} onInput=${(e) => ctx.setAskInput(it.key, e.target.value)}></textarea>
        <div class="op-ask-row">
          <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy || blocked} onClick=${() => ctx.ask(it)}>${aw.btn}</button>
          ${gated ? html`<span class="op-warn">${c('gatedWarn', { effects: consequences.map(x => conseqWord(x.type)).join(', ') })}</span>` : null}
          ${blocked ? html`<span class="op-warn">${t('profile.offers.blockedReason').replace('{what}', blockedReasons.join(', '))}</span>` : null}
        </div>
        ${result ? html`<div class="op-result">
          ${result.kind === 'prompt' ? t('profile.offers.promptCopied') : result.kind === 'triggered' ? t('profile.offers.triggered') : t('profile.offers.requested').replace('{agent}', it.agent)}
          ${result.kind === 'task' ? html` <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')} →</button>` : null}
          <small>${t('profile.offers.provenance')}: ${it.agent}${result.taskId ? ` · ${t('profile.offers.task')} ${result.taskId}` : ''}</small>
        </div>` : null}
      <//>
      ${hasBefore ? html`<${PageSection} id="op-before" num="02" title=${c('secBefore')}>
        <div class="facts facts--wide">
          ${consequences.length ? html`<div class="facts-k poster-label">${t('profile.offers.consequences')}</div><div class="facts-v">${consequences.map(x => conseqWord(x.type)).join(', ')}${consequences.some(x => x.requiresApproval || x.persistent) ? ` · ${c('lastingNote')}` : ''}</div>` : null}
          ${reqs.length ? html`<div class="facts-k poster-label">${t('profile.offers.requirements')}</div><div class="facts-v">${reqs.map((r, i) => html`<div key=${i}>${r.need}${r.instruction ? html` <span class="poster-hint">${r.instruction}</span>` : null}${r.fix ? html` <b class="op-st--err">${r.fix}</b>` : null}</div>`)}</div>` : null}
          ${prereq && prereq.items?.length ? html`<div class="facts-k poster-label">${t('profile.offers.needsFirst')}</div><div class="facts-v op-prereqs">${prereq.items.map((p, i) => html`<span class=${`poster-status ${p.ok ? 'poster-status--fine' : (p.hard ? 'poster-status--danger' : 'poster-status--attention')}`} key=${i}>${p.ok ? '✓' : (p.hard ? '✗' : '!')} ${p.label}</span>`)}</div>` : null}
          ${o.dataHandling ? html`<div class="facts-k poster-label">${t('profile.offers.facet.dataHandling')}</div><div class="facts-v">${c('data.' + o.dataHandling) || word('dataHandling', o.dataHandling)}</div>` : null}
        </div>
      <//>` : null}
      ${o.deliverable ? html`<${PageSection} id="op-get" num="03" title=${c('secGet')} count=${getWord(o)}>
        ${o.deliverable.sample === 'untested' ? html`<p class="poster-quiet">${t('profile.offers.untested')}</p>`
          : o.deliverable.sample ? html`<div class="op-frame poster-box"><span class="poster-label">${c('sampleLabel')}</span><div class="op-sample"><${DeliverableBody} value=${o.deliverable.sample} alt=${o.title} format=${o.deliverable.format} /></div></div>`
          : html`<p class="poster-quiet">${c('noSample')}</p>`}
      <//>` : null}
      <${PageSection} id="op-runs" num="04" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? deliveryRows(ctx, runs) : html`<p class="poster-quiet">${t('profile.offers.noRunsYet')}</p>`}
      <//>
      <${FoldSection} id="op-sellfold" num="05" title=${c('sell')} sub=${forSale ? c('sellingSub', { n: 1 }) : c('sellSub')} open=${ctx.sellFoldOpen} onToggle=${() => ctx.setSellFoldOpen(v => !v)}>
        <${SellingEditor} key=${it.key} it=${it} ctx=${ctx} />
      <//>`,
  });
}
