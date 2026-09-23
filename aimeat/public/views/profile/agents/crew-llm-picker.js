/**
 * @file public/views/profile/agents/crew-llm-picker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which model this agent thinks with, and the same choice for every agent at once.
 *
 *   WHY IT IS HERE AND NOT ON THE MACHINE. The definition lives on the node and the person editing
 *   it is looking at this page; the model that runs it lived in `llm_providers.json` on whatever box
 *   the fleet happens to run on, reachable from a terminal. So the crew and the mind behind it were
 *   configured in two places by two people. The choice is now a memory record in the owner's own
 *   namespace and the runtime reads it.
 *
 *   THE LIST COMES FROM THE RUNTIME. Profiles and models are what THAT machine can reach, read from
 *   GET /crew/menu — live when the agent is connected, otherwise the catalogue it published at its
 *   last start. When neither exists there is no picker and the panel says so, because offering an
 *   empty select would look like the machine has no models rather than like nobody has asked it.
 *
 *   A KEY IS NEVER STORED. A model entry names `api_key_env`, an environment variable on that
 *   machine; the service refuses a provider block that carries anything that looks like a key.
 * @structure CrewLlmPicker({ agentName, menu, onSaved, showToast })
 * @usage <${CrewLlmPicker} agentName=${name} menu=${menu} onSaved=${reload} showToast=${showToast} />
 * @version-history
 *   2026-09-22 -- Composed from the shared parts (Section, Field, Action, Text). The shared select has
 *     no option groups, so the Profiles and Models names are disabled rows above their options.
 *   v1.0.0 — 2026-09-09 — Initial. `llm_profile` had been carried in the definition and honoured by
 *     nothing since the JSON crew shipped.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPut } from '/js/api.js';
import { Section, Stack, Field, Action, Text } from '/components/poster-parts.js';

const K = 'profile.agents.detail.crew.llm';

/** The provider block as the runtime built it, minus the display label the picker added. */
function providerOf(model) {
  const provider = { ...(model ?? {}) };
  delete provider.label;
  return provider;
}

/** The stored choice as one value the select can hold: 'profile:<name>' or 'model:<label>'. */
function asValue(choice) {
  if (!choice) return '';
  if (choice.kind === 'profile') return `profile:${choice.profile}`;
  if (choice.kind === 'model') return `model:${choice.label ?? ''}`;
  return '';
}

export default function CrewLlmPicker({ agentName, menu, onSaved, showToast }) {
  const [busy, setBusy] = useState(false);
  const profiles = menu?.profiles ?? [];
  const models = menu?.models ?? [];
  const choice = menu?.choice ?? null;
  // A choice that came from the owner's default is shown as inherited, not as this agent's own —
  // otherwise clearing it would look like it changed nothing.
  const inherited = choice?.scope === 'default';
  const current = inherited ? '' : asValue(choice?.value);

  async function save(value) {
    setBusy(true);
    try {
      let body = null;
      if (value.startsWith('profile:')) {
        body = { kind: 'profile', profile: value.slice(8) };
      } else if (value.startsWith('model:')) {
        const label = value.slice(6);
        const m = models.find(x => x.label === label);
        if (!m) throw new Error(t(`${K}.unknownModel`));
        // The provider block travels whole, as the runtime built it: it names the endpoint, the
        // model id, the context window and the env var holding the key. Rebuilding it here would be
        // this node deciding what a provider is, which is the drift this whole feature removes.
        body = { kind: 'model', label, provider: providerOf(m) };
      }
      await apiPut(`/v1/agents/${encodeURIComponent(agentName)}/crew/llm`, { choice: body });
      showToast?.(body ? t(`${K}.saved`) : t(`${K}.cleared`));
      onSaved?.();
    } catch (err) {
      showToast?.(err?.message || t(`${K}.failed`), true);
    } finally {
      setBusy(false);
    }
  }

  async function saveDefault() {
    if (!current) { showToast?.(t(`${K}.pickFirst`), true); return; }
    setBusy(true);
    try {
      const body = current.startsWith('profile:')
        ? { kind: 'profile', profile: current.slice(8) }
        : (() => {
            const label = current.slice(6);
            return { kind: 'model', label, provider: providerOf(models.find(x => x.label === label)) };
          })();
      await apiPut('/v1/agents/llm-default', { choice: body });
      showToast?.(t(`${K}.savedDefault`));
      onSaved?.();
    } catch (err) {
      showToast?.(err?.message || t(`${K}.failed`), true);
    } finally {
      setBusy(false);
    }
  }

  const nothingToOffer = profiles.length === 0 && models.length === 0;

  // The shared Field has no option groups, so each group's name is a disabled row above its options.
  const options = [
    { value: '', label: inherited ? t(`${K}.inherited`) : t(`${K}.unset`) },
    ...(profiles.length > 0 ? [{ value: '#profiles', label: t(`${K}.profiles`), disabled: true },
      ...profiles.map(p => ({ value: `profile:${p}`, label: p }))] : []),
    ...(models.length > 0 ? [{ value: '#models', label: t(`${K}.models`), disabled: true },
      ...models.map(m => ({ value: `model:${m.label}`, label: m.label }))] : []),
  ];

  return html`
    <${Section} size="small" density="compact" title=${t(`${K}.title`)} description=${t(`${K}.hint`)}>
      ${nothingToOffer ? html`
        <${Stack} density="compact">
          ${/* A CHOICE CAN EXIST WITH NO LIST TO SHOW IT IN: it was made while the agent was up, or
                from a chat, and the machine has not reported since. Saying only "never said which
                models" would tell the owner nothing is set while something is. */''}
          ${choice && html`
            <${Stack} direction="wrap" align="center" density="compact">
              <${Text}>
                ${t(inherited ? `${K}.currentInherited` : `${K}.current`, {
                  what: choice.value.profile || choice.value.label || '',
                })}
              <//>
              ${!inherited && html`
                <${Action} kind="text" disabled=${busy} onClick=${() => save('')}>${t(`${K}.clear`)}<//>`}
            <//>`}
          <${Text} tone="muted">${t(`${K}.noneKnown`)}<//>
        <//>
      ` : html`
        <${Stack} density="compact">
          <${Stack} direction="wrap" align="end" density="compact">
            <${Field} type="select" disabled=${busy} value=${current} options=${options} onChange=${e => save(e.target.value)} />
            <${Action} kind="text" disabled=${busy || !current} onClick=${saveDefault}>${t(`${K}.setDefault`)}<//>
          <//>
          <${Text} kind="caption" tone="muted">
            ${inherited && choice?.value
              ? t(`${K}.inheritedFrom`, { what: choice.value.profile || choice.value.label || '' })
              : t(menu?.source === 'runtime' ? `${K}.fromRuntime` : `${K}.fromCatalog`)}
          <//>
        <//>
      `}
    <//>
  `;
}
