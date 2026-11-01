/**
 * @file public/views/profile/offers/sell-dialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sell a data product on EXCHANGE (design canvas "Data ulos", boards Tarjoama and
 *   Vaihe5-Kuka): by the month or by the read, the money price, the pacing each read carries for a
 *   buyer with an account, and how a buyer may use the data, with the sentence that says what this
 *   node's data intermediation setting does to a sale. The press is PUT
 *   /v1/datapackages/{owner}/{name}/exchange, the call aimeat_datapackage_sell makes; a package on
 *   sale can be taken off it here. A morsel is pacing and never a price. The site's Modal.
 * @structure SellDialog · SellFields · termsBody
 * @usage html`<${SellDialog} open=${o} onClose=${close} owner=${owner} name=${name} current=${pkg.latest.exchange} mode=${mode} />`
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D5, D7.1).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { Modal } from '/components/Modal.js';
import { Fields, Field } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import * as dp from '/js/services/dataproducts.js';
import { d } from './data-model.js';

const MICRO = 1_000_000;

/** The sale terms a form holds, as PUT .../exchange takes them. */
export function termsBody(f) {
  const euros = Number(String(f.price || '').replace(',', '.'));
  const pace = Number(f.pacing);
  return {
    exchange: true, model: f.model,
    ...(euros > 0 ? { prices_money: [{ amount: Math.round(euros * MICRO), currency: 'EUR' }] } : { prices_money: [] }),
    ...(pace > 0 ? { toll_morsels: Math.round(pace) } : { toll_morsels: null }),
    usage_terms: { derivatives: !!f.derivatives, resale: !!f.resale, attribution: !!f.attribution, ...(f.note?.trim() ? { note: f.note.trim() } : {}) },
  };
}

/** The form a sale is described in, shared by this dialog and the wizard's step 5. */
export function SellFields({ form, set, mode }) {
  return html`
    <${Fields} cols=${2}>
      <${Choice} label=${d('sell.model')} wide value=${form.model} onChange=${(v) => set({ model: v })}
        options=${[['per_month', d('sell.perMonth')], ['per_read', d('sell.perRead')]]} />
      <${TextField} label=${form.model === 'per_read' ? d('sell.priceRead') : d('sell.priceMonth')} value=${form.price} inputMode="decimal"
        size="short" placeholder="20" onInput=${(v) => set({ price: v })} hint=${d('sell.priceHint')} />
      <${TextField} label=${d('sell.pacing')} type="number" min="0" value=${form.pacing} size="short" placeholder="5"
        onInput=${(v) => set({ pacing: v })} hint=${d('sell.pacingHint')} />
      <${Field} label=${d('sell.terms')} wide group>
        <${Check} checked=${form.attribution} onChange=${(v) => set({ attribution: v })}>${d('sell.attribution')}<//>
        <${Check} checked=${form.derivatives} onChange=${(v) => set({ derivatives: v })}>${d('sell.derivatives')}<//>
        <${Check} checked=${form.resale} onChange=${(v) => set({ resale: v })}>${d('sell.resale')}<//>
      <//>
      <${TextField} label=${d('sell.note')} wide value=${form.note} onInput=${(v) => set({ note: v })} placeholder=${d('sell.notePlaceholder')} />
    <//>
    <${Note} kind="aside" size="small">${d('sell.mode.' + (mode || 'report'))}<//>`;
}

export const EMPTY_SALE = { model: 'per_month', price: '', pacing: '', attribution: true, derivatives: false, resale: false, note: '' };

/** The terms on the package now, back into the form. */
function formOf(current) {
  if (!current) return { ...EMPTY_SALE };
  const money = (current.pricesMoney || [])[0];
  return {
    model: current.model || 'per_month', price: money ? String(money.amount / MICRO) : '', pacing: current.tollMorsels ? String(current.tollMorsels) : '',
    attribution: !!current.usageTerms?.attribution, derivatives: !!current.usageTerms?.derivatives, resale: !!current.usageTerms?.resale, note: current.usageTerms?.note || '',
  };
}

export function SellDialog({ open, onClose, owner, name, title, current, mode, showToast, onSaved }) {
  const [form, setForm] = useState(() => formOf(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm(formOf(current)); setError(''); } }, [open, current]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const onSale = !!current?.exchange;
  const ready = Number(String(form.price).replace(',', '.')) > 0 || Number(form.pacing) > 0;

  const save = async (terms, said) => {
    setBusy(true); setError('');
    try { await dp.sellPackage(owner, name, terms); showToast?.(said); onSaved?.(); onClose(); }
    catch (err) { setError(err?.message || d('sell.failed')); }
    setBusy(false);
  };
  const footer = html`
    <${Action} onClick=${onClose}>${d('share.cancel')}<//>
    ${onSale ? html`<${Action} tone="danger" disabled=${busy} onClick=${() => save({ exchange: false }, d('sell.offDone'))}>${d('sell.off')}<//>` : null}
    <${Loud} control disabled=${!ready || busy} onClick=${() => save(termsBody(form), d('sell.done'))}>${onSale ? d('sell.update') : d('sell.submit')}<//>`;
  return html`<${Modal} open=${open} onClose=${onClose} size="md" title=${d('sell.title')} titleRef=${title || name} footer=${footer}>
    <${Note} kind="caption" size="body">${d('sell.lead')}<//>
    <${SellFields} form=${form} set=${set} mode=${mode} />
    ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
  <//>`;
}
