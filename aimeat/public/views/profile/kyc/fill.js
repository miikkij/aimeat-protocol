/**
 * @file public/views/profile/kyc/fill.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Fill the card with your own AI": the prompt path of an open customer card for a person
 *   whose AI cannot connect over MCP (CLAUDE.md, Prompt-driven workflow). The page composes a prompt in
 *   the page's language with the card's current facts (never the screening hits beyond their count,
 *   never a suspicion, never the identity evidence) and the exact fields and values the card takes
 *   (services/kyc/contract.ts CustomerInputSchema). The person gives it, with their documents, to their
 *   own AI and pastes the answer back. "Check" reads the JSON (also inside a ``` block), keeps only the
 *   known fields with valid values and shows what would change, before → after; nothing is saved until
 *   "Save to the card" sends PATCH /v1/kyc/{org}/customers/{id} with those fields and a note. The
 *   server screens the card and rates its risk again by itself.
 * @structure useFill · fillPart · promptOf · cleanAnswer · changesOf
 * @usage const fill = useFill({ org, id, card, reload }); ... fillPart(fill)
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { PromptCard } from '/components/PromptCard.js';
import { PasteBox } from '/components/PasteBox.js';
import { SubHeading } from '/components/SubHeading.js';
import { Facts } from '/components/Facts.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { x, word, dateWord, errWords, kycApi } from './frame.js';

const html = htm.bind(h);

/** The fields the prompt shows and the answer may set, in the order the card shows them. */
const FIELDS = ['kind', 'name', 'aliases', 'birthDate', 'nationality', 'country', 'businessId', 'beneficialOwners',
  'ownershipLayers', 'nomineeOrBearerShares', 'cashIntensive', 'productRisk', 'purpose', 'sourceOfFunds', 'pep', 'pepDetail'];
const PEPS = ['no', 'yes', 'family', 'close-associate', 'former', 'unknown'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A trimmed string of at most `max` characters (at least `min`), or undefined. */
const str = (v, max, min = 1) => (typeof v === 'string' && v.trim().length >= min ? v.trim().slice(0, max) : undefined);

/** The card's own facts as the prompt gives them: only the fields the answer may set. */
function factsOf(card) {
  const out = {};
  for (const f of FIELDS) if (card[f] !== undefined && card[f] !== null && !(Array.isArray(card[f]) && !card[f].length) && card[f] !== '') out[f] = card[f];
  return out;
}

/**
 * The prompt in the page's language.
 * @param {any} card the newest CustomerVersion
 */
export function promptOf(card) {
  const hits = (card.screening?.hits || []).filter((hit) => hit.verdict === 'open').length;
  return [
    x('fill.p.intro'),
    x('fill.p.facts'),
    JSON.stringify(factsOf(card), null, 2),
    x('fill.p.hits', { n: hits }),
    x('fill.p.task'),
    x('fill.p.fields'),
    x('fill.p.rules'),
  ].join('\n\n');
}

/**
 * The answer's known fields with valid values; a field with an invalid value is left out.
 * @param {any} a the parsed answer
 * @returns {Record<string, any>}
 */
export function cleanAnswer(a) {
  const out = {};
  if (!a || typeof a !== 'object' || Array.isArray(a)) return out;
  const put = (k, v) => { if (v !== undefined) out[k] = v; };
  if (a.kind === 'person' || a.kind === 'entity') out.kind = a.kind;
  put('name', str(a.name, 300));
  if (Array.isArray(a.aliases)) { const l = a.aliases.map((s) => str(s, 300)).filter(Boolean).slice(0, 20); if (l.length) out.aliases = l; }
  if (typeof a.birthDate === 'string' && DAY.test(a.birthDate)) out.birthDate = a.birthDate;
  put('nationality', str(a.nationality, 56, 2));
  put('country', str(a.country, 56, 2));
  put('businessId', str(a.businessId, 40));
  if (Array.isArray(a.beneficialOwners)) {
    const owners = a.beneficialOwners.filter((o) => o && typeof o === 'object').slice(0, 50).map((o) => {
      const one = { name: str(o.name, 200) };
      if (!one.name) return null;
      if (typeof o.birthDate === 'string' && DAY.test(o.birthDate)) one.birthDate = o.birthDate;
      const c = str(o.country, 56, 2); if (c) one.country = c;
      if (typeof o.share === 'number' && o.share >= 0 && o.share <= 100) one.share = o.share;
      const ctl = str(o.control, 500); if (ctl) one.control = ctl;
      return one;
    }).filter(Boolean);
    if (owners.length) out.beneficialOwners = owners;
  }
  if (Number.isInteger(a.ownershipLayers) && a.ownershipLayers >= 0 && a.ownershipLayers <= 20) out.ownershipLayers = a.ownershipLayers;
  if (typeof a.nomineeOrBearerShares === 'boolean') out.nomineeOrBearerShares = a.nomineeOrBearerShares;
  if (typeof a.cashIntensive === 'boolean') out.cashIntensive = a.cashIntensive;
  if (['low', 'medium', 'high'].includes(a.productRisk)) out.productRisk = a.productRisk;
  put('purpose', str(a.purpose, 2000));
  put('sourceOfFunds', str(a.sourceOfFunds, 2000));
  if (PEPS.includes(a.pep)) out.pep = a.pep;
  put('pepDetail', str(a.pepDetail, 1000));
  return out;
}

/** The JSON in a pasted answer: the whole text, a ``` block in it, or the first {...} in it. */
function parseAnswer(text) {
  const tries = [text.trim()];
  const block = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (block) tries.unshift(block[1].trim());
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const s of tries) {
    try { return JSON.parse(s); } catch { /* the next form of the text */ }   // eslint-disable-line aimeat/no-silent-catch -- a text that is not JSON tries the next form; none parsing is the answer the page shows
  }
  return null;
}

/** A field's value in the reader's words. */
function valueWords(field, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '–';
  if (field === 'kind') return word('kind', v);
  if (field === 'pep') return word('pep', v);
  if (field === 'productRisk') return word('risk', v);
  if (field === 'birthDate') return dateWord(v);
  if (typeof v === 'boolean') return v ? x('fill.yes') : x('fill.no');
  if (field === 'aliases') return v.join(', ');
  if (field === 'beneficialOwners') return v.map((o) => [o.name, o.share !== undefined ? `${o.share} %` : '', o.country].filter(Boolean).join(' ')).join('; ');
  return String(v);
}

/** The fields whose value differs from the card's, with both values in words. */
export function changesOf(card, fields) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return FIELDS.filter((f) => f in fields && !same(card[f], fields[f]))
    .map((f) => ({ field: f, before: valueWords(f, card[f]), after: valueWords(f, fields[f]) }));
}

/**
 * The paste box's state for one open card.
 * @param {{ org: string, id: string, card: any, reload: () => Promise<void> | void }} p
 */
export function useFill({ org, id, card, reload }) {
  const [text, setTextState] = useState('');
  const [checked, setChecked] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTextState(''); setChecked(null); setMsg(null); }, [id]);

  const setText = (v) => { setTextState(v); setChecked(null); setMsg(null); };
  const check = () => {
    const parsed = parseAnswer(text);
    if (!parsed) { setChecked(null); setMsg({ text: x('fill.notJson'), error: true }); return; }
    const fields = cleanAnswer(parsed);
    const changes = card ? changesOf(card, fields) : [];
    if (!Object.keys(fields).length) { setChecked(null); setMsg({ text: x('fill.noFields'), error: true }); return; }
    const send = Object.fromEntries(changes.map((c) => [c.field, fields[c.field]]));
    setChecked({ send, changes });
    setMsg(changes.length ? null : { text: x('fill.noChange') });
  };
  const save = async () => {
    if (!checked?.changes.length) return;
    setBusy(true);
    try {
      await kycApi.update(org, id, { ...checked.send, note: x('fill.note') });
      setTextState(''); setChecked(null);
      setMsg({ text: x('fill.saved') });
      await reload();
    } catch (e) { setMsg({ text: errWords(e), error: true }); }
    setBusy(false);
  };
  return { card, text, setText, checked, check, save, busy, msg };
}

/**
 * The part on the card. Null for an ended relationship: its card does not change.
 * @param {ReturnType<typeof useFill>} f
 */
export function fillPart(f) {
  const card = f.card;
  if (!card || card.status === 'ended') return null;
  const ch = f.checked;
  return html`
    <${SubHeading} level=${3} rule>${x('fill.title')}<//>
    <${Note} kind="lead">${x('fill.lead')}<//>
    <${PromptCard} quiet label=${x('fill.promptLabel')} prompt=${promptOf(card)} copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')} />
    <${PasteBox} id="kyc-fill-paste" label=${x('fill.pasteLabel')} rows="6" value=${f.text} placeholder=${x('fill.pastePlaceholder')}
      onInput=${(e) => f.setText(e.currentTarget.value)} />
    <${Actions} apart>
      <${Action} small disabled=${!f.text.trim() || f.busy} onClick=${f.check}>${x('fill.check')}<//>
      <${Loud} control disabled=${!ch?.changes.length || f.busy} onClick=${f.save}>${f.busy ? x('saving') : x('fill.save')}<//>
    <//>
    ${ch?.changes.length ? html`
      <${Note} kind="hint">${x('fill.changesLead', { n: ch.changes.length })}<//>
      <${Facts} wide rows=${ch.changes.map((c) => ({ key: c.field, k: x('fill.field.' + c.field), v: `${c.before} → ${c.after}` }))} />` : null}
    ${f.msg ? html`<${Note} kind="message" error=${!!f.msg.error}>${f.msg.text}<//>` : null}`;
}
