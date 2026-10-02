/**
 * @file public/views/profile/agents/basic-agents-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "create my basic agents" section: one press, two working agents.
 *
 *   It exists because the alternative is the road every other agent takes — install a connector,
 *   run a command, paste a prompt into a chat, approve a code — and someone who has just arrived
 *   should be able to have agents before learning any of that.
 *
 *   THE ONE PRECONDITION IS STATED UP FRONT, not discovered by pressing. The agents run in the
 *   person's own `aimeat connect serve`, so with nothing connected there is nothing to run them; the
 *   section says that and disables the action rather than letting the press fail. The state comes
 *   from the node (GET /v1/agents/v2/basic-agents), which is also where the SET is defined — this
 *   panel carries no list of its own, so the names can change on the node without touching it.
 *
 *   THE SECTION FOLDS. Open while there is something to press; once both agents exist it closes to
 *   one line, and whichever way the person leaves it, this browser remembers (tab-helpers loadFold).
 *
 * @structure BasicAgentsPanel({ session, showToast, onCreated, first })
 * @usage <${BasicAgentsPanel} session=${session} showToast=${showToast} onCreated=${loadData} />
 * @version-history
 *   v2.15.0 — 2026-10-02 — "Starts on its own" reads `task_start`, the agent's own start setting,
 *     instead of `mode === 'task-runner'`.
 *   v2.14.0 — 2026-10-01 — The words say the two agents run on the person's computer, and with no
 *     connector running the install commands stand inline (agent-guide.js ConnectorSteps); "you do
 *     not have to set anything up" was false for everyone without one. `num` sets the section number,
 *     02 on the Agents page under "What should an agent do?" (guided journey P4).
 *   v2.13.0 — 2026-09-26 — Every part is a component that takes data (page group G1a): the section is
 *     Section, the leads and the hint are Note, the connector's state is the Mark status, the run
 *     mode's tag is dim again as on main (og-chip--dim), "you have it" is the numbered step's end word,
 *     the one press is Loud in the Actions row.
 *   v2.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.11.0 — 2026-09-26 — A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v2.10.0 — 2026-09-25 — The sentence under the two agents is a lead (.og-lead); it keeps only its margin (a unification: the look most tabs use).
 *   v2.9.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger), a unification: Jouni's decision Status.
 *   v2.8.0 — 2026-09-25 — The one line a folded section shows is its lead (.og-lead); it keeps only its margin (a unification: the look most tabs use).
 *   v2.7.0 — 2026-09-25 — The two agents are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v2.6.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.5.0 — 2026-09-25 — A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v2.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v2.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v2.0.0 — 2026-09-14 — The poster face (design canvas "Your Agents"): a numbered B1 section with
 *     an Open/Close door the browser remembers, the two agents as numbered rows, one slab.
 *   2026-09-13 -- V2y: compose the section headline with the shared B1 class.
 *   2026-09-03 — An `emphasis` prop so the Agents section can render the button as an outline, and
 *     the acts-alone notice agrees with itself when there is one name. Default unchanged.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { areaLine } from '/js/consent-vocab.js';
import { Section } from '/components/Section.js';
import { loadFold, saveFold } from './tab-helpers.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Note } from '/components/Note.js';
import { Mark, Marks } from '/components/Mark.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { ConnectorSteps } from './agent-guide.js';

const p = (key, vars) => t('profile.agents.page.' + key, vars);

export default function BasicAgentsPanel({ session, showToast, onCreated, first = false, num = '01' }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  // null until the person chooses: open while there is still something to press, closed once
  // both agents exist. The choice, once made, is this browser's.
  const [fold, setFold] = useState(() => loadFold(session?.owner, 'basic', null));

  async function load() {
    try {
      const resp = await apiGet('/v1/agents/v2/basic-agents');
      setState(resp?.data ?? null);
    } catch (err) { swallowed('basic-agents-panel: load', err); setState(null); }
  }

  useEffect(() => { if (session) { load(); setFold(loadFold(session.owner, 'basic', null)); } }, [session]);

  // The connector connecting or dropping is an `agents` change, so this panel re-reads on the same
  // event the fleet list does — otherwise the line would still say "not connected" a minute after
  // the person started their connector.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !d.has('agents')) return;
      loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function create() {
    setBusy(true);
    try {
      const resp = await apiPost('/v1/agents/v2/basic-agents', {});
      const made = resp?.data?.enrolled?.length ?? 0;
      showToast(made > 0
        ? t('profile.agents.basic.done').replace('{count}', String(made))
        : t('profile.agents.basic.alreadyThere'));
      await load();
      onCreated?.();
    } catch (err) {
      showToast(err?.message || t('profile.agents.basic.failed'), true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const list = state.agents ?? [];
  const missing = list.filter(a => !a.exists || !a.enrolled);
  const allThere = missing.length === 0;
  const connected = state.daemon_connected === true;
  const open = fold === null ? !allThere : fold;
  const toggle = () => { const next = !open; setFold(next); saveFold(session?.owner, 'basic', next); };
  // `task_start: automatic` is the person saying "start without asking me each time":
  // services/agent-task-rules.ts starts a task for such an agent without the owner. That is the
  // single most consequential thing about this button, so it is named rather than left in a field
  // nobody outside the code reads. An older node sends no task_start; its rule was the mode.
  const startsAlone = (a) => (a.task_start ? a.task_start === 'automatic' : a.mode === 'task-runner');
  const actsAlone = list.filter(startsAlone);
  const names = list.map(a => a.display_name || a.name).join(', ');
  const connectorWord = connected
    ? html`<${Mark} kind="status" tone="fine">✓ ${t('profile.agents.basic.connected')}<//>`
    : html`<${Mark} kind="status" tone="attention">✗ ${t('profile.agents.basic.notConnected')}<//>`;
  const door = html`<${Action} small soft onClick=${toggle}>${open ? p('close') : p('open')}<//>`;

  return html`
    <${Section} id="agp-basic" num=${num} title=${t('profile.agents.basic.title')}
      count=${allThere ? t('profile.agents.basic.allThere') : null} doors=${door} first=${first}>
      ${!open ? html`
        <${Note} kind="lead">
          ${allThere ? p('basicHaveLine', { names }) : p('basicMissingLine', { n: missing.length })}
          ${' '}${connectorWord}
        <//>` : html`
        <${Note} kind="lead">${t('profile.agents.basic.desc')}<//>
        <div>${connectorWord}</div>
        ${!connected && html`<${Note}>${t('profile.agents.basic.notConnectedHint')}<//>
          <${ConnectorSteps} session=${session} />`}
        <${IndexList} steps>
          ${list.map((a) => html`
            <${IndexStep} key=${a.name}
              line=${html`${a.description}
                ${(a.scopes ?? []).length > 0 && html`<br /><small>${t('profile.agents.basic.reaches')} ${areaLine(a.scopes, t)}</small>`}`}
              endWord=${a.enrolled ? t('profile.agents.basic.have') : null}>
              ${a.display_name || a.name}
              <${Marks}>
                ${/* The run mode counts nothing yet, so its tag is dim, as main drew it (og-chip--dim). */''}
                <${Mark} tone="dim">${t(`profile.agents.runMode.${a.run_mode}`)}<//>
                ${startsAlone(a) && html`<${Mark} tone="coral" title=${t('profile.agents.basic.actsAloneWhy')}>${t('profile.agents.basic.actsAlone')}<//>`}
              <//>
            <//>
          `)}
        <//>
        ${actsAlone.length > 0 && html`
          <${Note} kind="lead">
            ${/* One name took the plural verb: "Workflow manager start work as soon as it
                  arrives". The template was written for a list and there is usually one. */''}
            ${t(actsAlone.length === 1 ? 'profile.agents.basic.actsAloneNoticeOne' : 'profile.agents.basic.actsAloneNotice')
              .replace('{names}', actsAlone.map(a => a.display_name || a.name).join(', '))}
          <//>`}
        ${!allThere && html`
          <${Actions}>
            <${Loud} control disabled=${!connected || busy} onClick=${create}>
              ${busy ? t('profile.agents.basic.working') : t('profile.agents.basic.button')}
            <//>
          <//>`}
      `}
    <//>
  `;
}
