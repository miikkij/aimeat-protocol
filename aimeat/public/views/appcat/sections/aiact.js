/**
 * @file public/views/appcat/sections/aiact.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "EU AI Act questions", for the owner of an app that uses AI: the
 *   node's questions, an answer and a reason for each, and a ready prompt that gives the job to the
 *   owner's own AI. The answers are stored in the app's data map as `aiAct` (PUT
 *   /v1/datamap/apps/{owner}/{file}, the same write aimeat_datamap_set makes), and the node's
 *   administrator approves them in the compliance register, where they are marked as the maker's.
 *
 *   WHY HERE. The maker knows what the app does to people; the administrator who keeps the register
 *   does not, and on innokas.aimeat.io (2026-10-28) twelve AI apps waited on one administrator with
 *   130 questions open. Jouni ruled that the maker answers, through their own AI or on the app's page,
 *   and the administrator approves. The chat road comes first (the prompt above the form); the form
 *   is for the one answer somebody wants to change by hand.
 *
 *   SHOWN ONLY WHEN IT CAN BE ANSWERED. The read answers `ai_act` only for an app that uses AI; an app
 *   with no data map yet has nowhere to keep the answers, and the section says to write the map first.
 * @structure meta · questionWords(q, builtIn) · AiActSection({ d })
 * @usage const mod = await import('./sections/aiact.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Note } from '/components/Note.js';
import { Readings } from '/components/Readings.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { TextArea } from '/components/TextField.js';
import { Action, Actions } from '/components/Action.js';
import { CopyButton } from '/components/CopyButton.js';
import { Space } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';

const html = htm.bind(h);
const A = (key, vars) => t('appcat.aiAct.' + key, vars);

export const meta = { id: 'aiact', title: 'aiAct.title', show: (d) => !!(d && d.isOwnPublished) };

/** A shipped question in the reader's language; one an administrator reworded in its own words. */
export function questionWords(q, builtIn) {
  const own = builtIn.has(q.id);
  const word = (key, stored) => (own && stored ? tOr(key, stored) : stored);
  return {
    text: word(`admin.compliance.question.${q.id}.text`, q.text),
    help: word(`admin.compliance.question.${q.id}.help`, q.help),
    option: (o) => word(`admin.compliance.option.${o.value}`, o.label),
  };
}

/** The prompt for the owner's own AI: the same job the node's reminder message hands over. */
function promptFor(ref) {
  return [
    `On my AIMEAT node ${window.location.origin}, answer the EU AI Act questions for my app ${ref}.`,
    'Call aimeat_datamap_get with the app; its `ai_act` lists the questions and which are unanswered.',
    'Read the app and its data map, then propose an answer to every question with one or two sentences saying why.',
    'Show me the answers and wait for my yes. Then write them into the app\'s data map as',
    '`aiAct`: { "answers": { "<question id>": true | false | "<option value>" }, "notes": { "<question id>": "why" } }',
    'with aimeat_datamap_set, sending the whole map back with `aiAct` added.',
  ].join('\n');
}

export default function AiActSection({ d }) {
  const [state, setState] = useState({ loading: true, map: null, aiAct: null });
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const path = '/v1/datamap/apps/' + encodeURIComponent(d.owner) + '/' + encodeURIComponent(d.filename);

  useEffect(() => {
    let live = true;
    apiGet(path)
      .then((json) => {
        if (!live) return;
        const data = (json && json.data) || {};
        const map = data.data_map || null;
        setState({ loading: false, map, aiAct: data.ai_act || null });
        setAnswers({ ...((map && map.aiAct && map.aiAct.answers) || {}) });
        setNotes({ ...((map && map.aiAct && map.aiAct.notes) || {}) });
      })
      .catch((err) => { swallowed('appcat aiact: read', err); if (live) setState({ loading: false, map: null, aiAct: null }); });
    return () => { live = false; };
  }, [path]);

  if (state.loading) return null;
  if (!state.aiAct) return html`<${Note} kind="quiet">${A('notAi')}<//>`;
  const ref = `${d.owner}/${d.filename}`;
  const builtIn = new Set(state.aiAct.built_in || []);
  const questions = state.aiAct.questions || [];
  const open = questions.filter((q) => answers[q.id] === undefined).length;

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const keep = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
      // The whole map goes back, as the write replaces it; only `aiAct` changes.
      await apiPut(path, { ...state.map, aiAct: { answers: keep(answers), notes: keep(notes) } });
      setSaid({ ok: true, text: A('saved') });
    } catch (err) {
      setSaid({ ok: false, text: (err && err.message) || A('saveFailed') });
    }
    setBusy(false);
  };

  const pick = (q, words) => (q.type === 'boolean'
    ? html`<${Choice} clearable ariaLabel=${words.text} value=${answers[q.id]}
        options=${[[true, t('admin.compliance.yes')], [false, t('admin.compliance.no')]]}
        onChange=${(v) => setAnswers({ ...answers, [q.id]: v === '' ? undefined : v })} />`
    : html`<${Select} fit ariaLabel=${words.text} value=${answers[q.id] === undefined ? '' : String(answers[q.id])}
        placeholder=${t('admin.compliance.pickAnswer')}
        options=${(q.options || []).map((o) => ({ value: o.value, label: words.option(o) }))}
        onChange=${(v) => setAnswers({ ...answers, [q.id]: v === '' ? undefined : v })} />`);

  return html`
    <${Note} kind="lead">${A('lead')}<//>
    <${Space} below="part">
      <${SubHeading} level=${3}>${A('aiTitle')}<//>
      <${Note} kind="quiet">${A('aiNote')}<//>
      <${Actions}><${CopyButton} text=${promptFor(ref)} className="btn-primary" label=${A('copyPrompt')} /><//>
    <//>
    ${state.map ? null : html`<${Note} kind="hint">${A('noMap')}<//>`}
    <${SubHeading} level=${3}>${A('formTitle', { open: String(open), total: String(questions.length) })}<//>
    <${Readings} rows=${questions.map((q, i) => {
      const words = questionWords(q, builtIn);
      return {
        key: q.id,
        name: words.text,
        why: words.help || undefined,
        mark: pick(q, words),
        value: html`<${TextArea} ariaLabel=${A('noteLabel')} rows=${2} value=${notes[q.id] || ''}
          placeholder=${A('notePlaceholder')} onInput=${(v) => setNotes({ ...notes, [q.id]: v })} />`,
        last: i === questions.length - 1,
      };
    })} />
    ${said ? html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>` : null}
    <${Actions}>
      <${Action} disabled=${busy || !state.map} onClick=${save}>${busy ? A('saving') : A('save')}<//>
    <//>`;
}
