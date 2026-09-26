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
 *   editor as a fold. The rail names offers for the same need and the same agent's others. Made of
 *   the component kit: the page passes data and never a class.
 * @structure renderOffer · SellingEditor · askWord
 * @usage import { renderOffer } from './offer-page.js';
 * @version-history
 *   v2.0.0 — 2026-09-26 — Every part is a component call that gets data (page group G6): the frame
 *     is renderPage (SettingsPage), the tags data (the data handling and the format the dim Tag
 *     again, main's og-chip--dim, which the previous branch lost), the strip FigureStrip (the latest
 *     state a word in the fine colour or coral), the rail's own lists rail groups; the ask the lead,
 *     the request a TextArea, the send the loud action with the warnings beside it as the small
 *     attention note (solid for an effect that cannot be undone), what the request did the sun-edged
 *     Box with its typewriter line; before asking the Facts (a requirement's fix a coral word, the
 *     prerequisites Status marks); the sample a scrolling Box; the selling editor Fields of four with
 *     its hints. The page writes no class.
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
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Row, Space } from '/components/Layout.js';
import { scrollToSection } from '/components/Rail.js';
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
    <${Fields} cols=${4}>
      <${Select} label=${c('colVisibility')} value=${vis} onChange=${setVis}
        options=${['private', 'unlisted', 'public'].map(v => [v, t('profile.offers.visibility.' + v)])} />
      <${TextField} label=${`${t('profile.offers.morsels')} / ${t('profile.offers.perCall')}`} type="number" min="0" value=${morsels} onInput=${setMorsels} />
      <${TextField} label=${c('colPrice')} inputMode="decimal" value=${moneyAmt} placeholder="0.00" onInput=${setMoneyAmt} />
      <${Select} label="EUR / USD" value=${moneyCur} onChange=${setMoneyCur} options=${['EUR', 'USD']} />
    <//>
    <${Space} above="medium">
      <${FormActions}><${Loud} control disabled=${saving} onClick=${save}>${t('profile.offers.saveBilling')}<//><//>
    <//>
    ${money ? html`<${Note}>${t('profile.offers.moneyHint')}<//>` : null}
    ${vis !== 'private' && Number(morsels) > 0 ? html`<${Note}>${t('profile.offers.billHint').replace('{n}', morsels)}<//>` : null}
    ${vis !== 'private' && !o.callable ? html`<${Note}><${Tinted} tone="notice">${t('profile.offers.notCallableHint')}<//><//>` : null}`;
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
  const openOther = (x) => () => ctx.pickView({ kind: 'offer', key: x.key });

  const marks = [
    agentMark(it, 'sun'),
    o.latency ? { label: word('latency', o.latency) } : null,
    o.cost ? { label: word('cost', o.cost) } : null,
    o.verification ? { label: word('verification', o.verification) } : null,
    o.dataHandling ? { label: word('dataHandling', o.dataHandling), tone: 'dim' } : null,
    o.deliverable?.format ? { label: word('format', o.deliverable.format), tone: 'dim' } : null,
    ...consequences.map((x) => ({ label: conseqWord(x.type), tone: 'coral' })),
  ];
  const actions = html`
    <${Loud} onClick=${() => scrollToSection('op-what')}>${c('ask')}<//>
    <${Action} small onClick=${() => ctx.openTab('agents')}>${c('agentPage')}<//>
    <${Action} small soft onClick=${() => ctx.setSellFoldOpen(v => !v)}>${c('sell')}<//>`;
  const strip = html`<${FigureStrip} items=${[
    last
      ? { key: 'latest', n: statusWord(last.status), tone: last.status === 'done' ? 'word fine' : 'coral', label: c('stripLatest'), sub: `${rel(last.updated_at)} · ${last.title || ''}` }
      : { key: 'latest', n: '·', label: c('stripLatest'), sub: t('profile.offers.noRunsYet') },
    { key: 'runs', n: runs.length, label: c('stripRuns'), sub: runs.length ? c('stripRatedOf', { n: runs.filter(d => d.rating).length }) : '' },
    { key: 'mode', n: aw.mode, tone: 'coral', label: c('stripMode'), sub: aw.sub },
    { key: 'sell', n: forSale ? (o.price?.morsels || (o.priceMoney ? fmtMoney(o.priceMoney.amount) : '·')) : '·', label: c('sell'), sub: forSale ? `${t('profile.offers.visibility.' + o.visibility)}${o.priceMoney ? ` · ${o.priceMoney.currency}` : ''}` : c('sellPrivate') },
  ]} />`;
  const rail = [
    sameNeed.length ? { label: c('railSameNeed', { g: needLabel(it.need) }), items: sameNeed.map(x => ({ key: x.key, mark: '→', label: x.offer.title, count: x.agent, onClick: openOther(x) })) } : null,
    sameAgent.length ? { label: c('railSameAgent', { a: it.agent }), items: sameAgent.map(x => ({ key: x.key, mark: '→', label: x.offer.title, onClick: openOther(x) })) } : null,
  ].filter(Boolean);

  return renderPage(ctx, {
    id: 'offer', crumbs: [o.title], title: o.title, marks, actions, strip, rail,
    children: html`
      <${Section} id="op-what" num="01" title=${c('secWhat')} first=${true}>
        <${Note} kind="lead">${o.ask}<//>
        ${o.example ? html`<${Facts} wide rows=${[{ k: t('profile.offers.example'), v: o.example }]} />` : null}
        <${Space} above="large">
          <${TextArea} rows=${3} placeholder=${t('profile.offers.requestPlaceholder')} value=${input} onInput=${(v) => ctx.setAskInput(it.key, v)} />
        <//>
        <${Row} gap="large" wrap above="medium">
          <${Loud} control disabled=${ctx.busy || blocked} onClick=${() => ctx.ask(it)}>${aw.btn}<//>
          ${gated ? html`<${Note} kind="aside" size="small" tone="irreversible">${c('gatedWarn', { effects: consequences.map(x => conseqWord(x.type)).join(', ') })}<//>` : null}
          ${blocked ? html`<${Note} kind="aside" size="small">${t('profile.offers.blockedReason').replace('{what}', blockedReasons.join(', '))}<//>` : null}
        <//>
        ${result ? html`<${Box} tone="edge">
          <b>${result.kind === 'prompt' ? t('profile.offers.promptCopied') : result.kind === 'triggered' ? t('profile.offers.triggered') : t('profile.offers.requested').replace('{agent}', it.agent)}</b>
          ${result.kind === 'task' ? html` <${Action} small soft onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')} →<//>` : null}
          <${Note} kind="meta" mono>${t('profile.offers.provenance')}: ${it.agent}${result.taskId ? ` · ${t('profile.offers.task')} ${result.taskId}` : ''}<//>
        <//>` : null}
      <//>
      ${hasBefore ? html`<${Section} id="op-before" num="02" title=${c('secBefore')}>
        <${Facts} wide rows=${[
          consequences.length && { k: t('profile.offers.consequences'), v: `${consequences.map(x => conseqWord(x.type)).join(', ')}${consequences.some(x => x.requiresApproval || x.persistent) ? ` · ${c('lastingNote')}` : ''}` },
          reqs.length && { k: t('profile.offers.requirements'), v: reqs.map((r, i) => html`<${FactLine} key=${i}>${r.need}${r.instruction ? html` <${Note} inline>${r.instruction}<//>` : null}${r.fix ? html` <${Tinted} strong tone="notice">${r.fix}<//>` : null}<//>`) },
          prereq && prereq.items?.length && { k: t('profile.offers.needsFirst'), v: html`<${Marks}>${prereq.items.map((p, i) => html`<${Mark} kind="status" key=${i} tone=${p.ok ? 'fine' : (p.hard ? 'danger' : 'attention')}>${p.ok ? '✓' : (p.hard ? '✗' : '!')} ${p.label}<//>`)}<//>` },
          o.dataHandling && { k: t('profile.offers.facet.dataHandling'), v: c('data.' + o.dataHandling) || word('dataHandling', o.dataHandling) },
        ]} />
      <//>` : null}
      ${o.deliverable ? html`<${Section} id="op-get" num="03" title=${c('secGet')} count=${getWord(o)}>
        ${o.deliverable.sample === 'untested' ? html`<${Note} kind="quiet">${t('profile.offers.untested')}<//>`
          : o.deliverable.sample ? html`<${Box} scroll><${Label} block>${c('sampleLabel')}<//><${DeliverableBody} value=${o.deliverable.sample} alt=${o.title} format=${o.deliverable.format} /><//>`
          : html`<${Note} kind="quiet">${c('noSample')}<//>`}
      <//>` : null}
      <${Section} id="op-runs" num="04" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? deliveryRows(ctx, runs) : html`<${Note} kind="quiet">${t('profile.offers.noRunsYet')}<//>`}
      <//>
      <${Section} fold wrap id="op-sellfold" num="05" title=${c('sell')} sub=${forSale ? c('sellingSub', { n: 1 }) : c('sellSub')} open=${ctx.sellFoldOpen} onToggle=${() => ctx.setSellFoldOpen(v => !v)}>
        <${SellingEditor} key=${it.key} it=${it} ctx=${ctx} />
      <//>`,
  });
}
