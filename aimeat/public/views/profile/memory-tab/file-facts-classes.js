/**
 * @file public/views/profile/memory-tab/file-facts-classes.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content classes part of a stored file's fold (memory-tab/file-facts.js): each
 *   class the file belongs to, how certain the answer was, and who decided it: the decision model
 *   (System 1), with a fold that shows that decision (file-facts-decision.js); the person; or the
 *   person's rule. "Change" opens a check list of the classes that can
 *   apply to a file of this kind, the current ones ticked; Save sends the list to
 *   POST /v1/content/correct { source, classes }, and the server marks a model's decision it keeps
 *   as confirmed and one it removes as overridden. When it answers with that review, one line says
 *   the decision is marked as corrected.
 *
 *   When the file has no class and the sorting step ran, the part says that no content class fits;
 *   when the step has not run, it says the file is not sorted yet. Jouni, 2026-10-21: he could not
 *   see what decision was made, nor that he could correct it.
 * @structure ClassesPart({ facts, classes, source, onFacts })
 * @usage html`<${ClassesPart} facts=${facts} classes=${classes} source=${source} onFacts=${setFacts} />`
 * @version-history
 *   v1.1.0 — 2026-10-21 — The model's decision is shown in a fold here (file-facts-decision.js); the
 *     link to the AI page's decision card is gone, because in the dialog it changed only the address.
 *   v1.0.0 — 2026-10-21 — Initial (Jouni's look of 2026-10-21).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Space } from '/components/Layout.js';
import { Facts } from '/components/Facts.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Fields, FormActions } from '/components/Field.js';
import { Check } from '/components/Check.js';
import { cc, classLabel, classesForKind, correctItem, percent } from '../data-wallet/content-facts.js';
import { DecisionFold } from './file-facts-decision.js';

const html = htm.bind(h);
const errText = (e) => e?.error?.message || e?.response?.error?.message || e?.message || cc('saveFailed');

/** One membership as a Facts row: the class, who decided, how certain. */
function membershipRow(m, classes) {
  const by = m.by === 'owner' ? cc('by.owner') : m.by === 'rule' ? cc('by.rule') : cc('by.model');
  return {
    key: m.id,
    k: classLabel(classes, m.id),
    v: by,
    sub: typeof m.confidence === 'number' ? cc('certainty', { pct: percent(m.confidence) }) : undefined,
  };
}

/**
 * @param {{ facts: any, classes: any[], source: { kind: string, key: string, owner?: string },
 *   onFacts: (facts: any) => void }} props
 */
export function ClassesPart({ facts, classes, source, onFacts }) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const members = facts.classes || [];
  const kind = facts.technical?.kind;
  // A class the file already has stays in the list even when its kinds would leave it out.
  const offered = classesForKind(classes, kind).concat(classes.filter((c) => members.some((m) => m.id === c.id) && !classesForKind([c], kind).length));

  const open = () => { setPicked(members.map((m) => m.id)); setMsg(null); setEditing(true); };
  const toggle = (id, on) => setPicked((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await correctItem({ source, classes: picked });
      if (r.facts) onFacts(r.facts);
      setEditing(false);
      setMsg({ text: r.review ? cc('reviewMarked') : cc('saved') });
    } catch (e) { setMsg({ text: errText(e), error: true }); }
    setBusy(false);
  };

  const empty = facts.stages?.classify ? cc('noClassFits') : cc('notSorted');
  return html`
    <${Space} above="medium">
      <${Label} block>${cc('classesTitle')}<//>
      ${members.length ? html`<${Facts} rows=${members.map((m) => membershipRow(m, classes))} />` : html`<${Note} kind="quiet">${empty}<//>`}
      ${members.filter((m) => m.by === 'model' && m.decisionId).map((m) => html`
        <${DecisionFold} key=${m.decisionId + m.id} decisionId=${m.decisionId} classes=${classes} title=${cc('decisionOf', { cls: classLabel(classes, m.id) })} />`)}
      ${editing ? html`
        <${Fields}>
          ${offered.map((c) => html`
            <${Check} key=${c.id} checked=${picked.includes(c.id)} disabled=${busy} hint=${c.describe}
              onChange=${(on) => toggle(c.id, on)}>${classLabel(classes, c.id)}<//>`)}
          <${FormActions}>
            <${Loud} control disabled=${busy} onClick=${save}>${busy ? cc('saving') : cc('save')}<//>
            <${Action} small soft disabled=${busy} onClick=${() => setEditing(false)}>${cc('cancel')}<//>
          <//>
        <//>` : html`
        <${Actions}>
          <${Action} small onClick=${open}>${cc('changeClasses')}<//>
        <//>`}
      ${msg ? html`<${Note} kind="message" error=${!!msg.error}>${msg.text}<//>` : null}
    <//>`;
}

export default ClassesPart;
