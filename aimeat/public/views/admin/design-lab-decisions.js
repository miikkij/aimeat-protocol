/**
 * @file public/views/admin/design-lab-decisions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat-design-lab, the decisions view: every kind of thing the pages draw in more
 *   than one way, the variants side by side as live parts (light and dark) and as crops from their
 *   pages, with their measured values and where they are drawn, the proposal for the one look, and
 *   what would change on which page. Jouni chooses; nothing is unified before he has.
 *
 *   A decision belongs to the project (Jouni, 2026-09-23). The pick made here is stored as the
 *   operator's own record on this node (`design-lab.choice.<id>`), and the session that builds the
 *   unification moves it into public/views/design-lab/decisions-data.js, where it ships in the code.
 * @structure DecisionsView (default) · DecisionDetail · VariantRow · ChoiceBar
 * @usage Mounted by views/admin/design-lab-tab.js (the Decisions switch).
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
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
const frameSrc = (id, v, theme) => `/v1/design-lab/frame?id=decision:${encodeURIComponent(id)}&v=${v}&theme=${theme}`;
const choiceKey = (id) => `design-lab.choice.${id}`;

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

/** The values a frame measured, as one quiet line per theme. */
function Values({ values }) {
  if (!values) return html`<p class="poster-specimen-values">${tr('designLab.measuring', 'measuring…')}</p>`;
  return html`<p class="poster-specimen-values">${Object.entries(values).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>`;
}

function VariantRow({ decision, variant, index, crops, chosen, onChoose }) {
  const [light, setLight] = useState(null);
  const [dark, setDark] = useState(null);
  const crop = crops?.[decision.id]?.[variant.id] ?? {};
  const isProposal = decision.proposal.variant === variant.id;
  const title = `${index + 1}. ${variant.name}${isProposal ? ' · ' + tr('designLab.proposed', 'proposed') : ''}${chosen ? ' · ' + tr('designLab.chosen', 'chosen') : ''}`;
  return html`
    <${Band} title=${title} tight=${true}>
      <p>${variant.look}. ${tr('designLab.drawn', 'Drawn')}: ${variant.where}${decision.counted && variant.files ? ` (${variant.files} ${tr('designLab.files', 'files')})` : ''}.</p>
      <${Specimens}>
        <${Specimen} label=${tr('designLab.liveLight', 'Live, light')} src=${frameSrc(decision.id, index, 'light')} onValues=${setLight} />
        <${Specimen} label=${tr('designLab.liveDark', 'Live, dark')} src=${frameSrc(decision.id, index, 'dark')} onValues=${setDark} />
        <${SpecimenImage} label=${tr('designLab.cropLight', 'On its page, light')} src=${crop.light} missing=${crop.missing || tr('designLab.noCrop', 'No crop yet.')} />
        <${SpecimenImage} label=${tr('designLab.cropDark', 'On its page, dark')} src=${crop.dark} missing=${crop.missing || tr('designLab.noCrop', 'No crop yet.')} />
      <//>
      <${NamedRow} label=${tr('designLab.light', 'Light')}><${Values} values=${light} /><//>
      <${NamedRow} label=${tr('designLab.dark', 'Dark')}><${Values} values=${dark} /><//>
      <${FoldButton} on=${chosen} onClick=${() => onChoose(variant.id)}>
        ${chosen ? tr('designLab.isChosen', 'Your choice') : tr('designLab.choose', 'Choose this one')}
      <//>
    <//>`;
}

function ChoiceBar({ decision, choice, onSave }) {
  const [note, setNote] = useState(choice?.note ?? '');
  const picked = choice?.choice ? decision.variants.find((v) => v.id === choice.choice) : null;
  return html`
    <${Band} title=${tr('designLab.yourChoice', 'Your choice')} tight=${true}>
      ${choice
        ? html`<p>${choice.choice === 'not-now'
            ? tr('designLab.notNowSaved', 'Not now.')
            : `${picked ? picked.name : choice.choice}.`} ${choice.decidedAt ? `(${choice.decidedAt.slice(0, 10)})` : ''}</p>`
        : html`<${QuietNote}>${tr('designLab.undecided', 'Not decided yet. Choose a variant above, or say not now.')}<//>`}
      <${TextInput} id=${`design-lab-note-${decision.id}`} maxLength="400" placeholder=${tr('designLab.notePlaceholder', 'A note with your choice (optional)')}
        value=${note} onInput=${(e) => setNote(e.target.value)} />
      <${FoldButton} onClick=${() => onSave('not-now', note)}>${tr('designLab.notNow', 'Not now')}<//>
      <${Hint}>${tr('designLab.choiceHint', 'The choice is kept as your record on this node. The session that builds the change writes it into the code, where it holds for every node.')}<//>
    <//>`;
}

function DecisionDetail({ decision, crops, onBack }) {
  const { choice, save } = useChoice(decision.id);
  const record = (value, note) => save({
    kind: decision.id, choice: value, note: note ?? choice?.note ?? '',
    proposal: decision.proposal.variant, decidedAt: new Date().toISOString(),
  }).catch((e) => swallowed('design-lab: choice save', e));
  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${tr('designLab.allDecisions', 'All decisions')}<//>
    <${PageIntro} title=${decision.title} sub=${decision.question} />
    <${Band} title=${tr('designLab.atAGlance', 'At a glance')} tight=${true}>
      <${Specimens}>
        ${decision.variants.map((v, i) => html`
          <${Specimen} key=${v.id} label=${`${i + 1}. ${v.name}`} src=${frameSrc(decision.id, i, 'light')} />`)}
      <//>
    <//>
    <${Band} title=${tr('designLab.proposal', 'The proposal')} tight=${true}>
      <p>${decision.proposal.text}</p>
      <${NamedRow} label=${tr('designLab.proposedVariant', 'Proposed')}>${decision.variants.find((v) => v.id === decision.proposal.variant)?.name}<//>
    <//>
    <${Band} title=${tr('designLab.changes', 'What would change')} tight=${true}>
      ${decision.changes.map((c) => html`<${NamedRow} key=${c.page} label=${c.page}>${c.what}<//>`)}
    <//>
    ${decision.variants.map((v, i) => html`
      <${VariantRow} key=${v.id} decision=${decision} variant=${v} index=${i} crops=${crops}
        chosen=${choice?.choice === v.id} onChoose=${(id) => record(id)} />`)}
    <${ChoiceBar} decision=${decision} choice=${choice} onSave=${record} />`;
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
  return html`
    <${Hint}>${tr('designLab.decisionsIntro', 'Every kind of thing the pages draw in more than one way. Open one to see the variants side by side, live and on their pages, with the proposal and what would change. Nothing is changed before you choose.')}<//>
    ${DECISIONS.map((d, i) => html`
      <${Band} key=${d.id} title=${`${i + 1}. ${d.title}`} tight=${true}>
        <p>${d.question}</p>
        <${BandNote}>${tr('designLab.variantsCount', '{n} variants').replace('{n}', String(d.variants.length))} · ${tr('designLab.proposedVariant', 'Proposed')}: ${d.variants.find((v) => v.id === d.proposal.variant)?.name}<//>
        <${FoldButton} onClick=${() => setOpen(d.id)}>${tr('designLab.open', 'Open the decision')}<//>
      <//>`)}`;
}
