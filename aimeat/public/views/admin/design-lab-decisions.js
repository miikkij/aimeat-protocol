/**
 * @file public/views/admin/design-lab-decisions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat-design-lab, the decisions view: one decision per job the pages do in more
 *   than one way. A decision opens on its proposal as a picture (the one component with its tones,
 *   light and dark) next to the variants it replaces, then the tones and where each comes from,
 *   what would change on which page, and each variant with its crops from its page and its measured
 *   values. Jouni chooses: the proposal, one variant, or several variants kept as named tones; or
 *   not now. Nothing is unified before he has.
 *
 *   A decision belongs to the project (Jouni, 2026-09-23). A pick made here is stored as the
 *   operator's own record on this node (`design-lab.choice.<id>`), and the session that builds the
 *   change writes it into public/views/design-lab/decisions-data.js, where it ships in the code; a
 *   decision already written there shows as decided and takes no new pick.
 * @structure DecisionsView (default) · DecisionDetail · VariantRow · ChoiceBar · useChoice
 * @usage Mounted by views/admin/design-lab-tab.js (the Decisions switch).
 * @version-history
 *   v2.0.0 — 2026-09-23 — The proposal as a picture next to the variants it replaces; tones with
 *     their sources; a choice can keep several variants as named tones; decided decisions (from the
 *     data) show as decided.
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
import { QuietNote } from '/components/QuietNote.js';
import { TextInput } from '/components/TextInput.js';
import { Specimens, Specimen, SpecimenImage } from '/components/Specimen.js';
import { DECISIONS } from '/views/design-lab/decisions-data.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const variantSrc = (id, v, theme) => `/v1/design-lab/frame?id=decision:${encodeURIComponent(id)}&v=${v}&theme=${theme}`;
const choiceKey = (id) => `design-lab.choice.${id}`;

/** The proposal's picture: its own composition, or the proposed variant's sample. */
function proposalSrc(decision, theme) {
  if (decision.proposal.variant === 'proposal') return `/v1/design-lab/frame?id=proposal:${encodeURIComponent(decision.id)}&v=0&theme=${theme}`;
  return variantSrc(decision.id, decision.variants.findIndex((v) => v.id === decision.proposal.variant), theme);
}

/** This node's record of the operator's pick for one decision, or null. */
function useChoice(id) {
  const [choice, setChoice] = useState(/** @type {any} */ (null));
  const load = useCallback(async () => {
    try {
      const r = await apiGet(`/v1/memory/${encodeURIComponent(choiceKey(id))}?soft=1`);
      setChoice(r?.data && r.data.exists !== false ? (r.data.value ?? null) : null);
    } catch (e) { swallowed('design-lab: choice read', e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (value) => {
    await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: choiceKey(id), value, visibility: 'private' }) });
    setChoice(value);
  }, [id]);
  return { choice, save };
}

/** The values a frame measured, as one quiet line. */
function Values({ values }) {
  if (!values) return html`<p class="poster-specimen-values">${tr('designLab.measuring', 'measuring…')}</p>`;
  return html`<p class="poster-specimen-values">${Object.entries(values).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>`;
}

function VariantRow({ decision, variant, values, crops, picked, kept, onChoose, onKeep, open }) {
  const crop = crops?.[decision.id]?.[variant.id] ?? {};
  const [toneName, setToneName] = useState(kept?.tone ?? '');
  const marks = [
    decision.proposal.variant === variant.id ? tr('designLab.proposed', 'proposed') : '',
    picked ? tr('designLab.chosen', 'chosen') : '',
    kept ? `${tr('designLab.keptAs', 'kept as')} "${kept.tone}"` : '',
  ].filter(Boolean).join(' · ');
  return html`
    <${Band} title=${variant.name + (marks ? ` · ${marks}` : '')} tight=${true}>
      <p>${variant.look}. ${tr('designLab.drawn', 'Drawn')}: ${variant.where}${decision.counted && variant.files ? ` (${variant.files} ${tr('designLab.files', 'files')})` : ''}.</p>
      <${Specimens}>
        <${SpecimenImage} label=${tr('designLab.cropLight', 'On its page, light')} src=${crop.light} missing=${crop.missing || tr('designLab.noCrop', 'No crop yet.')} />
        <${SpecimenImage} label=${tr('designLab.cropDark', 'On its page, dark')} src=${crop.dark} missing=${crop.missing || tr('designLab.noCrop', 'No crop yet.')} />
      <//>
      <${NamedRow} label=${tr('designLab.light', 'Light')}><${Values} values=${values?.light} /><//>
      <${NamedRow} label=${tr('designLab.dark', 'Dark')}><${Values} values=${values?.dark} /><//>
      ${open && html`
        <${FoldButton} on=${picked} onClick=${() => onChoose(variant.id)}>${picked ? tr('designLab.isChosen', 'Your choice') : tr('designLab.choose', 'Choose this one')}<//>
        <${TextInput} id=${`design-lab-tone-${decision.id}-${variant.id}`} maxLength="40" placeholder=${tr('designLab.tonePlaceholder', 'A tone name, to keep this one as a tone')}
          value=${toneName} onInput=${(e) => setToneName(e.target.value)} />
        <${FoldButton} on=${!!kept} onClick=${() => onKeep(variant.id, kept ? null : (toneName.trim() || variant.id))}>
          ${kept ? tr('designLab.dropTone', 'Do not keep it as a tone') : tr('designLab.keepTone', 'Keep it as a tone')}
        <//>`}
    <//>`;
}

function ChoiceBar({ decision, choice, onSave }) {
  const [note, setNote] = useState(choice?.note ?? '');
  const decided = decision.choice;
  if (decided) {
    const v = decision.variants.find((x) => x.id === decided.variant);
    return html`
      <${Band} title=${tr('designLab.decided', 'Decided')} tight=${true}>
        <p>${v ? v.name : decided.variant} · ${decided.decidedBy}, ${decided.decidedAt}</p>
        <p>${decided.note}</p>
      <//>`;
  }
  const picked = choice?.choice === 'proposal' ? decision.proposal.name
    : decision.variants.find((v) => v.id === choice?.choice)?.name;
  return html`
    <${Band} title=${tr('designLab.yourChoice', 'Your choice')} tight=${true}>
      ${choice?.choice
        ? html`<p>${choice.choice === 'not-now' ? tr('designLab.notNowSaved', 'Not now.') : `${picked ?? choice.choice}.`}
            ${(choice.keep ?? []).length ? ` ${tr('designLab.keptTones', 'Kept as tones')}: ${choice.keep.map((k) => `${k.tone} (${decision.variants.find((v) => v.id === k.variant)?.name ?? k.variant})`).join(', ')}.` : ''}
            ${choice.decidedAt ? ` (${choice.decidedAt.slice(0, 10)})` : ''}</p>`
        : html`<${QuietNote}>${tr('designLab.undecided', 'Not decided yet. Choose the proposal or a variant, keep variants as tones, or say not now.')}<//>`}
      ${decision.proposal.variant === 'proposal' && html`
        <${FoldButton} on=${choice?.choice === 'proposal'} onClick=${() => onSave({ choice: 'proposal' })}>${tr('designLab.chooseProposal', 'Choose the proposal')}<//>`}
      <${FoldButton} onClick=${() => onSave({ choice: 'not-now' })}>${tr('designLab.notNow', 'Not now')}<//>
      <${TextInput} id=${`design-lab-note-${decision.id}`} maxLength="400" placeholder=${tr('designLab.notePlaceholder', 'A note with your choice (optional)')}
        value=${note} onInput=${(e) => setNote(e.target.value)} />
      <${FoldButton} onClick=${() => onSave({ note })}>${tr('designLab.saveNote', 'Keep the note')}<//>
      <${Hint}>${tr('designLab.choiceHint', 'The choice is kept as your record on this server. The session that builds the change writes it into the code, where it holds for every AIMEAT.')}<//>
    <//>`;
}

function DecisionDetail({ decision, crops, onBack }) {
  const { choice, save } = useChoice(decision.id);
  const [values, setValues] = useState(/** @type {Record<string, {light?: any, dark?: any}>} */ ({}));
  // One stable setter per variant and theme, so a frame's listener is not re-made on every render.
  const setters = useMemo(() => Object.fromEntries(decision.variants.flatMap((v) => ['light', 'dark'].map((theme) => [
    `${v.id}:${theme}`, (vals) => setValues((prev) => ({ ...prev, [v.id]: { ...prev[v.id], [theme]: vals } })),
  ]))), [decision]);
  const open = !decision.choice;
  const record = (patch) => save({
    kind: decision.id, choice: choice?.choice ?? null, keep: choice?.keep ?? [], note: choice?.note ?? '',
    proposal: decision.proposal.variant, ...patch, decidedAt: new Date().toISOString(),
  }).catch((e) => swallowed('design-lab: choice save', e));
  const keep = (variantId, tone) => {
    const rest = (choice?.keep ?? []).filter((k) => k.variant !== variantId);
    record({ keep: tone ? [...rest, { variant: variantId, tone }] : rest });
  };
  const replaced = decision.variants.filter((v) => v.id !== decision.proposal.variant && !v.keptAsIs);
  const kept = decision.variants.filter((v) => v.keptAsIs);
  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${tr('designLab.allDecisions', 'All decisions')}<//>
    <${PageIntro} title=${decision.title} sub=${decision.question} />
    ${!open && html`<${ChoiceBar} decision=${decision} choice=${choice} onSave=${record} />`}
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
      ${replaced.length > 0 && html`<${NamedRow} label=${tr('designLab.replaces', 'Replaces')}>${replaced.map((v) => v.name).join(' · ')}<//>`}
      ${kept.length > 0 && html`<${NamedRow} label=${tr('designLab.keepsAsIs', 'Keeps as it is')}>${kept.map((v) => v.name).join(' · ')}<//>`}
    <//>
    <${Band} title=${tr('designLab.changes', 'What would change')} tight=${true}>
      ${decision.changes.map((c) => html`<${NamedRow} key=${c.page} label=${c.page}>${c.what}<//>`)}
    <//>
    ${decision.variants.map((v) => html`
      <${VariantRow} key=${v.id} decision=${decision} variant=${v} values=${values[v.id]} crops=${crops} open=${open}
        picked=${choice?.choice === v.id} kept=${(choice?.keep ?? []).find((k) => k.variant === v.id)}
        onChoose=${(id) => record({ choice: id })} onKeep=${keep} />`)}
    ${open && html`<${ChoiceBar} decision=${decision} choice=${choice} onSave=${record} />`}`;
}

export default function DecisionsView() {
  const [open, setOpen] = useState(/** @type {string|null} */ (null));
  const [crops, setCrops] = useState(/** @type {any} */ (null));
  useEffect(() => {
    fetch('/img/design-lab/crops.json').then((r) => (r.ok ? r.json() : {})).then(setCrops)
      .catch((e) => { swallowed('design-lab: crops', e); setCrops({}); });
  }, []);
  const decision = DECISIONS.find((d) => d.id === open);
  if (decision) return html`<${DecisionDetail} decision=${decision} crops=${crops} onBack=${() => setOpen(null)} />`;
  const waiting = DECISIONS.filter((d) => !d.choice).length;
  return html`
    <${Hint}>${tr('designLab.decisionsIntro', 'One decision per job the pages do in more than one way. Open one to see the proposal next to what it replaces, live and on their pages, with what would change. Nothing is changed before you choose.')}<//>
    <${BandNote}>${tr('designLab.decisionsCount', '{n} decisions, {w} waiting for you').replace('{n}', String(DECISIONS.length)).replace('{w}', String(waiting))}<//>
    ${DECISIONS.map((d, i) => html`
      <${Band} key=${d.id} title=${`${i + 1}. ${d.title}`} tight=${true}>
        <p>${d.question}</p>
        <${BandNote}>${tr('designLab.variantsCount', '{n} variants').replace('{n}', String(d.variants.length))} · ${tr('designLab.proposedVariant', 'Proposed')}: ${d.proposal.name}${d.choice ? ` · ${tr('designLab.decided', 'Decided')}` : ''}<//>
        <${FoldButton} onClick=${() => setOpen(d.id)}>${tr('designLab.open', 'Open the decision')}<//>
      <//>`)}`;
}
