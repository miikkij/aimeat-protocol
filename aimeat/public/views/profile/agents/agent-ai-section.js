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
 *   v1.1.1 — 2026-09-23 — The provider choice is confirmed beside the select, naming what answers now.
 *   v1.1.0 — 2026-09-23 — The decision provider this agent uses: the owner's default, or one the
 *     owner picks for this agent alone.
 *   v1.0.0 — 2026-09-20 — Initial: a key per agent.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

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
  const [providers, setProviders] = useState(null);
  const [provSaved, setProvSaved] = useState(null);

  // The decision providers the owner may use, with the one set for each agent. Read beside the keys;
  // a node without providers answers without the door, and then the block is not shown.
  const loadProviders = useCallback(async () => {
    const r = await apiGet('/v1/ai/decide/providers');
    const p = r?.data ?? null;
    setProviders(prev => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p));
  }, []);

  const load = useCallback(async () => {
    const r = await apiGet(base);
    const d = r?.data ?? null;
    setData(prev => (JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
    loadProviders().catch(err => swallowed('agent-ai-section: providers', err));
    return d;
  }, [base, loadProviders]);

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

  // `null` gives the agent back to the owner's default.
  const setProvider = async (id) => {
    setBusy(true);
    setProvSaved(null);
    try {
      await apiPut('/v1/ai/decide/settings', { agent_providers: { [agentName]: id || null } });
      await loadProviders();
      showToast?.(t('agentAi.saved'));
      // Said beside the select as well: a toast can be missed, and this choice moves where the
      // agent's content goes.
      setProvSaved({ error: false, id: id || null });
    } catch (e) { showToast?.(e.message, true); setProvSaved({ error: true, text: e.message }); }
    finally { setBusy(false); }
  };

  if (!data) return null;
  const q = data.quality || {};
  const provList = providers?.providers || [];
  const ownDefault = provList.find(p => p.id === providers?.default);

  return html`
    <div class="sch-form poster-row--thing pf-aai" id="agent-ai-section">
      <div class="pf-agd-section-title">${t('agentAi.title')}</div>
      <div class="section-desc">${t('agentAi.desc')}</div>

      ${MODELS.map(model => html`
        <div class="pf-aai-model" key=${model}>
          <div class="pf-aai-model-title">${t(`agentAi.model.${model}`)}</div>
          <p class="pf-aitr-note">${data[model].has_key
            ? t('agentAi.keySet', { when: String(data[model].set_at || '').slice(0, 10) })
            : t('agentAi.keyNotSet')}</p>
          <div class="pf-aai-row">
            <input class="og-input" type="password" autocomplete="off" data-1p-ignore data-lpignore="true"
                   aria-label=${t('agentAi.keyLabel')} placeholder=${t('agentAi.keyLabel')}
                   value=${keys[model]} disabled=${!!busy} onInput=${e => setKeys(k => ({ ...k, [model]: e.currentTarget.value }))} />
            <input class="og-input og-input--mono" aria-label=${t('agentAi.envLabel')} placeholder=${t(`agentAi.envHint.${model}`)}
                   value=${envs[model]} disabled=${!!busy} onInput=${e => setEnvs(x => ({ ...x, [model]: e.currentTarget.value }))} />
          </div>
          <p class="pf-aitr-muted">${t('agentAi.envHelp')}</p>
          <div class="og-doors">
            <button type="button" class="og-door" disabled=${!!busy} onClick=${() => saveKey(model)}>${t('agentAi.save')}</button>
            <button type="button" class="og-door og-door--quiet" disabled=${!!busy} onClick=${() => test(model)}>
              ${busy === model ? t('agentAi.testing') : t('agentAi.test')}</button>
            ${(data[model].has_key || data[model].key_env) && html`
              <button type="button" class="og-door og-door--quiet" disabled=${!!busy} onClick=${() => forget(model)}>${t('agentAi.forget')}</button>`}
          </div>
          ${tested[model] && html`
            <p class=${tested[model].ok ? 'pf-aitr-note' : 'pf-aitr-error'} role="status">
              ${tested[model].ok
                ? t(`agentAi.testOk.${tested[model].key_source}`, { model: tested[model].model || '' })
                : (tested[model].message || t('agentAi.testFailed'))}
            </p>`}
        </div>`)}

      ${provList.length > 0 && html`
        <div class="pf-aai-model">
          <div class="pf-aai-model-title">${t('agentAi.providerTitle')}</div>
          <p class="pf-aitr-note">${t('agentAi.providerDesc')}</p>
          <div class="pf-aai-row">
            <select class="og-input" aria-label=${t('agentAi.providerTitle')} disabled=${!!busy}
                    value=${providers.agents?.[agentName] || ''} onChange=${e => setProvider(e.currentTarget.value)}>
              <option value="">${t('agentAi.providerDefault', { provider: ownDefault ? ownDefault.title : String(providers.default || '') })}</option>
              ${provList.map(p => html`<option key=${p.id} value=${p.id}>${p.title}</option>`)}
            </select>
          </div>
          ${provSaved && html`<p class=${provSaved.error ? 'pf-aitr-error' : 'pf-aitr-note'} role="status">
            ${provSaved.error ? provSaved.text : t('agentAi.providerSaved', {
              provider: (provList.find(p => p.id === (provSaved.id || providers.default)) || {}).title || String(provSaved.id || providers.default || ''),
            })}</p>`}
        </div>`}

      <div class="pf-aai-model">
        <div class="pf-aai-model-title">${t('agentAi.capTitle')}</div>
        <p class="pf-aitr-note">${t('agentAi.capDesc', { spent: money(data.spent_today_usd) })}</p>
        <div class="pf-aai-row">
          <input class="og-input" type="number" min="0" step="0.1" aria-label=${t('agentAi.capLabel')} placeholder=${t('agentAi.capNone')}
                 value=${cap} disabled=${!!busy} onInput=${e => setCap(e.currentTarget.value)} />
          <button type="button" class="og-door" disabled=${!!busy}
                  onClick=${() => put({ daily_usd: cap.trim() === '' ? null : Number(cap) }, 'agentAi.saved')}>${t('agentAi.save')}</button>
        </div>
      </div>

      <div class="pf-aai-model">
        <div class="pf-aai-model-title">${t('agentAi.gateTitle')}</div>
        <p class="pf-aitr-note">${t('agentAi.gateDesc')}</p>
        <div class="og-choice" role="radiogroup" aria-label=${t('agentAi.gateTitle')}>
          ${['rule', 'on', 'off'].map(g => html`
            <button type="button" key=${g} role="radio" aria-checked=${data.gate === g}
                    class=${`og-choice-btn ${data.gate === g ? 'on' : ''}`} disabled=${!!busy}
                    onClick=${() => put({ gate: g }, 'agentAi.saved')}>${t(`agentAi.gate.${g}`)}</button>`)}
        </div>
      </div>

      <div class="pf-aai-model">
        <div class="pf-aai-model-title">${t('agentAi.qualityTitle')}</div>
        <div class="pf-aitr-stats">
          <div class="pf-aitr-stat"><span class="pf-aitr-num">${q.decisions ?? 0}</span><span class="pf-aitr-lbl">${t('agentAi.q.decisions')}</span></div>
          <div class="pf-aitr-stat"><span class="pf-aitr-num">${q.gateStops ?? 0}</span><span class="pf-aitr-lbl">${t('agentAi.q.gateStops')}</span></div>
          <div class="pf-aitr-stat"><span class="pf-aitr-num">${q.overridden ?? 0}</span><span class="pf-aitr-lbl">${t('agentAi.q.overridden')}</span></div>
          <div class="pf-aitr-stat"><span class="pf-aitr-num">${money(q.costUsd)}</span><span class="pf-aitr-lbl">${t('agentAi.q.cost')}</span></div>
        </div>
        ${Object.keys(data.quality_by_rule || {}).length > 0 && html`
          <ul class="pf-aitr-list pf-aai-rules">
            ${Object.entries(data.quality_by_rule).map(([rule, r]) => html`
              <li key=${rule} class="pf-aitr-row">
                <span class="pf-aitr-row-main">${rule}</span>
                <span class="pf-aitr-row-meta">${t('agentAi.q.perRule', {
                  decisions: String(r.decisions), stops: String(r.gateStops), overridden: String(r.overridden), cost: money(r.costUsd),
                })}</span>
              </li>`)}
          </ul>`}
      </div>
    </div>`;
}

export default AgentAiSection;
