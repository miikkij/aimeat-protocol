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
 * @structure DecideRules({ available }) · toRule / fromRule (the editor's draft ↔ the record)
 * @usage import { DecideRules } from './decide-rules.js'; html`<${DecideRules} available=${true} />`
 * @version-history
 *   2026-09-22 -- Composed from the shared set: rules and proposals are shared rows, the order is
 *     shared numbered steps, the editor is shared fields in a record; no page classes remain.
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Stack, Columns, ListRow, Steps, Surface, Field, Text, Action } from '/components/poster-parts.js';
import { StatusLine } from './ai/frame.js';

const shortDay = (iso) => String(iso ?? '').slice(0, 10);
const money = (usd) => `$${Number(usd || 0) < 1 ? Number(usd || 0).toFixed(4) : Number(usd || 0).toFixed(2)}`;
const EMPTY_Q = { id: '', type: 'noul', instructions: '', criteriaText: '', threshold: '' };
const EMPTY = { id: '', title: '', decides: '', sendsText: '', use: 'both', gate: false, questions: [{ ...EMPTY_Q }], act: '', ask: '', sampleText: '' };

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
  };
}

function RuleEditor({ draft, isNew, busy, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  const setQ = (i, k, v) => onChange({ ...draft, questions: draft.questions.map((q, n) => (n === i ? { ...q, [k]: v } : q)) });
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Columns} collapse="640">
        <${Field} label=${t('decideRules.f.id')} value=${draft.id} disabled=${!isNew || busy} placeholder="send-reply" spellCheck=${false}
          onInput=${e => set('id', e.currentTarget.value)} />
        <${Field} label=${t('decideRules.f.title')} value=${draft.title} disabled=${busy} onInput=${e => set('title', e.currentTarget.value)} />
      <//>
      <${Field} label=${t('decideRules.f.decides')} value=${draft.decides} disabled=${busy} placeholder=${t('decideRules.f.decidesHint')}
        onInput=${e => set('decides', e.currentTarget.value)} />
      <${Field} label=${t('decideRules.f.sends')} value=${draft.sendsText} disabled=${busy} placeholder="draft, question" spellCheck=${false}
        onInput=${e => set('sendsText', e.currentTarget.value)} />

      <${Text} kind="heading" size="small">${t('decideRules.questions')}<//>
      <${Text} tone="muted">${t('decideRules.questionsHelp')}<//>
      ${draft.questions.map((q, i) => html`
        <${Surface} kind="box" density="compact" key=${i}><${Stack} density="compact">
          <${Columns} layout="thirds" collapse="640">
            <${Field} ariaLabel=${t('decideRules.q.id')} placeholder=${t('decideRules.q.id')} spellCheck=${false}
              value=${q.id} disabled=${busy} onInput=${e => setQ(i, 'id', e.currentTarget.value)} />
            <${Field} type="select" ariaLabel=${t('decideRules.q.type')} value=${q.type} disabled=${busy}
              onChange=${e => setQ(i, 'type', e.currentTarget.value)}
              options=${[{ value: 'noul', label: t('decideRules.type.noul') }, { value: 'choice', label: t('decideRules.type.choice') }, { value: 'score', label: t('decideRules.type.score') }]} />
            <${Field} type="number" step="any" min="0" ariaLabel=${t('decideRules.q.threshold')}
              placeholder=${t(`decideRules.q.thresholdHint.${q.type}`)}
              value=${q.threshold} disabled=${busy} onInput=${e => setQ(i, 'threshold', e.currentTarget.value)} />
          <//>
          <${Field} type="textarea" rows=${2} ariaLabel=${t('decideRules.q.instructions')} placeholder=${t('decideRules.q.instructions')}
            value=${q.instructions} disabled=${busy} onInput=${e => setQ(i, 'instructions', e.currentTarget.value)} />
          ${q.type !== 'noul' && html`
            <${Field} type="textarea" rows=${3} ariaLabel=${t(`decideRules.q.criteria.${q.type}`)} placeholder=${t(`decideRules.q.criteria.${q.type}`)}
              value=${q.criteriaText} disabled=${busy} onInput=${e => setQ(i, 'criteriaText', e.currentTarget.value)} />`}
          ${draft.questions.length > 1 && html`
            <div><${Action} tone="danger" disabled=${busy}
              onClick=${() => onChange({ ...draft, questions: draft.questions.filter((_, n) => n !== i) })}>${t('decideRules.q.remove')}<//></div>`}
        <//><//>`)}
      <div><${Action} disabled=${busy}
        onClick=${() => onChange({ ...draft, questions: [...draft.questions, { ...EMPTY_Q }] })}>${t('decideRules.q.add')}<//></div>

      <${Text} kind="heading" size="small">${t('decideRules.bands')}<//>
      <${Text} tone="muted">${t('decideRules.bandsHelp')}<//>
      <${Columns} collapse="560">
        <${Field} label=${t('decideRules.f.act')} type="number" step="any" min="0" max="1" value=${draft.act} disabled=${busy}
          onInput=${e => set('act', e.currentTarget.value)} />
        <${Field} label=${t('decideRules.f.ask')} type="number" step="any" min="0" max="1" value=${draft.ask} disabled=${busy}
          onInput=${e => set('ask', e.currentTarget.value)} />
      <//>

      <${Field} type="select" label=${t('decideRules.f.use')} value=${draft.use} disabled=${busy} onChange=${e => set('use', e.currentTarget.value)}
        options=${[{ value: 'both', label: t('decideRules.use.both') }, { value: 'agent', label: t('decideRules.use.agent') }, { value: 'app', label: t('decideRules.use.app') }]} />
      <${Action} kind="choice" semantics="switch" title=${t('decideRules.f.gate')} selected=${!!draft.gate} disabled=${busy}
        onClick=${() => set('gate', !draft.gate)} />
      <${Field} type="textarea" rows=${4} label=${t('decideRules.f.sample')} value=${draft.sampleText} disabled=${busy} spellCheck=${false}
        placeholder='{ "draft": "…", "question": "…" }'
        onInput=${e => set('sampleText', e.currentTarget.value)} />

      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${onSave} disabled=${busy}>${t('decideRules.save')}<//>
        <${Action} onClick=${onCancel} disabled=${busy}>${t('decideRules.cancel')}<//>
      <//>
    <//><//>`;
}

export function DecideRules({ available }) {
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

  const act = async (fn, okKey, params) => {
    setBusy(true);
    setMsg(null);
    let done = false;
    try {
      await fn();
      if (okKey) setMsg({ key: okKey, params, error: false });
      await load();
      done = true;
    } catch (err) {
      // The node names every problem of a refused rule; show all of them, one per line.
      const problems = err?.response?.error?.details?.problems;
      setMsg({ text: Array.isArray(problems) ? problems.map(p => p.message).join('\n') : (err?.message || t('decideRules.saveFailed')), error: true });
    } finally {
      setBusy(false);
    }
    return done;
  };

  const save = async () => {
    let body;
    try { body = toRule(draft); } catch (err) {
      swallowed('decide-rules: the sample is not JSON', err);
      setMsg({ key: 'decideRules.sampleNotJson', error: true });
      return;
    }
    const id = draft.id.trim();
    if (!id) { setMsg({ key: 'decideRules.idMissing', error: true }); return; }
    if (await act(() => apiPut(`/v1/ai/decide/rules/${encodeURIComponent(id)}`, body), 'decideRules.saved')) setDraft(null);
  };

  const tryRule = (id) => act(async () => {
    setTried(null);
    const r = await apiPost(`/v1/ai/decide/rules/${encodeURIComponent(id)}/try`, {});
    setTried({ id, ...(r?.data ?? {}) });
  });

  if (!data) return html`<${Text} tone="muted">${msg?.error ? msg.text : t('decideRules.loading')}<//>`;
  const quality = data.quality || {};

  return html`
    <${Stack} id="decide-rules">
      <${Text} kind="heading" size="small">${t('decideRules.title')}<//>
      <${Text} tone="muted">${t('decideRules.desc')}<//>
      <${Steps} items=${[1, 2, 3, 4, 5, 6].map(n => t(`decideRules.order.${n}`))} />
      ${msg && html`<${StatusLine} error=${msg.error}>${msg.key ? t(msg.key, msg.params) : msg.text}<//>`}

      ${(data.proposals || []).length > 0 && html`
        <${Text} kind="label">${t('decideRules.proposals')}<//>
        <div>
          ${data.proposals.map(p => html`
            <${ListRow} key=${p.id} density="compact" name=${p.rule.title} detailKind="text"
              detail=${`${t('decideRules.proposedBy', { who: String(p.proposed_by).split('#')[0] })} · ${p.reason}`}
              actions=${html`
                <${Action} tone="success" disabled=${busy}
                  onClick=${() => act(() => apiPost(`/v1/ai/decide/rule-proposals/${p.id}/approve`, {}), 'decideRules.approved')}>${t('decideRules.approve')}<//>
                <${Action} disabled=${busy} onClick=${() => { setIsNew(true); setDraft(fromRule(p.rule)); }}>${t('decideRules.readFirst')}<//>
                <${Action} tone="danger" disabled=${busy}
                  onClick=${() => act(() => apiPost(`/v1/ai/decide/rule-proposals/${p.id}/decline`, {}), 'decideRules.declined')}>${t('decideRules.decline')}<//>`}>
              <${Text} kind="caption" tone="muted">${t('decideRules.decidesLine', { what: p.rule.decides })}<//>
            <//>`)}
        </div>`}

      ${data.rules.length === 0 && !draft && html`<${Text} tone="muted">${t('decideRules.none')}<//>`}
      ${data.rules.length > 0 && html`<div>
        ${data.rules.map(r => {
          const q = quality[r.id] || { decisions: 0, gateStops: 0, overridden: 0, costUsd: 0 };
          return html`
            <${ListRow} key=${r.id} density="compact" name=${r.title} detailKind="text" detail=${t('decideRules.decidesLine', { what: r.decides })}
              actions=${html`
                <${Action} disabled=${busy} onClick=${() => { setIsNew(false); setTried(null); setDraft(fromRule(r)); }}>${t('decideRules.edit')}<//>
                <${Action} disabled=${busy || !available || r.sample === null}
                  title=${!available ? t('decideRules.tryNeedsKey') : r.sample === null ? t('decideRules.tryNeedsSample') : ''}
                  onClick=${() => tryRule(r.id)}>${t('decideRules.try')}<//>
                <${Action} tone="danger" disabled=${busy}
                  onClick=${() => act(() => apiDelete(`/v1/ai/decide/rules/${encodeURIComponent(r.id)}`), 'decideRules.deleted')}>${t('decideRules.delete')}<//>`}>
              <${Stack} density="compact">
                <${Text} kind="mono" tone="muted">${t(`decideRules.use.${r.use}`)} · ${r.gate ? t('decideRules.isGate') : t('decideRules.notGate')} · v${r.version}<//>
                <${Text} kind="caption" tone="muted">
                  ${t('decideRules.quality', {
                    decisions: String(q.decisions), stops: String(q.gateStops), overridden: String(q.overridden),
                    cost: money(q.costUsd), changed: shortDay(r.updatedAt),
                  })}
                <//>
                ${tried && tried.id === r.id && html`
                  <${StatusLine}>
                    ${/* A null result is not 0 %: it means the model returned no certainty at all, so
                         the bands had nothing to cut and the rule sent it to a person. Printing it as
                         zero would read as "the model was sure it is wrong". */''}
                    ${t(`decideRules.outcome.${tried.outcome}`)} · ${typeof tried.result === 'number'
                      ? t('decideRules.triedResult', { result: String(Math.round(tried.result * 100)) })
                      : t('decideRules.triedNoResult')}
                    ${' · '}${Object.entries(tried.answers || {}).map(([id, a]) =>
                      `${id}: ${a.type === 'noul' ? `${Math.round(Number(a.value) * 100)} %` : String(a.value)}`).join(' · ')}
                  <//>`}
              <//>
            <//>`;
        })}
      </div>`}

      ${!draft && html`
        <div><${Action} disabled=${busy} onClick=${() => { setIsNew(true); setDraft({ ...EMPTY, questions: [{ ...EMPTY_Q }] }); }}>${t('decideRules.new')}<//></div>`}
      ${draft && html`<${RuleEditor} draft=${draft} isNew=${isNew} busy=${busy} onChange=${setDraft} onSave=${save} onCancel=${() => setDraft(null)} />`}
    <//>`;
}

export default DecideRules;
