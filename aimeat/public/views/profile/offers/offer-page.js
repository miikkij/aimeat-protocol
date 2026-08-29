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
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtMoney, microsFromInput } from '/js/utils.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
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
  const money = Number(String(moneyAmt).replace(',', '.')) > 0;
  return html`
    <div class="op-sell">
      <label class="op-field"><span class="og-label">${c('colVisibility')}</span>
        <select value=${vis} onChange=${(e) => setVis(e.target.value)}>
          ${['private', 'unlisted', 'public'].map(v => html`<option value=${v} key=${v}>${t('profile.offers.visibility.' + v)}</option>`)}
        </select></label>
      <label class="op-field"><span class="og-label">${t('profile.offers.morsels')} / ${t('profile.offers.perCall')}</span><input type="number" min="0" value=${morsels} onInput=${(e) => setMorsels(e.target.value)} /></label>
      <label class="op-field"><span class="og-label">${c('colPrice')}</span><input type="text" inputmode="decimal" value=${moneyAmt} placeholder="0.00" onInput=${(e) => setMoneyAmt(e.target.value)} /></label>
      <label class="op-field op-field--cur"><span class="og-label">EUR / USD</span><select value=${moneyCur} onChange=${(e) => setMoneyCur(e.target.value)}><option value="EUR">EUR</option><option value="USD">USD</option></select></label>
      <div class="op-sell-actions"><button type="button" class="og-slab" disabled=${saving} onClick=${save}>${t('profile.offers.saveBilling')}</button></div>
      ${money ? html`<p class="op-hint op-sell-hint">${t('profile.offers.moneyHint')}</p>` : null}
      ${vis !== 'private' && Number(morsels) > 0 ? html`<p class="op-hint op-sell-hint">${t('profile.offers.billHint').replace('{n}', morsels)}</p>` : null}
      ${vis !== 'private' && !o.callable ? html`<p class="op-hint op-sell-hint op-st--err">${t('profile.offers.notCallableHint')}</p>` : null}
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
    <span class="og-chip og-chip--sun op-chip--case">${agentMark(it)}</span>
    ${o.latency ? html`<span class="og-chip">${word('latency', o.latency)}</span>` : null}
    ${o.cost ? html`<span class="og-chip">${word('cost', o.cost)}</span>` : null}
    ${o.verification ? html`<span class="og-chip">${word('verification', o.verification)}</span>` : null}
    ${o.dataHandling ? html`<span class="og-chip og-chip--dim">${word('dataHandling', o.dataHandling)}</span>` : null}
    ${o.deliverable?.format ? html`<span class="og-chip og-chip--dim">${word('format', o.deliverable.format)}</span>` : null}
    ${consequences.map((x, i) => html`<span class="og-chip og-chip--coral" key=${i}>${conseqWord(x.type)}</span>`)}`;
  const doors = html`
    <button type="button" class="og-slab" onClick=${() => scrollTo('op-what')}>${c('ask')}</button>
    <button type="button" class="og-door" onClick=${() => ctx.openTab('agents')}>${c('agentPage')}</button>
    <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setSellFoldOpen(v => !v)}>${c('sell')}</button>`;
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
      <${Section} id="op-what" num="01" title=${c('secWhat')} first=${true}>
        <p class="op-ask">${o.ask}</p>
        ${o.example ? html`<div class="op-kv"><div class="k">${t('profile.offers.example')}</div><div>${o.example}</div></div>` : null}
        <textarea class="op-request" rows="3" placeholder=${t('profile.offers.requestPlaceholder')} value=${input} onInput=${(e) => ctx.setAskInput(it.key, e.target.value)}></textarea>
        <div class="op-ask-row">
          <button type="button" class="og-slab" disabled=${ctx.busy || blocked} onClick=${() => ctx.ask(it)}>${aw.btn}</button>
          ${gated ? html`<span class="op-warn">${c('gatedWarn', { effects: consequences.map(x => conseqWord(x.type)).join(', ') })}</span>` : null}
          ${blocked ? html`<span class="op-warn">${t('profile.offers.blockedReason').replace('{what}', blockedReasons.join(', '))}</span>` : null}
        </div>
        ${result ? html`<div class="op-result">
          ${result.kind === 'prompt' ? t('profile.offers.promptCopied') : result.kind === 'triggered' ? t('profile.offers.triggered') : t('profile.offers.requested').replace('{agent}', it.agent)}
          ${result.kind === 'task' ? html` <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')} →</button>` : null}
          <small>${t('profile.offers.provenance')}: ${it.agent}${result.taskId ? ` · ${t('profile.offers.task')} ${result.taskId}` : ''}</small>
        </div>` : null}
      <//>
      ${hasBefore ? html`<${Section} id="op-before" num="02" title=${c('secBefore')}>
        <div class="op-kv">
          ${consequences.length ? html`<div class="k">${t('profile.offers.consequences')}</div><div>${consequences.map(x => conseqWord(x.type)).join(', ')}${consequences.some(x => x.requiresApproval || x.persistent) ? ` · ${c('lastingNote')}` : ''}</div>` : null}
          ${reqs.length ? html`<div class="k">${t('profile.offers.requirements')}</div><div>${reqs.map((r, i) => html`<div key=${i}>${r.need}${r.instruction ? html` <span class="op-hint">${r.instruction}</span>` : null}${r.fix ? html` <b class="op-st--err">${r.fix}</b>` : null}</div>`)}</div>` : null}
          ${prereq && prereq.items?.length ? html`<div class="k">${t('profile.offers.needsFirst')}</div><div class="op-prereqs">${prereq.items.map((p, i) => html`<span class=${`op-pre ${p.ok ? 'op-pre--ok' : (p.hard ? 'op-pre--blocked' : 'op-pre--warn')}`} key=${i}>${p.ok ? '✓' : (p.hard ? '✗' : '!')} ${p.label}</span>`)}</div>` : null}
          ${o.dataHandling ? html`<div class="k">${t('profile.offers.facet.dataHandling')}</div><div>${c('data.' + o.dataHandling) || word('dataHandling', o.dataHandling)}</div>` : null}
        </div>
      <//>` : null}
      ${o.deliverable ? html`<${Section} id="op-get" num="03" title=${c('secGet')} count=${getWord(o)}>
        ${o.deliverable.sample === 'untested' ? html`<p class="og-empty">${t('profile.offers.untested')}</p>`
          : o.deliverable.sample ? html`<div class="op-frame"><span class="og-label">${c('sampleLabel')}</span><div class="op-sample"><${DeliverableBody} value=${o.deliverable.sample} alt=${o.title} format=${o.deliverable.format} /></div></div>`
          : html`<p class="og-empty">${c('noSample')}</p>`}
      <//>` : null}
      <${Section} id="op-runs" num="04" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? deliveryRows(ctx, runs) : html`<p class="og-empty">${t('profile.offers.noRunsYet')}</p>`}
      <//>
      <${Fold} id="op-sellfold" num="05" title=${c('sell')} sub=${forSale ? c('sellingSub', { n: 1 }) : c('sellSub')} open=${ctx.sellFoldOpen} onToggle=${() => ctx.setSellFoldOpen(v => !v)}>
        <${SellingEditor} key=${it.key} it=${it} ctx=${ctx} />
      <//>`,
  });
}
