/**
 * @file public/views/profile/offers/wizard-publish.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Steps 4, 5 and 6 of a new data product (design canvas "Data ulos", boards
 *   Vaihe4-Paivitys, Vaihe5-Kuka and Vaihe6-Valmis). Step 4: how often it updates (once, daily, weekly,
 *   monthly; the day and the time), how many old versions stay, and what the three freshness words
 *   will mean to a reader for that interval. Step 5: who may use it (only me, one organism's members,
 *   signed-in accounts, everyone) with the licence, the named shares made at publish, and the sale on
 *   EXCHANGE with the sentence of this node's data intermediation setting. Step 6: what was made, the
 *   addresses and the steps per tool, each share's connection file with its key shown this once, and
 *   the ways on. Made of the component kit.
 * @structure stepSchedule · stepWho · stepDone · ShareQueue
 * @usage const body = stepSchedule(s);
 * @version-history
 *   v1.2.0 — 2026-11-01 — Step 6 says what became of each share's e-mailed link (LinkResult), and its
 *     connection steps follow the Power-BI-Excel board (WP9b).
 *   v1.1.0 — 2026-11-01 — Step 4 "When the source changes", refused next to the option for a product with
 *     an extension source; step 5's shares take a person on another AIMEAT node by their account; step 6
 *     says each share's sentence and key note in the page's language (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D9.5, D3, D5, D6.1).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { date as fmtDate } from '/js/format.js';
import { Section } from '/components/Section.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Facts } from '/components/Facts.js';
import { Box, BoxList } from '/components/Box.js';
import { List, Row, Name, Who, Doors } from '/components/List.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { d, scheduleWords, cronFor, shareSentence, keyNote } from './data-model.js';
import { SellFields } from './sell-dialog.js';
import { partyNameOf, VisitorRead, LinkResult, SHARE_HOWS, isAccount } from './share-dialog.js';
import { ConnectSteps } from './data-connect.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** The licences a product is offered under: two open ones, and "only on the terms of a contract". */
const LICENCES = [['CC-BY-4.0', 'ccBy'], ['CC0-1.0', 'cc0'], ['proprietary', 'contract']];

/* ── 4 How often ──────────────────────────────────────────────────────────────────────────── */

export function stepSchedule(s) {
  const { draft, setDraft } = s;
  const sch = draft.schedule;
  const set = (patch) => setDraft((cur) => ({ schedule: { ...cur.schedule, ...patch } }));
  const cron = cronFor(sch);
  const onChange = sch.freq === 'change';
  // An extension's result has no change the server can see (the node answers NO_CHANGE_SIGNAL).
  const blind = draft.sources.some((src) => src.kind === 'extension');
  const interval = { daily: 'day', weekly: 'week', monthly: 'month' }[sch.freq];
  const days = sch.freq === 'weekly'
    ? [1, 2, 3, 4, 5, 6, 0].map((n) => [n, d('day.' + n)])
    : Array.from({ length: 28 }, (_, i) => [i + 1, String(i + 1)]);
  const keep = html`<${Select} label=${d('sched.keep')} value=${draft.keep} onChange=${(v) => setDraft({ keep: v })}
    options=${[['12', d('sched.keep12')], ['all', d('sched.keepAll')], ['6m', d('sched.keep6m')]]} />`;
  const paces = [
    ...['once', 'daily', 'weekly', 'monthly'].map((k) => ({ value: k, label: d('sched.' + k) })),
    { value: 'change', label: d('sched.change'), disabled: blind, ...(blind ? { title: d('sched.changeBlocked') } : {}) },
  ];
  const freshRows = onChange ? [
    { k: d('fresh.fresh'), state: 'fine', v: d('sched.freshChange.fresh') },
    { k: d('fresh.late'), state: 'attention', v: d('sched.freshChange.late') },
    { k: d('fresh.stale'), state: 'danger', v: d('sched.freshChange.stale') },
  ] : interval ? [
    { k: d('fresh.fresh'), state: 'fine', v: d('sched.freshFresh') },
    { k: d('fresh.late'), state: 'attention', v: d('sched.freshLate.' + interval) },
    { k: d('fresh.stale'), state: 'danger', v: d('sched.freshStale.' + interval) },
  ] : [{ k: d('fresh.unscheduled'), state: 'off', v: d('sched.freshNone') }];
  return html`
    <${Section} id="wz-pace" title=${d('sched.title')} count=${scheduleWords(onChange ? { on: 'change' } : cron ? { cron } : null)} first=${true}>
      <${Choice} label=${d('sched.pace')} value=${sch.freq} onChange=${(v) => set({ freq: v })} options=${paces} />
      ${blind ? html`<${Note} kind="aside" size="small">${d('sched.changeBlocked')}<//>` : null}
      ${onChange ? html`<${Fields} cols=${3}>${keep}<//><${Note}>${d('sched.changeNote')}<//>`
        : sch.freq !== 'once' ? html`<${Fields} cols=${3}>
        ${sch.freq !== 'daily' ? html`<${Select} label=${sch.freq === 'weekly' ? d('sched.weekday') : d('sched.monthday')} value=${String(sch.day)}
          options=${days.map(([v, l]) => [String(v), l])} onChange=${(v) => set({ day: Number(v) })} />` : null}
        <${TextField} label=${d('sched.time')} type="time" size="short" value=${sch.time} onInput=${(v) => set({ time: v })} />
        ${keep}
      <//>` : html`<${Note}>${d('sched.onceNote')}<//>`}
    <//>
    <${Section} id="wz-fresh" title=${d('sched.freshTitle')}>
      <${Facts} rows=${freshRows} />
      <${Note}>${onChange ? d('sched.changeNodeNote') : d('sched.nodeNote')}<//>
    <//>`;
}

/* ── 5 Who may use it ─────────────────────────────────────────────────────────────────────── */

/** The named shares made when the product is published: a short form and the list of them. */
function ShareQueue({ draft, setDraft, maxDays = 365 }) {
  const empty = { who: '', how: 'program', email: '', account: '', purpose: '', until: isoDay(Date.now() + 30 * DAY) };
  const [form, setForm] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const add = () => {
    setDraft((cur) => ({ shares: [...cur.shares, { ...form, who: form.who.trim(), party: partyNameOf(form.who), purpose: form.purpose.trim(), email: form.email.trim(), account: form.account.trim() }] }));
    setForm(null);
  };
  const ok = form && partyNameOf(form.who) && form.purpose.trim() && form.until && (form.how !== 'person' || /\S+@\S+/.test(form.email))
    && (form.how !== 'aimeat' || isAccount(form.account));
  return html`
    <${List} cols="name-who-doors" empty=${d('who.noShares')} rows=${draft.shares} render=${(sh, i) => html`
      <${Row} key=${sh.party + i}>
        <${Name} meta=${[d('party.kind.' + sh.how), sh.how === 'aimeat' ? sh.account : '', sh.purpose].filter(Boolean).join(' · ')}>${sh.who}<//>
        <${Who}>${d('product.until', { date: fmtDate(`${sh.until}T12:00:00`) })}<//>
        <${Doors}><${Action} small row soft tone="danger" onClick=${() => setDraft((cur) => ({ shares: cur.shares.filter((_, j) => j !== i) }))}>${d('src.remove')}<//><//>
      <//>`} />
    ${form ? html`<${Box} tone="field">
      <${Fields} cols=${2}>
        <${TextField} label=${d('share.who')} value=${form.who} onInput=${(v) => set({ who: v })} placeholder=${d('share.whoPlaceholder')} />
        <${Choice} label=${d('share.how')} value=${form.how} onChange=${(v) => set({ how: v })}
          options=${SHARE_HOWS.map(([k, key]) => [k, d('share.' + key)])} />
        ${form.how === 'aimeat'
          ? html`<${TextField} label=${d('share.account')} value=${form.account} onInput=${(v) => set({ account: v })} placeholder=${d('share.accountPlaceholder')} hint=${d('share.accountHint')} />`
          : html`<${TextField} label=${d('share.email')} type="email" value=${form.email} onInput=${(v) => set({ email: v })} placeholder=${d('share.emailPlaceholder')} />`}
        <${TextField} label=${d('share.purpose')} value=${form.purpose} onInput=${(v) => set({ purpose: v })} placeholder=${d('share.purposePlaceholder')} />
        <${TextField} label=${d('share.until')} type="date" value=${form.until} min=${isoDay(Date.now() + DAY)} max=${isoDay(Date.now() + maxDays * DAY)} onInput=${(v) => set({ until: v })} />
      <//>
      <${Actions}>
        <${Action} small disabled=${!ok} onClick=${add}>${d('who.addShare')}<//>
        <${Action} small soft onClick=${() => setForm(null)}>${d('share.cancel')}<//>
      <//>
    <//>` : html`<${Actions}><${Action} small onClick=${() => setForm(empty)}>${d('who.newShare')}<//><//>`}
    <${Note}>${d('who.noAccount')}<//>`;
}

export function stepWho(s) {
  const { draft, setDraft, choices, ctx } = s;
  const orgs = choices?.organisms || [];
  const orgName = orgs.find((o) => o.value === draft.organism)?.label;
  const audiences = [
    { value: 'private', label: d('audience.private'), hint: d('who.privateHint') },
    { value: 'organism', label: orgName ? d('audience.organismOf', { name: orgName }) : d('who.organism'), hint: d('who.organismHint'), disabled: !orgs.length },
    { value: 'members', label: d('audience.members'), hint: d('who.membersHint') },
    { value: 'public', label: d('audience.public'), hint: d('who.publicHint') },
  ];
  return html`
    <${Section} id="wz-audience" title=${d('who.audience')} first=${true}>
      <${Choice} boxed cols=${2} dot name="wz-audience" ariaLabel=${d('who.audience')} value=${draft.visibility}
        onChange=${(v) => setDraft({ visibility: v })} options=${audiences} />
      <${Fields} cols=${2}>
        ${draft.visibility === 'organism' ? html`<${Select} label=${d('who.organismPick')} value=${draft.organism} placeholder=${d('src.pick')}
          options=${orgs} onChange=${(v) => setDraft({ organism: v })} />` : null}
        <${Select} label=${d('who.licence')} value=${draft.license} placeholder=${d('who.licencePick')}
          options=${LICENCES.map(([value, key]) => [value, d('licence.' + key)])} onChange=${(v) => setDraft({ license: v })} />
      <//>
      ${draft.visibility === 'public' ? html`<${Note} kind="aside" size="small" tone="irreversible">${d('who.publicNote')}<//>` : null}
    <//>
    <${Section} id="wz-shares" title=${d('who.sharesTitle')} count=${String(draft.shares.length)}>
      <${ShareQueue} draft=${draft} setDraft=${setDraft} />
    <//>
    <${Section} id="wz-sell" title=${d('who.sellTitle')}>
      <${Check} strong checked=${draft.sell.on} onChange=${(v) => setDraft((cur) => ({ sell: { ...cur.sell, on: v } }))}>${d('who.sell')}<//>
      ${draft.sell.on ? html`<${SellFields} form=${draft.sell} set=${(patch) => setDraft((cur) => ({ sell: { ...cur.sell, ...patch } }))} mode=${ctx.data.intermediation} />`
        : html`<${Note}>${d('sell.mode.' + (ctx.data.intermediation || 'report'))}<//>`}
    <//>`;
}

/* ── 6 Done ───────────────────────────────────────────────────────────────────────────────── */

export function stepDone(s) {
  const { ctx, draft, result } = s;
  if (!result) return html`<${Note} kind="loading" />`;
  const open = (tab, share = false) => ctx.pickView({ kind: 'product', name: draft.name, tab, share });
  return html`
    <${Section} id="wz-addresses" title=${d('done.addresses')} first=${true}>
      ${result.pkg ? html`<${ConnectSteps} owner=${ctx.data.owner} name=${draft.name} pkg=${result.pkg} visibility=${result.visibility} />` : html`<${Note} kind="quiet">${d('done.noPackage')}<//>`}
    <//>
    ${result.shares.length ? html`<${Section} id="wz-made-shares" title=${d('done.shares')} count=${String(result.shares.length)}>
      <${BoxList}>
        ${result.shares.map((sh, i) => (sh.error
          ? html`<${Box} key=${i} tone="attention" name=${sh.who}><${Note} kind="message" error>${sh.error}<//><//>`
          : html`<${Box} key=${i} name=${sh.who} marks=${html`<${Mark}>${d('party.kind.' + sh.how)}<//>`}>
              <${Note} kind="lead">${shareSentence(sh.out, sh.who)}<//>
              <${LinkResult} link=${sh.link} email=${sh.email} />
              ${sh.out.recipient_kind === 'visitor' ? html`<${VisitorRead} out=${sh.out} />` : html`
                <${Note}>${keyNote(sh.out, sh.who)}<//>
                <${Code} block scroll>${JSON.stringify(sh.out.connection, null, 2)}<//>
                <${Actions}><${Action} small copy=${JSON.stringify(sh.out.connection, null, 2)}>${d('share.copyFile')}<//><//>`}
            <//>`))}
      <//>
    <//>` : null}
    ${result.sale ? html`<${Note} kind="message" error=${!!result.sale.error}>${result.sale.error || d('sell.done')}<//>` : null}
    <${Actions}>
      <${Loud} control onClick=${() => open('shares')}>${d('done.showInOffers')}<//>
      <${Action} small onClick=${() => open('connect')}>${d('done.tryTool')}<//>
      <${Action} small onClick=${() => open('shares', true)}>${d('done.shareMore')}<//>
    <//>`;
}
