/**
 * @file decide-rules.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's DECISION RULES inside the decision-model card: the list with each rule's
 *   quality numbers, the editor, the try button, and the proposals an agent left for approval.
 *
 *   WHY A SCREEN. A rule decides whether an agent acts, so an agent may only PROPOSE one; creating,
 *   changing and approving are the owner's own presses. Reading and running rules is on MCP
 *   (aimeat_decide_rules, aimeat_decide { rule }).
 *
 *   THE EDITOR SPEAKS THE RULE'S OWN SHAPE. One row per question: its id, its type, the statement in
 *   English, its options or levels one per line, and the value its answer must reach. The two bands
 *   are two numbers. No number is prefilled: a threshold nobody chose is a guess with a decimal
 *   point, and TypeSafe's agreement forbids presenting thresholds as defaults.
 *
 *   THE NUMBERS BESIDE A RULE are counted by the node (GET /v1/ai/decide/rules → quality): decisions,
 *   how many a gate stopped, how many a person overrode, what they cost, and when the rule last
 *   changed. They are what the thresholds are tuned from.
 * @structure DecideRules({ available, providers }) · toRule / fromRule (the editor's draft ↔ the record)
 * @usage import { DecideRules } from './decide-rules.js'; html`<${DecideRules} available=${true} providers=${view} />`
 * @version-history
 *   v1.18.0 — 2026-09-26 — Every part is a kit component (Touch keeps every control 44px; BoxList and BoxLine for the proposals and the rules, the message each door caused after it; the editor in the dashed field Box with TextField, TextArea, Select, Check and Fields, a question in a row Box; SubHeading; Note with a refusal kept one problem per line; Action; Layout): the part writes no class (page group G8).
 *   v1.17.0 — 2026-09-26 — A rule's lines beside its title are the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.16.0 — 2026-09-26 — "Gate" is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.15.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.13.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 — 2026-09-26 — A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.10.0 — 2026-09-26 — What trying a Decide rule gave, and a load of the rules that failed, are the Form message (its error tone for the failure); .pf-dr-tried and .pf-aitr-muted go (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-26 — The last labels over a field, a meter or a chart are the row label (.poster-label): the Decide editors' field labels, the overview's quota names, the AI budget chart's title; their own looks go (a unification: Jouni's decision Row label).
 *   v1.8.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The last lines that say nothing is there are the quiet sentence (.poster-quiet); the ecosystem's empty frame goes, its second line is the Hint (Jouni's decision "Empty line", a unification).
 *   v1.6.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-23 — A message is drawn beside the control that caused it (the editor, the rule,
 *     the proposal), Cancel takes the editor's message with it, and what a provider cannot carry is
 *     said in the page's language from the fields the node sends.
 *   v1.1.0 — 2026-09-23 — A rule may name the decision provider it always runs on: a field in the
 *     editor, and the provider in the rule's line.
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from '/js/format.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { providerTitle } from './decide-providers.js';
import { Hint } from '/components/Hint.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Box, BoxList, BoxLine } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { Stack, Space, Touch } from '/components/Layout.js';

const shortDay = (iso) => String(iso ?? '').slice(0, 10);
const money = (usd) => `$${Number(usd || 0) < 1 ? Number(usd || 0).toFixed(4) : Number(usd || 0).toFixed(2)}`;
const EMPTY_Q = { id: '', type: 'noul', instructions: '', criteriaText: '', threshold: '' };
const EMPTY = { id: '', title: '', decides: '', sendsText: '', use: 'both', gate: false, questions: [{ ...EMPTY_Q }], act: '', ask: '', sampleText: '', provider: '' };

/** The small headings inside the card, with main's space above them. */
const sub4 = (words) => html`<${Space} above="large"><${SubHeading} level=${4}>${words}<//><//>`;
const sub5 = (words) => html`<${Space} above="large"><${SubHeading} level=${5}>${words}<//><//>`;

/** Options or levels as the editor shows them: one per line, `option: meaning` for a choice. */
function criteriaToText(q) {
  if (q.type === 'choice' && q.criteria && typeof q.criteria === 'object') {
    return Object.entries(q.criteria).map(([k, v]) => (v ? `${k}: ${v}` : k)).join('\n');
  }
  if (q.type === 'score' && Array.isArray(q.criteria)) return q.criteria.join('\n');
  return '';
}

function textToCriteria(type, text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (type === 'score') return lines;
  if (type === 'choice') {
    return Object.fromEntries(lines.map(l => {
      const i = l.indexOf(':');
      return i < 0 ? [l, null] : [l.slice(0, i).trim(), l.slice(i + 1).trim() || null];
    }));
  }
  return undefined;
}

/** The stored rule as an editor draft. */
export function fromRule(rule) {
  return {
    id: rule.id, title: rule.title, decides: rule.decides, sendsText: (rule.sends || []).join(', '),
    use: rule.use, gate: !!rule.gate,
    questions: Object.entries(rule.questions || {}).map(([id, q]) => ({
      id, type: q.type, instructions: typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions),
      criteriaText: criteriaToText(q),
      threshold: rule.thresholds && rule.thresholds[id] !== undefined ? String(rule.thresholds[id]) : '',
    })),
    act: String(rule.bands?.act ?? ''), ask: String(rule.bands?.ask ?? ''),
    sampleText: rule.sample === null || rule.sample === undefined ? '' : JSON.stringify(rule.sample, null, 2),
    provider: rule.provider || '',
  };
}

/** The editor draft as the body of PUT /v1/ai/decide/rules/:id. Throws on a sample that is not JSON. */
export function toRule(d) {
  const questions = {};
  const thresholds = {};
  for (const q of d.questions) {
    const id = q.id.trim();
    if (!id) continue;
    const criteria = textToCriteria(q.type, q.criteriaText);
    questions[id] = { type: q.type, instructions: q.instructions.trim(), ...(criteria !== undefined ? { criteria } : {}) };
    if (String(q.threshold).trim() !== '') thresholds[id] = Number(q.threshold);
  }
  const sample = d.sampleText.trim() ? JSON.parse(d.sampleText) : null;
  return {
    title: d.title.trim(), decides: d.decides.trim(),
    sends: d.sendsText.split(',').map(s => s.trim()).filter(Boolean),
    questions, thresholds, bands: { act: Number(d.act), ask: Number(d.ask) },
    use: d.use, gate: !!d.gate, sample,
    // Empty is "whoever the caller would get": the agent's, the owner's default, the server's.
    ...(d.provider ? { provider: d.provider } : {}),
  };
}

/** One PROVIDER_CANNOT_CARRY violation in the page's language, with the provider's own name. */
export function cannotCarryText(v) {
  return t(`decideRules.cannotCarry.${v.what}`, {
    provider: v.providerTitle || v.provider || '', limit: num(v.limit ?? 0), count: num(v.count ?? 0), question: v.question || '',
  });
}

/** A message where it was caused: `at` names the place, and only that place draws it. A refusal
 *  keeps its own line breaks (the node names every problem, one per line). */
function Said({ msg, at }) {
  if (!msg || msg.at !== at) return null;
  return html`<${Note} kind="message" error=${!!msg.error} pre=${!!msg.error} role="status">${msg.key ? t(msg.key, msg.params) : msg.text}<//>`;
}

/** One question of a rule in the editor: its id, its type and its threshold in a row, its
 *  instructions, the options or levels of a choice or a score, and the way to remove it. */
function QuestionBox({ q, i, busy, count, setQ, onRemove }) {
  return html`
    <${Box} tone="row" packed>
      <${Stack} gap="small">
        <${Fields} cols=${3}>
          <${TextField} code ariaLabel=${t('decideRules.q.id')} placeholder=${t('decideRules.q.id')}
            value=${q.id} disabled=${busy} onInput=${(v) => setQ(i, 'id', v)} />
          <${Select} ariaLabel=${t('decideRules.q.type')} value=${q.type} disabled=${busy}
            options=${[['noul', t('decideRules.type.noul')], ['choice', t('decideRules.type.choice')], ['score', t('decideRules.type.score')]]}
            onChange=${(v) => setQ(i, 'type', v)} />
          <${TextField} type="number" step="any" min="0" ariaLabel=${t('decideRules.q.threshold')}
            placeholder=${t(`decideRules.q.thresholdHint.${q.type}`)}
            value=${q.threshold} disabled=${busy} onInput=${(v) => setQ(i, 'threshold', v)} />
        <//>
        <${TextArea} rows=${2} ariaLabel=${t('decideRules.q.instructions')} placeholder=${t('decideRules.q.instructions')}
          value=${q.instructions} disabled=${busy} onInput=${(v) => setQ(i, 'instructions', v)} />
        ${q.type !== 'noul' && html`
          <${TextArea} rows=${3} ariaLabel=${t(`decideRules.q.criteria.${q.type}`)} placeholder=${t(`decideRules.q.criteria.${q.type}`)}
            value=${q.criteriaText} disabled=${busy} onInput=${(v) => setQ(i, 'criteriaText', v)} />`}
        ${count > 1 && html`<${Actions}><${Action} small soft disabled=${busy} onClick=${onRemove}>${t('decideRules.q.remove')}<//><//>`}
      <//>
    <//>`;
}

function RuleEditor({ draft, isNew, busy, providers, msg, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  const setQ = (i, k, v) => onChange({ ...draft, questions: draft.questions.map((q, n) => (n === i ? { ...q, [k]: v } : q)) });
  const removeQ = (i) => onChange({ ...draft, questions: draft.questions.filter((_, n) => n !== i) });
  return html`
    <${Box} tone="field">
      <${Stack} gap="medium">
        <${TextField} code label=${t('decideRules.f.id')} value=${draft.id} disabled=${!isNew || busy} placeholder="send-reply"
          onInput=${(v) => set('id', v)} />
        <${TextField} label=${t('decideRules.f.title')} value=${draft.title} disabled=${busy} onInput=${(v) => set('title', v)} />
        <${TextField} label=${t('decideRules.f.decides')} value=${draft.decides} disabled=${busy} placeholder=${t('decideRules.f.decidesHint')}
          onInput=${(v) => set('decides', v)} />
        <${TextField} code label=${t('decideRules.f.sends')} value=${draft.sendsText} disabled=${busy} placeholder="draft, question"
          onInput=${(v) => set('sendsText', v)} />

        ${sub5(t('decideRules.questions'))}
        <${Hint}>${t('decideRules.questionsHelp')}<//>
        ${draft.questions.map((q, i) => html`<${QuestionBox} key=${i} q=${q} i=${i} busy=${busy} count=${draft.questions.length} setQ=${setQ} onRemove=${() => removeQ(i)} />`)}
        <${Actions}>
          <${Action} small soft disabled=${busy} onClick=${() => onChange({ ...draft, questions: [...draft.questions, { ...EMPTY_Q }] })}>${t('decideRules.q.add')}<//>
        <//>

        ${sub5(t('decideRules.bands'))}
        <${Hint}>${t('decideRules.bandsHelp')}<//>
        <${Fields} cols=${2}>
          <${TextField} type="number" step="any" min="0" max="1" label=${t('decideRules.f.act')} value=${draft.act} disabled=${busy}
            onInput=${(v) => set('act', v)} />
          <${TextField} type="number" step="any" min="0" max="1" label=${t('decideRules.f.ask')} value=${draft.ask} disabled=${busy}
            onInput=${(v) => set('ask', v)} />
        <//>

        <${Select} label=${t('decideRules.f.use')} value=${draft.use} disabled=${busy} onChange=${(v) => set('use', v)}
          options=${[['both', t('decideRules.use.both')], ['agent', t('decideRules.use.agent')], ['app', t('decideRules.use.app')]]} />
        ${providers && (providers.providers || []).length > 0 && html`
          <${Select} label=${t('decideRules.f.provider')} value=${draft.provider} disabled=${busy} onChange=${(v) => set('provider', v)}
            options=${[['', t('decideRules.provider.any')], ...providers.providers.map(p => [p.id, p.title])]} />
          <${Hint}>${t('decideRules.providerHelp')}<//>`}
        <${Check} checked=${draft.gate} disabled=${busy} onChange=${() => set('gate', !draft.gate)}>${t('decideRules.f.gate')}<//>
        <${TextArea} code rows=${4} label=${t('decideRules.f.sample')} value=${draft.sampleText} disabled=${busy}
          placeholder='{ "draft": "…", "question": "…" }'
          onInput=${(v) => set('sampleText', v)} />

        <${Said} msg=${msg} at="editor" />
        <${Actions}>
          <${Action} small onClick=${onSave} disabled=${busy}>${t('decideRules.save')}<//>
          <${Action} small soft onClick=${onCancel} disabled=${busy}>${t('decideRules.cancel')}<//>
        <//>
      <//>
    <//>`;
}

/**
 * What trying a rule gave. A null result is not 0 %: it means the model returned no certainty at
 * all, so the bands had nothing to cut and the rule sent it to a person. Printing it as zero would
 * read as "the model was sure it is wrong".
 */
function triedWords(tried) {
  const result = typeof tried.result === 'number'
    ? t('decideRules.triedResult', { result: String(Math.round(tried.result * 100)) })
    : t('decideRules.triedNoResult');
  const answers = Object.entries(tried.answers || {}).map(([id, a]) =>
    `${id}: ${a.type === 'noul' ? `${Math.round(Number(a.value) * 100)} %` : String(a.value)}`).join(' · ');
  return `${t(`decideRules.outcome.${tried.outcome}`)} · ${result} · ${answers}`;
}

export function DecideRules({ available, providers }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [tried, setTried] = useState(null);

  const load = useCallback(async () => {
    const r = await apiGet('/v1/ai/decide/rules');
    setData(prev => (JSON.stringify(prev) === JSON.stringify(r?.data ?? null) ? prev : (r?.data ?? null)));
  }, []);

  useEffect(() => { load().catch(err => setMsg({ text: err?.message || t('decideRules.loadFailed'), error: true })); }, [load]);
  useEffect(() => {
    // An open editor is not reloaded under the person typing in it; the list behind it is.
    const handler = () => { load().catch(err => swallowed('decide-rules: live reload', err)); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // `at` is where the press happened and where its message is drawn: a refusal drawn at the top of
  // the part, a screen above the Save that caused it, read as nothing happening. `okAt` is where a
  // success lands when the place pressed is gone afterwards (a closed editor, a deleted row).
  /** @param {() => Promise<unknown>} fn @param {string} [okKey] @param {{ params?: object, at?: string, okAt?: string }} [where] */
  const act = async (fn, okKey, { params, at = 'top', okAt = at } = {}) => {
    setBusy(true);
    setMsg(null);
    let done = false;
    try {
      await fn();
      if (okKey) setMsg({ key: okKey, params, error: false, at: okAt });
      await load();
      done = true;
    } catch (err) {
      // The node names every problem of a refused rule; show all of them, one per line. What a
      // provider cannot carry is written here in the page's language, from the fields the node sends.
      const details = err?.response?.error?.details;
      const problems = details?.problems;
      const cannot = Array.isArray(details?.violations) && details.violations.every(v => v.what)
        ? details.violations.map(cannotCarryText) : null;
      setMsg({ text: cannot ? cannot.join('\n') : Array.isArray(problems) ? problems.map(p => p.message).join('\n') : (err?.message || t('decideRules.saveFailed')), error: true, at });
    } finally {
      setBusy(false);
    }
    return done;
  };

  const save = async () => {
    let body;
    try { body = toRule(draft); } catch (err) {
      swallowed('decide-rules: the sample is not JSON', err);
      setMsg({ key: 'decideRules.sampleNotJson', error: true, at: 'editor' });
      return;
    }
    const id = draft.id.trim();
    if (!id) { setMsg({ key: 'decideRules.idMissing', error: true, at: 'editor' }); return; }
    if (await act(() => apiPut(`/v1/ai/decide/rules/${encodeURIComponent(id)}`, body), 'decideRules.saved', { at: 'editor', okAt: `rule:${id}` })) setDraft(null);
  };
  const openEditor = (d, fresh) => { setMsg(null); setIsNew(fresh); setTried(null); setDraft(d); };
  const closeEditor = () => { setDraft(null); setMsg(m => (m && m.at === 'editor' ? null : m)); };

  const tryRule = (id) => act(async () => {
    setTried(null);
    const r = await apiPost(`/v1/ai/decide/rules/${encodeURIComponent(id)}/try`, {});
    setTried({ id, ...(r?.data ?? {}) });
  }, undefined, { at: `rule:${id}` });

  if (!data) return msg?.error ? html`<${Note} kind="message" error>${msg.text}<//>` : html`<${Note} kind="loading">${t('decideRules.loading')}<//>`;
  const quality = data.quality || {};
  const approve = (p) => act(() => apiPost(`/v1/ai/decide/rule-proposals/${p.id}/approve`, {}), 'decideRules.approved', { at: `prop:${p.id}`, okAt: `rule:${p.rule.id}` });
  const decline = (p) => act(() => apiPost(`/v1/ai/decide/rule-proposals/${p.id}/decline`, {}), 'decideRules.declined', { at: `prop:${p.id}`, okAt: 'top' });
  const remove = (r) => act(() => apiDelete(`/v1/ai/decide/rules/${encodeURIComponent(r.id)}`), 'decideRules.deleted', { at: `rule:${r.id}`, okAt: 'list' });

  return html`
    <${Touch} id="decide-rules">
      ${sub4(t('decideRules.title'))}
      <${Hint}>${t('decideRules.desc')}<//>
      <${Space} above="small">
        <${IndexList} steps>
          ${[1, 2, 3, 4, 5, 6].map(n => html`<${IndexStep} key=${n}>${t(`decideRules.order.${n}`)}<//>`)}
        <//>
      <//>
      <${Said} msg=${msg} at="top" />

      ${(data.proposals || []).length > 0 && html`
        ${sub5(t('decideRules.proposals'))}
        <${BoxList}>
          ${data.proposals.map(p => html`
            <${BoxLine} key=${p.id} column name=${p.rule.title}
              meta=${[`${t('decideRules.proposedBy', { who: String(p.proposed_by).split('#')[0] })} · ${p.reason}`, t('decideRules.decidesLine', { what: p.rule.decides })]}
              doors=${html`
                <${Action} small disabled=${busy} onClick=${() => approve(p)}>${t('decideRules.approve')}<//>
                <${Action} small soft disabled=${busy} onClick=${() => openEditor(fromRule(p.rule), true)}>${t('decideRules.readFirst')}<//>
                <${Action} small soft disabled=${busy} onClick=${() => decline(p)}>${t('decideRules.decline')}<//>`}
              after=${html`<${Said} msg=${msg} at=${`prop:${p.id}`} />`} />`)}
        <//>`}

      ${data.rules.length === 0 && !draft && html`<${Note} kind="quiet">${t('decideRules.none')}<//>`}
      <${BoxList}>
        ${data.rules.map(r => {
          const q = quality[r.id] || { decisions: 0, gateStops: 0, overridden: 0, costUsd: 0 };
          const tryTitle = !available ? t('decideRules.tryNeedsKey') : r.sample === null ? t('decideRules.tryNeedsSample') : '';
          return html`
            <${BoxLine} key=${r.id} column name=${r.title}
              meta=${[
                t('decideRules.decidesLine', { what: r.decides }),
                `${t(`decideRules.use.${r.use}`)} · ${r.gate ? t('decideRules.isGate') : t('decideRules.notGate')} · v${r.version}${r.provider ? ` · ${t('decideRules.runsOn', { provider: providerTitle(providers, r.provider) })}` : ''}`,
                t('decideRules.quality', {
                  decisions: String(q.decisions), stops: String(q.gateStops), overridden: String(q.overridden),
                  cost: money(q.costUsd), changed: shortDay(r.updatedAt),
                }),
              ]}
              doors=${html`
                <${Action} small soft disabled=${busy} onClick=${() => openEditor(fromRule(r), false)}>${t('decideRules.edit')}<//>
                <${Action} small soft disabled=${busy || !available || r.sample === null} title=${tryTitle} onClick=${() => tryRule(r.id)}>${t('decideRules.try')}<//>
                <${Action} small soft disabled=${busy} onClick=${() => remove(r)}>${t('decideRules.delete')}<//>`}
              after=${html`
                <${Said} msg=${msg} at=${`rule:${r.id}`} />
                ${tried && tried.id === r.id && html`<${Note} kind="message" role="status">${triedWords(tried)}<//>`}`} />`;
        })}
      <//>
      <${Said} msg=${msg} at="list" />

      ${!draft && html`
        <${Actions}>
          <${Action} small disabled=${busy} onClick=${() => openEditor({ ...EMPTY, questions: [{ ...EMPTY_Q }] }, true)}>${t('decideRules.new')}<//>
        <//>`}
      ${draft && html`<${RuleEditor} draft=${draft} isNew=${isNew} busy=${busy} providers=${providers} msg=${msg} onChange=${setDraft} onSave=${save} onCancel=${closeEditor} />`}
    <//>`;
}

export default DecideRules;
