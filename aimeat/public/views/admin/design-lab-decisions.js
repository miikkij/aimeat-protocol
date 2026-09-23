/**
 * @file public/views/admin/design-lab-decisions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat-design-lab, the decisions view: one decision per job the pages do in more
 *   than one way. Laid out as Jouni asked (2026-09-23), in five parts:
 *
 *   1. The proposal: its picture in light and dark, "If you accept, these become one component:"
 *      with each option it covers, its picture and the tone it becomes, then "What would change" in
 *      plain words, and two buttons, Accept the proposal and No thanks.
 *   2. Every option on its own: its pictures in light and dark (from its own page where a crop
 *      exists), the pages that use it, and two buttons, Accept and Reject. He answers each one
 *      whether or not he accepted the proposal.
 *   3. Every answer shows its state beside its buttons (accepted, rejected, none) and changes any
 *      number of times; pressing the answer that is on takes it back to none.
 *   4. No CSS value in the visible part: the values, the measurements and the class names are in
 *      one folded Details at the bottom, closed by default. Its live previews load only when it opens.
 *   5. The list of all decisions: each one, its proposal in one sentence, and his answers so far.
 *
 *   A decision belongs to the project. An answer given here is stored as the operator's own record
 *   on this node (`design-lab.choice.<id>`: { proposal, options: { <option>: answer } }), and
 *   nothing is final until Jouni says in chat to read the decisions; the session then writes them
 *   into public/views/design-lab/decisions-data.js. A decision already written there shows as
 *   decided and takes no new answer.
 * @structure DecisionsView (default) · Summary · DecisionDetail · ProposalPart · OptionPart ·
 *   DetailsPart · Answer · useChoice · answersOf
 * @usage Mounted by views/admin/design-lab-tab.js (the Decisions switch).
 * @version-history
 *   v4.0.0 — 2026-09-23 — Rebuilt to Jouni's five points: the proposal with what it covers and two
 *     buttons, every option on its own with Accept and Reject, the state beside every answer, all
 *     values in one closed Details, and the answers in the list.
 *   v3.0.0 — 2026-09-23 — One main button, the other choices folded under Other options.
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
import { ActionRow } from '/components/ActionRow.js';
import { ChooserFold } from '/components/Chooser.js';
import { Specimens, Specimen, SpecimenImage } from '/components/Specimen.js';
import { DECISIONS } from '/views/design-lab/decisions-data.js';
import { plainDiff } from '/views/design-lab/plain-diff.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const variantSrc = (id, v, theme, solo = false) => `/v1/design-lab/frame?id=decision:${encodeURIComponent(id)}&v=${v}&theme=${theme}${solo ? '&solo=1' : ''}`;
const afterSrc = (id, v, theme) => `/v1/design-lab/frame?id=after:${encodeURIComponent(id)}&v=${v}&theme=${theme}&solo=1`;
const choiceKey = (id) => `design-lab.choice.${id}`;
/** A decision's short name: its title up to the colon. */
const shortTitle = (d) => d.title.split(':')[0];
const THEMES = /** @type {const} */ (['light', 'dark']);
const themeWord = (theme) => (theme === 'light' ? tr('designLab.lightWord', 'light') : tr('designLab.darkWord', 'dark'));

/** The proposal's picture: its own composition, or the proposed option's sample. */
function proposalSrc(decision, theme) {
  if (decision.proposal.variant === 'proposal') return `/v1/design-lab/frame?id=proposal:${encodeURIComponent(decision.id)}&v=0&theme=${theme}&solo=1`;
  return variantSrc(decision.id, decision.variants.findIndex((v) => v.id === decision.proposal.variant), theme, true);
}

/** One stable setter per key, so a frame's listener is not re-made on every render. */
function useValues(keys) {
  const [values, setValues] = useState(/** @type {Record<string, Record<string, string>>} */ ({}));
  const [setters] = useState(() => Object.fromEntries(keys.map((k) => [k, (vals) => setValues((prev) => ({ ...prev, [k]: vals }))])));
  return { values, setters };
}

async function readChoice(id) {
  try {
    const r = await apiGet(`/v1/memory/${encodeURIComponent(choiceKey(id))}?soft=1`);
    return r?.data && r.data.exists !== false ? (r.data.value ?? null) : null;
  } catch (e) { swallowed('design-lab: choice read', e); return null; }
}

/** This node's record of the operator's answers for one decision. */
function useChoice(id) {
  const [choice, setChoice] = useState(/** @type {any} */ (null));
  useEffect(() => { readChoice(id).then(setChoice); }, [id]);
  const save = useCallback(async (value) => {
    await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: choiceKey(id), value, visibility: 'private' }) });
    setChoice(value);
  }, [id]);
  return { choice, save };
}

/**
 * The answers in one shape: the proposal's and each option's, 'accepted', 'rejected' or null. A
 * record from the view before this one (`choice: 'proposal'`) reads as the proposal accepted.
 */
function answersOf(record) {
  const proposal = record?.proposal === 'accepted' || record?.proposal === 'rejected' ? record.proposal
    : record?.choice === 'proposal' ? 'accepted' : null;
  return { proposal, options: record?.options && typeof record.options === 'object' ? record.options : {} };
}
const answerWord = (a) => tr(`designLab.answer.${a ?? 'none'}`, a ?? 'none');

/** Two buttons and the answer's state beside them. Pressing the answer that is on clears it. */
function Answer({ state, acceptLabel, rejectLabel, onSet }) {
  return html`
    <${ActionRow}>
      <${FoldButton} on=${state === 'accepted'} onClick=${() => onSet(state === 'accepted' ? null : 'accepted')}>${acceptLabel}<//>
      <${FoldButton} on=${state === 'rejected'} onClick=${() => onSet(state === 'rejected' ? null : 'rejected')}>${rejectLabel}<//>
      <span>${tr('designLab.answerLabel', 'Your answer')}: <strong>${answerWord(state)}</strong></span>
    <//>`;
}

/** Part 1: the proposal, what it covers, what would change, and its answer. */
function ProposalPart({ decision, state, onSet }) {
  const tones = decision.proposal.tones ?? [];
  return html`
    <${Band} title=${`${tr('designLab.proposal', 'The proposal')}: ${decision.proposal.name}`} tight=${true}>
      <${Specimens}>
        ${THEMES.map((theme) => html`<${Specimen} key=${theme} label=${`${tr('designLab.proposal', 'The proposal')}, ${themeWord(theme)}`} src=${proposalSrc(decision, theme)} />`)}
      <//>
      <p>${decision.proposal.summary}</p>
      ${tones.map((tn) => html`<${NamedRow} key=${tn.name} label=${tn.name}>${tn.meaning}<//>`)}
      <p><strong>${tr('designLab.ifAccept', 'If you accept, these become one component:')}</strong></p>
      <${Specimens}>
        ${decision.variants.map((v, i) => html`
          <${Specimen} key=${v.id} label=${v.name} src=${variantSrc(decision.id, i, 'light', true)} note=${`→ ${v.becomes}`} />`)}
      <//>
    <//>
    <${Band} title=${tr('designLab.changes', 'What would change')} tight=${true}>
      ${decision.changes.map((c) => html`<${NamedRow} key=${c.page} label=${c.page}>${c.what}<//>`)}
    <//>
    ${decision.choice
      ? html`<${Band} title=${tr('designLab.decided', 'Decided')} tight=${true}>
          <p>${decision.choice.note} (${decision.choice.decidedBy}, ${decision.choice.decidedAt})</p><//>`
      : html`<${Answer} state=${state} acceptLabel=${tr('designLab.accept', 'Accept the proposal')}
          rejectLabel=${tr('designLab.noThanks', 'No thanks')} onSet=${onSet} />`}`;
}

/**
 * Part 2: one option on its own: the element alone as it looks today and as the proposal would
 * draw it, in light and dark; what changes, computed from the two; where it sits on its real page,
 * outlined; the pages that use it; and its answer.
 */
function OptionPart({ decision, variant, index, crops, state, onSet }) {
  const crop = crops?.[decision.id]?.[variant.id] ?? {};
  const { values, setters } = useValues(['today', 'after']);
  const changes = plainDiff(values.today, values.after);
  return html`
    <${Band} title=${variant.name} tight=${true}>
      <${Specimens}>
        ${THEMES.map((theme) => html`
          <${Specimen} key=${`t-${theme}`} label=${`${tr('designLab.today', 'Today')}, ${themeWord(theme)}`}
            src=${variantSrc(decision.id, index, theme, true)} eager=${theme === 'light'} onValues=${theme === 'light' ? setters.today : undefined} />
          <${Specimen} key=${`a-${theme}`} label=${`${tr('designLab.afterProposal', 'After the proposal')}, ${themeWord(theme)}`}
            src=${afterSrc(decision.id, index, theme)} eager=${theme === 'light'} onValues=${theme === 'light' ? setters.after : undefined} />`)}
      <//>
      <${NamedRow} label=${tr('designLab.whatChanges', 'What changes')}>${changes ? changes.join(' ') : tr('designLab.measuring', 'measuring…')}<//>
      ${crop.context
        ? html`<${Specimens}><${SpecimenImage} label=${tr('designLab.onItsPage', 'Where it is on its page (outlined)')} src=${crop.context} /><//>`
        : html`<${Hint}>${tr('designLab.noContext', 'No picture from a real page')}: ${crop.missing || tr('designLab.noContextYet', 'not taken yet')}.<//>`}
      <${NamedRow} label=${tr('designLab.pages', 'Pages')}>${variant.where}<//>
      ${!decision.choice && html`<${Answer} state=${state} acceptLabel=${tr('designLab.acceptOne', 'Accept')}
        rejectLabel=${tr('designLab.reject', 'Reject')} onSet=${onSet} />`}
    <//>`;
}

/** Part 4: the values, the measurements and the code, closed until opened. */
function DetailsPart({ decision }) {
  const [values, setValues] = useState(/** @type {Record<string, Record<string, string>>} */ ({}));
  // One stable setter per option and theme, so a frame's listener is not re-made on every render.
  const setters = useMemo(() => Object.fromEntries(decision.variants.flatMap((v) => THEMES.map((theme) => [
    `${v.id}:${theme}`, (vals) => setValues((prev) => ({ ...prev, [`${v.id}:${theme}`]: vals })),
  ]))), [decision]);
  const measured = (key) => {
    const vals = values[key];
    return vals ? Object.entries(vals).map(([k, v]) => `${k} ${v}`).join(' · ') : tr('designLab.measuring', 'measuring…');
  };
  return html`
    <${ChooserFold} summary=${tr('designLab.details', 'Details')}>
      <p>${decision.proposal.text}</p>
      ${(decision.proposal.tones ?? []).map((tn) => html`<${NamedRow} key=${tn.name} label=${tn.name}>${tn.from}<//>`)}
      ${decision.variants.map((v, i) => html`
        <${NamedRow} key=${v.id} label=${v.name}>
          ${v.code}.${decision.counted && v.files ? ` ${v.files} ${tr('designLab.files', 'files')}.` : ''}
        <//>
        <${Specimens}>
          ${THEMES.map((theme) => html`<${Specimen} key=${theme} label=${themeWord(theme)} src=${variantSrc(decision.id, i, theme)}
            onValues=${setters[`${v.id}:${theme}`]} note=${measured(`${v.id}:${theme}`)} />`)}
        <//>`)}
    <//>`;
}

function DecisionDetail({ decision, crops, onBack }) {
  const { choice, save } = useChoice(decision.id);
  const answers = answersOf(choice);
  const record = (patch) => save({
    kind: decision.id, proposal: answers.proposal, options: answers.options, ...patch, decidedAt: new Date().toISOString(),
  }).catch((e) => swallowed('design-lab: choice save', e));
  const setOption = (id, state) => {
    const options = { ...answers.options };
    if (state) options[id] = state; else delete options[id];
    record({ options });
  };
  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${tr('designLab.allDecisions', 'All decisions')}<//>
    <${PageIntro} title=${decision.title} sub=${decision.question} />
    <${ProposalPart} decision=${decision} state=${answers.proposal} onSet=${(state) => record({ proposal: state })} />
    <${BandNote}>${tr('designLab.everyOption', 'Every option on its own')}<//>
    ${decision.variants.map((v, i) => html`<${OptionPart} key=${v.id} decision=${decision} variant=${v} index=${i} crops=${crops}
      state=${answers.options[v.id] ?? null} onSet=${(state) => setOption(v.id, state)} />`)}
    <${DetailsPart} decision=${decision} />`;
}

/** Part 5: every decision, its proposal in one sentence, and the answers so far. */
function Summary({ records, onOpen }) {
  return html`
    <${Band} title=${tr('designLab.summary', 'The decisions and your answers')} tight=${true}>
      ${DECISIONS.map((d, i) => {
        const a = answersOf(records?.[d.id]);
        const given = Object.values(a.options);
        const accepted = given.filter((s) => s === 'accepted').length;
        const rejected = given.filter((s) => s === 'rejected').length;
        const answerText = d.choice
          ? `${tr('designLab.decided', 'Decided')}: ${d.choice.note}`
          : `${tr('designLab.proposal', 'The proposal')}: ${answerWord(a.proposal)}. ${tr('designLab.optionsCount', 'Options: {a} accepted, {r} rejected, {n} without an answer.')
            .replace('{a}', String(accepted)).replace('{r}', String(rejected)).replace('{n}', String(d.variants.length - accepted - rejected))}`;
        return html`
          <${NamedRow} key=${d.id} label=${`${i + 1}. ${shortTitle(d)}`}>
            <span>${d.proposal.summary} <strong>${answerText}</strong></span>
            <${FoldButton} onClick=${() => onOpen(d.id)}>${tr('designLab.open', 'Open the decision')}<//>
          <//>`;
      })}
    <//>`;
}

export default function DecisionsView() {
  const [open, setOpen] = useState(/** @type {string|null} */ (null));
  const [crops, setCrops] = useState(/** @type {any} */ (null));
  const [records, setRecords] = useState(/** @type {Record<string, any>|null} */ (null));
  // The server gives /img a week's cache; a new crop run must show at once, so ask every time.
  useEffect(() => {
    fetch('/img/design-lab/crops.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).then(setCrops)
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
  const waiting = DECISIONS.filter((d) => !d.choice && !answersOf(records?.[d.id]).proposal).length;
  return html`
    <${Hint}>${tr('designLab.decisionsIntro', 'One decision per job the pages do in more than one way. Open one to see the proposal, what it covers and what would change, and answer the proposal and every option. You can change an answer at any time; nothing changes on the pages before you say so in chat.')}<//>
    <${BandNote}>${tr('designLab.decisionsCount', '{n} decisions, {w} waiting for you').replace('{n}', String(DECISIONS.length)).replace('{w}', String(waiting))}<//>
    <${Summary} records=${records} onOpen=${setOpen} />`;
}
