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
 *   v1.1.0 — 2026-09-23 — A rule may name the decision provider it always runs on: a field in the
 *     editor, and the provider in the rule's line.
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { providerTitle } from './decide-providers.js';

const shortDay = (iso) => String(iso ?? '').slice(0, 10);
const money = (usd) => `$${Number(usd || 0) < 1 ? Number(usd || 0).toFixed(4) : Number(usd || 0).toFixed(2)}`;
const EMPTY_Q = { id: '', type: 'noul', instructions: '', criteriaText: '', threshold: '' };
const EMPTY = { id: '', title: '', decides: '', sendsText: '', use: 'both', gate: false, questions: [{ ...EMPTY_Q }], act: '', ask: '', sampleText: '', provider: '' };

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

function RuleEditor({ draft, isNew, busy, providers, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  const setQ = (i, k, v) => onChange({ ...draft, questions: draft.questions.map((q, n) => (n === i ? { ...q, [k]: v } : q)) });
  return html`
    <div class="pf-dr-editor">
      <label class="pf-dr-field"><span>${t('decideRules.f.id')}</span>
        <input class="og-input og-input--mono" value=${draft.id} disabled=${!isNew || busy} placeholder="send-reply"
               onInput=${e => set('id', e.currentTarget.value)} /></label>
      <label class="pf-dr-field"><span>${t('decideRules.f.title')}</span>
        <input class="og-input" value=${draft.title} disabled=${busy} onInput=${e => set('title', e.currentTarget.value)} /></label>
      <label class="pf-dr-field"><span>${t('decideRules.f.decides')}</span>
        <input class="og-input" value=${draft.decides} disabled=${busy} placeholder=${t('decideRules.f.decidesHint')}
               onInput=${e => set('decides', e.currentTarget.value)} /></label>
      <label class="pf-dr-field"><span>${t('decideRules.f.sends')}</span>
        <input class="og-input og-input--mono" value=${draft.sendsText} disabled=${busy} placeholder="draft, question"
               onInput=${e => set('sendsText', e.currentTarget.value)} /></label>

      <h5 class="pf-dr-h">${t('decideRules.questions')}</h5>
      <p class="pf-aitr-note">${t('decideRules.questionsHelp')}</p>
      ${draft.questions.map((q, i) => html`
        <div class="pf-dr-q" key=${i}>
          <div class="pf-dr-q-top">
            <input class="og-input og-input--mono" aria-label=${t('decideRules.q.id')} placeholder=${t('decideRules.q.id')}
                   value=${q.id} disabled=${busy} onInput=${e => setQ(i, 'id', e.currentTarget.value)} />
            <select class="og-input" aria-label=${t('decideRules.q.type')} value=${q.type} disabled=${busy}
                    onChange=${e => setQ(i, 'type', e.currentTarget.value)}>
              <option value="noul">${t('decideRules.type.noul')}</option>
              <option value="choice">${t('decideRules.type.choice')}</option>
              <option value="score">${t('decideRules.type.score')}</option>
            </select>
            <input class="og-input" type="number" step="any" min="0" aria-label=${t('decideRules.q.threshold')}
                   placeholder=${t(`decideRules.q.thresholdHint.${q.type}`)}
                   value=${q.threshold} disabled=${busy} onInput=${e => setQ(i, 'threshold', e.currentTarget.value)} />
          </div>
          <textarea class="og-textarea" rows="2" aria-label=${t('decideRules.q.instructions')} placeholder=${t('decideRules.q.instructions')}
                    value=${q.instructions} disabled=${busy} onInput=${e => setQ(i, 'instructions', e.currentTarget.value)}></textarea>
          ${q.type !== 'noul' && html`
            <textarea class="og-textarea" rows="3" aria-label=${t(`decideRules.q.criteria.${q.type}`)} placeholder=${t(`decideRules.q.criteria.${q.type}`)}
                      value=${q.criteriaText} disabled=${busy} onInput=${e => setQ(i, 'criteriaText', e.currentTarget.value)}></textarea>`}
          ${draft.questions.length > 1 && html`
            <button type="button" class="og-door og-door--quiet" disabled=${busy}
                    onClick=${() => onChange({ ...draft, questions: draft.questions.filter((_, n) => n !== i) })}>
              ${t('decideRules.q.remove')}</button>`}
        </div>`)}
      <button type="button" class="og-door og-door--quiet" disabled=${busy}
              onClick=${() => onChange({ ...draft, questions: [...draft.questions, { ...EMPTY_Q }] })}>
        ${t('decideRules.q.add')}</button>

      <h5 class="pf-dr-h">${t('decideRules.bands')}</h5>
      <p class="pf-aitr-note">${t('decideRules.bandsHelp')}</p>
      <div class="pf-dr-pair">
        <label class="pf-dr-field"><span>${t('decideRules.f.act')}</span>
          <input class="og-input" type="number" step="any" min="0" max="1" value=${draft.act} disabled=${busy}
                 onInput=${e => set('act', e.currentTarget.value)} /></label>
        <label class="pf-dr-field"><span>${t('decideRules.f.ask')}</span>
          <input class="og-input" type="number" step="any" min="0" max="1" value=${draft.ask} disabled=${busy}
                 onInput=${e => set('ask', e.currentTarget.value)} /></label>
      </div>

      <label class="pf-dr-field"><span>${t('decideRules.f.use')}</span>
        <select class="og-input" value=${draft.use} disabled=${busy} onChange=${e => set('use', e.currentTarget.value)}>
          <option value="both">${t('decideRules.use.both')}</option>
          <option value="agent">${t('decideRules.use.agent')}</option>
          <option value="app">${t('decideRules.use.app')}</option>
        </select></label>
      ${providers && (providers.providers || []).length > 0 && html`
        <label class="pf-dr-field"><span>${t('decideRules.f.provider')}</span>
          <select class="og-input" value=${draft.provider} disabled=${busy} onChange=${e => set('provider', e.currentTarget.value)}>
            <option value="">${t('decideRules.provider.any')}</option>
            ${providers.providers.map(p => html`<option key=${p.id} value=${p.id}>${p.title}</option>`)}
          </select></label>
        <p class="pf-aitr-note">${t('decideRules.providerHelp')}</p>`}
      <label class="pf-dr-check">
        <input type="checkbox" class="checkbox checkbox-sm" checked=${draft.gate} disabled=${busy}
               onChange=${() => set('gate', !draft.gate)} />
        ${' '}${t('decideRules.f.gate')}
      </label>
      <label class="pf-dr-field"><span>${t('decideRules.f.sample')}</span>
        <textarea class="og-textarea og-input--mono" rows="4" value=${draft.sampleText} disabled=${busy}
                  placeholder='{ "draft": "…", "question": "…" }'
                  onInput=${e => set('sampleText', e.currentTarget.value)}></textarea></label>

      <div class="og-doors">
        <button type="button" class="og-door" onClick=${onSave} disabled=${busy}>${t('decideRules.save')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onCancel} disabled=${busy}>${t('decideRules.cancel')}</button>
      </div>
    </div>`;
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

  if (!data) return html`<p class="pf-aitr-muted">${msg?.error ? msg.text : t('decideRules.loading')}</p>`;
  const quality = data.quality || {};

  return html`
    <div class="pf-dr" id="decide-rules">
      <h4 class="pf-aitr-sub">${t('decideRules.title')}</h4>
      <p class="pf-aitr-note">${t('decideRules.desc')}</p>
      <ol class="pf-dr-order">
        ${[1, 2, 3, 4, 5, 6].map(n => html`<li key=${n}>${t(`decideRules.order.${n}`)}</li>`)}
      </ol>
      ${msg && html`<p class=${msg.error ? 'pf-aitr-error pf-dr-pre' : 'pf-aitr-note'} role="status">${msg.key ? t(msg.key, msg.params) : msg.text}</p>`}

      ${(data.proposals || []).length > 0 && html`
        <h5 class="pf-dr-h">${t('decideRules.proposals')}</h5>
        <ul class="pf-aitr-list">
          ${data.proposals.map(p => html`
            <li key=${p.id} class="pf-aitr-row">
              <span class="pf-aitr-row-main">${p.rule.title}</span>
              <span class="pf-aitr-row-meta">${t('decideRules.proposedBy', { who: String(p.proposed_by).split('#')[0] })} · ${p.reason}</span>
              <span class="pf-aitr-row-meta">${t('decideRules.decidesLine', { what: p.rule.decides })}</span>
              <span class="og-doors">
                <button type="button" class="og-door" disabled=${busy}
                        onClick=${() => act(() => apiPost(`/v1/ai/decide/rule-proposals/${p.id}/approve`, {}), 'decideRules.approved')}>
                  ${t('decideRules.approve')}</button>
                <button type="button" class="og-door og-door--quiet" disabled=${busy}
                        onClick=${() => { setIsNew(true); setDraft(fromRule(p.rule)); }}>
                  ${t('decideRules.readFirst')}</button>
                <button type="button" class="og-door og-door--quiet" disabled=${busy}
                        onClick=${() => act(() => apiPost(`/v1/ai/decide/rule-proposals/${p.id}/decline`, {}), 'decideRules.declined')}>
                  ${t('decideRules.decline')}</button>
              </span>
            </li>`)}
        </ul>`}

      ${data.rules.length === 0 && !draft && html`<p class="pf-aitr-muted">${t('decideRules.none')}</p>`}
      <ul class="pf-aitr-list">
        ${data.rules.map(r => {
          const q = quality[r.id] || { decisions: 0, gateStops: 0, overridden: 0, costUsd: 0 };
          return html`
            <li key=${r.id} class="pf-aitr-row">
              <span class="pf-aitr-row-main">${r.title}</span>
              <span class="pf-aitr-row-meta">${t('decideRules.decidesLine', { what: r.decides })}</span>
              <span class="pf-aitr-row-meta">
                ${t(`decideRules.use.${r.use}`)} · ${r.gate ? t('decideRules.isGate') : t('decideRules.notGate')} · v${r.version}${r.provider ? ` · ${t('decideRules.runsOn', { provider: providerTitle(providers, r.provider) })}` : ''}
              </span>
              <span class="pf-aitr-row-meta">
                ${t('decideRules.quality', {
                  decisions: String(q.decisions), stops: String(q.gateStops), overridden: String(q.overridden),
                  cost: money(q.costUsd), changed: shortDay(r.updatedAt),
                })}
              </span>
              <span class="og-doors">
                <button type="button" class="og-door og-door--quiet" disabled=${busy}
                        onClick=${() => { setIsNew(false); setTried(null); setDraft(fromRule(r)); }}>${t('decideRules.edit')}</button>
                <button type="button" class="og-door og-door--quiet" disabled=${busy || !available || r.sample === null}
                        title=${!available ? t('decideRules.tryNeedsKey') : r.sample === null ? t('decideRules.tryNeedsSample') : ''}
                        onClick=${() => tryRule(r.id)}>${t('decideRules.try')}</button>
                <button type="button" class="og-door og-door--quiet" disabled=${busy}
                        onClick=${() => act(() => apiDelete(`/v1/ai/decide/rules/${encodeURIComponent(r.id)}`), 'decideRules.deleted')}>
                  ${t('decideRules.delete')}</button>
              </span>
              ${tried && tried.id === r.id && html`
                <span class="pf-aitr-row-meta pf-dr-tried" role="status">
                  ${/* A null result is not 0 %: it means the model returned no certainty at all, so
                       the bands had nothing to cut and the rule sent it to a person. Printing it as
                       zero would read as "the model was sure it is wrong". */''}
                  ${t(`decideRules.outcome.${tried.outcome}`)} · ${typeof tried.result === 'number'
                    ? t('decideRules.triedResult', { result: String(Math.round(tried.result * 100)) })
                    : t('decideRules.triedNoResult')}
                  ${' · '}${Object.entries(tried.answers || {}).map(([id, a]) =>
                    `${id}: ${a.type === 'noul' ? `${Math.round(Number(a.value) * 100)} %` : String(a.value)}`).join(' · ')}
                </span>`}
            </li>`;
        })}
      </ul>

      ${!draft && html`
        <div class="og-doors">
          <button type="button" class="og-door" disabled=${busy} onClick=${() => { setIsNew(true); setDraft({ ...EMPTY, questions: [{ ...EMPTY_Q }] }); }}>
            ${t('decideRules.new')}</button>
        </div>`}
      ${draft && html`<${RuleEditor} draft=${draft} isNew=${isNew} busy=${busy} providers=${providers} onChange=${setDraft} onSave=${save} onCancel=${() => setDraft(null)} />`}
    </div>`;
}

export default DecideRules;
