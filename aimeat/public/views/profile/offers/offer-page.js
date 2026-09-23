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
 *   2026-09-22 -- Composed from the shared component set (NumeralBand strip, Section, Fold,
 *     KeyValue, Field, Surface, Action); no own CSS. Behaviour and words unchanged.
 *   v1.0.0 — 2026-08-30 — Initial.
 *   v1.0.1 — 2026-09-13 — The money hint reads the price through microsFromInput, the same parser the
 *     save uses; its own first-comma replace left the hint off for "1,500.00".
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtMoney, microsFromInput } from '/js/utils.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { Section, Fold, Stack, Columns, KeyValue, Field, Action, Text, Surface, NumeralBand } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { dispatchMode } from '/js/services/offers.js';
import { runsOf } from './model.js';
import { c, word, agentMark, getWord, statusWord, deliveryRows, rel, chipRow, railList, renderPage } from './frame.js';

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
  return html`<${Stack}>
    <${Columns} layout="quarters" collapse="640" density="compact">
      <${Field} type="select" label=${c('colVisibility')} value=${vis} onChange=${(e) => setVis(e.target.value)}
        options=${['private', 'unlisted', 'public'].map(v => ({ value: v, label: t('profile.offers.visibility.' + v) }))} />
      <${Field} type="number" min="0" label=${`${t('profile.offers.morsels')} / ${t('profile.offers.perCall')}`} value=${morsels} onInput=${(e) => setMorsels(e.target.value)} />
      <${Field} type="text" label=${c('colPrice')} value=${moneyAmt} placeholder="0.00" onInput=${(e) => setMoneyAmt(e.target.value)} />
      <${Field} type="select" label="EUR / USD" value=${moneyCur} onChange=${(e) => setMoneyCur(e.target.value)}
        options=${[{ value: 'EUR', label: 'EUR' }, { value: 'USD', label: 'USD' }]} />
    <//>
    <${Stack} direction="horizontal" align="start"><${Action} kind="primary" disabled=${saving} onClick=${save}>${t('profile.offers.saveBilling')}<//><//>
    ${money ? html`<${Text} kind="caption" tone="muted">${t('profile.offers.moneyHint')}<//>` : null}
    ${vis !== 'private' && Number(morsels) > 0 ? html`<${Text} kind="caption" tone="muted">${t('profile.offers.billHint').replace('{n}', morsels)}<//>` : null}
    ${vis !== 'private' && !o.callable ? html`<${Text} kind="caption" tone="danger">${t('profile.offers.notCallableHint')}<//>` : null}
  <//>`;
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

  const chips = chipRow([
    [agentMark(it), 'sun'],
    o.latency && [word('latency', o.latency)],
    o.cost && [word('cost', o.cost)],
    o.verification && [word('verification', o.verification)],
    o.dataHandling && [word('dataHandling', o.dataHandling), 'muted'],
    o.deliverable?.format && [word('format', o.deliverable.format), 'muted'],
    ...consequences.map(x => [conseqWord(x.type), 'sun']),
  ]);
  const doors = html`
    <${Action} kind="primary" onClick=${() => scrollTo('op-what')}>${c('ask')}<//>
    <${Action} onClick=${() => ctx.openTab('agents')}>${c('agentPage')}<//>
    <${Action} onClick=${() => ctx.setSellFoldOpen(v => !v)}>${c('sell')}<//>`;
  const strip = html`<${NumeralBand} tone="plain" items=${[
    last ? { label: c('stripLatest'), value: statusWord(last.status), note: `${rel(last.updated_at)} · ${last.title || ''}`, tone: 'coral' }
      : { label: c('stripLatest'), value: '·', note: t('profile.offers.noRunsYet') },
    { label: c('stripRuns'), value: runs.length, note: runs.length ? c('stripRatedOf', { n: runs.filter(d => d.rating).length }) : undefined },
    { label: c('stripMode'), value: aw.mode, note: aw.sub, tone: 'coral' },
    { label: c('sell'), value: forSale ? (o.price?.morsels || (o.priceMoney ? fmtMoney(o.priceMoney.amount) : '·')) : '·', note: forSale ? `${t('profile.offers.visibility.' + o.visibility)}${o.priceMoney ? ` · ${o.priceMoney.currency}` : ''}` : c('sellPrivate') },
  ]} />`;
  const rail = html`
    ${sameNeed.length ? railList(c('railSameNeed', { g: needLabel(it.need) }), sameNeed.map(x => ({ key: x.key, label: `${x.offer.title} · ${x.agent}`, onClick: () => ctx.pickView({ kind: 'offer', key: x.key }) }))) : null}
    ${sameAgent.length ? railList(c('railSameAgent', { a: it.agent }), sameAgent.map(x => ({ key: x.key, label: x.offer.title, onClick: () => ctx.pickView({ kind: 'offer', key: x.key }) }))) : null}`;

  return renderPage(ctx, {
    id: 'offer', crumbs: [o.title], title: o.title, chips, doors, strip, rail,
    children: html`
      <${Section} id="op-what" title=${c('secWhat')}>
        <${Stack}>
          <${Text} kind="lead">${o.ask}<//>
          ${o.example ? html`<${KeyValue} label=${t('profile.offers.example')} value=${o.example} />` : null}
          <${Field} type="textarea" rows="3" placeholder=${t('profile.offers.requestPlaceholder')} value=${input} onInput=${(e) => ctx.setAskInput(it.key, e.target.value)} />
          <${Stack} direction="wrap" align="center">
            <${Action} kind="primary" disabled=${ctx.busy || blocked} onClick=${() => ctx.ask(it)}>${aw.btn}<//>
            ${gated ? html`<${Text} kind="caption" tone="danger">${c('gatedWarn', { effects: consequences.map(x => conseqWord(x.type)).join(', ') })}<//>` : null}
            ${blocked ? html`<${Text} kind="caption" tone="danger">${t('profile.offers.blockedReason').replace('{what}', blockedReasons.join(', '))}<//>` : null}
          <//>
          ${result ? html`<${Surface} kind="box" tone="sun" density="compact"><${Stack} density="compact">
            <${Stack} direction="wrap" align="center">
              <${Text}>${result.kind === 'prompt' ? t('profile.offers.promptCopied') : result.kind === 'triggered' ? t('profile.offers.triggered') : t('profile.offers.requested').replace('{agent}', it.agent)}<//>
              ${result.kind === 'task' ? html`<${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')} →<//>` : null}
            <//>
            <${Text} kind="mono" tone="muted">${t('profile.offers.provenance')}: ${it.agent}${result.taskId ? ` · ${t('profile.offers.task')} ${result.taskId}` : ''}<//>
          <//><//>` : null}
        <//>
      <//>
      ${hasBefore ? html`<${Section} id="op-before" title=${c('secBefore')}>
        ${consequences.length ? html`<${KeyValue} label=${t('profile.offers.consequences')} value=${`${consequences.map(x => conseqWord(x.type)).join(', ')}${consequences.some(x => x.requiresApproval || x.persistent) ? ` · ${c('lastingNote')}` : ''}`} />` : null}
        ${reqs.length ? html`<${KeyValue} label=${t('profile.offers.requirements')} value=${html`<${Stack} density="compact">${reqs.map((r, i) => html`<${Text} key=${i}>${r.need}${r.instruction ? html` <${Text} kind="caption" tone="muted">${r.instruction}<//>` : null}${r.fix ? html` <${Text} kind="caption" tone="danger">${r.fix}<//>` : null}<//>`)}<//>`} />` : null}
        ${prereq && prereq.items?.length ? html`<${KeyValue} label=${t('profile.offers.needsFirst')} value=${html`<${Stack} direction="wrap" density="compact">${prereq.items.map((p, i) => html`<${Text} key=${i} kind="mono" tone=${p.ok ? 'success' : (p.hard ? 'danger' : 'coral')}>${p.ok ? '✓' : (p.hard ? '✗' : '!')} ${p.label}<//>`)}<//>`} />` : null}
        ${o.dataHandling ? html`<${KeyValue} label=${t('profile.offers.facet.dataHandling')} value=${c('data.' + o.dataHandling) || word('dataHandling', o.dataHandling)} />` : null}
      <//>` : null}
      ${o.deliverable ? html`<${Section} id="op-get" title=${c('secGet')} count=${getWord(o)}>
        ${o.deliverable.sample === 'untested' ? html`<${Text} tone="muted">${t('profile.offers.untested')}<//>`
          : o.deliverable.sample ? html`<${Surface} kind="box"><${Stack} density="compact"><${Text} kind="label">${c('sampleLabel')}<//><${DeliverableBody} value=${o.deliverable.sample} alt=${o.title} format=${o.deliverable.format} /><//><//>`
          : html`<${Text} tone="muted">${c('noSample')}<//>`}
      <//>` : null}
      <${Section} id="op-runs" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? deliveryRows(ctx, runs) : html`<${Text} tone="muted">${t('profile.offers.noRunsYet')}<//>`}
      <//>
      <${Fold} id="op-sellfold" number="05" title=${c('sell')} sub=${forSale ? c('sellingSub', { n: 1 }) : c('sellSub')} open=${ctx.sellFoldOpen} onToggle=${() => ctx.setSellFoldOpen(v => !v)}>
        <${SellingEditor} key=${it.key} it=${it} ctx=${ctx} />
      <//>`,
  });
}
