/**
 * @file public/views/profile/kyc/settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's settings for customer due diligence, for its admins and its compliance
 *   officers (in person): who the officers are, who does the due diligence (the staff), the firm's
 *   list of high-risk third countries (two-letter codes, from the EU list it follows), and how many
 *   months pass between reviews at each risk level. Staff do not see this section.
 * @structure useSettings · secSettings · formOf
 * @usage const st = useSettings({ org, role }); ... secSettings(st, num)
 * @version-history
 *   v1.2.0 — 2026-11-27 — The section is a row (Section fold) that says in one line how many compliance
 *     officers, staff and high-risk countries the settings name, and opens in place; it opens by
 *     itself while no compliance officer is named and the reader may name one. "Save" is an ordinary
 *     action in the control size: the page has one loud action. No field, limit or check changed.
 *   v1.1.0 — 2026-11-19 — Browser check: the heading's small figure is a count, as in the page's other
 *     sections (the persons named as officers or staff), not the section's number.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { TagInput } from '/components/TagInput.js';
import { Action } from '/components/Action.js';
import { x, word, errWords, timeWord, kycApi } from './frame.js';

const html = htm.bind(h);

/** The EU's page on high-risk third countries, which the firm's own list follows. */
const EU_LIST = 'https://finance.ec.europa.eu/financial-crime/anti-money-laundering-and-countering-financing-terrorism-international-level_en';
const LEVELS = ['low', 'medium', 'high'];

/** The form's copy of the settings. */
export function formOf(s) {
  const m = s.reviewMonths || { low: 60, medium: 36, high: 12 };
  return { officers: [...(s.officers || [])], staff: [...(s.staff || [])], highRiskCountries: [...(s.highRiskCountries || [])],
    low: String(m.low), medium: String(m.medium), high: String(m.high) };
}

/**
 * The settings, read for every role, written by a manager or an officer.
 * @param {{ org: string, role: string }} p
 */
export function useSettings({ org, role }) {
  const editor = role === 'manager' || role === 'officer';
  const reader = editor;
  const [settings, setSettings] = useState(null);
  const [form, setFormState] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The row's state: null until the person opens or shuts it, then their choice.
  const [shown, setShown] = useState(null);

  const load = useCallback(async () => {
    if (!org || !reader) { setSettings(null); return; }
    try {
      const r = await kycApi.settings(org);
      setSettings(r.settings); setErr('');
    } catch (e) { setErr(errWords(e)); }
  }, [org, reader]);
  useEffect(() => { setSettings(null); setFormState(null); setShown(null); load(); }, [load]);

  // Open by itself while no compliance officer is named and the reader may name one: that needs them.
  const open = shown ?? (!!settings && editor && !(settings.officers || []).length);
  const toggle = () => setShown(!open);
  // Editing keeps the row open, so the saved message stays in sight after the officers are named.
  const edit = () => { setFormState(formOf(settings)); setMsg(null); setShown(true); };
  const setForm = (patch) => { setFormState((f) => ({ ...f, ...patch })); setMsg(null); };
  const months = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 && n <= max ? n : null; };
  const valid = form ? months(form.low, 60) !== null && months(form.medium, 60) !== null && months(form.high, 12) !== null : false;
  const save = async () => {
    setBusy(true);
    try {
      const s = await kycApi.saveSettings(org, {
        officers: form.officers, staff: form.staff, highRiskCountries: form.highRiskCountries,
        reviewMonths: { low: months(form.low, 60), medium: months(form.medium, 60), high: months(form.high, 12) },
      });
      setSettings(s); setFormState(null); setMsg({ text: x('set.saved') });
    } catch (e) { setMsg({ text: errWords(e), error: true }); }
    setBusy(false);
  };
  return { org, role, editor, reader, settings, err, load, open, toggle, form, edit, setForm, cancel: () => setFormState(null), valid, save, busy, msg };
}

/** The country codes typed: two letters each, in capitals, each once. */
const countries = (tags) => [...new Set(tags.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];

/** What the settings say, read only. */
function readView(st) {
  const s = st.settings;
  const m = s.reviewMonths || {};
  const list = (a) => (a && a.length ? a.join(', ') : x('set.nobody'));
  return html`
    <${Facts} rows=${[
      { k: x('set.officers'), v: list(s.officers), missing: !s.officers?.length, warn: !s.officers?.length && st.editor },
      { k: x('set.staff'), v: list(s.staff), missing: !s.staff?.length },
      { k: x('set.countries'), v: s.highRiskCountries?.length ? s.highRiskCountries.join(' ') : x('set.noCountries'), mono: !!s.highRiskCountries?.length, missing: !s.highRiskCountries?.length },
      { k: x('set.months'), v: LEVELS.map((l) => x('set.monthsOf', { level: word('risk', l), n: m[l] })).join(' · ') },
      s.updatedAt && { k: x('set.updated'), v: timeWord(s.updatedAt), sub: s.updatedBy },
    ]} />
    ${st.editor ? html`<${FormActions}><${Action} small onClick=${st.edit}>${x('set.edit')}<//><//>` : null}`;
}

/** The form a manager or an officer changes the settings in. */
function editView(st) {
  const f = st.form;
  return html`
    <${Fields}>
      <${TagInput} label=${x('set.officers')} help="kyc.officers" hint=${x('set.ghiiHint')} tags=${f.officers} onChange=${(tags) => st.setForm({ officers: tags })} placeholder=${x('set.ghiiPlaceholder')} />
      <${TagInput} label=${x('set.staff')} help="kyc.staff" hint=${x('set.ghiiHint')} tags=${f.staff} onChange=${(tags) => st.setForm({ staff: tags })} placeholder=${x('set.ghiiPlaceholder')} />
      <${TagInput} label=${x('set.countries')} help="kyc.highRiskCountries" tags=${f.highRiskCountries} onChange=${(tags) => st.setForm({ highRiskCountries: countries(tags) })} placeholder="IR" />
    <//>
    <${Note} kind="hint">${x('set.countriesHint')} <${Action} tone="link" href=${EU_LIST} newTab>${x('set.euList')}<//><//>
    <${Fields} cols=${3}>
      ${LEVELS.map((l) => html`<${TextField} key=${l} label=${x('set.monthsLabel', { level: word('risk', l) })} help=${l === 'low' ? 'kyc.reviewMonths' : undefined} type="number" size="short"
        min=${1} max=${l === 'high' ? 12 : 60} value=${f[l]} onInput=${(v) => st.setForm({ [l]: v })} />`)}
    <//>
    <${FormActions}>
      <${Action} control disabled=${!st.valid || st.busy} onClick=${st.save}>${st.busy ? x('saving') : x('set.save')}<//>
      <${Action} small soft onClick=${st.cancel}>${x('cancel')}<//>
    <//>`;
}

/**
 * The settings section, or null for a caller who does not read them.
 * @param {ReturnType<typeof useSettings>} st
 * @param {string} num
 */
export function secSettings(st, num) {
  if (!st.reader) return null;
  // The row's one line: counts only, never a person's name.
  const s = st.settings;
  const sub = !s ? (st.err ? '' : '…') : !(s.officers || []).length ? x('set.foldNoOfficer')
    : x('set.foldState', { officers: s.officers.length, staff: (s.staff || []).length, countries: (s.highRiskCountries || []).length });
  return html`
    <${Section} fold wrap id="kyc-settings" num=${num} title=${x('secSettings')} sub=${sub} open=${st.open} onToggle=${st.toggle}>
      <${Note} kind="lead">${x('set.lead')}<//>
      ${st.err ? html`<${Note} kind="quiet">${st.err}<//>`
        : !st.settings ? html`<${Note} kind="loading">${x('loading')}<//>`
        : st.form ? editView(st) : readView(st)}
      ${st.msg ? html`<${Note} kind="message" error=${!!st.msg.error}>${st.msg.text}<//>` : null}
    <//>`;
}
