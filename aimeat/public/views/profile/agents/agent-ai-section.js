/**
 * @file agent-ai-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One agent's AI settings on its own page: a key of its own for the decision model and
 *   for the text model, a test button for each, a daily cap, the gate switch, and this agent's own
 *   decision numbers.
 *
 *   WHY A SCREEN. A key typed into a chat is a key in a transcript, and an agent that could switch its
 *   own gate has no gate. These four controls are the owner's own presses; everything an agent needs
 *   to READ about them is on MCP (aimeat_decide_settings).
 *
 *   NO KEY IS EVER SHOWN. The node answers whether one is set and when. The second field is the NAME
 *   of the environment variable that holds the key on the machine where the agent runs its own calls:
 *   the node never sends a key to an agent.
 *
 *   THE GATE has three positions, because "nobody has said" is a real one: each rule then uses its own
 *   default. It is off until somebody turns it on, so a comparison run can run unguarded.
 * @structure AgentAiSection({ agentName, showToast })
 * @usage import { AgentAiSection } from './agent-ai-section.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared parts (Section, Field, Action, NumeralBand, ListRow, Text);
 *     it no longer borrows the scheduler's, organism's and AI tab's classes. The key and variable
 *     fields carry a visible label now, the words that were their placeholder and aria-label.
 *   v1.0.0 — 2026-09-20 — Initial: a key per agent.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Section, Stack, Columns, Field, Action, NumeralBand, ListRow, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const MODELS = ['decide', 'openrouter'];
const money = (usd) => `$${Number(usd || 0) < 1 ? Number(usd || 0).toFixed(4) : Number(usd || 0).toFixed(2)}`;

export function AgentAiSection({ agentName, showToast }) {
  const base = `/v1/agents/${encodeURIComponent(agentName)}/ai-keys`;
  const [data, setData] = useState(null);
  const [keys, setKeys] = useState({ decide: '', openrouter: '' });
  const [envs, setEnvs] = useState({ decide: '', openrouter: '' });
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState({});

  const load = useCallback(async () => {
    const r = await apiGet(base);
    const d = r?.data ?? null;
    setData(prev => (JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
    return d;
  }, [base]);

  useEffect(() => {
    load().then(d => {
      if (!d) return;
      setEnvs({ decide: d.decide.key_env || '', openrouter: d.openrouter.key_env || '' });
      setCap(d.daily_usd === null ? '' : String(d.daily_usd));
    }).catch(err => swallowed('agent-ai-section: load', err));
  }, [load]);

  useEffect(() => {
    // Only the numbers follow a live event; the fields a person is typing in are left alone.
    const handler = () => { load().catch(err => swallowed('agent-ai-section: live reload', err)); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const put = async (body, okKey) => {
    setBusy(true);
    let saved = false;
    try {
      const r = await apiPut(base, body);
      setData(r?.data ?? data);
      showToast?.(t(okKey));
      saved = true;
    } catch (e) {
      // The refusal is the node's own sentence (which part was wrong), shown to the person as it is.
      showToast?.(e.message, true);
    } finally { setBusy(false); }
    return saved;
  };

  const saveKey = async (model) => {
    const part = {};
    if (keys[model].trim()) part.api_key = keys[model].trim();
    part.key_env = envs[model].trim() || null;
    if (await put({ [model]: part }, 'agentAi.saved')) setKeys(k => ({ ...k, [model]: '' }));
  };

  const forget = async (model) => {
    setBusy(true);
    try {
      const r = await apiDelete(`${base}/${model}`);
      setData(r?.data ?? data);
      setEnvs(e => ({ ...e, [model]: '' }));
      setTested(x => ({ ...x, [model]: null }));
      showToast?.(t('agentAi.forgotten'));
    } catch (e) { showToast?.(e.message, true); }
    finally { setBusy(false); }
  };

  const test = async (model) => {
    setBusy(model);
    setTested(x => ({ ...x, [model]: null }));
    try {
      const d = (await apiPost(`${base}/${model}/test`, {}))?.data ?? {};
      setTested(x => ({ ...x, [model]: d }));
    } catch (e) { setTested(x => ({ ...x, [model]: { ok: false, message: e.message } })); }
    finally { setBusy(false); }
  };

  if (!data) return null;
  const q = data.quality || {};

  return html`
    <${Section} size="small" density="compact" id="agent-ai-section" title=${t('agentAi.title')} description=${t('agentAi.desc')}>
      <${Stack}>
        ${MODELS.map(model => html`
          <${Stack} key=${model} density="compact">
            <${Text} kind="label">${t(`agentAi.model.${model}`)}<//>
            <${Text}>${data[model].has_key
              ? t('agentAi.keySet', { when: String(data[model].set_at || '').slice(0, 10) })
              : t('agentAi.keyNotSet')}<//>
            <${Columns} density="compact" collapse="560">
              <${Field} type="password" autoComplete="off" label=${t('agentAi.keyLabel')} placeholder=${t('agentAi.keyLabel')}
                value=${keys[model]} disabled=${!!busy} onInput=${e => setKeys(k => ({ ...k, [model]: e.currentTarget.value }))} />
              <${Field} label=${t('agentAi.envLabel')} placeholder=${t(`agentAi.envHint.${model}`)}
                value=${envs[model]} disabled=${!!busy} onInput=${e => setEnvs(x => ({ ...x, [model]: e.currentTarget.value }))} />
            <//>
            <${Text} kind="caption" tone="muted">${t('agentAi.envHelp')}<//>
            <${Stack} direction="wrap" density="compact">
              <${Action} disabled=${!!busy} onClick=${() => saveKey(model)}>${t('agentAi.save')}<//>
              <${Action} kind="text" disabled=${!!busy} onClick=${() => test(model)}>
                ${busy === model ? t('agentAi.testing') : t('agentAi.test')}<//>
              ${(data[model].has_key || data[model].key_env) && html`
                <${Action} kind="text" disabled=${!!busy} onClick=${() => forget(model)}>${t('agentAi.forget')}<//>`}
            <//>
            ${tested[model] && html`
              <div role="status">
                <${Text} tone=${tested[model].ok ? 'success' : 'danger'}>
                  ${tested[model].ok
                    ? t(`agentAi.testOk.${tested[model].key_source}`, { model: tested[model].model || '' })
                    : (tested[model].message || t('agentAi.testFailed'))}
                <//>
              </div>`}
          <//>`)}

        <${Stack} density="compact">
          <${Text} kind="label">${t('agentAi.capTitle')}<//>
          <${Text}>${t('agentAi.capDesc', { spent: money(data.spent_today_usd) })}<//>
          <${Stack} direction="wrap" align="end" density="compact">
            <${Field} type="number" min="0" step="0.1" label=${t('agentAi.capLabel')} placeholder=${t('agentAi.capNone')}
              value=${cap} disabled=${!!busy} onInput=${e => setCap(e.currentTarget.value)} />
            <${Action} disabled=${!!busy}
              onClick=${() => put({ daily_usd: cap.trim() === '' ? null : Number(cap) }, 'agentAi.saved')}>${t('agentAi.save')}<//>
          <//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${t('agentAi.gateTitle')}<//>
          <${Text}>${t('agentAi.gateDesc')}<//>
          <${Stack} direction="wrap" density="compact" role="radiogroup" label=${t('agentAi.gateTitle')}>
            ${['rule', 'on', 'off'].map(g => html`
              <${Action} key=${g} kind="tab" semantics="radio" selected=${data.gate === g} disabled=${!!busy}
                onClick=${() => put({ gate: g }, 'agentAi.saved')}>${t(`agentAi.gate.${g}`)}<//>`)}
          <//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${t('agentAi.qualityTitle')}<//>
          <${NumeralBand} size="small" tone="plain" items=${[
            { id: 'decisions', label: t('agentAi.q.decisions'), value: q.decisions ?? 0 },
            { id: 'gateStops', label: t('agentAi.q.gateStops'), value: q.gateStops ?? 0 },
            { id: 'overridden', label: t('agentAi.q.overridden'), value: q.overridden ?? 0 },
            { id: 'cost', label: t('agentAi.q.cost'), value: money(q.costUsd) },
          ]} />
          ${Object.keys(data.quality_by_rule || {}).length > 0 && html`
            <${Stack} density="compact">
              ${Object.entries(data.quality_by_rule).map(([rule, r]) => html`
                <${ListRow} key=${rule} density="compact" detailKind="text" name=${rule}
                  detail=${t('agentAi.q.perRule', {
                    decisions: String(r.decisions), stops: String(r.gateStops), overridden: String(r.overridden), cost: money(r.costUsd),
                  })} />`)}
            <//>`}
        <//>
      <//>
    <//>`;
}

export default AgentAiSection;
