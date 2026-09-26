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
 *   v1.13.0 — 2026-09-26 — Every part is a component that takes data (page group G1a): the section card,
 *     SubHeading and Note, the key a password TextField that keeps password managers out (no eye, as
 *     on main), the variable name the code TextField, the provider the Select, the daily cap a short
 *     number field with Save beside it, the gate the Choice, the quality figures the FigureStrip, the
 *     per-rule lines the List with the typewriter line under each rule, a test's answer the message;
 *     every control keeps main's 44px thumb target (Touch with its tabs, was .pf .pf-aai).
 *   v1.12.0 — 2026-09-26 — A rule's line beside its name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.11.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.10.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.9.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 — 2026-09-25 — The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — A row of figures is the figure strip (og-strip, css/components/figure-strip.css), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
import { Card } from '/components/Card.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { Action, Actions } from '/components/Action.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name } from '/components/List.js';
import { Stack, Touch } from '/components/Layout.js';

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

  // One part of the section: its sub-heading, then its hint, fields and doors in a column.
  const part = (title, body) => html`<${Stack} gap="small" above="large"><${SubHeading}>${title}<//>${body}<//>`;
  const testWords = (x) => (x.ok
    ? t(`agentAi.testOk.${x.key_source}`, { model: x.model || '' })
    : (x.message || t('agentAi.testFailed')));

  // Every control of the section is a thumb's target, 44px at every width, the gate's tabs included:
  // measured at 390 on main the three SAVE buttons were 16 px, the tests 18, the gate 28 (Touch tabs).
  return html`
    <${Card} tone="section" id="agent-ai-section"><${Touch} tabs>
      <${SubHeading} desc=${t('agentAi.desc')}>${t('agentAi.title')}<//>

      ${MODELS.map(model => html`
        <div key=${model}>
          ${part(t(`agentAi.model.${model}`), html`
            <${Note}>${data[model].has_key
              ? t('agentAi.keySet', { when: String(data[model].set_at || '').slice(0, 10) })
              : t('agentAi.keyNotSet')}<//>
            <${Fields} cols=${2}>
              <${TextField} type="password" unmanaged ariaLabel=${t('agentAi.keyLabel')} placeholder=${t('agentAi.keyLabel')}
                value=${keys[model]} disabled=${!!busy} onInput=${v => setKeys(k => ({ ...k, [model]: v }))} />
              <${TextField} code ariaLabel=${t('agentAi.envLabel')} placeholder=${t(`agentAi.envHint.${model}`)}
                value=${envs[model]} disabled=${!!busy} onInput=${v => setEnvs(x => ({ ...x, [model]: v }))} />
            <//>
            <${Note}>${t('agentAi.envHelp')}<//>
            <${Actions}>
              <${Action} small disabled=${!!busy} onClick=${() => saveKey(model)}>${t('agentAi.save')}<//>
              <${Action} small soft disabled=${!!busy} onClick=${() => test(model)}>
                ${busy === model ? t('agentAi.testing') : t('agentAi.test')}<//>
              ${(data[model].has_key || data[model].key_env) && html`
                <${Action} small soft disabled=${!!busy} onClick=${() => forget(model)}>${t('agentAi.forget')}<//>`}
            <//>
            ${tested[model] && html`<${Note} kind="message" error=${!tested[model].ok} role="status">${testWords(tested[model])}<//>`}
          `)}
        </div>`)}

      ${provList.length > 0 && part(t('agentAi.providerTitle'), html`
        <${Note}>${t('agentAi.providerDesc')}<//>
        <${Select} ariaLabel=${t('agentAi.providerTitle')} disabled=${!!busy}
          value=${providers.agents?.[agentName] || ''} onChange=${setProvider}
          placeholder=${t('agentAi.providerDefault', { provider: ownDefault ? ownDefault.title : String(providers.default || '') })}
          options=${provList.map(p => ({ value: p.id, label: p.title }))} />
        ${provSaved && html`<${Note} kind="message" error=${provSaved.error} role="status">
          ${provSaved.error ? provSaved.text : t('agentAi.providerSaved', {
            provider: (provList.find(p => p.id === (provSaved.id || providers.default)) || {}).title || String(provSaved.id || providers.default || ''),
          })}<//>`}
      `)}

      ${part(t('agentAi.capTitle'), html`
        <${Note}>${t('agentAi.capDesc', { spent: money(data.spent_today_usd) })}<//>
        <${TextField} type="number" min="0" step="0.1" size="short" ariaLabel=${t('agentAi.capLabel')} placeholder=${t('agentAi.capNone')}
          value=${cap} disabled=${!!busy} onInput=${setCap}
          actions=${html`<${Action} small disabled=${!!busy}
            onClick=${() => put({ daily_usd: cap.trim() === '' ? null : Number(cap) }, 'agentAi.saved')}>${t('agentAi.save')}<//>`} />
      `)}

      ${part(t('agentAi.gateTitle'), html`
        <${Note}>${t('agentAi.gateDesc')}<//>
        <${Choice} ariaLabel=${t('agentAi.gateTitle')} value=${data.gate} disabled=${!!busy}
          options=${['rule', 'on', 'off'].map(g => ({ value: g, label: t(`agentAi.gate.${g}`) }))}
          onChange=${g => put({ gate: g }, 'agentAi.saved')} />
      `)}

      ${part(t('agentAi.qualityTitle'), html`
        <${FigureStrip} flush items=${[
          { key: 'decisions', n: q.decisions ?? 0, label: t('agentAi.q.decisions') },
          { key: 'stops', n: q.gateStops ?? 0, label: t('agentAi.q.gateStops') },
          { key: 'overridden', n: q.overridden ?? 0, label: t('agentAi.q.overridden') },
          { key: 'cost', n: money(q.costUsd), label: t('agentAi.q.cost') },
        ]} />
        ${Object.keys(data.quality_by_rule || {}).length > 0 && html`
          <${List} cols="name" dense>
            ${Object.entries(data.quality_by_rule).map(([rule, r]) => html`
              <${Row} key=${rule}>
                <${Name} meta=${t('agentAi.q.perRule', {
                  decisions: String(r.decisions), stops: String(r.gateStops), overridden: String(r.overridden), cost: money(r.costUsd),
                })}>${rule}<//>
              <//>`)}
          <//>`}
      `)}
    <//><//>`;
}

export default AgentAiSection;
