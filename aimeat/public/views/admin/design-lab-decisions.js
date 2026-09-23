/**
 * @file public/views/admin/design-lab-decisions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat-design-lab, the decisions view: one decision per job the pages do in more
 *   than one way. The list opens with a summary: each decision, its proposal in one sentence, and
 *   Jouni's answer so far. A decision opens with ONE main button, "Accept the proposal", which keeps
 *   every tone the proposal lists; then the proposal as a picture next to what it replaces, the
 *   tones and where each comes from, which old classes go away and the tone each one's look becomes,
 *   what would change on which page, and each variant with its crops and measured values. Choosing
 *   a variant, keeping variants as tones, or "not now" sit under a folded "Other options".
 *
 *   A decision belongs to the project (Jouni, 2026-09-23). An answer given here is stored as the
 *   operator's own record on this node (`design-lab.choice.<id>`), and the session that builds the
 *   change writes it into public/views/design-lab/decisions-data.js, where it ships in the code; a
 *   decision already written there shows as decided and takes no new answer.
 * @structure DecisionsView (default) · Summary · DecisionDetail · AnswerBar · VariantRow · OtherOptions · useChoice · answerOf
 * @usage Mounted by views/admin/design-lab-tab.js (the Decisions switch).
 * @version-history
 *   v3.0.0 — 2026-09-23 — Jouni's layout: one main button (Accept the proposal, keeping every tone),
 *     the per-variant choices folded under Other options, "Replaces" said in words with each old
 *     class's tone beside it, crops only where one exists, and a summary of every decision and his
 *     answer at the top of the list.
 *   v2.0.0 — 2026-09-23 — The proposal as a picture next to the variants it replaces; tones.
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */
import { h } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { PageIntro } from '/components/PageIntro.js';
import { Hint } from '/components/Hint.js';
import { BackLink } from '/components/BackLink.js';
import { FoldButton } from '/components/FoldButton.js';
import { TextInput } from '/components/TextInput.js';
import { ActionRow } from '/components/ActionRow.js';
import { ChooserFold } from '/components/Chooser.js';
import { Specimens, Specimen, SpecimenImage } from '/components/Specimen.js';
import { DECISIONS } from '/views/design-lab/decisions-data.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const variantSrc = (id, v, theme) => `/v1/design-lab/frame?id=decision:${encodeURIComponent(id)}&v=${v}&theme=${theme}`;
const choiceKey = (id) => `design-lab.choice.${id}`;
/** A decision's short name: its title up to the colon. */
const shortTitle = (d) => d.title.split(':')[0];

/** The proposal's picture: its own composition, or the proposed variant's sample. */
function proposalSrc(decision, theme) {
  if (decision.proposal.variant === 'proposal') return `/v1/design-lab/frame?id=proposal:${encodeURIComponent(decision.id)}&v=0&theme=${theme}`;
  return variantSrc(decision.id, decision.variants.findIndex((v) => v.id === decision.proposal.variant), theme);
}

async function readChoice(id) {
  try {
    const r = await apiGet(`/v1/memory/${encodeURIComponent(choiceKey(id))}?soft=1`);
    return r?.data && r.data.exists !== false ? (r.data.value ?? null) : null;
  } catch (e) { swallowed('design-lab: choice read', e); return null; }
}

/** This node's record of the operator's answer for one decision. */
function useChoice(id) {
  const [choice, setChoice] = useState(/** @type {any} */ (null));
  useEffect(() => { readChoice(id).then(setChoice); }, [id]);
  const save = useCallback(async (value) => {
    await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: choiceKey(id), value, visibility: 'private' }) });
    setChoice(value);
  }, [id]);
  return { choice, save };
}

/** Jouni's answer so far, in the four words he asked for: none, accepted, other, not now. */
function answerOf(decision, record) {
  if (decision.choice) return decision.choice.variant === decision.proposal.variant ? 'accepted' : 'other';
  if (record?.choice === 'proposal') return 'accepted';
  if (record?.choice === 'not-now') return 'not now';
  if (record?.choice || (record?.keep ?? []).length) return 'other';
  return 'none';
}
const answerWord = (a) => tr(`designLab.answer.${a.replace(' ', '')}`, a);

function Values({ values }) {
  if (!values) return html`<p class="poster-specimen-values">${tr('designLab.measuring', 'measuring…')}</p>`;
  return html`<p class="poster-specimen-values">${Object.entries(values).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>`;
}

/** The one main button, and the answer so far. */
function AnswerBar({ decision, record, onAccept }) {
  const answer = answerOf(decision, record);
  if (decision.choice) {
    return html`<${Band} title=${tr('designLab.decided', 'Decided')} tight=${true}>
      <p>${decision.choice.note} (${decision.choice.decidedBy}, ${decision.choice.decidedAt})</p><//>`;
  }
  return html`
    <${ActionRow}>
      <button type="button" class="btn-primary poster-slab" onClick=${onAccept}>${tr('designLab.accept', 'Accept the proposal')}</button>
    <//>
    <${Hint}>${[
      decision.proposal.summary,
      (decision.proposal.tones ?? []).length ? tr('designLab.acceptHint', 'Accepting keeps every tone the proposal lists.') : '',
      `${tr('designLab.yourAnswer', 'Your answer so far')}: ${answerWord(answer)}${record?.decidedAt ? ` (${record.decidedAt.slice(0, 10)})` : ''}.`,
    ].filter(Boolean).join(' ')}<//>`;
}

function VariantRow({ decision, variant, values, crops }) {
  const crop = crops?.[decision.id]?.[variant.id] ?? {};
  const hasCrop = crop.light || crop.dark;
  return html`
    <${Band} title=${variant.name} tight=${true}>
      <p>${variant.look}. ${tr('designLab.drawn', 'Drawn')}: ${variant.where}${decision.counted && variant.files ? ` (${variant.files} ${tr('designLab.files', 'files')})` : ''}.</p>
      ${hasCrop
        ? html`<${Specimens}>
            ${crop.light && html`<${SpecimenImage} label=${tr('designLab.cropLight', 'On its page, light')} src=${crop.light} />`}
            ${crop.dark && html`<${SpecimenImage} label=${tr('designLab.cropDark', 'On its page, dark')} src=${crop.dark} />`}
          <//>`
        : html`<${Hint}>${tr('designLab.noCropBecause', 'No picture from its page')}: ${crop.missing || tr('designLab.notShot', 'not shot yet')}.<//>`}
      <${NamedRow} label=${tr('designLab.light', 'Light')}><${Values} values=${values?.light} /><//>
      <${NamedRow} label=${tr('designLab.dark', 'Dark')}><${Values} values=${values?.dark} /><//>
    <//>`;
}

/** Everything that is not "accept": one variant, variants kept as named tones, not now, a note. */
function OtherOptions({ decision, record, onSave }) {
  const [tones, setTones] = useState(/** @type {Record<string, string>} */ ({}));
  const [note, setNote] = useState(record?.note ?? '');
  const kept = (id) => (record?.keep ?? []).find((k) => k.variant === id);
  const keep = (id, tone) => {
    const rest = (record?.keep ?? []).filter((k) => k.variant !== id);
    onSave({ choice: record?.choice === 'proposal' ? null : record?.choice ?? null, keep: tone ? [...rest, { variant: id, tone }] : rest });
  };
  return html`
    <${ChooserFold} summary=${tr('designLab.otherOptions', 'Other options')}>
      ${decision.variants.map((v) => html`
        <${NamedRow} key=${v.id} label=${v.name}>
          <${FoldButton} on=${record?.choice === v.id} onClick=${() => onSave({ choice: v.id })}>
            ${record?.choice === v.id ? tr('designLab.isChosen', 'Your choice') : tr('designLab.choose', 'Choose this one')}
          <//>
          <${TextInput} id=${`design-lab-tone-${decision.id}-${v.id}`} maxLength="40" placeholder=${tr('designLab.tonePlaceholder', 'A tone name, to keep this one as a tone')}
            value=${tones[v.id] ?? kept(v.id)?.tone ?? ''} onInput=${(e) => setTones({ ...tones, [v.id]: e.target.value })} />
          <${FoldButton} on=${!!kept(v.id)} onClick=${() => keep(v.id, kept(v.id) ? null : ((tones[v.id] ?? '').trim() || v.id))}>
            ${kept(v.id) ? `${tr('designLab.keptAs', 'kept as')} "${kept(v.id).tone}"` : tr('designLab.keepTone', 'Keep it as a tone')}
          <//>
        <//>`)}
      <${FoldButton} on=${record?.choice === 'not-now'} onClick=${() => onSave({ choice: 'not-now', keep: [] })}>${tr('designLab.notNow', 'Not now')}<//>
      <${TextInput} id=${`design-lab-note-${decision.id}`} maxLength="400" placeholder=${tr('designLab.notePlaceholder', 'A note with your choice (optional)')}
        value=${note} onInput=${(e) => setNote(e.target.value)} />
      <${FoldButton} onClick=${() => onSave({ note })}>${tr('designLab.saveNote', 'Keep the note')}<//>
    <//>`;
}

function DecisionDetail({ decision, crops, onBack }) {
  const { choice, save } = useChoice(decision.id);
  const [values, setValues] = useState(/** @type {Record<string, {light?: any, dark?: any}>} */ ({}));
  // One stable setter per variant and theme, so a frame's listener is not re-made on every render.
  const setters = useMemo(() => Object.fromEntries(decision.variants.flatMap((v) => ['light', 'dark'].map((theme) => [
    `${v.id}:${theme}`, (vals) => setValues((prev) => ({ ...prev, [v.id]: { ...prev[v.id], [theme]: vals } })),
  ]))), [decision]);
  const record = (patch) => save({
    kind: decision.id, choice: choice?.choice ?? null, keep: choice?.keep ?? [], note: choice?.note ?? '',
    proposal: decision.proposal.variant, ...patch, decidedAt: new Date().toISOString(),
  }).catch((e) => swallowed('design-lab: choice save', e));
  const accept = () => record({ choice: 'proposal', keep: (decision.proposal.tones ?? []).map((tn) => ({ tone: tn.name, from: tn.from })) });
  const replaced = decision.variants.filter((v) => v.id !== decision.proposal.variant && !v.keptAsIs);
  const keptAsIs = decision.variants.filter((v) => v.keptAsIs);
  const toneBased = (decision.proposal.tones ?? []).length > 0;
  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${tr('designLab.allDecisions', 'All decisions')}<//>
    <${PageIntro} title=${decision.title} sub=${decision.question} />
    <${AnswerBar} decision=${decision} record=${choice} onAccept=${accept} />
    <${Band} title=${tr('designLab.proposalPicture', 'The proposal, next to what it replaces')} tight=${true}>
      <${Specimens}>
        <${Specimen} label=${`${tr('designLab.proposal', 'The proposal')}: ${decision.proposal.name}, ${tr('designLab.lightWord', 'light')}`} src=${proposalSrc(decision, 'light')} />
        <${Specimen} label=${`${tr('designLab.proposal', 'The proposal')}: ${decision.proposal.name}, ${tr('designLab.darkWord', 'dark')}`} src=${proposalSrc(decision, 'dark')} />
        ${decision.variants.map((v, i) => html`
          <${Specimen} key=${`${v.id}-l`} label=${`${v.name}, ${tr('designLab.lightWord', 'light')}`} src=${variantSrc(decision.id, i, 'light')} onValues=${setters[`${v.id}:light`]} />
          <${Specimen} key=${`${v.id}-d`} label=${`${v.name}, ${tr('designLab.darkWord', 'dark')}`} src=${variantSrc(decision.id, i, 'dark')} onValues=${setters[`${v.id}:dark`]} />`)}
      <//>
    <//>
    <${Band} title=${tr('designLab.proposal', 'The proposal')} tight=${true}>
      <p>${decision.proposal.text}</p>
      ${(decision.proposal.tones ?? []).map((tn) => html`<${NamedRow} key=${tn.name} label=${tn.name}>${tn.from}<//>`)}
    <//>
    ${replaced.length > 0 && html`
      <${Band} title=${tr('designLab.goesAway', 'What goes away')} tight=${true}>
        <p>${toneBased
          ? tr('designLab.goesAwayTones', 'These old classes go away; their look stays as the tone named beside each.')
          : tr('designLab.goesAwayPlain', 'These old classes go away; where they were, the proposal\'s look is drawn.')}</p>
        ${replaced.map((v) => html`<${NamedRow} key=${v.id} label=${v.name}>${v.becomes ?? decision.proposal.name}<//>`)}
        ${keptAsIs.length > 0 && html`<${NamedRow} label=${tr('designLab.keepsAsIs', 'Keeps as it is')}>${keptAsIs.map((v) => v.name).join(' · ')}<//>`}
      <//>`}
    <${Band} title=${tr('designLab.changes', 'What would change')} tight=${true}>
      ${decision.changes.map((c) => html`<${NamedRow} key=${c.page} label=${c.page}>${c.what}<//>`)}
    <//>
    ${!decision.choice && html`<${OtherOptions} decision=${decision} record=${choice} onSave=${record} />`}
    ${decision.variants.map((v) => html`<${VariantRow} key=${v.id} decision=${decision} variant=${v} values=${values[v.id]} crops=${crops} />`)}`;
}

/** Every decision, its proposal in one sentence, and the answer so far. */
function Summary({ records, onOpen }) {
  return html`
    <${Band} title=${tr('designLab.summary', 'The decisions and your answers')} tight=${true}>
      ${DECISIONS.map((d, i) => html`
        <${NamedRow} key=${d.id} label=${`${i + 1}. ${shortTitle(d)}`}>
          <span>${d.proposal.summary} ${tr('designLab.yourAnswer', 'Your answer so far')}: <strong>${answerWord(answerOf(d, records?.[d.id]))}</strong>.</span>
          <${FoldButton} onClick=${() => onOpen(d.id)}>${tr('designLab.open', 'Open the decision')}<//>
        <//>`)}
    <//>`;
}

export default function DecisionsView() {
  const [open, setOpen] = useState(/** @type {string|null} */ (null));
  const [crops, setCrops] = useState(/** @type {any} */ (null));
  const [records, setRecords] = useState(/** @type {Record<string, any>|null} */ (null));
  useEffect(() => {
    fetch('/img/design-lab/crops.json').then((r) => (r.ok ? r.json() : {})).then(setCrops)
      .catch((e) => { swallowed('design-lab: crops', e); setCrops({}); });
  }, []);
  // The answers are read again whenever the list is shown, so an answer given inside a decision
  // is in the summary on the way back.
  useEffect(() => {
    if (open) return;
    Promise.all(DECISIONS.map(async (d) => [d.id, await readChoice(d.id)])).then((pairs) => setRecords(Object.fromEntries(pairs)));
  }, [open]);
  const decision = DECISIONS.find((d) => d.id === open);
  if (decision) return html`<${DecisionDetail} decision=${decision} crops=${crops} onBack=${() => setOpen(null)} />`;
  const waiting = DECISIONS.filter((d) => answerOf(d, records?.[d.id]) === 'none').length;
  return html`
    <${Hint}>${tr('designLab.decisionsIntro', 'One decision per job the pages do in more than one way. Open one to see the proposal next to what it replaces, live and on their pages, with what would change. Nothing is changed before you choose.')}<//>
    <${BandNote}>${tr('designLab.decisionsCount', '{n} decisions, {w} waiting for you').replace('{n}', String(DECISIONS.length)).replace('{w}', String(waiting))}<//>
    <${Summary} records=${records} onOpen=${setOpen} />`;
}
