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
 *   v1.8.0 — 2026-09-26 — Every part is a component that takes data (page group G1a): the box is Box,
 *     the heading SubHeading, the lines Note, the picker the Select with its two named groups as
 *     data, the doors Action; the current choice stands in the text's own colour, as before.
 *   v1.7.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.6.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.5.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.4.0 — 2026-09-25 — A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.3.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.2.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 — 2026-09-09 — Initial. `llm_profile` had been carried in the definition and honoured by
 *     nothing since the JSON crew shipped.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPut } from '/js/api.js';
import { Box } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { Action } from '/components/Action.js';
import { Row } from '/components/Layout.js';

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

  const options = [
    profiles.length > 0 && { group: t(`${K}.profiles`), options: profiles.map(p => ({ value: `profile:${p}`, label: p })) },
    models.length > 0 && { group: t(`${K}.models`), options: models.map(m => ({ value: `model:${m.label}`, label: m.label })) },
  ].filter(Boolean);

  return html`
    <${Box}>
      <${SubHeading}>${t(`${K}.title`)}<//>
      <${Note}>${t(`${K}.hint`)}<//>

      ${nothingToOffer ? html`
        ${/* A CHOICE CAN EXIST WITH NO LIST TO SHOW IT IN: it was made while the agent was up, or
              from a chat, and the machine has not reported since. Saying only "never said which
              models" would tell the owner nothing is set while something is. */''}
        ${choice && html`
          <${Row} wrap gap="medium">
            <span>
              ${t(inherited ? `${K}.currentInherited` : `${K}.current`, {
                what: choice.value.profile || choice.value.label || '',
              })}
            </span>
            ${!inherited && html`
              <${Action} small disabled=${busy} onClick=${() => save('')}>
                ${t(`${K}.clear`)}
              <//>`}
          <//>`}
        <${Note} kind="quiet">${t(`${K}.noneKnown`)}<//>
      ` : html`
        <${Row} wrap gap="medium">
          <${Select} ariaLabel=${t(`${K}.title`)} disabled=${busy} value=${current} onChange=${save}
            placeholder=${inherited ? t(`${K}.inherited`) : t(`${K}.unset`)} options=${options} />
          <${Action} small disabled=${busy || !current} onClick=${saveDefault}>
            ${t(`${K}.setDefault`)}
          <//>
        <//>
        <${Note}>
          ${inherited && choice?.value
            ? t(`${K}.inheritedFrom`, { what: choice.value.profile || choice.value.label || '' })
            : t(menu?.source === 'runtime' ? `${K}.fromRuntime` : `${K}.fromCatalog`)}
        <//>
      `}
    <//>
  `;
}
